/**
 * Vault — the Aegis primary screen, mounted at "/" inside AppLayout
 * (SPA pages/Vault.tsx full port; replaces the foundation's temporary
 * two-pane page).
 *
 * Three columns:
 *   - left:   <FolderTree> (folder filtering + a 收藏 virtual node)
 *   - center: a searchable resource list (.reslist) of .rescard rows
 *   - right:  <SecretPanel> — encrypted-by-default detail with background
 *             reveal, ACL and comments tabs.
 *
 * E2EE: v4 rows pass through; v5 rows are transparently decrypted into the same
 * display fields via the METADATA_DECRYPT_BATCH background RPC
 * (useResolvedResources). Reveal/copy of a secret happens in the background —
 * plaintext reaches this iframe only as already-displayable fields.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { Plus, Search, Star, Lock, AlertTriangle, Clock, X, ArrowDownUp } from 'lucide-react';
import type { Resource, ResourceType } from '../../../shared/types';
import { describeApiError } from '../../lib/errors';
import { tf } from '../../lib/i18n';
import { deleteResource } from '../../services/resources';
import { getResourceTypes } from '../../services/settings';
import { addFavorite, removeFavorite, FavoriteAlreadyExistsError } from '../../services/favorites';
import { useToast } from '../../lib/toast';
import { ConfirmDialog } from '../../components/ConfirmDialog';
import ShareDialog from '../../components/share/ShareDialog';
import ImportExportModal from '../../components/importexport/ImportExportModal';
import FolderTree, { RESOURCE_DRAG_MIME } from './FolderTree';
import { useVaultData } from './useVaultData';
import { useResolvedResources } from './useResolvedResources';
import { SecretPanel, tileColor, tileLetter } from './SecretPanel';
import { ResourceFormModal } from './ResourceFormModal';
import { MoveDialog } from './MoveDialog';
import './vault.css';

/** Debounce a fast-changing value (used for the search box). */
function useDebounced<T>(value: T, delay = 200): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const t = window.setTimeout(() => setDebounced(value), delay);
    return () => window.clearTimeout(t);
  }, [value, delay]);
  return debounced;
}

/** ⌘ on macOS/iOS, Ctrl elsewhere — drives both the <kbd> hint and the shortcut. */
const IS_APPLE = /Mac|iP(hone|od|ad)/i.test(
  (navigator as Navigator & { userAgentData?: { platform?: string } }).userAgentData?.platform ??
    navigator.platform,
);

function expiryState(iso: string | null | undefined): 'expired' | 'soon' | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  const days = Math.round((d.getTime() - Date.now()) / 86_400_000);
  if (days < 0) return 'expired';
  if (days <= 14) return 'soon';
  return null;
}

export default function VaultPage() {
  const toast = useToast();
  const { resources, folders, folderMembership, initialLoading, error, refetch } = useVaultData();

  // Format-transparent display projection (v4 pass-through; v5 decrypted in the
  // background and merged in place).
  const { display, resolving } = useResolvedResources(resources);

  const [resourceTypes, setResourceTypes] = useState<ResourceType[]>([]);

  // Filters
  const [search, setSearch] = useState('');
  const debouncedSearch = useDebounced(search);
  const searchRef = useRef<HTMLInputElement>(null);
  const [favoritesOnly, setFavoritesOnly] = useState(false);
  const [selectedFolderId, setSelectedFolderId] = useState<string | null>(null);

  // Selection (drives the inline SecretPanel) + mutation state
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [editing, setEditing] = useState<Resource | null>(null);
  const [creating, setCreating] = useState(false);
  const [importExport, setImportExport] = useState(false);
  const [sharing, setSharing] = useState<Resource | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<Resource | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [favBusyId, setFavBusyId] = useState<string | null>(null);
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [moving, setMoving] = useState<Resource | null>(null);

  useEffect(() => {
    getResourceTypes()
      .then(setResourceTypes)
      .catch(() => setResourceTypes([]));
  }, []);

  // ⌘K / Ctrl+K focuses the search box (backs the <kbd> hint in the header).
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && !e.altKey && !e.shiftKey && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        searchRef.current?.focus();
        searchRef.current?.select();
      }
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, []);

  const filtered = useMemo(() => {
    const q = debouncedSearch.trim().toLowerCase();
    const folderSet = selectedFolderId ? folderMembership.get(selectedFolderId) : null;
    return display.filter((r) => {
      if (favoritesOnly && !r.favorite) return false;
      if (folderSet && !folderSet.has(r.id)) return false;
      if (!q) return true;
      // username/uri are nullable on v4 resources (optional columns; the app-side
      // listResources does not normalize them) — coerce before lowercasing.
      return (
        r.name.toLowerCase().includes(q) ||
        (r.username ?? '').toLowerCase().includes(q) ||
        (r.uri ?? '').toLowerCase().includes(q)
      );
    });
  }, [display, debouncedSearch, favoritesOnly, selectedFolderId, folderMembership]);

  // Keep a valid selection: default to the first row; clear when empty.
  useEffect(() => {
    if (filtered.length === 0) {
      setSelectedId(null);
      return;
    }
    setSelectedId((cur) => (cur && filtered.some((r) => r.id === cur) ? cur : filtered[0].id));
  }, [filtered]);

  const selected = filtered.find((r) => r.id === selectedId) ?? null;

  // Invert folderMembership into resourceId -> folderId so the move dialog can
  // preselect a resource's current folder (a resource lives in at most one
  // folder per user; membership comes from folders_relations).
  const resourceFolderId = useMemo(() => {
    const m = new Map<string, string>();
    for (const [folderId, ids] of folderMembership) {
      for (const rid of ids) m.set(rid, folderId);
    }
    return m;
  }, [folderMembership]);

  const toggleFavorite = async (resource: Resource) => {
    setFavBusyId(resource.id);
    try {
      if (resource.favorite) {
        await removeFavorite(resource.favorite.id);
        toast.success(tf('app.vault.toast.favRemoved', '已取消收藏'));
      } else {
        await addFavorite(resource.id);
        toast.success(tf('app.vault.toast.favAdded', '已加入收藏'));
      }
      await refetch();
    } catch (err) {
      if (err instanceof FavoriteAlreadyExistsError) {
        await refetch();
      } else {
        toast.error(describeApiError(err));
      }
    } finally {
      setFavBusyId(null);
    }
  };

  const confirmDelete = async () => {
    if (!deleteTarget) return;
    setDeleting(true);
    try {
      await deleteResource(deleteTarget.id);
      toast.success(tf('app.vault.toast.deleted', '凭据已删除'));
      if (selectedId === deleteTarget.id) setSelectedId(null);
      setDeleteTarget(null);
      await refetch();
    } catch (err) {
      toast.error(describeApiError(err));
    } finally {
      setDeleting(false);
    }
  };

  const scopeName = debouncedSearch.trim()
    ? tf('app.vault.scope.searchResults', '搜索结果')
    : favoritesOnly
      ? tf('app.vault.scope.favorites', '收藏')
      : selectedFolderId
        ? folders.find((f) => f.id === selectedFolderId)?.name ?? tf('app.vault.scope.folder', '文件夹')
        : tf('app.vault.scope.all', '全部凭据');

  return (
    <div className="vault">
      {/* Left: folder navigation */}
      <FolderTree
        selectedFolderId={selectedFolderId}
        onSelect={(id) => {
          setSelectedFolderId(id);
          if (id !== null) setFavoritesOnly(false);
        }}
        favoritesOnly={favoritesOnly}
        onToggleFavorites={(on) => {
          setFavoritesOnly(on);
          if (on) setSelectedFolderId(null);
        }}
        onResourceMoved={() => void refetch()}
      />

      {/* Center: resource list */}
      <div className="reslist">
        <div className="reslist-head">
          <div className="searchbox">
            <Search />
            <input
              ref={searchRef}
              placeholder={tf('app.vault.search.placeholder', '搜索凭据、用户名、网址…')}
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
            {search ? (
              <button className="star" onClick={() => setSearch('')} title={tf('app.vault.search.clear', '清除')}>
                <X />
              </button>
            ) : (
              <kbd>{IS_APPLE ? '⌘K' : 'Ctrl K'}</kbd>
            )}
          </div>
          <div className="reslist-meta">
            <span className="count">
              {tf('app.vault.meta.count', '{{count}} 项 · {{scope}}', {
                count: filtered.length,
                scope: scopeName,
              })}
            </span>
            {resolving && (
              <span className="count" style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                <span className="spin-ring" /> {tf('app.vault.meta.decrypting', '解密中…')}
              </span>
            )}
            <button
              className="btn sm"
              style={{ marginLeft: 'auto' }}
              onClick={() => setImportExport(true)}
              title={tf('app.vault.ie.title', '导入 / 导出密码')}
            >
              <ArrowDownUp /> {tf('app.vault.ie.button', '导入/导出')}
            </button>
            <button className="btn primary sm" onClick={() => setCreating(true)}>
              <Plus /> {tf('app.vault.actions.create', '新建')}
            </button>
          </div>
        </div>

        <div className="reslist-scroll">
          {initialLoading ? (
            <div className="empty">
              <div className="ico">
                <span className="spin-ring" style={{ width: 26, height: 26 }} />
              </div>
              <h3>{tf('app.vault.list.loadingVault', '正在解密你的保险库…')}</h3>
            </div>
          ) : error ? (
            <div className="empty">
              <div className="ico">
                <AlertTriangle />
              </div>
              <h3>{tf('app.vault.list.loadFailed', '加载失败')}</h3>
              <p>{error}</p>
            </div>
          ) : filtered.length === 0 ? (
            <div className="empty">
              <div className="ico">{search ? <Search /> : <Lock />}</div>
              <h3>
                {search
                  ? tf('app.vault.list.noMatch', '没有匹配的凭据')
                  : resources.length === 0
                    ? tf('app.vault.list.emptyVault', '保险库是空的')
                    : tf('app.vault.list.noResourcesYet', '这里还没有凭据')}
              </h3>
              <p>
                {search
                  ? tf('app.vault.list.noMatchHint', '没有找到与「{{query}}」相关的结果，换个关键词试试。', {
                      query: search,
                    })
                  : tf(
                      'app.vault.list.emptyHint',
                      '点击右上角「新建」添加你的第一条凭据——它会在离开浏览器前先在本地加密。',
                    )}
              </p>
              {!search && (
                <button className="btn primary sm" onClick={() => setCreating(true)}>
                  <Plus /> {tf('app.vault.actions.createResource', '新建凭据')}
                </button>
              )}
            </div>
          ) : (
            filtered.map((r) => {
              const exp = expiryState(r.expired);
              return (
                <button
                  key={r.id}
                  className={`rescard${r.id === selectedId ? ' active' : ''}`}
                  draggable
                  onDragStart={(e) => {
                    e.dataTransfer.setData(RESOURCE_DRAG_MIME, r.id);
                    e.dataTransfer.setData('text/plain', r.id);
                    e.dataTransfer.effectAllowed = 'move';
                    setDraggingId(r.id);
                  }}
                  onDragEnd={() => setDraggingId(null)}
                  title={tf('app.vault.list.dragHint', '拖到文件夹可移动')}
                  style={{ opacity: draggingId === r.id ? 0.45 : 1 }}
                  onClick={() => setSelectedId(r.id)}
                >
                  <span className="res-ico" style={{ background: tileColor(r.id) }}>
                    {tileLetter(r.name)}
                  </span>
                  <span className="res-mid">
                    <span className="res-name">
                      <span className="nm">{r.name}</span>
                      {exp === 'expired' && <AlertTriangle style={{ width: 13, height: 13, color: 'var(--red)' }} />}
                      {exp === 'soon' && <Clock style={{ width: 13, height: 13, color: 'var(--amber)' }} />}
                    </span>
                    <span className="res-sub">{r.username || r.uri || '—'}</span>
                  </span>
                  <span className="res-right">
                    <span
                      className={`star${r.favorite ? ' on' : ''}`}
                      role="button"
                      tabIndex={0}
                      aria-label={
                        r.favorite
                          ? tf('app.vault.actions.unfavorite', '取消收藏')
                          : tf('app.vault.actions.favorite', '收藏')
                      }
                      onClick={(e) => {
                        e.stopPropagation();
                        if (favBusyId !== r.id) void toggleFavorite(r);
                      }}
                    >
                      <Star style={r.favorite ? { fill: 'currentColor' } : undefined} />
                    </span>
                    <Lock style={{ width: 14, height: 14, color: 'var(--text-3)' }} />
                  </span>
                </button>
              );
            })
          )}
        </div>
      </div>

      {/* Right: secret detail panel (inline) */}
      {selected ? (
        <SecretPanel
          key={selected.id}
          resource={selected}
          resourceTypes={resourceTypes}
          onEdit={(r) => setEditing(r)}
          onShare={(r) => setSharing(r)}
          onMove={(r) => setMoving(r)}
          onToggleFavorite={toggleFavorite}
          onDelete={(r) => setDeleteTarget(r)}
          favBusy={favBusyId === selected.id}
        />
      ) : (
        <div className="panel">
          <div className="empty" style={{ flex: 1 }}>
            <div className="ico">
              <Lock />
            </div>
            <h3>{tf('app.vault.panel.selectPrompt', '选择一个凭据')}</h3>
            <p>{tf('app.vault.panel.selectHint', '从中间的列表选择一项，即可查看并按需在本地解密其密码。')}</p>
          </div>
        </div>
      )}

      {/* Create / edit modal (plaintext form -> RESOURCE_SAVE RPC) */}
      <ResourceFormModal
        open={creating || !!editing}
        resource={editing}
        resourceTypes={resourceTypes}
        folders={folders}
        defaultFolderId={selectedFolderId}
        onClose={() => {
          setCreating(false);
          setEditing(null);
        }}
        onSaved={() => {
          void refetch();
        }}
      />

      {/* Import / Export (CSV + KDBX) — parsing/crypto live in the background. */}
      <ImportExportModal
        open={importExport}
        resourceIds={display.map((r) => r.id)}
        onClose={() => setImportExport(false)}
        onImported={() => void refetch()}
      />

      {/* Share dialog */}
      {sharing && (
        <ShareDialog
          open={!!sharing}
          resource={sharing}
          onClose={(didChange) => {
            setSharing(null);
            if (didChange) void refetch();
          }}
        />
      )}

      {/* Move dialog — folder change is a standalone op, separate from edit. */}
      <MoveDialog
        resource={moving}
        currentFolderId={moving ? resourceFolderId.get(moving.id) ?? null : null}
        folders={folders}
        onClose={() => setMoving(null)}
        onMoved={refetch}
      />

      {/* Delete confirmation */}
      <ConfirmDialog
        open={!!deleteTarget}
        title={tf('app.vault.delete.title', '删除凭据')}
        message={
          <>
            {tf('app.vault.delete.messageBefore', '删除')}{' '}
            <strong style={{ color: 'var(--text)' }}>{deleteTarget?.name ?? ''}</strong>
            {tf('app.vault.delete.messageAfter', '？这会对所有共享对象一并移除。你必须是该凭据的拥有者。')}
          </>
        }
        confirmLabel={tf('app.common.actions.delete', '删除')}
        cancelLabel={tf('app.common.actions.cancel', '取消')}
        danger
        loading={deleting}
        onConfirm={confirmDelete}
        onCancel={() => setDeleteTarget(null)}
      />
    </div>
  );
}

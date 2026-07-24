/**
 * FolderTree — Aegis "folders" column (SPA components/FolderTree.tsx port).
 *
 * Fetches the flat /folders.json list (via the API_CALL pass-through service)
 * and nests it client-side; renders the "全部凭据" root + a virtual "收藏"
 * node; supports create / rename / share / export / move / cascade-aware
 * delete, and accepts HTML5 drops of BOTH resources (from the resource list)
 * and folders (from this tree), moving them via PUT /move/{Resource,Folder}
 * — note the CAPITALIZED /move casing vs lowercase /share.
 *
 * Folders carry no secret material, so this component performs NO crypto — the
 * folder ShareDialog below likewise only moves permission rows (SHARE_APPLY's
 * folder branch skips both simulate and secret re-encryption).
 */
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type DragEvent,
  type FormEvent,
} from 'react';
import {
  ChevronRight,
  Download,
  Folder as FolderIcon,
  FolderPlus,
  MoreHorizontal,
  Pencil,
  Plus,
  Share2,
  Star,
  Trash2,
  Users,
  Vault as VaultIcon,
  Move as MoveIcon,
} from 'lucide-react';
import { Modal } from '../../components/Modal';
import { ConfirmDialog } from '../../components/ConfirmDialog';
import ShareDialog from '../../components/share/ShareDialog';
import { useToast } from '../../lib/toast';
import { tf } from '../../lib/i18n';
import { describeApiError } from '../../lib/errors';
import type { Folder, FolderNode } from '../../../shared/types';
import {
  buildFolderTree,
  createFolder,
  deleteFolder,
  listFolders,
  moveFolder,
  moveResource,
  renameFolder,
} from '../../services/folders';

// ---------------------------------------------------------------------------
// Public contract — kept compatible with the Vault page.
// ---------------------------------------------------------------------------
export interface FolderTreeProps {
  /** Currently selected folder id (null = 全部凭据 / root). */
  selectedFolderId: string | null;
  /** Called when a folder (or the All node) is selected. null = 全部凭据. */
  onSelect: (folderId: string | null) => void;
  /** Whether the virtual "收藏" node is active. */
  favoritesOnly?: boolean;
  /** Toggle the parent's favorites-only filter. */
  onToggleFavorites?: (on: boolean) => void;
  /** Called after a drag-dropped resource has been successfully moved. */
  onResourceMoved?: () => void;
  /**
   * Called after the folder SET changes here (create / rename / move / delete).
   * The parent owns a second copy of the folders (folderMembership from
   * useVaultData); without this it goes stale — a freshly created folder would
   * be absent from the parent's membership map until an unrelated refetch.
   */
  onFoldersChanged?: () => void;
  /**
   * Bump to force a reload of the tree — the mirror image of
   * onFoldersChanged above.
   *
   * The tree owns its own folder list, so changes made OUTSIDE it (an import
   * creating a whole subtree, most visibly) are invisible here until the
   * component remounts, i.e. until the user reloads the page. Incrementing
   * this from the parent after such an operation refetches the tree in place.
   */
  reloadKey?: number;
  /**
   * Asks the parent to export this folder's subtree. Optional: without it the
   * "导出" menu entry is not rendered at all (the tree cannot export on its own
   * — the export scope needs the parent's resolved resource list).
   */
  onExportFolder?: (folder: Folder) => void;
}

/** The drag-and-drop MIME type the resource list sets on a dragged row. */
export const RESOURCE_DRAG_MIME = 'application/x-jpassbolt-resource-id';

/**
 * The drag-and-drop MIME type a dragged FOLDER row carries. Deliberately
 * distinct from RESOURCE_DRAG_MIME and deliberately NOT accompanied by a
 * text/plain copy: readDroppedResourceId() below accepts any UUID found in
 * text/plain, and a folder id is a UUID too — a text/plain folder id would be
 * mistaken for a resource id and moved with PUT /move/Resource/{folderId}.
 */
export const FOLDER_DRAG_MIME = 'application/x-jpassbolt-folder-id';

/**
 * Rough height of the open row menu, used only to decide whether it opens
 * upwards. The menu is position:absolute inside .folders-scroll (overflow-y:
 * auto), so a 6-entry menu on a row near the bottom would otherwise be clipped.
 * Flipping the INLINE offsets keeps this a zero-CSS change.
 */
const MENU_EST_HEIGHT = 250;

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------
/** Resource ids are backend UUIDs — reject anything else (e.g. dragged page text). */
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function readDroppedResourceId(e: DragEvent): string | null {
  // UUID-checked like the text/plain branch below, and like handleRowDrop does
  // for FOLDER_DRAG_MIME. Drag payloads are NOT same-origin data: the app runs
  // as an iframe injected into a server page, and in the zero-knowledge model
  // the server is untrusted — a compromised host page can set our proprietary
  // MIME to anything and bait a drag. The value is interpolated unencoded into
  // PUT /move/Resource/{id}.json, and the API_CALL guard only checks the path
  // starts with '/', so a value like '../../resources/{uuid}' would normalise
  // into a different endpoint. Anything that is not a bare UUID is dropped.
  const typed = e.dataTransfer.getData(RESOURCE_DRAG_MIME).trim();
  if (typed) return UUID_RE.test(typed) ? typed : null;
  // text/plain fallback: the resource list sets both types (vault/index.tsx),
  // but arbitrary browser drags (selected text, URLs) also carry text/plain —
  // only accept values that look like a resource UUID.
  const plain = e.dataTransfer.getData('text/plain').trim();
  return UUID_RE.test(plain) ? plain : null;
}

/** True if `candidateId` is `nodeId` itself or one of its descendants. */
function isSelfOrDescendant(
  nodeId: string,
  candidateId: string,
  byParent: Map<string | null, Folder[]>,
): boolean {
  if (nodeId === candidateId) return true;
  const stack = [...(byParent.get(nodeId) ?? [])];
  while (stack.length) {
    const f = stack.pop()!;
    if (f.id === candidateId) return true;
    stack.push(...(byParent.get(f.id) ?? []));
  }
  return false;
}

const ft = (k: string, fallback: string, vars?: Record<string, string | number>) =>
  tf(`app.components.folderTree.${k}`, fallback, vars);

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------
export default function FolderTree({
  selectedFolderId,
  onSelect,
  favoritesOnly = false,
  onToggleFavorites,
  onResourceMoved,
  onFoldersChanged,
  reloadKey = 0,
  onExportFolder,
}: FolderTreeProps) {
  const toast = useToast();
  const activeId = selectedFolderId;

  const [folders, setFolders] = useState<Folder[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [menuFor, setMenuFor] = useState<string | null>(null);
  /** Whether the open menu drops upwards (row too close to the scroller's end). */
  const [menuUp, setMenuUp] = useState(false);
  const [dropTargetId, setDropTargetId] = useState<string | null | 'root'>(null);
  /**
   * Id of the folder currently being dragged. Required because dragover /
   * dragenter run in the HTML5 "protected mode": only dataTransfer.types is
   * readable there, getData() returns "" — so the validity of a hovered target
   * can only be judged against an id captured at dragstart.
   */
  const [draggingFolderId, setDraggingFolderId] = useState<string | null>(null);

  const [shareTarget, setShareTarget] = useState<Folder | null>(null);

  const [createOpen, setCreateOpen] = useState(false);
  const [createName, setCreateName] = useState('');
  const [createParent, setCreateParent] = useState<string>('');
  const [createBusy, setCreateBusy] = useState(false);

  const [renameTarget, setRenameTarget] = useState<Folder | null>(null);
  const [renameName, setRenameName] = useState('');
  const [renameBusy, setRenameBusy] = useState(false);

  const [moveTarget, setMoveTarget] = useState<Folder | null>(null);
  const [moveParent, setMoveParent] = useState<string>('');
  const [moveBusy, setMoveBusy] = useState(false);

  const [deleteTarget, setDeleteTarget] = useState<Folder | null>(null);
  const [deleteCascade, setDeleteCascade] = useState(false);
  const [deleteBusy, setDeleteBusy] = useState(false);

  const containerRef = useRef<HTMLDivElement | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const list = await listFolders({ permissions: false });
      setFolders(list);
    } catch (err) {
      setError(describeApiError(err));
    } finally {
      setLoading(false);
    }
  }, []);

  // reloadKey is a dependency, not a no-op: load() is a stable useCallback, so
  // without it this effect runs exactly once (on mount) and the tree can only
  // ever be refreshed by a full page reload.
  useEffect(() => {
    void load();
  }, [load, reloadKey]);

  useEffect(() => {
    if (!menuFor) return;
    const onDocClick = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setMenuFor(null);
      }
    };
    document.addEventListener('mousedown', onDocClick);
    return () => document.removeEventListener('mousedown', onDocClick);
  }, [menuFor]);

  const tree = useMemo<FolderNode[]>(() => buildFolderTree(folders), [folders]);

  const byParent = useMemo(() => {
    const map = new Map<string | null, Folder[]>();
    for (const f of folders) {
      const key = f.folder_parent_id ?? null;
      const arr = map.get(key) ?? [];
      arr.push(f);
      map.set(key, arr);
    }
    return map;
  }, [folders]);

  const folderName = useCallback(
    (id: string | null | undefined): string => {
      if (!id) return ft('allCredentialsRoot', '全部凭据（根）');
      return folders.find((f) => f.id === id)?.name ?? ft('unknownFolder', '（未知文件夹）');
    },
    [folders],
  );

  const toggleExpand = useCallback((id: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const handleCreate = useCallback(
    async (e: FormEvent) => {
      e.preventDefault();
      const name = createName.trim();
      if (!name) return;
      setCreateBusy(true);
      try {
        await createFolder({ name, folder_parent_id: createParent || null });
        toast.success(ft('toast.created', '已创建文件夹「{{name}}」。', { name }));
        setCreateOpen(false);
        setCreateName('');
        setCreateParent('');
        if (createParent) setExpanded((prev) => new Set(prev).add(createParent));
        await load();
        onFoldersChanged?.();
      } catch (err) {
        toast.error(describeApiError(err));
      } finally {
        setCreateBusy(false);
      }
    },
    [createName, createParent, load, toast, onFoldersChanged],
  );

  const handleRename = useCallback(
    async (e: FormEvent) => {
      e.preventDefault();
      if (!renameTarget) return;
      const name = renameName.trim();
      if (!name || name === renameTarget.name) {
        setRenameTarget(null);
        return;
      }
      setRenameBusy(true);
      try {
        await renameFolder(renameTarget.id, name);
        toast.success(ft('toast.renamed', '文件夹已重命名。'));
        setRenameTarget(null);
        await load();
        onFoldersChanged?.();
      } catch (err) {
        toast.error(describeApiError(err));
      } finally {
        setRenameBusy(false);
      }
    },
    [renameTarget, renameName, load, toast, onFoldersChanged],
  );

  const handleMove = useCallback(
    async (e: FormEvent) => {
      e.preventDefault();
      if (!moveTarget) return;
      const newParent = moveParent || null;
      if ((moveTarget.folder_parent_id ?? null) === newParent) {
        setMoveTarget(null);
        return;
      }
      setMoveBusy(true);
      try {
        await moveFolder(moveTarget.id, newParent);
        toast.success(
          ft('toast.moved', '已将「{{name}}」移动到 {{destination}}。', {
            name: moveTarget.name,
            destination: folderName(newParent),
          }),
        );
        setMoveTarget(null);
        if (newParent) setExpanded((prev) => new Set(prev).add(newParent));
        await load();
        onFoldersChanged?.();
      } catch (err) {
        toast.error(describeApiError(err));
      } finally {
        setMoveBusy(false);
      }
    },
    [moveTarget, moveParent, folderName, load, toast, onFoldersChanged],
  );

  const handleDelete = useCallback(async () => {
    if (!deleteTarget) return;
    setDeleteBusy(true);
    try {
      await deleteFolder(deleteTarget.id, deleteCascade);
      toast.success(
        deleteCascade
          ? ft('toast.deletedWithContents', '已删除「{{name}}」及其内容。', {
              name: deleteTarget.name,
            })
          : ft('toast.deleted', '已删除「{{name}}」。', { name: deleteTarget.name }),
      );
      if (activeId === deleteTarget.id) onSelect(null);
      setDeleteTarget(null);
      setDeleteCascade(false);
      await load();
      onFoldersChanged?.();
    } catch (err) {
      toast.error(describeApiError(err));
    } finally {
      setDeleteBusy(false);
    }
  }, [deleteTarget, deleteCascade, activeId, onSelect, load, toast, onFoldersChanged]);

  const handleResourceDrop = useCallback(
    async (e: DragEvent, destinationFolderId: string | null) => {
      e.preventDefault();
      setDropTargetId(null);
      const resourceId = readDroppedResourceId(e);
      if (!resourceId) return;
      try {
        await moveResource(resourceId, destinationFolderId);
        toast.success(
          ft('toast.resourceMoved', '已将凭据移动到 {{destination}}。', {
            destination: folderName(destinationFolderId),
          }),
        );
        await load();
        onResourceMoved?.();
      } catch (err) {
        toast.error(describeApiError(err));
      }
    },
    [folderName, load, onResourceMoved, toast],
  );

  /**
   * Whether `folderId` may be re-parented under `destId` (null = root).
   * Rejects a no-op (already that parent) and any cycle (dropping a folder on
   * itself or on one of its own descendants). Note isSelfOrDescendant's
   * argument order: (subtree root = the dragged folder, candidate = the target).
   */
  const canMoveFolderTo = useCallback(
    (folderId: string, destId: string | null): boolean => {
      const dragged = folders.find((f) => f.id === folderId);
      if (!dragged) return false;
      if ((dragged.folder_parent_id ?? null) === destId) return false; // no-op
      if (destId === null) return true; // the root always accepts
      return !isSelfOrDescendant(folderId, destId, byParent);
    },
    [folders, byParent],
  );

  /**
   * Whether a drag hovering `destId` should get a drop affordance. Only our two
   * proprietary MIME types qualify — arbitrary browser drags (selected text,
   * links) carry text/plain alone and must not light up a row.
   */
  const acceptsDrag = useCallback(
    (e: DragEvent, destId: string | null): boolean => {
      const types = e.dataTransfer.types;
      if (types.includes(RESOURCE_DRAG_MIME)) return true;
      return (
        types.includes(FOLDER_DRAG_MIME) &&
        !!draggingFolderId &&
        canMoveFolderTo(draggingFolderId, destId)
      );
    },
    [draggingFolderId, canMoveFolderTo],
  );

  const onRowDragOver = useCallback(
    (e: DragEvent, destId: string | null) => {
      // Withholding preventDefault() on an illegal target is what makes the
      // cursor show "no-drop" and keeps .frow.drop from lighting up.
      if (acceptsDrag(e, destId)) {
        e.preventDefault();
        e.dataTransfer.dropEffect = 'move';
      }
    },
    [acceptsDrag],
  );

  const handleFolderDrop = useCallback(
    async (folderId: string, destinationFolderId: string | null) => {
      // Re-validate against the id that actually landed rather than trusting
      // the draggingFolderId state (dragend/drop ordering is not guaranteed).
      const dragged = folders.find((f) => f.id === folderId);
      if (!dragged) return;
      // Dropped back onto its own parent: a no-op, not an error — say nothing.
      if ((dragged.folder_parent_id ?? null) === destinationFolderId) return;
      if (!canMoveFolderTo(folderId, destinationFolderId)) {
        // Defensive: dragover already withholds the drop for illegal targets,
        // so this should be unreachable — but never move a folder into a cycle.
        toast.error(ft('toast.moveInvalid', '不能把文件夹移动到它自己或它的子文件夹中。'));
        return;
      }
      try {
        await moveFolder(folderId, destinationFolderId);
        toast.success(
          ft('toast.moved', '已将「{{name}}」移动到 {{destination}}。', {
            name: dragged.name,
            destination: folderName(destinationFolderId),
          }),
        );
        if (destinationFolderId) setExpanded((prev) => new Set(prev).add(destinationFolderId));
        await load();
        onFoldersChanged?.();
      } catch (err) {
        toast.error(describeApiError(err));
      }
    },
    [canMoveFolderTo, folders, folderName, load, onFoldersChanged, toast],
  );

  /**
   * Single drop entry point for every row (folder rows and the 全部凭据 root).
   * The FOLDER branch MUST come first and return: folder ids are UUIDs too, and
   * readDroppedResourceId() falls back to any UUID in text/plain — letting a
   * folder drag reach the resource branch would PUT /move/Resource on it.
   */
  const handleRowDrop = useCallback(
    (e: DragEvent, destinationFolderId: string | null) => {
      e.preventDefault();
      setDropTargetId(null);
      if (e.dataTransfer.types.includes(FOLDER_DRAG_MIME)) {
        const folderId = e.dataTransfer.getData(FOLDER_DRAG_MIME).trim();
        setDraggingFolderId(null);
        if (!UUID_RE.test(folderId)) return;
        void handleFolderDrop(folderId, destinationFolderId);
        return;
      }
      void handleResourceDrop(e, destinationFolderId);
    },
    [handleFolderDrop, handleResourceDrop],
  );

  // Recursive folder row render ------------------------------------------------
  const renderNode = useCallback(
    (node: FolderNode, depth: number) => {
      const hasChildren = node.children.length > 0;
      const isOpen = expanded.has(node.id);
      const isActive = activeId === node.id && !favoritesOnly;
      const isDropTarget = dropTargetId === node.id;
      const menuOpen = menuFor === node.id;

      return (
        <div key={node.id}>
          {/* `draggable` belongs on .frow only: the wrapper also contains the
              child-row <div role="group">, so making IT the drag source would
              drag the whole subtree. .frow and the group are siblings, hence a
              child row's drop never bubbles into its parent row either.

              It is turned OFF while this row's ··· menu is open. The menu renders
              inside .frow, and the drag source is "the first ancestor with
              draggable=true" — draggable={false} on the menu does NOT halt that
              walk, so a press-and-twitch on a menu item would otherwise start a
              real folder drag and silently PUT /move/Folder/{id} while the item
              itself never fires. It has to be stopped here at the source:
              dragstart fires ON .frow, so the menu is not in its path and no
              handler down there can preventDefault it. */}
          <div
            className={`frow${isActive ? ' active' : ''}${hasChildren && isOpen ? ' open' : ''}${
              isDropTarget ? ' drop' : ''
            }`}
            role="treeitem"
            aria-selected={isActive}
            aria-expanded={hasChildren ? isOpen : undefined}
            title={ft('dragFolderHint', '拖到其他文件夹可移动')}
            style={{
              position: 'relative',
              paddingLeft: 9 + depth * 18,
              opacity: draggingFolderId === node.id ? 0.45 : 1,
            }}
            onClick={() => onSelect(node.id)}
            draggable={!menuOpen}
            onDragStart={(e) => {
              e.dataTransfer.setData(FOLDER_DRAG_MIME, node.id);
              // NO text/plain copy — see FOLDER_DRAG_MIME's note.
              e.dataTransfer.effectAllowed = 'move';
              setDraggingFolderId(node.id);
            }}
            onDragEnd={() => {
              setDraggingFolderId(null);
              setDropTargetId(null);
            }}
            onDragOver={(e) => onRowDragOver(e, node.id)}
            onDragEnter={(e) => {
              if (acceptsDrag(e, node.id)) setDropTargetId(node.id);
            }}
            onDragLeave={(e) => {
              if (!(e.currentTarget as HTMLElement).contains(e.relatedTarget as Node)) {
                setDropTargetId((cur) => (cur === node.id ? null : cur));
              }
            }}
            onDrop={(e) => handleRowDrop(e, node.id)}
          >
            {hasChildren ? (
              <button
                type="button"
                className="twirl"
                aria-label={isOpen ? ft('collapse', '收起') : ft('expand', '展开')}
                onClick={(e) => {
                  e.stopPropagation();
                  toggleExpand(node.id);
                }}
              >
                <ChevronRight />
              </button>
            ) : (
              <span style={{ width: 12, flex: '0 0 12px' }} />
            )}
            <FolderIcon />
            <span className="fname">{node.name}</span>
            {node.personal === false && (
              <Users style={{ width: 13, height: 13 }} aria-label={ft('sharedFolder', '共享文件夹')} />
            )}
            <button
              type="button"
              className="fmenu"
              aria-label={ft('folderActions', '文件夹操作')}
              onClick={(e) => {
                e.stopPropagation();
                // Flip the menu upwards when the row sits too close to the
                // bottom of the (overflow-y:auto) scroller to fit it below.
                const rowBottom = e.currentTarget.getBoundingClientRect().bottom;
                const box = containerRef.current?.getBoundingClientRect();
                setMenuUp(!!box && rowBottom + MENU_EST_HEIGHT > box.bottom);
                setMenuFor((cur) => (cur === node.id ? null : node.id));
              }}
            >
              <MoreHorizontal />
            </button>

            {/* Official order (新建文件夹 / 重命名 / 分享 / 导出 / 删除) kept
                contiguous and unbroken; "移动…" is this port's own extra and so
                sits last among the non-destructive entries, right before the
                separator that isolates the destructive 删除. A press in here
                cannot start a row drag because .frow drops `draggable` whenever
                this menu is open — see the note on .frow above. */}
            {menuOpen && (
              <div
                className="menu"
                role="menu"
                style={menuUp ? { bottom: '100%', right: 4 } : { top: '100%', right: 4 }}
                onClick={(e) => e.stopPropagation()}
              >
                <button
                  onClick={() => {
                    setMenuFor(null);
                    setCreateName('');
                    // node.id, NOT activeId: the ··· button stops propagation,
                    // so this menu can be opened on an UNSELECTED folder.
                    setCreateParent(node.id);
                    setCreateOpen(true);
                  }}
                >
                  <FolderPlus /> {ft('menu.newSubfolder', '在此新建文件夹')}
                </button>
                <button
                  onClick={() => {
                    setMenuFor(null);
                    setRenameTarget(node);
                    setRenameName(node.name);
                  }}
                >
                  <Pencil /> {ft('menu.rename', '重命名')}
                </button>
                <button
                  onClick={() => {
                    setMenuFor(null);
                    setShareTarget(node);
                  }}
                >
                  <Share2 /> {ft('menu.share', '共享')}
                </button>
                {onExportFolder && (
                  <button
                    onClick={() => {
                      setMenuFor(null);
                      onExportFolder(node);
                    }}
                  >
                    <Download /> {ft('menu.export', '导出')}
                  </button>
                )}
                <button
                  onClick={() => {
                    setMenuFor(null);
                    setMoveTarget(node);
                    setMoveParent(node.folder_parent_id ?? '');
                  }}
                >
                  <MoveIcon /> {ft('menu.move', '移动…')}
                </button>
                <div className="sep" />
                <button
                  className="danger"
                  onClick={() => {
                    setMenuFor(null);
                    setDeleteTarget(node);
                    setDeleteCascade(false);
                  }}
                >
                  <Trash2 /> {tf('app.common.actions.delete', '删除')}
                </button>
              </div>
            )}
          </div>

          {hasChildren && isOpen && (
            <div role="group">{node.children.map((child) => renderNode(child, depth + 1))}</div>
          )}
        </div>
      );
    },
    [
      activeId,
      favoritesOnly,
      expanded,
      dropTargetId,
      draggingFolderId,
      menuFor,
      menuUp,
      onSelect,
      onExportFolder,
      onRowDragOver,
      acceptsDrag,
      handleRowDrop,
      toggleExpand,
    ],
  );

  const renderParentOptions = useCallback(
    (excludeSubtreeOf?: string) => {
      const opts: { id: string; label: string }[] = [];
      const walk = (nodes: FolderNode[], depth: number) => {
        for (const n of nodes) {
          if (excludeSubtreeOf && isSelfOrDescendant(excludeSubtreeOf, n.id, byParent)) continue;
          opts.push({ id: n.id, label: `${'— '.repeat(depth)}${n.name}` });
          walk(n.children, depth + 1);
        }
      };
      walk(tree, 0);
      return opts;
    },
    [tree, byParent],
  );

  return (
    <div className="folders" ref={containerRef}>
      <div className="folders-scroll">
        <div className="fsec-label">{ft('quickAccess', '快速访问')}</div>

        {/* 全部凭据 (root) — also a drop target moving resources OR folders to
            the root of the current user's tree. */}
        <div
          className={`frow${activeId === null && !favoritesOnly ? ' active' : ''}${
            dropTargetId === 'root' ? ' drop' : ''
          }`}
          role="treeitem"
          onClick={() => {
            onToggleFavorites?.(false);
            onSelect(null);
          }}
          onDragOver={(e) => onRowDragOver(e, null)}
          onDragEnter={(e) => {
            if (acceptsDrag(e, null)) setDropTargetId('root');
          }}
          onDragLeave={() => setDropTargetId((cur) => (cur === 'root' ? null : cur))}
          onDrop={(e) => handleRowDrop(e, null)}
        >
          <span style={{ width: 12, flex: '0 0 12px' }} />
          <VaultIcon />
          <span className="fname">{ft('allCredentials', '全部凭据')}</span>
        </div>

        {/* 收藏 — virtual node toggling the favorites filter. */}
        {onToggleFavorites && (
          <div
            className={`frow${favoritesOnly ? ' active' : ''}`}
            role="treeitem"
            onClick={() => onToggleFavorites(!favoritesOnly)}
          >
            <span style={{ width: 12, flex: '0 0 12px' }} />
            <Star style={favoritesOnly ? { fill: 'currentColor' } : undefined} />
            <span className="fname">{ft('favorites', '收藏')}</span>
          </div>
        )}

        <div className="fsec-label">{ft('foldersLabel', '文件夹')}</div>

        {loading ? (
          <div className="frow" style={{ color: 'var(--text-3)', cursor: 'default' }}>
            <span className="spin-ring" />
            <span className="fname">{ft('loading', '加载文件夹…')}</span>
          </div>
        ) : error ? (
          <div style={{ padding: '8px 9px' }}>
            <div className="warnbox" style={{ fontSize: 12, padding: '10px 11px' }}>
              <div>
                {error}
                <button
                  className="btn sm"
                  style={{ marginTop: 8 }}
                  onClick={() => void load()}
                  type="button"
                >
                  {tf('app.common.actions.retry', '重试')}
                </button>
              </div>
            </div>
          </div>
        ) : tree.length === 0 ? (
          <div className="frow" style={{ color: 'var(--text-3)', cursor: 'default', fontStyle: 'italic' }}>
            <span style={{ width: 12, flex: '0 0 12px' }} />
            <span className="fname">{ft('noFolders', '还没有文件夹')}</span>
          </div>
        ) : (
          <div role="tree">{tree.map((node) => renderNode(node, 0))}</div>
        )}

        <button
          type="button"
          className="frow"
          style={{ marginTop: 8, color: 'var(--accent-text)' }}
          onClick={() => {
            setCreateParent(activeId ?? '');
            setCreateName('');
            setCreateOpen(true);
          }}
        >
          <span style={{ width: 12, flex: '0 0 12px' }} />
          <Plus style={{ color: 'var(--accent)' }} />
          <span className="fname">{ft('newFolder', '新建文件夹')}</span>
        </button>
      </div>

      {/* ---- Create modal ---- */}
      <Modal
        open={createOpen}
        title={
          createParent
            ? ft('createTitleUnder', '在「{{name}}」中新建文件夹', {
                name: folderName(createParent),
              })
            : ft('newFolder', '新建文件夹')
        }
        onClose={() => !createBusy && setCreateOpen(false)}
        maxWidth={420}
        footer={
          <>
            <span style={{ flex: 1 }} />
            <button className="btn" onClick={() => setCreateOpen(false)} disabled={createBusy}>
              {tf('app.common.actions.cancel', '取消')}
            </button>
            <button
              className="btn primary"
              onClick={(e) => void handleCreate(e)}
              disabled={createBusy || createName.trim().length === 0}
            >
              {createBusy ? ft('creating', '创建中…') : ft('create', '创建')}
            </button>
          </>
        }
      >
        <form onSubmit={handleCreate}>
          <div className="form-group">
            <label className="form-label" htmlFor="ft-create-name">
              {ft('folderName', '文件夹名称')}
            </label>
            <input
              id="ft-create-name"
              className="form-control"
              autoFocus
              value={createName}
              onChange={(e) => setCreateName(e.target.value)}
              disabled={createBusy}
              placeholder={ft('namePlaceholder', '例如：工作')}
            />
          </div>
          <div className="form-group" style={{ marginBottom: 0 }}>
            <label className="form-label" htmlFor="ft-create-parent">
              {ft('parentFolder', '上级文件夹')}
            </label>
            <select
              id="ft-create-parent"
              className="form-control"
              value={createParent}
              onChange={(e) => setCreateParent(e.target.value)}
              disabled={createBusy}
            >
              <option value="">{ft('allCredentialsRoot', '全部凭据（根）')}</option>
              {renderParentOptions().map((o) => (
                <option key={o.id} value={o.id}>
                  {o.label}
                </option>
              ))}
            </select>
          </div>
          <button type="submit" style={{ display: 'none' }} aria-hidden tabIndex={-1} />
        </form>
      </Modal>

      {/* ---- Rename modal ---- */}
      <Modal
        open={renameTarget !== null}
        title={ft('renameFolder', '重命名文件夹')}
        onClose={() => !renameBusy && setRenameTarget(null)}
        maxWidth={420}
        footer={
          <>
            <span style={{ flex: 1 }} />
            <button className="btn" onClick={() => setRenameTarget(null)} disabled={renameBusy}>
              {tf('app.common.actions.cancel', '取消')}
            </button>
            <button
              className="btn primary"
              onClick={(e) => void handleRename(e)}
              disabled={renameBusy || renameName.trim().length === 0}
            >
              {renameBusy
                ? tf('app.common.actions.saving', '保存中…')
                : tf('app.common.actions.save', '保存')}
            </button>
          </>
        }
      >
        <form onSubmit={handleRename}>
          <div className="form-group" style={{ marginBottom: 0 }}>
            <label className="form-label" htmlFor="ft-rename-name">
              {ft('folderName', '文件夹名称')}
            </label>
            <input
              id="ft-rename-name"
              className="form-control"
              autoFocus
              value={renameName}
              onChange={(e) => setRenameName(e.target.value)}
              disabled={renameBusy}
            />
          </div>
          <button type="submit" style={{ display: 'none' }} aria-hidden tabIndex={-1} />
        </form>
      </Modal>

      {/* ---- Move modal ---- */}
      <Modal
        open={moveTarget !== null}
        title={
          moveTarget
            ? ft('moveTitle', '移动「{{name}}」', { name: moveTarget.name })
            : ft('moveFolder', '移动文件夹')
        }
        onClose={() => !moveBusy && setMoveTarget(null)}
        maxWidth={420}
        footer={
          <>
            <span style={{ flex: 1 }} />
            <button className="btn" onClick={() => setMoveTarget(null)} disabled={moveBusy}>
              {tf('app.common.actions.cancel', '取消')}
            </button>
            <button className="btn primary" onClick={(e) => void handleMove(e)} disabled={moveBusy}>
              {moveBusy ? ft('moving', '移动中…') : ft('menu.moveAction', '移动')}
            </button>
          </>
        }
      >
        <form onSubmit={handleMove}>
          <div className="form-group" style={{ marginBottom: 0 }}>
            <label className="form-label" htmlFor="ft-move-parent">
              {ft('destination', '目标位置')}
            </label>
            <select
              id="ft-move-parent"
              className="form-control"
              value={moveParent}
              onChange={(e) => setMoveParent(e.target.value)}
              disabled={moveBusy}
            >
              <option value="">{ft('allCredentialsRoot', '全部凭据（根）')}</option>
              {renderParentOptions(moveTarget?.id).map((o) => (
                <option key={o.id} value={o.id}>
                  {o.label}
                </option>
              ))}
            </select>
          </div>
          <button type="submit" style={{ display: 'none' }} aria-hidden tabIndex={-1} />
        </form>
      </Modal>

      {/* ---- Delete confirm ---- */}
      <ConfirmDialog
        open={deleteTarget !== null}
        title={ft('deleteFolder', '删除文件夹')}
        danger
        loading={deleteBusy}
        confirmLabel={tf('app.common.actions.delete', '删除')}
        cancelLabel={tf('app.common.actions.cancel', '取消')}
        message={
          <>
            {ft('deleteConfirm.before', '删除文件夹')}{' '}
            <strong style={{ color: 'var(--text)' }}>{deleteTarget?.name}</strong>
            {ft('deleteConfirm.after', '？此操作不可撤销。')}
          </>
        }
        extra={
          <label
            style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, color: 'var(--text-2)', cursor: 'pointer' }}
          >
            <input
              type="checkbox"
              checked={deleteCascade}
              onChange={(e) => setDeleteCascade(e.target.checked)}
              disabled={deleteBusy}
            />
            {ft('deleteCascade', '同时删除其内容（凭据与子文件夹）。关闭时，可写内容会被移动到根目录。')}
          </label>
        }
        onConfirm={() => void handleDelete()}
        onCancel={() => {
          setDeleteTarget(null);
          setDeleteCascade(false);
        }}
      />

      {/* ---- Folder share ----
          Mounted HERE, not in the vault page: this component owns a PRIVATE
          copy of `folders`, and a share flips `personal` (the Users badge on
          the row) — only our own load() can refresh that. onFoldersChanged then
          syncs the parent's second copy (useVaultData). */}
      {shareTarget && (
        <ShareDialog
          open
          foreignModel="folder"
          folderId={shareTarget.id}
          folderName={shareTarget.name}
          onClose={(didChange) => {
            setShareTarget(null);
            if (didChange) {
              void load();
              onFoldersChanged?.();
            }
          }}
        />
      )}
    </div>
  );
}

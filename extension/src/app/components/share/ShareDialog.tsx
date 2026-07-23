/**
 * Share dialog — ported from the SPA components/ShareDialog.tsx (1115 lines).
 *
 * The props contract below is ADDITIVE-ONLY (it started as the SPA's fixed
 * ShareDialogProps): a new prop must be OPTIONAL and must default to exactly
 * today's resource behaviour, so every existing call site keeps byte-identical
 * semantics. Changing/removing an existing prop, making anything required, or
 * altering the `onClose` signature WOULD break the contract.
 *
 * What changed vs the SPA original: the entire apply-side crypto orchestration
 * (fetch own secret → decrypt → expand Group AROs → verify each recipient's
 * key fingerprint → re-encrypt per recipient → PUT /share) moved into the
 * background SHARE_APPLY RPC (background/handlers/share.ts), so this iframe
 * never touches plaintext secrets or encryption keys. The dialog only builds
 * the permission deltas and submits them in one message. Reads (ACL fetch,
 * ARO search, simulate preview, display-name resolution) stay here as plain
 * API_CALL traffic through app/services/*.
 */
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import {
  AlertTriangle,
  Plus,
  RefreshCw,
  Search,
  Share2,
  Users as UsersIcon,
  X as XIcon,
} from 'lucide-react';

import { Modal } from '../Modal';
import { Badge } from '../Badge';
import { Avatar } from '../Avatar';
import { useToast } from '../../lib/toast';
import { describeApiError } from '../../lib/errors';
import { t as baseT } from '../../../shared/i18n';
import { joinName } from '../../../shared/names';
import { rpc } from '../../../shared/messages';
import type { PermissionChange } from '../../../shared/rpc/share';

import { searchAros, simulateShare } from '../../services/share';
import { getFolder } from '../../services/folders';
import { getResourcePermissions } from '../../services/permissions';
import { getUser } from '../../services/users';
import { getGroup } from '../../services/groups';

import {
  PERMISSION,
  isUserAro,
  type Aro,
  type Group,
  type Permission,
  type PermissionType,
  type PermissionWithAro,
  type Resource,
  type ShareSimulateResult,
  type User,
} from '../../../shared/types';

/**
 * SPA-source key mapping: the original used the i18next `components` namespace
 * (`t('share.…')`) plus cross-ns `common:` refs; both flatten per the
 * `app.<ns>.a.b` convention so the SPA call sites port verbatim.
 */
function t(key: string, vars?: Record<string, string | number>): string {
  const flat = key.startsWith('common:')
    ? 'app.common.' + key.slice('common:'.length)
    : 'app.components.' + key;
  return baseT(flat, vars);
}

type TFunc = typeof t;

export interface ShareDialogProps {
  /** Whether the dialog is open. */
  open: boolean;
  /**
   * What is being shared. Defaults to 'resource' — the historical behaviour;
   * 'folder' switches the ACL source, drops the simulate step (the backend has
   * no folder dry-run route) and hides every secret/re-encryption affordance
   * (folders carry no secret material).
   */
  foreignModel?: 'resource' | 'folder';
  /** The resource to share. Provide this OR `resourceId`. */
  resource?: Resource | null;
  /** The id of the resource to share. Provide this OR `resource`. */
  resourceId?: string;
  /** The id of the folder to share (foreignModel === 'folder' only). */
  folderId?: string;
  /** The folder's display name, for the title (may be absent on v5 folders). */
  folderName?: string;
  /**
   * Existing permissions, if the caller already loaded them. OPTIONAL — when
   * provided the dialog seeds synchronously from these and skips its own
   * GET /permissions/resource/{id}.json fetch on open.
   */
  existingPermissions?: Permission[] | PermissionWithAro[];
  /** Close handler. Receives whether a share was actually applied. */
  onClose: (didChange?: boolean) => void;
  /** Called after a successful share (in addition to onClose(true)). */
  onShared?: () => void;
}

// ---------------------------------------------------------------------------
// Internal draft model
// ---------------------------------------------------------------------------
interface DraftRow {
  /** Existing permission id (present only for already-shared AROs). */
  permissionId?: string;
  aro: 'User' | 'Group';
  aroForeignKey: string;
  type: PermissionType;
  /**
   * The permission level this existing row started with (undefined for rows
   * added in this session). Used to detect a level-only change so Apply is
   * enabled and the changed level is actually sent.
   */
  originalType?: PermissionType;
  /** True for AROs added in this session (need a re-encrypted secret on apply). */
  isNew: boolean;
  /** Marked for removal. */
  deleted: boolean;
  /** Display data. */
  label: string;
  sublabel?: string;
  avatarSrc?: string | null;
  firstName?: string | null;
  lastName?: string | null;
}

const DEBOUNCE_MS = 300;

const PERMISSION_OPTIONS: { value: PermissionType; labelKey: string }[] = [
  { value: PERMISSION.READ, labelKey: 'share.permission.read' },
  { value: PERMISSION.UPDATE, labelKey: 'share.permission.update' },
  { value: PERMISSION.OWNER, labelKey: 'share.permission.owner' },
];

/**
 * Error text for SHARE_APPLY failures: the RPC throws a plain Error carrying
 * the background/backend message (no `.response` shape), which
 * describeApiError would misclassify as a network failure — so prefer the
 * envelope message when present, then the Error message, then the fallback.
 */
function errMessage(err: unknown, fallback: string): string {
  if (err && typeof err === 'object' && 'response' in err) {
    const resp = (err as { response?: { data?: { header?: { message?: string } } } }).response;
    const msg = resp?.data?.header?.message;
    if (msg) return msg;
  }
  if (err instanceof Error && err.message) return err.message;
  if (typeof err === 'string' && err) return err;
  return fallback;
}

function aroDisplay(aro: Aro, tr: TFunc): { label: string; sublabel?: string } {
  if (isUserAro(aro)) {
    const full = joinName(aro.profile?.first_name, aro.profile?.last_name);
    return { label: full || aro.username, sublabel: aro.username };
  }
  const group = aro as Group;
  const count = group.user_count;
  return {
    label: group.name,
    sublabel: typeof count === 'number' ? tr('share.memberCount', { count }) : tr('share.group'),
  };
}

/**
 * Build a seeded DraftRow from a permission row, using the ARO display objects
 * the permissions endpoint embedded when available (no extra round-trip), and
 * falling back to a UUID placeholder otherwise (the resolver effect replaces it
 * with a name). Always marked isNew:false / deleted:false — it's existing ACL.
 */
function seedRowFromPermission(p: Permission | PermissionWithAro, tr: TFunc): DraftRow {
  const embedded = p as PermissionWithAro;
  const base: DraftRow = {
    permissionId: p.id,
    aro: p.aro,
    aroForeignKey: p.aro_foreign_key,
    type: p.type,
    originalType: p.type,
    isNew: false,
    deleted: false,
    // Default to the UUID as a placeholder; replaced below if we have an
    // embedded object, or later by the resolver effect (never show raw UUIDs).
    label: p.aro_foreign_key,
    sublabel: p.aro === 'Group' ? tr('share.group') : tr('share.user'),
  };

  if (p.aro === 'User' && embedded.user) {
    const { label, sublabel } = aroDisplay(embedded.user, tr);
    const profile = embedded.user.profile;
    return {
      ...base,
      label,
      sublabel,
      avatarSrc: profile?.avatar?.url?.small ?? null,
      firstName: profile?.first_name ?? null,
      lastName: profile?.last_name ?? null,
    };
  }
  if (p.aro === 'Group' && embedded.group) {
    return { ...base, label: embedded.group.name, sublabel: tr('share.group') };
  }
  return base;
}

/** Tiny inline spinner on the aegis .spin-ring keyframe. */
function SpinRing() {
  return <span className="spin-ring" aria-hidden="true" />;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------
export function ShareDialog({
  open,
  foreignModel = 'resource',
  resource,
  resourceId: resourceIdProp,
  folderId,
  folderName,
  existingPermissions,
  onClose,
  onShared,
}: ShareDialogProps) {
  const toast = useToast();

  // One id / one name for both models; the resource branch is byte-identical
  // to what this component computed before folder mode existed.
  const isFolder = foreignModel === 'folder';
  const foreignId = isFolder ? folderId ?? '' : resource?.id ?? resourceIdProp ?? '';
  const displayName = isFolder ? folderName : resource?.name;

  // --- search state ---
  const [query, setQuery] = useState('');
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [results, setResults] = useState<Aro[]>([]);

  // --- draft permission state ---
  const [rows, setRows] = useState<DraftRow[]>([]);
  // Loading / error state for the initial ACL fetch (when the dialog loads its
  // own permissions rather than receiving them via existingPermissions).
  const [loadingPermissions, setLoadingPermissions] = useState(false);
  const [permissionsError, setPermissionsError] = useState<string | null>(null);

  // --- simulate state ---
  const [simulating, setSimulating] = useState(false);
  const [simulation, setSimulation] = useState<ShareSimulateResult | null>(null);
  // userId -> display name, so the simulate preview shows names not truncated UUIDs.
  const [aroNames, setAroNames] = useState<Record<string, string>>({});

  // --- apply state ---
  const [applying, setApplying] = useState(false);
  const [applyError, setApplyError] = useState<string | null>(null);

  const searchSeq = useRef(0);

  // -----------------------------------------------------------------------
  // Reset everything when (re)opened, then seed the current ACL.
  //
  // Preferred path (caller passes only the resource): fetch the full ACL
  // ourselves via GET /permissions/resource/{id}.json with the user/group
  // contains, so we DISPLAY who already has access with human-readable names
  // and avatars straight from the embedded objects. Fallback: a caller MAY
  // pass `existingPermissions` to seed synchronously and skip the fetch.
  //
  // Folder mode has exactly ONE source: GET /folders/{id}.json?contain
  // [permissions]=1 (there is no /permissions/folder/{id}.json route). Those
  // rows embed NO user/group object, so every row is resolved by the
  // name-resolution effect below.
  // -----------------------------------------------------------------------
  useEffect(() => {
    if (!open) return;
    setQuery('');
    setResults([]);
    setSearchError(null);
    setSimulation(null);
    setApplyError(null);
    setSimulating(false);
    setApplying(false);
    setAroNames({});
    setPermissionsError(null);

    // Caller pre-loaded the ACL: seed synchronously and skip the fetch.
    if (existingPermissions) {
      setLoadingPermissions(false);
      setRows(existingPermissions.map((p) => seedRowFromPermission(p, t)));
      return;
    }

    // No id to fetch against: nothing to load (only additions are possible).
    if (!foreignId) {
      setLoadingPermissions(false);
      setRows([]);
      return;
    }

    // Fetch the full ACL ourselves.
    let cancelled = false;
    setLoadingPermissions(true);
    setRows([]);
    (async () => {
      try {
        const perms = isFolder
          ? (await getFolder(foreignId, { permissions: true })).permissions ?? []
          : await getResourcePermissions(foreignId, {
              containUser: true,
              containUserProfile: true,
              containGroup: true,
            });
        if (cancelled) return;
        setRows(perms.map((p) => seedRowFromPermission(p, t)));
        setPermissionsError(null);
      } catch (err: unknown) {
        if (cancelled) return;
        // Don't block sharing if the ACL couldn't be read — the user can
        // still add people; we just couldn't show the current access.
        setPermissionsError(describeApiError(err));
        setRows([]);
      } finally {
        if (!cancelled) setLoadingPermissions(false);
      }
    })();
    return () => {
      cancelled = true;
    };
    // Re-seed whenever the dialog opens for a (possibly) different resource or
    // a caller swaps in a different pre-loaded permission set.
  }, [open, foreignId, isFolder, existingPermissions]);

  // -----------------------------------------------------------------------
  // Resolve human-readable names for any seeded existing-permission rows whose
  // label is still the raw aro_foreign_key UUID (i.e. the permissions endpoint
  // could not embed the ARO, or a caller passed bare Permission[]). Rows whose
  // names came from embedded objects are already resolved and skipped.
  //
  // In folder mode this is not a fallback but THE path: /folders/{id}.json
  // permission rows embed no ARO at all, so every row lands here — which is why
  // the avatar/first/last fields are backfilled too, not just the label.
  // -----------------------------------------------------------------------
  useEffect(() => {
    if (!open) return;
    if (loadingPermissions) return; // wait for the ACL fetch to settle first
    const unresolved = rows.filter((r) => !r.isNew && r.label === r.aroForeignKey);
    if (unresolved.length === 0) return;
    let cancelled = false;
    (async () => {
      type Resolved = {
        label: string;
        sublabel?: string;
        avatarSrc?: string | null;
        firstName?: string | null;
        lastName?: string | null;
      };
      const resolved = new Map<string, Resolved>();
      await Promise.all(
        unresolved.map(async (r) => {
          try {
            if (r.aro === 'User') {
              const u = await getUser(r.aroForeignKey);
              resolved.set(r.aroForeignKey, {
                ...aroDisplay(u, t),
                avatarSrc: u.profile?.avatar?.url?.small ?? null,
                firstName: u.profile?.first_name ?? null,
                lastName: u.profile?.last_name ?? null,
              });
            } else {
              const g = await getGroup(r.aroForeignKey);
              resolved.set(r.aroForeignKey, aroDisplay(g, t));
            }
          } catch {
            // Leave the placeholder UUID if the lookup fails.
          }
        }),
      );
      if (cancelled || resolved.size === 0) return;
      setRows((prev) =>
        prev.map((r) => {
          const r2 = resolved.get(r.aroForeignKey);
          return r2 && r.label === r.aroForeignKey
            ? {
                ...r,
                label: r2.label,
                sublabel: r2.sublabel ?? r.sublabel,
                avatarSrc: r2.avatarSrc ?? r.avatarSrc,
                firstName: r2.firstName ?? r.firstName,
                lastName: r2.lastName ?? r.lastName,
              }
            : r;
        }),
      );
    })();
    return () => {
      cancelled = true;
    };
    // `rows` must be a dependency: when a caller seeds `existingPermissions`
    // synchronously (loadingPermissions never flips), the first run of this
    // effect closes over the pre-seed rows and would otherwise never see the
    // seeded UUID-labelled rows. No render loop is possible: the
    // `!isNew && label === aroForeignKey` filter plus the `resolved.size === 0`
    // early return stop re-runs once labels are resolved, and the setRows
    // updater only rewrites rows whose label still equals the UUID.
  }, [open, loadingPermissions, rows]);

  // -----------------------------------------------------------------------
  // Debounced ARO search.
  // -----------------------------------------------------------------------
  useEffect(() => {
    if (!open) return;
    const q = query.trim();
    if (q.length === 0) {
      setResults([]);
      setSearching(false);
      setSearchError(null);
      return;
    }
    setSearching(true);
    const seq = ++searchSeq.current;
    const handle = window.setTimeout(async () => {
      try {
        const aros = await searchAros({ search: q });
        if (seq !== searchSeq.current) return; // stale
        setResults(aros);
        setSearchError(null);
      } catch (err: unknown) {
        if (seq !== searchSeq.current) return;
        setSearchError(describeApiError(err));
        setResults([]);
      } finally {
        if (seq === searchSeq.current) setSearching(false);
      }
    }, DEBOUNCE_MS);
    return () => window.clearTimeout(handle);
  }, [query, open]);

  // -----------------------------------------------------------------------
  // Add an ARO from the search results to the draft.
  // -----------------------------------------------------------------------
  const addAro = useCallback((aro: Aro) => {
    const isUser = isUserAro(aro);
    const aroType: 'User' | 'Group' = isUser ? 'User' : 'Group';
    const aroForeignKey = aro.id;
    const { label, sublabel } = aroDisplay(aro, t);

    setRows((prev) => {
      // If it already exists in the draft, un-delete it instead of duplicating.
      const idx = prev.findIndex((r) => r.aroForeignKey === aroForeignKey && r.aro === aroType);
      if (idx >= 0) {
        const copy = [...prev];
        copy[idx] = { ...copy[idx], deleted: false };
        return copy;
      }
      const profile = isUser ? (aro as User).profile : null;
      const next: DraftRow = {
        aro: aroType,
        aroForeignKey,
        type: PERMISSION.READ,
        isNew: true,
        deleted: false,
        label,
        sublabel,
        avatarSrc: profile?.avatar?.url?.small ?? null,
        firstName: profile?.first_name ?? null,
        lastName: profile?.last_name ?? null,
      };
      return [...prev, next];
    });
    setSimulation(null);
    setApplyError(null);
    setQuery('');
    setResults([]);
  }, []);

  const changeRowType = useCallback((idx: number, type: PermissionType) => {
    setRows((prev) => {
      const copy = [...prev];
      copy[idx] = { ...copy[idx], type };
      return copy;
    });
    setSimulation(null);
  }, []);

  const removeRow = useCallback((idx: number) => {
    setRows((prev) => {
      const row = prev[idx];
      if (row.isNew && !row.permissionId) {
        // Never persisted — just drop it from the draft.
        return prev.filter((_, i) => i !== idx);
      }
      const copy = [...prev];
      copy[idx] = { ...copy[idx], deleted: true };
      return copy;
    });
    setSimulation(null);
  }, []);

  const undoRemove = useCallback((idx: number) => {
    setRows((prev) => {
      const copy = [...prev];
      copy[idx] = { ...copy[idx], deleted: false };
      return copy;
    });
    setSimulation(null);
  }, []);

  // -----------------------------------------------------------------------
  // Build the PermissionChange[] payload from the draft. Removal rows carry
  // their aro fields too (the RPC type requires them; the background maps
  // them back down to the SPA's bare `{ id, delete }` wire shape).
  // -----------------------------------------------------------------------
  const buildPermissions = useCallback((): PermissionChange[] => {
    const items: PermissionChange[] = [];
    for (const row of rows) {
      if (row.isNew && !row.permissionId) {
        if (row.deleted) continue; // added then removed — no-op
        items.push({
          aro: row.aro,
          aro_foreign_key: row.aroForeignKey,
          type: row.type,
          is_new: true,
        });
      } else if (row.permissionId) {
        if (row.deleted) {
          // Removal: id + delete flag (no re-encryption needed).
          items.push({
            id: row.permissionId,
            aro: row.aro,
            aro_foreign_key: row.aroForeignKey,
            type: row.type,
            delete: true,
          });
        } else if (row.originalType === undefined || row.type !== row.originalType) {
          // Level change on an existing permission: id + the new type.
          // Unchanged existing permissions are intentionally omitted so the
          // payload expresses only real changes (added / changed / removed).
          items.push({
            id: row.permissionId,
            aro: row.aro,
            aro_foreign_key: row.aroForeignKey,
            type: row.type,
          });
        }
      }
    }
    return items;
  }, [rows]);

  // The AROs that are genuinely newly added (need re-encrypted secrets).
  const newlyAdded = useMemo(
    () => rows.filter((r) => r.isNew && !r.permissionId && !r.deleted),
    [rows],
  );

  const hasChanges = useMemo(() => {
    return rows.some(
      (r) =>
        // a newly added ARO that is still present
        (r.isNew && !r.deleted) ||
        // an existing permission marked for removal
        (r.permissionId && r.deleted) ||
        // an existing permission whose level was changed
        (r.permissionId && !r.deleted && r.originalType !== undefined && r.type !== r.originalType),
    );
  }, [rows]);

  // -----------------------------------------------------------------------
  // Simulate (read-only preview; plain API_CALL). Resource-only: the backend
  // 404s POST /share/simulate/folder/{id}.json by design (no PHP dry-run route
  // for folders), so folder mode does not render the button either.
  // -----------------------------------------------------------------------
  const handleSimulate = useCallback(async () => {
    if (isFolder) return;
    if (!foreignId) return;
    setSimulating(true);
    setApplyError(null);
    try {
      const perms = buildPermissions();
      const result = await simulateShare(foreignId, perms);
      setSimulation(result);
    } catch (err: unknown) {
      setApplyError(describeApiError(err));
      setSimulation(null);
    } finally {
      setSimulating(false);
    }
  }, [isFolder, foreignId, buildPermissions]);

  // -----------------------------------------------------------------------
  // Resolve display names for the user ids referenced by a simulation result,
  // so the preview shows names instead of truncated UUIDs. Seeds from draft
  // rows we already have names for, then fetches any remaining ids once.
  // -----------------------------------------------------------------------
  useEffect(() => {
    if (!simulation) return;
    const ids = new Set<string>();
    for (const a of simulation.changes?.added ?? []) ids.add(a.User.id);
    for (const r of simulation.changes?.removed ?? []) ids.add(r.User.id);

    // Seed from rows whose label is already a resolved (non-UUID) name.
    const seeded: Record<string, string> = {};
    for (const row of rows) {
      if (row.aro === 'User' && row.label && row.label !== row.aroForeignKey) {
        seeded[row.aroForeignKey] = row.label;
      }
    }

    let cancelled = false;
    (async () => {
      const next: Record<string, string> = { ...seeded };
      const missing = Array.from(ids).filter((id) => !next[id]);
      await Promise.all(
        missing.map(async (id) => {
          try {
            const u = await getUser(id);
            next[id] = aroDisplay(u, t).label;
          } catch {
            // Leave it unresolved; the preview falls back to a short id.
          }
        }),
      );
      if (!cancelled) setAroNames(next);
    })();
    return () => {
      cancelled = true;
    };
    // Keyed on the simulation result; rows are read only to seed names.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [simulation]);

  // -----------------------------------------------------------------------
  // Apply: one SHARE_APPLY RPC. The background re-runs the simulate, decrypts
  // our own secret, verifies + re-encrypts per added recipient and PUTs the
  // share — no key material ever enters this iframe.
  // -----------------------------------------------------------------------
  const handleApply = useCallback(async () => {
    if (!foreignId) return;
    if (!hasChanges) {
      setApplyError(t('share.errors.noChanges'));
      return;
    }

    setApplying(true);
    setApplyError(null);

    try {
      const permissions = buildPermissions();
      await rpc({
        type: 'SHARE_APPLY',
        foreignModel: isFolder ? 'folder' : 'resource',
        foreignId,
        permissions,
      });

      toast.success(
        displayName
          ? t('share.toast.sharedNamed', { name: displayName })
          : t('share.toast.sharedUpdated'),
      );
      onShared?.();
      onClose(true);
    } catch (err: unknown) {
      setApplyError(errMessage(err, t('share.toast.applyFailed')));
      toast.error(t('share.toast.applyFailed'));
    } finally {
      setApplying(false);
    }
  }, [isFolder, foreignId, displayName, hasChanges, buildPermissions, toast, onShared, onClose]);

  if (!open) return null;

  const busy = applying;

  return (
    <Modal
      open={open}
      title={
        isFolder
          ? displayName
            ? t('share.titleFolderNamed', { name: displayName })
            : t('share.titleFolder')
          : displayName
            ? t('share.titleNamed', { name: displayName })
            : t('share.title')
      }
      icon={<Share2 />}
      onClose={() => !busy && onClose(false)}
      maxWidth={620}
      closeOnBackdrop={!busy}
      footer={
        <>
          <span style={{ fontSize: 12, color: 'var(--text-3)', marginRight: 'auto' }}>
            {t('share.accessorCount', { count: rows.filter((r) => !r.deleted).length })}
          </span>
          <button className="btn" onClick={() => onClose(false)} disabled={busy}>
            {t('common:actions.cancel')}
          </button>
          {/* Simulate is a resource-only backend route — see handleSimulate. */}
          {!isFolder && (
            <button
              className="btn"
              onClick={handleSimulate}
              disabled={busy || simulating || !hasChanges}
              title={t('share.simulateTooltip')}
            >
              {simulating ? <SpinRing /> : null}
              {simulating ? t('share.simulating') : t('share.simulate')}
            </button>
          )}
          <button
            className="btn primary"
            onClick={handleApply}
            disabled={busy || !hasChanges}
          >
            {/* Folder mode never encrypts anything: no re-encrypt icon, and a
                plain Save/Saving label instead of the "encrypt and share" one. */}
            {applying ? (
              <SpinRing />
            ) : !isFolder && newlyAdded.length > 0 ? (
              <RefreshCw size={16} />
            ) : null}
            {isFolder
              ? applying
                ? t('common:actions.saving')
                : t('common:actions.save')
              : applying
                ? t('share.encryptingAndSharing')
                : newlyAdded.length > 0
                  ? t('share.encryptAndShare')
                  : t('common:actions.save')}
          </button>
        </>
      }
    >
      {applyError && (
        <Banner variant="error" icon={<AlertTriangle size={16} />}>
          {applyError}
        </Banner>
      )}

      {/* ---- Search ---- */}
      <div className="aro-search" style={{ marginBottom: 16 }}>
        <div className="searchbox">
          <Search />
          <input
            id="share-search"
            placeholder={t('share.searchPlaceholder')}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            autoComplete="off"
            disabled={busy}
          />
        </div>

        {/* Search results dropdown */}
        {query.trim().length > 0 && (
          <div className="aro-results">
            {searching && (
              <div
                style={{
                  padding: '11px 12px',
                  display: 'flex',
                  alignItems: 'center',
                  gap: 8,
                  color: 'var(--text-3)',
                  fontSize: 13,
                }}
              >
                <SpinRing /> {t('share.searching')}
              </div>
            )}
            {!searching && searchError && (
              <div style={{ padding: '11px 12px', color: 'var(--red-text)', fontSize: 13 }}>
                {searchError}
              </div>
            )}
            {!searching && !searchError && results.length === 0 && (
              <div style={{ padding: '11px 12px', color: 'var(--text-3)', fontSize: 13 }}>
                {t('share.noMatches')}
              </div>
            )}
            {!searching &&
              !searchError &&
              results.map((aro) => {
                const isUser = isUserAro(aro);
                const { label, sublabel } = aroDisplay(aro, t);
                const profile = isUser ? (aro as User).profile : null;
                return (
                  <button
                    key={`${isUser ? 'u' : 'g'}-${aro.id}`}
                    type="button"
                    className="aro-opt"
                    onClick={() => addAro(aro)}
                  >
                    {isUser ? (
                      <Avatar
                        size={30}
                        src={profile?.avatar?.url?.small}
                        firstName={profile?.first_name}
                        lastName={profile?.last_name}
                        name={label}
                      />
                    ) : (
                      <span className="avatar" style={{ width: 30, height: 30, fontSize: 12 }}>
                        <UsersIcon size={15} />
                      </span>
                    )}
                    <span className="aro-info">
                      <span
                        className="an"
                        style={{
                          whiteSpace: 'nowrap',
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                        }}
                      >
                        {label}
                      </span>
                      {sublabel && <span className="ae">{sublabel}</span>}
                    </span>
                    <Badge variant={isUser ? 'primary' : 'default'} icon={<UsersIcon size={11} />}>
                      {isUser ? t('share.user') : t('share.group')}
                    </Badge>
                    <span className="add">
                      <Plus />
                    </span>
                  </button>
                );
              })}
          </div>
        )}
      </div>

      {/* Sharing a folder does NOT cascade to the credentials inside it
          (PermissionService.shareFolder only touches the Folder ACO and
          folders_relations) — say so, or the grant reads as more than it is. */}
      {isFolder && (
        <Banner variant="warning" icon={<AlertTriangle size={16} />}>
          {t('share.folderNote')}
        </Banner>
      )}

      {/* ---- Current / draft permissions ---- */}
      <div style={{ marginBottom: 8 }}>
        <div style={{ fontSize: 13, color: 'var(--text-2)', fontWeight: 500, marginBottom: 8 }}>
          {t('share.whoHasAccess')}
        </div>
        {permissionsError && (
          <div style={{ marginBottom: 8 }}>
            <Banner variant="error" icon={<AlertTriangle size={16} />}>
              {permissionsError}
            </Banner>
          </div>
        )}
        {loadingPermissions ? (
          <div
            style={{
              padding: '16px',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 8,
              color: 'var(--text-3)',
              fontSize: 13,
              border: '1px dashed var(--border)',
              borderRadius: 'var(--r)',
            }}
          >
            <SpinRing /> {t('share.loadingAccessList')}
          </div>
        ) : rows.length === 0 ? (
          <div
            style={{
              padding: '16px',
              color: 'var(--text-3)',
              fontSize: 13,
              textAlign: 'center',
              border: '1px dashed var(--border)',
              borderRadius: 'var(--r)',
            }}
          >
            {t('share.noAccessYet')}
          </div>
        ) : (
          <div className="matrix">
            {rows.map((row, idx) => (
              <div
                className="matrix-row"
                key={`${row.aro}-${row.aroForeignKey}-${row.permissionId ?? 'new'}`}
                style={row.deleted ? { background: 'var(--red-soft)', opacity: 0.7 } : undefined}
              >
                {row.aro === 'User' ? (
                  <Avatar
                    size={30}
                    src={row.avatarSrc}
                    firstName={row.firstName}
                    lastName={row.lastName}
                    name={row.label}
                  />
                ) : (
                  <span className="avatar" style={{ width: 30, height: 30, fontSize: 12 }}>
                    <UsersIcon size={15} />
                  </span>
                )}
                <span className="aro-info">
                  <span
                    className="an"
                    style={{
                      whiteSpace: 'nowrap',
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      textDecoration: row.deleted ? 'line-through' : 'none',
                    }}
                  >
                    {row.label}
                    {row.isNew && !row.deleted && (
                      <span className="chip green" style={{ padding: '1px 6px' }}>
                        {t('share.chip.added')}
                      </span>
                    )}
                    {row.deleted && (
                      <span className="chip red" style={{ padding: '1px 6px' }}>
                        {t('share.chip.removed')}
                      </span>
                    )}
                  </span>
                  <span className="ae">{row.sublabel}</span>
                </span>

                <div className="perm-select">
                  {PERMISSION_OPTIONS.map((opt) => (
                    <button
                      key={opt.value}
                      type="button"
                      className={
                        (row.type === opt.value ? 'sel' : '') +
                        (opt.value === PERMISSION.OWNER ? ' owner' : '')
                      }
                      disabled={busy || row.deleted}
                      onClick={() => changeRowType(idx, opt.value)}
                    >
                      {t(opt.labelKey)}
                    </button>
                  ))}
                </div>

                {row.deleted ? (
                  <button
                    type="button"
                    className="btn sm"
                    onClick={() => undoRemove(idx)}
                    disabled={busy}
                  >
                    {t('share.undo')}
                  </button>
                ) : (
                  <button
                    type="button"
                    className="rm-aro"
                    onClick={() => removeRow(idx)}
                    disabled={busy}
                    aria-label={t('share.removeAro', { name: row.label })}
                    title={t('share.removeAccess')}
                  >
                    <XIcon />
                  </button>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* ---- Re-encrypt summary (only when there are newly-added recipients) ----
          Never in folder mode: there is no secret to re-encrypt. */}
      {!isFolder && newlyAdded.length > 0 && (
        <div className="reencrypt">
          <div className="re-head">
            <RefreshCw /> {t('share.reencrypt.head')}
          </div>
          <div className="re-sub">{t('share.reencrypt.sub', { count: newlyAdded.length })}</div>
        </div>
      )}

      {/* ---- Simulation preview ---- */}
      {simulation && <SimulationPreview result={simulation} names={aroNames} />}
    </Modal>
  );
}

// ---------------------------------------------------------------------------
// Simulation preview (informational only).
// ---------------------------------------------------------------------------
function SimulationPreview({
  result,
  names,
}: {
  result: ShareSimulateResult;
  names: Record<string, string>;
}) {
  const added = result.changes?.added ?? [];
  const removed = result.changes?.removed ?? [];
  // Prefer a resolved display name; fall back to a short id only when unknown.
  const display = (id: string) => names[id] ?? id.slice(0, 8);
  return (
    <div className="reencrypt" style={{ marginTop: 12, fontSize: 13 }}>
      <div style={{ color: 'var(--text-2)', fontWeight: 500, marginBottom: 10 }}>
        {t('share.simulation.title')}
      </div>
      <div
        style={{
          display: 'flex',
          flexWrap: 'wrap',
          alignItems: 'center',
          gap: 6,
          marginBottom: 8,
        }}
      >
        <span style={{ color: 'var(--text-3)', marginRight: 4 }}>
          {t('share.simulation.gainAccess')}
        </span>
        {added.length === 0 ? (
          <span style={{ color: 'var(--text-3)' }}>{t('share.simulation.none')}</span>
        ) : (
          added.map((a) => (
            <span key={`a-${a.User.id}`} className="chip green">
              {display(a.User.id)}
            </span>
          ))
        )}
      </div>
      <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 6 }}>
        <span style={{ color: 'var(--text-3)', marginRight: 4 }}>
          {t('share.simulation.loseAccess')}
        </span>
        {removed.length === 0 ? (
          <span style={{ color: 'var(--text-3)' }}>{t('share.simulation.none')}</span>
        ) : (
          removed.map((r) => (
            <span key={`r-${r.User.id}`} className="chip red">
              {display(r.User.id)}
            </span>
          ))
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Small inline banner (matches the danger-banner tone used across the app).
// ---------------------------------------------------------------------------
function Banner({
  children,
  variant,
  icon,
}: {
  children: ReactNode;
  variant: 'error' | 'warning';
  icon?: ReactNode;
}) {
  const color = variant === 'error' ? 'var(--red-text)' : 'var(--amber-text)';
  const bg = variant === 'error' ? 'var(--red-soft)' : 'var(--amber-soft)';
  const borderColor =
    variant === 'error'
      ? 'color-mix(in oklch, var(--red) 30%, transparent)'
      : 'color-mix(in oklch, var(--amber) 35%, transparent)';
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'flex-start',
        gap: 8,
        background: bg,
        color,
        border: `1px solid ${borderColor}`,
        borderRadius: 'var(--r)',
        padding: '10px 12px',
        fontSize: 13,
        lineHeight: 1.5,
        marginBottom: 16,
      }}
    >
      {icon && <span style={{ marginTop: 1, flexShrink: 0 }}>{icon}</span>}
      <span>{children}</span>
    </div>
  );
}

export default ShareDialog;

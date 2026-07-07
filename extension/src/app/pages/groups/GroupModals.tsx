/**
 * Groups page modals + shared helpers, ported from SPA pages/Groups.tsx.
 *
 * The big migration delta is ManageMembersModal: the SPA's in-page
 * dry-run → decrypt → verify-fingerprint → re-encrypt orchestration is GONE
 * from the UI — the whole pipeline now runs in the background behind one
 * GROUP_SAVE_REENCRYPT RPC (background/handlers/groups.ts), so this iframe
 * never sees plaintext secrets or key material. Consequence: no per-step
 * progress strings; the modal shows a single static re-encryption banner.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  Loader2,
  Plus,
  Search,
  X as XIcon,
} from 'lucide-react';

import { Modal } from '../../components/Modal';
import { ConfirmDialog } from '../../components/ConfirmDialog';
import { Avatar } from '../../components/Avatar';
import { Badge } from '../../components/Badge';
import { ApiError } from '../../lib/api';
import { describeApiError } from '../../lib/errors';
import { t } from '../../../shared/i18n';
import { rpc } from '../../../shared/messages';

import * as groupsService from '../../services/groups';
import { listUsers } from '../../services/users';
import type { Group, GroupUserChange, User } from '../../../shared/types';

// ---------------------------------------------------------------------------
// Shared helpers (also used by index.tsx)
// ---------------------------------------------------------------------------

/** Best-effort display name for a user (falls back to username). */
export function userName(u?: User | null): string {
  if (!u) return t('app.directory.groups.unknownUser');
  const full = [u.profile?.first_name, u.profile?.last_name].filter(Boolean).join(' ');
  return full || u.username || t('app.directory.groups.unknownUser');
}

/**
 * Message for a caught error. A GROUP_SAVE_REENCRYPT failure arrives as a plain
 * Error whose message the background already localized (guard messages, or the
 * server's header.message via apiCall) — surface it verbatim. Service-layer
 * ApiErrors go through describeApiError for the unreachable / session-expired /
 * forbidden distinction (the SPA's axios.isAxiosError split, ApiError edition).
 */
export function describeGroupsError(err: unknown): string {
  if (err instanceof ApiError) return describeApiError(err);
  if (err instanceof Error && err.message) return err.message;
  return describeApiError(err);
}

export function ErrorBanner({ message }: { message: string }) {
  return (
    <div className="warnbox" role="alert">
      <AlertTriangle />
      <span>{message}</span>
    </div>
  );
}

export function Spinner({ size = 20 }: { size?: number }) {
  return <Loader2 className="spin" size={size} aria-hidden />;
}

export function FullSpinner({ label }: { label?: string }) {
  return (
    <div className="spinner-full">
      <Spinner size={32} />
      {label && <span style={{ fontSize: 14 }}>{label}</span>}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Create group modal (admin only)
// ---------------------------------------------------------------------------

export function CreateGroupModal({
  currentUser,
  onClose,
  onCreated,
  onError,
}: {
  /** From GET /users/me.json — the creator must be the group's first manager. */
  currentUser: User | null;
  onClose: () => void;
  onCreated: (newId: string) => void;
  onError: (m: string) => void;
}) {
  const [name, setName] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    const trimmed = name.trim();
    if (!trimmed) {
      setError(t('app.directory.groups.form.nameRequired'));
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const created = await groupsService.createGroup({
        name: trimmed,
        groups_users: currentUser
          ? [{ user_id: currentUser.id, is_admin: true }]
          : undefined,
      });
      onCreated(created.id);
    } catch (err) {
      const m = describeApiError(err);
      setError(m);
      onError(m);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      open
      title={t('app.directory.groups.createModal.title')}
      onClose={onClose}
      maxWidth={440}
      footer={
        <>
          <span style={{ flex: 1 }} />
          <button type="button" className="btn" onClick={onClose} disabled={saving}>
            {t('app.common.actions.cancel')}
          </button>
          <button type="button" className="btn primary" onClick={submit} disabled={saving}>
            {saving
              ? t('app.directory.groups.createModal.creating')
              : t('app.directory.groups.createModal.create')}
          </button>
        </>
      }
    >
      {error && (
        <div style={{ marginBottom: 16 }}>
          <ErrorBanner message={error} />
        </div>
      )}
      <div className="form-group" style={{ marginBottom: 0 }}>
        <label className="form-label" htmlFor="group-name">
          {t('app.directory.groups.createModal.nameLabel')}
        </label>
        <input
          id="group-name"
          className="form-control"
          autoFocus
          value={name}
          placeholder={t('app.directory.groups.createModal.namePlaceholder')}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') void submit();
          }}
          disabled={saving}
        />
      </div>
      <p style={{ color: 'var(--text-3)', fontSize: 13, marginTop: 12 }}>
        {t('app.directory.groups.createModal.hint')}
      </p>
    </Modal>
  );
}

// ---------------------------------------------------------------------------
// Rename group modal
// ---------------------------------------------------------------------------

export function RenameGroupModal({
  group,
  onClose,
  onRenamed,
  onError,
}: {
  group: Group;
  onClose: () => void;
  onRenamed: () => void;
  onError: (m: string) => void;
}) {
  const [name, setName] = useState(group.name);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    const trimmed = name.trim();
    if (!trimmed) {
      setError(t('app.directory.groups.form.nameRequired'));
      return;
    }
    if (trimmed === group.name) {
      onClose();
      return;
    }
    setSaving(true);
    setError(null);
    try {
      await groupsService.updateGroup(group.id, { name: trimmed });
      onRenamed();
    } catch (err) {
      const m = describeApiError(err);
      setError(m);
      onError(m);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      open
      title={t('app.directory.groups.renameModal.title')}
      onClose={onClose}
      maxWidth={440}
      footer={
        <>
          <span style={{ flex: 1 }} />
          <button type="button" className="btn" onClick={onClose} disabled={saving}>
            {t('app.common.actions.cancel')}
          </button>
          <button type="button" className="btn primary" onClick={submit} disabled={saving}>
            {saving
              ? t('app.directory.groups.renameModal.saving')
              : t('app.common.actions.save')}
          </button>
        </>
      }
    >
      {error && (
        <div style={{ marginBottom: 16 }}>
          <ErrorBanner message={error} />
        </div>
      )}
      <div className="form-group" style={{ marginBottom: 0 }}>
        <label className="form-label" htmlFor="rename-group">
          {t('app.directory.groups.renameModal.nameLabel')}
        </label>
        <input
          id="rename-group"
          className="form-control"
          autoFocus
          value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') void submit();
          }}
          disabled={saving}
        />
      </div>
    </Modal>
  );
}

// ---------------------------------------------------------------------------
// Manage members modal (submit = one GROUP_SAVE_REENCRYPT RPC)
// ---------------------------------------------------------------------------

/**
 * A row in the membership draft. Mirrors a GroupUser when it already exists
 * (`groupUserId` set) or describes a brand-new member (`groupUserId` undefined).
 */
interface MemberDraft {
  groupUserId?: string;
  user: User;
  isAdmin: boolean;
  /** Marked for removal (existing members only). */
  markedDelete: boolean;
  /** True when added in this editing session (no existing groups_users row). */
  isNew: boolean;
}

export function ManageMembersModal({
  group,
  onClose,
  onSaved,
  onError,
}: {
  group: Group;
  onClose: () => void;
  onSaved: () => void;
  onError: (m: string) => void;
}) {
  // Seed the draft from the group's current members.
  const [drafts, setDrafts] = useState<MemberDraft[]>(() =>
    (group.groups_users ?? []).map((gu) => ({
      groupUserId: gu.id,
      user: gu.user ?? ({ id: gu.user_id, username: gu.user_id } as User),
      isAdmin: gu.is_admin,
      markedDelete: false,
      isNew: false,
    })),
  );

  // User picker
  const [search, setSearch] = useState('');
  const [results, setResults] = useState<User[]>([]);
  const [searching, setSearching] = useState(false);

  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Debounced search of the user directory.
  useEffect(() => {
    const q = search.trim();
    if (q.length < 1) {
      setResults([]);
      return;
    }
    let cancelled = false;
    setSearching(true);
    const handle = window.setTimeout(async () => {
      try {
        const users = await listUsers({ search: q });
        if (!cancelled) setResults(users);
      } catch (err) {
        if (!cancelled) setError(describeApiError(err));
      } finally {
        if (!cancelled) setSearching(false);
      }
    }, 300);
    return () => {
      cancelled = true;
      window.clearTimeout(handle);
    };
  }, [search]);

  const draftedUserIds = useMemo(
    () => new Set(drafts.filter((d) => !d.markedDelete).map((d) => d.user.id)),
    [drafts],
  );

  const addMember = (u: User) => {
    setError(null);
    setDrafts((prev) => {
      // Re-adding a member previously marked for deletion just un-marks it.
      const existing = prev.find((d) => d.user.id === u.id);
      if (existing) {
        return prev.map((d) => (d.user.id === u.id ? { ...d, markedDelete: false } : d));
      }
      return [...prev, { user: u, isAdmin: false, markedDelete: false, isNew: true }];
    });
    setSearch('');
    setResults([]);
  };

  const toggleManager = (userId: string) => {
    setDrafts((prev) =>
      prev.map((d) => (d.user.id === userId ? { ...d, isAdmin: !d.isAdmin } : d)),
    );
  };

  const removeMember = (userId: string) => {
    setDrafts((prev) =>
      prev
        // New (unsaved) members are dropped entirely; existing ones are marked for delete.
        .filter((d) => !(d.isNew && d.user.id === userId))
        .map((d) => (d.user.id === userId ? { ...d, markedDelete: true } : d)),
    );
  };

  /** Build the groups_users[] change list for the final PUT. */
  const buildChanges = useCallback((): GroupUserChange[] => {
    const changes: GroupUserChange[] = [];
    for (const d of drafts) {
      if (d.isNew) {
        if (d.markedDelete) continue; // added then removed in the same session — noop
        changes.push({ user_id: d.user.id, is_admin: d.isAdmin });
      } else if (d.markedDelete) {
        changes.push({ id: d.groupUserId, user_id: d.user.id, delete: true });
      } else {
        // Existing member — include only when the manager flag changed.
        const original = group.groups_users?.find((gu) => gu.id === d.groupUserId);
        if (original && original.is_admin !== d.isAdmin) {
          changes.push({ id: d.groupUserId, user_id: d.user.id, is_admin: d.isAdmin });
        }
      }
    }
    return changes;
  }, [drafts, group.groups_users]);

  const save = async () => {
    const changes = buildChanges();
    if (changes.length === 0) {
      onClose();
      return;
    }
    setSaving(true);
    setError(null);
    try {
      // Dry-run, key verification, decryption and re-encryption all happen in
      // the background; a thrown error means NOTHING was committed server-side.
      await rpc({
        type: 'GROUP_SAVE_REENCRYPT',
        groupId: group.id,
        payload: { groups_users: changes },
      });
      onSaved();
    } catch (err) {
      const m = describeGroupsError(err);
      setError(m);
      onError(m);
    } finally {
      setSaving(false);
    }
  };

  const visibleDrafts = drafts.filter((d) => !d.markedDelete);
  const pendingRemovals = drafts.filter((d) => d.markedDelete && !d.isNew);
  const addingMembers = drafts.some((d) => d.isNew && !d.markedDelete);

  return (
    <Modal
      open
      title={t('app.directory.groups.manageModal.title', { name: group.name })}
      onClose={saving ? () => undefined : onClose}
      maxWidth={560}
      closeOnBackdrop={!saving}
      footer={
        <>
          <span style={{ flex: 1 }} />
          <button type="button" className="btn" onClick={onClose} disabled={saving}>
            {t('app.common.actions.cancel')}
          </button>
          <button type="button" className="btn primary" onClick={save} disabled={saving}>
            {saving
              ? t('app.directory.groups.manageModal.saving')
              : t('app.directory.groups.manageModal.saveChanges')}
          </button>
        </>
      }
    >
      {error && (
        <div style={{ marginBottom: 16 }}>
          <ErrorBanner message={error} />
        </div>
      )}

      {saving && addingMembers && (
        <div className="reencrypt-banner" style={{ margin: '0 0 16px' }}>
          <Spinner size={16} />
          <div className="rb-text">
            <b>{t('app.directory.groups.manageModal.reencrypting')}</b>
            <div className="s">{t('app.directory.groups.manageModal.reencryptHintBg')}</div>
          </div>
        </div>
      )}

      {/* Add-member search */}
      <div className="form-group">
        <label className="form-label" htmlFor="member-search">
          {t('app.directory.groups.manageModal.addMember')}
        </label>
        <div className="searchbox">
          <Search />
          <input
            id="member-search"
            placeholder={t('app.directory.groups.manageModal.searchPlaceholder')}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            disabled={saving}
            autoComplete="off"
          />
        </div>

        {(searching || results.length > 0) && search.trim().length > 0 && (
          <div className="pick-target" style={{ marginTop: 8 }}>
            {searching ? (
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 8,
                  padding: '12px 11px',
                  color: 'var(--text-3)',
                  fontSize: 13,
                }}
              >
                <Spinner size={14} /> {t('app.directory.groups.manageModal.searching')}
              </div>
            ) : (
              results.map((u) => {
                const already = draftedUserIds.has(u.id);
                const hasKey = Boolean(u.gpgkey?.armored_key);
                return (
                  <button
                    key={u.id}
                    type="button"
                    className="pick-opt"
                    onClick={() => !already && addMember(u)}
                    disabled={already}
                    style={{
                      cursor: already ? 'default' : 'pointer',
                      opacity: already ? 0.5 : 1,
                    }}
                  >
                    <Avatar
                      src={u.profile?.avatar?.url?.small ?? null}
                      firstName={u.profile?.first_name}
                      lastName={u.profile?.last_name}
                      name={u.username}
                      size={32}
                    />
                    <div className="aro-info">
                      <div className="an">{userName(u)}</div>
                      <div className="ae">{u.username}</div>
                    </div>
                    {already ? (
                      <Badge variant="muted">
                        {t('app.directory.groups.manageModal.added')}
                      </Badge>
                    ) : !hasKey && !u.active ? (
                      <Badge
                        variant="danger"
                        title={t('app.directory.groups.manageModal.noKeyTitle')}
                      >
                        {t('app.directory.groups.manageModal.noKey')}
                      </Badge>
                    ) : (
                      <span
                        className="add"
                        style={{ color: 'var(--accent-text)', display: 'inline-flex' }}
                      >
                        <Plus size={16} />
                      </span>
                    )}
                  </button>
                );
              })
            )}
          </div>
        )}
      </div>

      {/* Current/draft membership */}
      <div style={{ marginTop: 8 }}>
        <div
          style={{
            fontSize: 13,
            color: 'var(--text-2)',
            fontWeight: 500,
            marginBottom: 8,
          }}
        >
          {t('app.directory.groups.manageModal.membersCount', { count: visibleDrafts.length })}
        </div>
        <div>
          {visibleDrafts.map((d) => (
            <div className="member-row" key={d.user.id}>
              <Avatar
                src={d.user.profile?.avatar?.url?.small ?? null}
                firstName={d.user.profile?.first_name}
                lastName={d.user.profile?.last_name}
                name={d.user.username}
                size={32}
              />
              <div className="mr-info">
                <div className="mn">
                  {userName(d.user)}
                  {d.isNew && (
                    <span style={{ marginLeft: 4 }}>
                      <Badge variant="success">
                        {t('app.directory.groups.manageModal.new')}
                      </Badge>
                    </span>
                  )}
                </div>
                {d.user.username && <div className="me">{d.user.username}</div>}
              </div>

              <div className="mr-actions">
                <label
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: 6,
                    fontSize: 13,
                    color: 'var(--text-2)',
                    cursor: saving ? 'default' : 'pointer',
                    userSelect: 'none',
                  }}
                  title={t('app.directory.groups.manageModal.managerLabelTitle')}
                >
                  <input
                    type="checkbox"
                    checked={d.isAdmin}
                    onChange={() => toggleManager(d.user.id)}
                    disabled={saving}
                  />
                  {t('app.directory.groups.manageModal.manager')}
                </label>

                <button
                  type="button"
                  className="rowmenu"
                  onClick={() => removeMember(d.user.id)}
                  disabled={saving}
                  title={t('app.directory.groups.manageModal.removeTitle')}
                  aria-label={t('app.directory.groups.manageModal.removeAria', {
                    name: userName(d.user),
                  })}
                  style={{ color: 'var(--text-3)' }}
                >
                  <XIcon size={16} />
                </button>
              </div>
            </div>
          ))}
        </div>

        {pendingRemovals.length > 0 && (
          <div style={{ marginTop: 12, fontSize: 13, color: 'var(--text-3)' }}>
            {t('app.directory.groups.manageModal.pendingRemovals', {
              count: pendingRemovals.length,
            })}
          </div>
        )}
      </div>

      <p style={{ color: 'var(--text-3)', fontSize: 12, marginTop: 16 }}>
        {t('app.directory.groups.manageModal.footnote')}
      </p>
    </Modal>
  );
}

// ---------------------------------------------------------------------------
// Delete group dialog (sole-owner dry-run guard)
// ---------------------------------------------------------------------------

export function DeleteGroupDialog({
  group,
  onClose,
  onDeleted,
  onError,
}: {
  group: Group;
  onClose: () => void;
  onDeleted: () => void;
  onError: (m: string) => void;
}) {
  const [checking, setChecking] = useState(true);
  const [blocking, setBlocking] = useState<string[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);

  // Run the sole-owner dry-run as soon as the dialog opens.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      setChecking(true);
      setError(null);
      setBlocking(null);
      try {
        await groupsService.deleteGroupDryRun(group.id);
        if (!cancelled) setBlocking([]); // safe to delete
      } catch (err) {
        if (cancelled) return;
        // A 400 typically carries the sole-owner blocking resource list.
        let names: string[] | null = null;
        if (err instanceof ApiError && err.response.status === 400) {
          const list = err.response.data.body;
          if (Array.isArray(list)) {
            names = list
              .map((r) => (r as { name?: string })?.name)
              .filter((n): n is string => Boolean(n));
          }
        }
        if (names && names.length > 0) {
          setBlocking(names);
        } else {
          setError(describeApiError(err));
        }
      } finally {
        if (!cancelled) setChecking(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [group.id]);

  const confirmDelete = async () => {
    setDeleting(true);
    setError(null);
    try {
      await groupsService.deleteGroup(group.id);
      onDeleted();
    } catch (err) {
      const m = describeApiError(err);
      setError(m);
      onError(m);
    } finally {
      setDeleting(false);
    }
  };

  const isBlocked = (blocking?.length ?? 0) > 0;
  const canDelete = !checking && !isBlocked && !error;

  return (
    <ConfirmDialog
      open
      danger
      title={t('app.directory.groups.deleteDialog.title', { name: group.name })}
      confirmLabel={t('app.directory.groups.deleteDialog.confirm')}
      loading={deleting}
      onCancel={onClose}
      // When blocked or still checking, the confirm button is a no-op guard.
      onConfirm={canDelete ? confirmDelete : onClose}
      message={
        checking ? (
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
            <Spinner size={16} /> {t('app.directory.groups.deleteDialog.checking')}
          </span>
        ) : isBlocked ? (
          <div>
            <p style={{ marginTop: 0 }}>
              {t('app.directory.groups.deleteDialog.blockedIntro')}
            </p>
            <ul
              style={{
                margin: '8px 0 0',
                paddingLeft: 18,
                color: 'var(--red-text)',
                maxHeight: 160,
                overflowY: 'auto',
              }}
            >
              {blocking!.map((n) => (
                <li key={n}>{n}</li>
              ))}
            </ul>
          </div>
        ) : error ? (
          <ErrorBanner message={error} />
        ) : (
          <span>{t('app.directory.groups.deleteDialog.warning')}</span>
        )
      }
      extra={
        isBlocked ? (
          <button
            type="button"
            className="btn"
            style={{ width: '100%' }}
            onClick={onClose}
          >
            {t('app.common.actions.close')}
          </button>
        ) : undefined
      }
    />
  );
}

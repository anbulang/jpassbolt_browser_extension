/**
 * Users directory page — ported from SPA pages/Users.tsx (WP-USERS, pure
 * API_CALL domain, no crypto). Modals + row helpers live in ./UserModals.tsx.
 *
 * Adaptations from the SPA, by design:
 *   - Current-user identity comes from the network (GET /users/me.json via
 *     getMe()), never a localStorage blob — the extension has no cached
 *     identity, and admin-ness must not be spoofable from page storage.
 *   - 403 detection reads ApiError.status from app/lib/api (axios shim).
 *   - Re-enabling an account requires an EXPLICIT `disabled: null` in the PUT
 *     body (backend uses Jackson "present" semantics; omitting the field
 *     means "no change"). JSON.stringify keeps null properties, so building
 *     the payload with `disabled: ... ?? null` is sufficient.
 */
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
} from 'react';
import {
  Users as UsersIcon,
  UserPlus,
  Search,
  Pencil,
  Trash2,
  ShieldAlert,
} from 'lucide-react';
import type { Role, User, UserCreateRequest, UserUpdateRequest } from '../../../shared/types';
import {
  createUser,
  deleteUser,
  deleteUserDryRun,
  listUsers,
  updateUser,
} from '../../services/users';
import { getRoles } from '../../services/settings';
import { getMe, avatarUrl } from '../../services/profile';
import { ApiError } from '../../lib/api';
import { describeApiError } from '../../lib/errors';
import { useToast } from '../../lib/toast';
import { t } from '../../../shared/i18n';
import { ConfirmDialog } from '../../components/ConfirmDialog';
import { EmptyState } from '../../components/EmptyState';
import { Avatar } from '../../components/Avatar';
import { Spinner } from '../../../ui/components';
import {
  InviteUserModal,
  EditUserModal,
  ViewUserModal,
  RoleBadge,
  displayName,
  statusOf,
  formatDate,
  tu,
  type UserFormState,
} from './UserModals';

/** True when the error is an HTTP 403 (forbidden). */
function isForbidden(err: unknown): boolean {
  return err instanceof ApiError && err.status === 403;
}

export default function UsersPage() {
  const toast = useToast();

  // Current user resolved over the API_CALL pass-through (self row + admin UI).
  const [me, setMe] = useState<User | null>(null);
  useEffect(() => {
    let cancelled = false;
    getMe()
      .then((u) => {
        if (!cancelled) setMe(u);
      })
      .catch(() => {
        /* Non-fatal: the page degrades to the member (read-only) view. */
      });
    return () => {
      cancelled = true;
    };
  }, []);
  const isAdmin = me?.role?.name === 'admin';

  const [users, setUsers] = useState<User[]>([]);
  const [roles, setRoles] = useState<Role[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  // Search (debounced) + admin-only "active only" filter.
  const [searchInput, setSearchInput] = useState('');
  const [search, setSearch] = useState('');
  const [activeOnly, setActiveOnly] = useState(false);

  // Client-side segmented filter (presentation only, derived over the fetched list).
  const [segment, setSegment] = useState<'all' | 'admin' | 'pending' | 'disabled'>('all');

  // Modal state.
  const [inviteOpen, setInviteOpen] = useState(false);
  const [editTarget, setEditTarget] = useState<User | null>(null);
  const [viewTarget, setViewTarget] = useState<User | null>(null);
  const [form, setForm] = useState<UserFormState | null>(null);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  // Delete / dry-run state.
  const [deleteTarget, setDeleteTarget] = useState<User | null>(null);
  const [deleteChecking, setDeleteChecking] = useState(false);
  const [deleteBlocked, setDeleteBlocked] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);

  // --- Debounce the search box (~300ms). ---
  useEffect(() => {
    const handle = window.setTimeout(() => setSearch(searchInput.trim()), 300);
    return () => window.clearTimeout(handle);
  }, [searchInput]);

  // --- Load roles once (best-effort; used by the admin forms). ---
  useEffect(() => {
    let cancelled = false;
    getRoles()
      .then((data) => {
        if (!cancelled) setRoles(data);
      })
      .catch(() => {
        /* Non-fatal: the role <select> simply shows nothing extra. */
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // --- Load the directory whenever the filters change. ---
  const reqIdRef = useRef(0);
  const fetchUsers = useCallback(async () => {
    const reqId = ++reqIdRef.current;
    setLoading(true);
    setLoadError(null);
    try {
      const data = await listUsers({
        search: search || undefined,
        // is-active is admin-only; non-admins never send it.
        isActive: isAdmin && activeOnly ? true : undefined,
      });
      if (reqId === reqIdRef.current) setUsers(data);
    } catch (err) {
      if (reqId === reqIdRef.current) {
        setLoadError(describeApiError(err));
      }
    } finally {
      if (reqId === reqIdRef.current) setLoading(false);
    }
  }, [search, activeOnly, isAdmin]);

  useEffect(() => {
    void fetchUsers();
  }, [fetchUsers]);

  const defaultRoleId = useMemo(() => {
    const userRole = roles.find((r) => r.name === 'user');
    return userRole?.id ?? roles[0]?.id ?? '';
  }, [roles]);

  // --- Open the invite modal. ---
  const openInvite = useCallback(() => {
    setFormError(null);
    setForm({
      first_name: '',
      last_name: '',
      username: '',
      role_id: defaultRoleId,
      disabled: false,
    });
    setInviteOpen(true);
  }, [defaultRoleId]);

  // --- Open the edit modal for a given user. ---
  const openEdit = useCallback((user: User) => {
    setFormError(null);
    setEditTarget(user);
    setForm({
      first_name: user.profile?.first_name ?? '',
      last_name: user.profile?.last_name ?? '',
      username: user.username,
      role_id: user.role_id,
      disabled: !!user.disabled,
    });
  }, []);

  const closeForm = useCallback(() => {
    setInviteOpen(false);
    setEditTarget(null);
    setForm(null);
    setFormError(null);
    setSaving(false);
  }, []);

  // --- Submit invite (POST /users.json). ---
  const submitInvite = useCallback(
    async (e: FormEvent) => {
      e.preventDefault();
      if (!form) return;
      if (!form.username.trim()) {
        setFormError(tu('form.usernameRequired'));
        return;
      }
      if (!form.role_id) {
        setFormError(tu('form.roleRequired'));
        return;
      }
      setSaving(true);
      setFormError(null);
      const req: UserCreateRequest = {
        username: form.username.trim(),
        role_id: form.role_id,
        profile: {
          first_name: form.first_name.trim(),
          last_name: form.last_name.trim(),
        },
      };
      try {
        await createUser(req);
        toast.success(tu('toast.inviteSent'));
        closeForm();
        await fetchUsers();
      } catch (err) {
        const msg = isForbidden(err) ? tu('error.inviteForbidden') : describeApiError(err);
        setFormError(msg);
        setSaving(false);
      }
    },
    [form, toast, closeForm, fetchUsers],
  );

  // --- Submit edit (PUT /users/{id}.json). ---
  const submitEdit = useCallback(
    async (e: FormEvent) => {
      e.preventDefault();
      if (!form || !editTarget) return;
      setSaving(true);
      setFormError(null);

      const req: UserUpdateRequest = {
        role_id: form.role_id,
        // Disabled toggles a timestamp on, null to re-enable.
        disabled: form.disabled ? (editTarget.disabled ?? new Date().toISOString()) : null,
        profile: {
          first_name: form.first_name.trim(),
          last_name: form.last_name.trim(),
        },
      };
      try {
        await updateUser(editTarget.id, req);
        toast.success(tu('toast.updated'));
        closeForm();
        await fetchUsers();
      } catch (err) {
        const msg = isForbidden(err) ? tu('error.editForbidden') : describeApiError(err);
        setFormError(msg);
        setSaving(false);
      }
    },
    [form, editTarget, toast, closeForm, fetchUsers],
  );

  // --- Begin a delete: run the dry-run first to surface sole-owner conflicts. ---
  const beginDelete = useCallback(async (user: User) => {
    setDeleteTarget(user);
    setDeleteBlocked(null);
    setDeleteChecking(true);
    try {
      await deleteUserDryRun(user.id);
      // No conflict — the ConfirmDialog will allow the delete.
    } catch (err) {
      if (isForbidden(err)) {
        setDeleteBlocked(tu('error.deleteForbidden'));
      } else {
        // A 400 here means the user solely owns content that must be
        // transferred first; surface the backend's explanation verbatim.
        setDeleteBlocked(describeApiError(err));
      }
    } finally {
      setDeleteChecking(false);
    }
  }, []);

  const cancelDelete = useCallback(() => {
    setDeleteTarget(null);
    setDeleteBlocked(null);
    setDeleteChecking(false);
    setDeleting(false);
  }, []);

  // --- Confirm the delete (DELETE /users/{id}.json). ---
  const confirmDelete = useCallback(async () => {
    if (!deleteTarget || deleteBlocked) return;
    setDeleting(true);
    try {
      await deleteUser(deleteTarget.id);
      toast.success(tu('toast.deleted', { name: displayName(deleteTarget) }));
      cancelDelete();
      await fetchUsers();
    } catch (err) {
      // The backend may still reject with a transfer requirement at commit time.
      const msg = isForbidden(err) ? tu('error.deleteForbidden') : describeApiError(err);
      setDeleteBlocked(msg);
      setDeleting(false);
    }
  }, [deleteTarget, deleteBlocked, toast, cancelDelete, fetchUsers]);

  // -------------------------------------------------------------------------
  // Render
  // -------------------------------------------------------------------------

  const hasSearch = search.length > 0;

  // Client-side segment counts + filtered view (presentation only).
  const counts = useMemo(
    () => ({
      all: users.length,
      admin: users.filter((u) => u.role?.name === 'admin').length,
      pending: users.filter((u) => !u.disabled && !u.active).length,
      disabled: users.filter((u) => !!u.disabled).length,
    }),
    [users],
  );

  const visibleUsers = useMemo(() => {
    return users.filter((u) => {
      if (segment === 'admin') return u.role?.name === 'admin';
      if (segment === 'pending') return !u.disabled && !u.active;
      if (segment === 'disabled') return !!u.disabled;
      return true;
    });
  }, [users, segment]);

  return (
    <div className="page">
      {/* In-page section header ------------------------------------------- */}
      <div className="page-head">
        <div className="ph-text">
          <h2>{tu('head.title')}</h2>
          <p>
            {isAdmin
              ? tu('head.subtitleAdmin', { count: users.length })
              : tu('head.subtitleMember', { count: users.length })}
          </p>
        </div>
        <div className="ph-spacer" />
        {isAdmin && (
          <button className="btn primary" onClick={openInvite} type="button">
            <UserPlus /> {tu('invite')}
          </button>
        )}
      </div>

      {/* Toolbar: search + segmented filter ------------------------------- */}
      <div className="page-toolbar">
        <div className="searchbox">
          <Search />
          <input
            type="text"
            placeholder={tu('toolbar.searchPlaceholder')}
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            aria-label={tu('toolbar.searchAria')}
          />
        </div>
        <div className="seg">
          <button
            className={segment === 'all' ? 'on' : ''}
            onClick={() => setSegment('all')}
            type="button"
          >
            {tu('segment.all', { count: counts.all })}
          </button>
          <button
            className={segment === 'admin' ? 'on' : ''}
            onClick={() => setSegment('admin')}
            type="button"
          >
            {tu('segment.admin', { count: counts.admin })}
          </button>
          <button
            className={segment === 'pending' ? 'on' : ''}
            onClick={() => setSegment('pending')}
            type="button"
          >
            {tu('segment.pending', { count: counts.pending })}
          </button>
          <button
            className={segment === 'disabled' ? 'on' : ''}
            onClick={() => setSegment('disabled')}
            type="button"
          >
            {tu('segment.disabled', { count: counts.disabled })}
          </button>
        </div>
        {isAdmin && (
          <label
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '8px',
              fontSize: '13px',
              color: 'var(--text-2)',
              cursor: 'pointer',
              whiteSpace: 'nowrap',
              userSelect: 'none',
            }}
          >
            <input
              type="checkbox"
              checked={activeOnly}
              onChange={(e) => setActiveOnly(e.target.checked)}
            />
            {tu('toolbar.activeOnly')}
          </label>
        )}
      </div>

      {/* Load error banner ------------------------------------------------ */}
      {loadError && (
        <div className="warnbox" role="alert" style={{ margin: '14px 28px 0' }}>
          <ShieldAlert />
          <span>{loadError}</span>
        </div>
      )}

      {/* Body: loading / empty / table ------------------------------------ */}
      {loading ? (
        <Spinner label={tu('loading')} />
      ) : visibleUsers.length === 0 ? (
        <div className="page-scroll">
          <EmptyState
            icon={UsersIcon}
            title={tu('empty.title')}
            description={
              hasSearch
                ? tu('empty.descSearch')
                : isAdmin
                  ? tu('empty.descAdmin')
                  : tu('empty.descMember')
            }
            action={
              isAdmin && !hasSearch ? (
                <button className="btn primary" onClick={openInvite} type="button">
                  <UserPlus /> {tu('invite')}
                </button>
              ) : undefined
            }
          />
        </div>
      ) : (
        <div className="page-scroll">
          <div className="utable">
            <div
              className="utable-head"
              style={{ gridTemplateColumns: '2.6fr 1fr 1.4fr 1fr 44px' }}
            >
              <div>{tu('table.user')}</div>
              <div>{tu('table.role')}</div>
              <div>{tu('table.groups')}</div>
              <div>{tu('table.status')}</div>
              <div />
            </div>
            {visibleUsers.map((user) => {
              const status = statusOf(user);
              const isSelf = me?.id === user.id;
              return (
                <div
                  className={'urow' + (user.disabled ? ' disabled' : '')}
                  key={user.id}
                  style={{ gridTemplateColumns: '2.6fr 1fr 1.4fr 1fr 44px' }}
                  onClick={() => !isAdmin && setViewTarget(user)}
                >
                  {/* User cell */}
                  <div className="ucell-user">
                    <Avatar
                      src={avatarUrl(user, 'small')}
                      firstName={user.profile?.first_name}
                      lastName={user.profile?.last_name}
                      name={user.username}
                      size={36}
                    />
                    <div className="un">
                      <div className="n">
                        {displayName(user)}
                        {isSelf && (
                          <span className="chip blue" style={{ padding: '1px 6px' }}>
                            {tu('you')}
                          </span>
                        )}
                      </div>
                      <div className="e">{user.username}</div>
                    </div>
                  </div>

                  {/* Role cell */}
                  <div>
                    <RoleBadge roleName={user.role?.name} />
                  </div>

                  {/* Groups cell — the user object exposes no group names. */}
                  <div className="gchips">
                    <span style={{ fontSize: 12, color: 'var(--text-3)' }}>—</span>
                  </div>

                  {/* Status cell */}
                  <div className={'statuschip ' + status.tone}>
                    <span className="sd" /> {tu(`status.${status.labelKey}`)}
                    <span
                      style={{
                        color: 'var(--text-3)',
                        fontSize: 11,
                        marginLeft: 2,
                      }}
                    >
                      {tu('lastLogin', { date: formatDate(user.last_logged_in) })}
                    </span>
                  </div>

                  {/* Actions cell (admin only) */}
                  {isAdmin ? (
                    <div
                      style={{
                        display: 'flex',
                        gap: '4px',
                        justifySelf: 'end',
                      }}
                      onClick={(e) => e.stopPropagation()}
                    >
                      <button
                        className="rowmenu"
                        title={tu('actions.editTitle')}
                        aria-label={tu('actions.editAria', { name: displayName(user) })}
                        onClick={() => openEdit(user)}
                        type="button"
                      >
                        <Pencil />
                      </button>
                      <button
                        className="rowmenu"
                        title={
                          isSelf ? tu('actions.deleteSelfTitle') : tu('actions.deleteTitle')
                        }
                        aria-label={tu('actions.deleteAria', { name: displayName(user) })}
                        disabled={isSelf}
                        style={
                          isSelf
                            ? { opacity: 0.4, cursor: 'not-allowed' }
                            : { color: 'var(--red-text)' }
                        }
                        onClick={() => !isSelf && void beginDelete(user)}
                        type="button"
                      >
                        <Trash2 />
                      </button>
                    </div>
                  ) : (
                    <div />
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Invite modal (admin) --------------------------------------------- */}
      {form && (
        <InviteUserModal
          open={inviteOpen}
          form={form}
          setForm={setForm}
          roles={roles}
          saving={saving}
          error={formError}
          onSubmit={submitInvite}
          onClose={closeForm}
        />
      )}

      {/* Edit modal (admin) ----------------------------------------------- */}
      {form && (
        <EditUserModal
          target={editTarget}
          form={form}
          setForm={setForm}
          roles={roles}
          saving={saving}
          error={formError}
          onSubmit={submitEdit}
          onClose={closeForm}
        />
      )}

      {/* Read-only profile detail (non-admin) ----------------------------- */}
      <ViewUserModal target={viewTarget} onClose={() => setViewTarget(null)} />

      {/* Delete confirm (admin) ------------------------------------------- */}
      <ConfirmDialog
        open={!!deleteTarget}
        title={tu('deleteDialog.title')}
        danger={!deleteBlocked}
        loading={deleting || deleteChecking}
        confirmLabel={deleteBlocked ? tu('deleteDialog.ack') : t('app.common.actions.delete')}
        cancelLabel={
          deleteBlocked ? t('app.common.actions.close') : t('app.common.actions.cancel')
        }
        message={
          deleteChecking ? (
            <span style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
              {tu('deleteDialog.checking')}
            </span>
          ) : deleteBlocked ? (
            <span style={{ color: 'var(--red-text)' }}>{deleteBlocked}</span>
          ) : (
            <>
              {tu('deleteDialog.confirmPrefix')}
              <strong>
                {deleteTarget ? displayName(deleteTarget) : tu('deleteDialog.confirmFallbackName')}
              </strong>
              {tu('deleteDialog.confirmSuffix')}
            </>
          )
        }
        // When blocked, the confirm button just dismisses the dialog.
        onConfirm={deleteBlocked ? cancelDelete : confirmDelete}
        onCancel={cancelDelete}
      />
    </div>
  );
}

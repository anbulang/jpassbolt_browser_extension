/**
 * Users directory modals + row helpers (ported from SPA pages/Users.tsx,
 * split out per WP-USERS). Pure presentation over props — all API calls stay
 * in index.tsx. Keys live in shared/i18n/dicts/users.ts (app.directory.users.*).
 */
import type { FormEvent } from 'react';
import { ShieldAlert, ShieldCheck } from 'lucide-react';
import type { Role, User } from '../../../shared/types';
import { avatarUrl } from '../../services/profile';
import { Modal } from '../../components/Modal';
import { Avatar } from '../../components/Avatar';
import { Badge, type BadgeVariant } from '../../components/Badge';
import { t } from '../../../shared/i18n';

/** Shorthand: translate under the users directory namespace. */
export const tu = (key: string, vars?: Record<string, string | number>): string =>
  t(`app.directory.users.${key}`, vars);

// ---------------------------------------------------------------------------
// Row / status helpers (shared by the table and the modals)
// ---------------------------------------------------------------------------

/** Best-effort full name from a profile, falling back to the username. */
export function displayName(user: User): string {
  const full = [user.profile?.first_name, user.profile?.last_name]
    .filter(Boolean)
    .join(' ')
    .trim();
  return full || user.username;
}

export interface UserStatus {
  /** i18n key under app.directory.users.status for the chip label. */
  labelKey: 'disabled' | 'active' | 'pending';
  /** Aegis statuschip variant: active / disabled / pending. */
  tone: 'active' | 'disabled' | 'pending';
  variant: BadgeVariant;
}

/** Derives the status from a user's active / disabled flags. */
export function statusOf(user: User): UserStatus {
  if (user.disabled) return { labelKey: 'disabled', tone: 'disabled', variant: 'danger' };
  if (user.active) return { labelKey: 'active', tone: 'active', variant: 'success' };
  return { labelKey: 'pending', tone: 'pending', variant: 'muted' };
}

/** Maps a role name to a badge variant (used in the profile modal). */
function roleVariant(roleName?: string): BadgeVariant {
  if (roleName === 'admin') return 'primary';
  return 'default';
}

/** RFC3339 string -> short local date, or an em-dash when absent. */
export function formatDate(value?: string | null): string {
  if (!value) return '—';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
}

/** Inline role badge matching the Aegis `.rolebadge` style. */
export function RoleBadge({ roleName }: { roleName?: string }) {
  if (roleName === 'admin') {
    return (
      <span className="rolebadge admin">
        <ShieldCheck /> {tu('role.admin')}
      </span>
    );
  }
  return <span className="rolebadge">{tu('role.member')}</span>;
}

// ---------------------------------------------------------------------------
// Form state shared by the invite / edit modals
// ---------------------------------------------------------------------------

export interface UserFormState {
  first_name: string;
  last_name: string;
  username: string;
  role_id: string;
  disabled: boolean;
}

interface FormModalCommonProps {
  form: UserFormState;
  setForm: (next: UserFormState) => void;
  roles: Role[];
  saving: boolean;
  error: string | null;
  onSubmit: (e: FormEvent) => void;
  onClose: () => void;
}

function FormErrorBanner({ error }: { error: string | null }) {
  if (!error) return null;
  return (
    <div className="warnbox" role="alert" style={{ marginBottom: '20px' }}>
      <ShieldAlert />
      <span>{error}</span>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Invite modal (admin): POST /users.json
// ---------------------------------------------------------------------------

export function InviteUserModal({
  open,
  form,
  setForm,
  roles,
  saving,
  error,
  onSubmit,
  onClose,
}: FormModalCommonProps & { open: boolean }) {
  return (
    <Modal
      open={open}
      title={tu('inviteModal.title')}
      onClose={onClose}
      footer={
        <>
          <button className="btn" onClick={onClose} disabled={saving} type="button">
            {t('app.common.actions.cancel')}
          </button>
          <button
            className="btn primary"
            type="submit"
            form="invite-user-form"
            disabled={saving}
          >
            {saving ? tu('inviteModal.sending') : tu('inviteModal.send')}
          </button>
        </>
      }
    >
      {open && (
        <form id="invite-user-form" onSubmit={onSubmit}>
          <FormErrorBanner error={error} />
          <p
            style={{
              color: 'var(--text-2)',
              fontSize: '13px',
              marginTop: 0,
              marginBottom: '20px',
              lineHeight: 1.5,
            }}
          >
            {tu('inviteModal.hint')}
          </p>
          <div className="form-group">
            <label className="form-label" htmlFor="invite-username">
              {tu('inviteModal.usernameLabel')}
            </label>
            <input
              id="invite-username"
              type="email"
              className="form-control"
              value={form.username}
              onChange={(e) => setForm({ ...form, username: e.target.value })}
              placeholder="person@example.com"
              autoFocus
              required
            />
          </div>
          <div style={{ display: 'flex', gap: '12px' }}>
            <div className="form-group" style={{ flex: 1 }}>
              <label className="form-label" htmlFor="invite-first">
                {tu('inviteModal.firstNameLabel')}
              </label>
              <input
                id="invite-first"
                type="text"
                className="form-control"
                value={form.first_name}
                onChange={(e) => setForm({ ...form, first_name: e.target.value })}
                required
              />
            </div>
            <div className="form-group" style={{ flex: 1 }}>
              <label className="form-label" htmlFor="invite-last">
                {tu('inviteModal.lastNameLabel')}
              </label>
              <input
                id="invite-last"
                type="text"
                className="form-control"
                value={form.last_name}
                onChange={(e) => setForm({ ...form, last_name: e.target.value })}
                required
              />
            </div>
          </div>
          <div className="form-group" style={{ marginBottom: 0 }}>
            <label className="form-label" htmlFor="invite-role">
              {tu('inviteModal.roleLabel')}
            </label>
            <select
              id="invite-role"
              className="form-control"
              value={form.role_id}
              onChange={(e) => setForm({ ...form, role_id: e.target.value })}
              required
            >
              {roles.length === 0 && <option value="">{tu('inviteModal.roleLoading')}</option>}
              {roles.map((role) => (
                <option key={role.id} value={role.id}>
                  {role.name}
                </option>
              ))}
            </select>
          </div>
        </form>
      )}
    </Modal>
  );
}

// ---------------------------------------------------------------------------
// Edit modal (admin): PUT /users/{id}.json
// ---------------------------------------------------------------------------

export function EditUserModal({
  target,
  form,
  setForm,
  roles,
  saving,
  error,
  onSubmit,
  onClose,
}: FormModalCommonProps & { target: User | null }) {
  return (
    <Modal
      open={!!target}
      title={tu('editModal.title')}
      onClose={onClose}
      footer={
        <>
          <button className="btn" onClick={onClose} disabled={saving} type="button">
            {t('app.common.actions.cancel')}
          </button>
          <button
            className="btn primary"
            type="submit"
            form="edit-user-form"
            disabled={saving}
          >
            {saving ? t('app.common.actions.saving') : t('app.common.actions.save')}
          </button>
        </>
      }
    >
      {target && (
        <form id="edit-user-form" onSubmit={onSubmit}>
          <FormErrorBanner error={error} />
          <div className="form-group">
            <label className="form-label">{tu('editModal.usernameLabel')}</label>
            <input
              type="text"
              className="form-control"
              value={form.username}
              disabled
              style={{ opacity: 0.6 }}
            />
          </div>
          <div style={{ display: 'flex', gap: '12px' }}>
            <div className="form-group" style={{ flex: 1 }}>
              <label className="form-label" htmlFor="edit-first">
                {tu('editModal.firstNameLabel')}
              </label>
              <input
                id="edit-first"
                type="text"
                className="form-control"
                value={form.first_name}
                onChange={(e) => setForm({ ...form, first_name: e.target.value })}
                required
              />
            </div>
            <div className="form-group" style={{ flex: 1 }}>
              <label className="form-label" htmlFor="edit-last">
                {tu('editModal.lastNameLabel')}
              </label>
              <input
                id="edit-last"
                type="text"
                className="form-control"
                value={form.last_name}
                onChange={(e) => setForm({ ...form, last_name: e.target.value })}
                required
              />
            </div>
          </div>
          <div className="form-group">
            <label className="form-label" htmlFor="edit-role">
              {tu('editModal.roleLabel')}
            </label>
            <select
              id="edit-role"
              className="form-control"
              value={form.role_id}
              onChange={(e) => setForm({ ...form, role_id: e.target.value })}
              required
            >
              {roles.length === 0 && (
                <option value={form.role_id}>
                  {target.role?.name ?? tu('editModal.currentRole')}
                </option>
              )}
              {roles.map((role) => (
                <option key={role.id} value={role.id}>
                  {role.name}
                </option>
              ))}
            </select>
          </div>
          <div className="form-group" style={{ marginBottom: 0 }}>
            <label
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '10px',
                fontSize: '14px',
                cursor: 'pointer',
                userSelect: 'none',
              }}
            >
              <input
                type="checkbox"
                checked={form.disabled}
                onChange={(e) => setForm({ ...form, disabled: e.target.checked })}
              />
              <span>
                {tu('editModal.disableLabel')}
                <span
                  style={{
                    display: 'block',
                    color: 'var(--text-3)',
                    fontSize: '12px',
                  }}
                >
                  {tu('editModal.disableHint')}
                </span>
              </span>
            </label>
          </div>
        </form>
      )}
    </Modal>
  );
}

// ---------------------------------------------------------------------------
// Read-only profile detail modal (non-admin row click)
// ---------------------------------------------------------------------------

export function ViewUserModal({
  target,
  onClose,
}: {
  target: User | null;
  onClose: () => void;
}) {
  return (
    <Modal
      open={!!target}
      title={tu('viewModal.title')}
      onClose={onClose}
      maxWidth={420}
      footer={
        <button className="btn" onClick={onClose} type="button">
          {t('app.common.actions.close')}
        </button>
      }
    >
      {target && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '14px' }}>
            <Avatar
              src={avatarUrl(target, 'medium')}
              firstName={target.profile?.first_name}
              lastName={target.profile?.last_name}
              name={target.username}
              size={56}
            />
            <div style={{ minWidth: 0 }}>
              <div style={{ fontWeight: 600, fontSize: '16px' }}>{displayName(target)}</div>
              <div
                style={{
                  color: 'var(--text-2)',
                  fontSize: '13px',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                }}
              >
                {target.username}
              </div>
            </div>
          </div>
          <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
            <Badge variant={roleVariant(target.role?.name)}>
              {target.role?.name === 'admin' ? tu('role.admin') : tu('role.member')}
            </Badge>
            <Badge variant={statusOf(target).variant}>
              {tu(`status.${statusOf(target).labelKey}`)}
            </Badge>
          </div>
          <dl style={{ margin: 0, fontSize: '13px' }}>
            <div
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                padding: '8px 0',
                borderBottom: '1px solid var(--border)',
              }}
            >
              <dt style={{ color: 'var(--text-2)' }}>{tu('viewModal.joined')}</dt>
              <dd style={{ margin: 0 }}>{formatDate(target.created)}</dd>
            </div>
            <div
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                padding: '8px 0',
              }}
            >
              <dt style={{ color: 'var(--text-2)' }}>{tu('viewModal.lastLogin')}</dt>
              <dd style={{ margin: 0 }}>{formatDate(target.last_logged_in)}</dd>
            </div>
          </dl>
        </div>
      )}
    </Modal>
  );
}

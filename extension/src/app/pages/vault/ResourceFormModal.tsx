/**
 * ResourceFormModal — create or edit a password resource (SPA port).
 *
 * The UI collects PLAINTEXT form fields only and hands the whole thing to the
 * RESOURCE_SAVE background RPC — no crypto happens in this iframe. The v4/v5
 * write-format decision, the metadata encryption and the secret encryption all
 * live in background/handlers/vault.ts.
 *
 * RPC contract note: the type pick crosses the RPC explicitly as
 * `resourceTypeSlug` (create: the user's pick; edit: the resource's current
 * type unless deliberately re-picked), PLUS the legacy implicit signal —
 * choosing an encrypted-description type puts the description into
 * `secret.description` (defined, even when empty). The REVEAL-returned
 * `secret.totp` of a totp-typed resource is held in state and echoed back on
 * save so editing such a resource never destroys its TOTP.
 */
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Dices, Eye, EyeOff } from 'lucide-react';
import { Modal } from '../../components/Modal';
import type {
  Folder,
  MetadataTypesSettings,
  Resource,
  ResourceType,
} from '../../../shared/types';
import { rpc, type TotpConfig } from '../../../shared/messages';
import { PasswordGenerator, observedEntropy, strengthFromEntropy } from '../../../ui/components';
import { listFolders } from '../../services/folders';
import { getMetadataTypesSettings } from '../../services/metadata';
import { useToast } from '../../lib/toast';
import { tf } from '../../lib/i18n';
import { describeApiError } from '../../lib/errors';
import {
  RESOURCE_TYPE_ID,
  V5_PASSWORD_SLUGS,
  isEncryptedDescriptionType,
  isV5PolicyActive,
} from '../../../shared/vaultFormat';
import { barLevelFromBits } from './SecretPanel';

interface ResourceFormModalProps {
  open: boolean;
  /** Resource to edit, or null for create mode. */
  resource: Resource | null;
  resourceTypes: ResourceType[];
  folders: Folder[];
  /** Pre-selected destination folder for new resources (create mode). */
  defaultFolderId?: string | null;
  onClose: () => void;
  /** Called after a successful create/update so the caller refetches. */
  onSaved: () => void;
}

interface FormState {
  name: string;
  username: string;
  uri: string;
  description: string;
  password: string;
  resourceTypeId: string;
  folderParentId: string;
}

const EMPTY: FormState = {
  name: '',
  username: '',
  uri: '',
  description: '',
  password: '',
  resourceTypeId: '',
  folderParentId: '',
};

/**
 * Offer the password-shaped resource types the org policy dictates — NEVER a
 * v4-vs-v5 choice. When the org selects v5, the selector surfaces the v5 slugs;
 * otherwise the v4 slugs. Falls back to the v4 slugs if the org selected v5 but
 * no v5 type exists yet.
 */
function passwordResourceTypes(
  types: ResourceType[],
  typesSettings: MetadataTypesSettings | null,
): ResourceType[] {
  const v5Active = isV5PolicyActive(typesSettings);
  const allowed = new Set<string>(
    v5Active
      ? (V5_PASSWORD_SLUGS as readonly string[])
      : ['password-string', 'password-and-description'],
  );
  const filtered = types.filter((t) => allowed.has(t.slug) && !t.deleted);
  if (filtered.length > 0) return filtered;
  const anyMatch = types.filter((t) => allowed.has(t.slug));
  if (anyMatch.length > 0) return anyMatch;
  const v4Allowed = new Set<string>(['password-string', 'password-and-description']);
  const v4 = types.filter((t) => v4Allowed.has(t.slug) && !t.deleted);
  return v4.length > 0 ? v4 : types.filter((t) => v4Allowed.has(t.slug));
}

/**
 * Password input with show/hide, a strength meter (official six-tier entropy
 * thresholds via ui/components) and a fold-out PasswordGenerator.
 */
function PasswordField({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
}) {
  const [show, setShow] = useState(false);
  const [genOpen, setGenOpen] = useState(false);
  const bits = observedEntropy(value);
  const strength = strengthFromEntropy(bits);
  const barLevel = barLevelFromBits(bits);

  return (
    <div className="form-group">
      <label className="form-label">{label}</label>
      <div style={{ display: 'flex', gap: 8 }}>
        <input
          className="form-control mono"
          style={{ flex: 1 }}
          type={show ? 'text' : 'password'}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={tf('app.components.passwordField.placeholder', '密码')}
          autoComplete="off"
        />
        <button
          type="button"
          className="btn"
          title={
            show
              ? tf('app.components.passwordField.hide', '隐藏')
              : tf('app.components.passwordField.reveal', '显示')
          }
          onClick={() => setShow((s) => !s)}
        >
          {show ? <EyeOff /> : <Eye />}
        </button>
        <button
          type="button"
          className={`btn${genOpen ? ' primary' : ''}`}
          title={tf('app.components.passwordField.generatePassword', '生成密码')}
          onClick={() => setGenOpen((v) => !v)}
        >
          <Dices />
        </button>
      </div>
      {value && (
        <div className={`strength s${barLevel} pwfield-strength`}>
          {tf('app.vault.secret.strength', '强度')}
          <div className="bars">
            <i />
            <i />
            <i />
            <i />
          </div>
          <span>{strength.label}</span>
        </div>
      )}
      {genOpen && (
        <div className="pwfield-gen">
          <PasswordGenerator
            onUse={(v) => {
              onChange(v);
              setShow(true);
              setGenOpen(false);
            }}
          />
        </div>
      )}
    </div>
  );
}

export function ResourceFormModal({
  open,
  resource,
  resourceTypes,
  folders,
  defaultFolderId,
  onClose,
  onSaved,
}: ResourceFormModalProps) {
  const toast = useToast();
  const isEdit = !!resource;

  // Org create-format policy: drives ONLY the type-selector display here (the
  // background re-reads it at save time for the authoritative decision).
  const [typesSettings, setTypesSettings] = useState<MetadataTypesSettings | null>(null);

  const typeOptions = useMemo(
    () => passwordResourceTypes(resourceTypes, typesSettings),
    [resourceTypes, typesSettings],
  );

  const [form, setForm] = useState<FormState>(EMPTY);
  // TOTP sub-object of a totp-typed resource, captured from the REVEAL prefill
  // and echoed back on save. It is NEVER rendered — this state exists solely so
  // an edit round-trip cannot destroy the TOTP (the form has no TOTP fields).
  const [secretTotp, setSecretTotp] = useState<TotpConfig | undefined>(undefined);
  const [saving, setSaving] = useState(false);
  const [prefilling, setPrefilling] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Destination-folder options: seeded from the prop then refreshed live on
  // open, so a folder just created in the sidebar is selectable immediately.
  const [folderOptions, setFolderOptions] = useState<Folder[]>(folders);

  const currentSlug = useMemo(
    () => resourceTypes.find((t) => t.id === form.resourceTypeId)?.slug,
    [resourceTypes, form.resourceTypeId],
  );
  const usesEncryptedDescription = isEncryptedDescriptionType(currentSlug);

  // ---------------------------------------------------------------------------
  // Form (re)initialization — only on a genuine open transition / resource
  // switch, never on dependency churn (would wipe mid-edit input).
  // ---------------------------------------------------------------------------
  const initKeyRef = useRef<string | null>(null);

  useEffect(() => {
    if (!open) {
      initKeyRef.current = null;
      return;
    }
    const key = isEdit && resource ? `edit:${resource.id}` : 'create';
    if (initKeyRef.current === key) return;
    initKeyRef.current = key;

    setError(null);
    setSecretTotp(undefined); // re-seeded by the REVEAL prefill in edit mode
    if (isEdit && resource) {
      const slug = resourceTypes.find((t) => t.id === resource.resource_type_id)?.slug;
      setForm({
        name: resource.name ?? '',
        username: resource.username ?? '',
        uri: resource.uri ?? '',
        description: isEncryptedDescriptionType(slug) ? '' : resource.description ?? '',
        password: '',
        resourceTypeId: resource.resource_type_id,
        folderParentId: '',
      });
    } else {
      const defaultType =
        typeOptions.find((t) => t.id === RESOURCE_TYPE_ID.PASSWORD_AND_DESCRIPTION) ??
        typeOptions.find((t) => t.id === RESOURCE_TYPE_ID.PASSWORD_STRING) ??
        typeOptions[0];
      setForm({
        ...EMPTY,
        resourceTypeId: defaultType?.id ?? '',
        folderParentId: defaultFolderId ?? '',
      });
    }
  }, [open, isEdit, resource, resourceTypes, typeOptions, defaultFolderId]);

  // ---------------------------------------------------------------------------
  // Async prefill (edit mode): background-decrypt the existing secret via the
  // REVEAL RPC to fill the password/description fields.
  // ---------------------------------------------------------------------------
  useEffect(() => {
    if (!open || !isEdit || !resource) return;
    const slug = resourceTypes.find((t) => t.id === resource.resource_type_id)?.slug;
    let cancelled = false;
    setPrefilling(true);
    (async () => {
      try {
        const { secret } = await rpc({ type: 'REVEAL', id: resource.id });
        if (cancelled) return;
        // Hold the totp sub-object (if any) so the save echoes it back — the
        // background refuses updates that would drop an existing TOTP.
        setSecretTotp(secret.totp);
        setForm((f) => ({
          ...f,
          password: secret.password,
          description: isEncryptedDescriptionType(slug)
            ? secret.description ?? ''
            : f.description,
        }));
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : describeApiError(err));
        }
      } finally {
        if (!cancelled) setPrefilling(false);
      }
    })();
    return () => {
      cancelled = true;
    };
    // resource.id is the stable identity; resourceTypes only supplies the slug.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, isEdit, resource?.id]);

  // Load the org create-format policy when the modal opens (selector display).
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    (async () => {
      try {
        const settings = await getMetadataTypesSettings();
        if (!cancelled) setTypesSettings(settings);
      } catch {
        // Tolerate: the v4 selector is the safe default when the policy is unknown.
        if (!cancelled) setTypesSettings(null);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [open]);

  // Refresh the create-mode folder picker on open (edit mode uses the separate
  // "移动到…" action — PUT /resources never touches folders_relations).
  useEffect(() => {
    if (!open || isEdit) return;
    setFolderOptions(folders);
    let cancelled = false;
    (async () => {
      try {
        const fresh = await listFolders();
        if (!cancelled) setFolderOptions(fresh);
      } catch {
        // keep the seeded prop list
      }
    })();
    return () => {
      cancelled = true;
    };
    // `folders` is re-seeded synchronously above on each open.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, isEdit]);

  // Create mode: keep the selected type valid as the org policy loads (the v4
  // default picked before the policy arrived may not be offered under v5).
  useEffect(() => {
    if (!open || isEdit) return;
    setForm((f) => {
      if (f.resourceTypeId && typeOptions.some((t) => t.id === f.resourceTypeId)) {
        return f;
      }
      const def =
        typeOptions.find((t) => t.slug === 'v5-default') ??
        typeOptions.find((t) => t.id === RESOURCE_TYPE_ID.PASSWORD_AND_DESCRIPTION) ??
        typeOptions.find((t) => t.id === RESOURCE_TYPE_ID.PASSWORD_STRING) ??
        typeOptions[0];
      return def ? { ...f, resourceTypeId: def.id } : f;
    });
  }, [open, isEdit, typeOptions]);

  const setField = <K extends keyof FormState>(key: K, value: FormState[K]) =>
    setForm((f) => ({ ...f, [key]: value }));

  const canSubmit =
    form.name.trim().length > 0 && form.password.length > 0 && !!form.resourceTypeId;

  const handleSubmit = async () => {
    if (!canSubmit) return;
    setError(null);
    setSaving(true);
    try {
      await rpc({
        type: 'RESOURCE_SAVE',
        mode: isEdit && resource ? 'update' : 'create',
        ...(isEdit && resource ? { resourceId: resource.id } : {}),
        input: {
          name: form.name.trim(),
          username: form.username.trim(),
          uri: form.uri.trim(),
          // Explicit type signal: the selected type's slug (edit mode defaults
          // to the resource's current type). The background uses it to keep
          // v4 rows v4 / v5 rows v5 and to honor the exact v5 pick.
          ...(currentSlug ? { resourceTypeSlug: currentSlug } : {}),
          // Cleartext/metadata description; encrypted-description types carry
          // it inside `secret` instead (defined-ness IS the type signal).
          ...(usesEncryptedDescription ? {} : { description: form.description }),
          ...(!isEdit && form.folderParentId ? { folderParentId: form.folderParentId } : {}),
          secret: {
            password: form.password,
            ...(usesEncryptedDescription ? { description: form.description } : {}),
            // Echo the REVEAL-captured TOTP back (edit of a totp-typed row).
            ...(secretTotp ? { totp: secretTotp } : {}),
          },
        },
      });
      toast.success(
        isEdit
          ? tf('app.vault.toast.updated', '凭据已更新')
          : tf('app.vault.toast.created', '凭据已创建'),
      );
      onSaved();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : describeApiError(err));
    } finally {
      setSaving(false);
    }
  };

  return (
    <ModalShell
      open={open}
      isEdit={isEdit}
      saving={saving}
      canSubmit={canSubmit}
      onClose={onClose}
      onSubmit={handleSubmit}
    >
      {error && (
        <div className="warnbox" style={{ marginBottom: 18, fontSize: 13 }}>
          {error}
        </div>
      )}

      {prefilling && (
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            color: 'var(--text-3)',
            marginBottom: 16,
            fontSize: 13,
          }}
        >
          <span className="spin-ring" /> {tf('app.vault.form.decryptingCurrent', '正在解密当前密钥…')}
        </div>
      )}

      <div className="form-group">
        <label className="form-label">{tf('app.vault.form.nameLabel', '名称 *')}</label>
        <input
          className="form-control"
          value={form.name}
          onChange={(e) => setField('name', e.target.value)}
          placeholder={tf('app.vault.form.namePlaceholder', '例如：GitHub')}
          autoFocus
        />
      </div>

      <div className="form-group">
        <label className="form-label">{tf('app.vault.form.usernameLabel', '用户名')}</label>
        <input
          className="form-control"
          value={form.username}
          onChange={(e) => setField('username', e.target.value)}
          placeholder={tf('app.vault.form.usernamePlaceholder', 'you@example.com')}
        />
      </div>

      <div className="form-group">
        <label className="form-label">{tf('app.vault.form.uriLabel', '网址')}</label>
        <input
          className="form-control"
          value={form.uri}
          onChange={(e) => setField('uri', e.target.value)}
          placeholder={tf('app.vault.form.uriPlaceholder', 'https://example.com')}
        />
      </div>

      <PasswordField
        label={tf('app.vault.form.passwordLabel', '密码 *')}
        value={form.password}
        onChange={(v) => setField('password', v)}
      />

      <div className="form-group">
        <label className="form-label">{tf('app.vault.form.descriptionLabel', '描述')}</label>
        <textarea
          className="form-control"
          value={form.description}
          onChange={(e) => setField('description', e.target.value)}
          placeholder={
            usesEncryptedDescription
              ? tf('app.vault.form.descriptionEncryptedPlaceholder', '随密钥一起加密')
              : tf('app.vault.form.descriptionCleartextPlaceholder', '可选备注（不加密存储）')
          }
        />
      </div>

      <div className="form-group">
        <label className="form-label">{tf('app.vault.form.typeLabel', '类型')}</label>
        <select
          className="form-control"
          value={form.resourceTypeId}
          onChange={(e) => setField('resourceTypeId', e.target.value)}
        >
          {typeOptions.map((rt) => (
            <option key={rt.id} value={rt.id}>
              {rt.name}
            </option>
          ))}
        </select>
      </div>

      {!isEdit && (
        <div className="form-group" style={{ marginBottom: 0 }}>
          <label className="form-label">{tf('app.vault.form.folderLabel', '文件夹')}</label>
          <select
            className="form-control"
            value={form.folderParentId}
            onChange={(e) => setField('folderParentId', e.target.value)}
          >
            <option value="">{tf('app.vault.form.noFolder', '无文件夹（根目录）')}</option>
            {folderOptions.map((f) => (
              <option key={f.id} value={f.id}>
                {f.name}
              </option>
            ))}
          </select>
        </div>
      )}
    </ModalShell>
  );
}

// Thin wrapper keeping the Modal chrome out of the (long) form body above.
function ModalShell({
  open,
  isEdit,
  saving,
  canSubmit,
  onClose,
  onSubmit,
  children,
}: {
  open: boolean;
  isEdit: boolean;
  saving: boolean;
  canSubmit: boolean;
  onClose: () => void;
  onSubmit: () => void;
  children: ReactNode;
}) {
  return (
    <Modal
      open={open}
      title={
        isEdit
          ? tf('app.vault.form.titleEdit', '编辑凭据')
          : tf('app.vault.form.titleCreate', '新建凭据')
      }
      onClose={saving ? () => {} : onClose}
      maxWidth={560}
      footer={
        <>
          <span style={{ flex: 1 }} />
          <button className="btn" onClick={onClose} disabled={saving}>
            {tf('app.common.actions.cancel', '取消')}
          </button>
          <button className="btn primary" onClick={onSubmit} disabled={!canSubmit || saving}>
            {saving
              ? tf('app.common.actions.saving', '保存中…')
              : isEdit
                ? tf('app.vault.form.saveChanges', '保存更改')
                : tf('app.vault.form.create', '创建')}
          </button>
        </>
      }
    >
      {children}
    </Modal>
  );
}

export default ResourceFormModal;

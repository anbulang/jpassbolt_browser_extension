/**
 * Encrypted-metadata admin sections (WP-METADATA-ADMIN) — ported from the SPA
 * pages/EncryptedMetadataSettings.tsx sections, restyled onto the Aegis
 * `.scard` / `.srow` / `.switch` kit. Pure API_CALL transport via
 * app/services/metadata.ts; nothing here touches key material beyond public
 * fingerprints and distribution counts.
 *
 * v5-gating semantics kept verbatim from the SPA: enabling any v5-dependent
 * flag requires an ACTIVE org metadata key (a row with expired===null &&
 * deleted===null); the form blocks the save client-side AND still surfaces the
 * backend 400 message verbatim if a write slips through.
 */
import { useMemo, useState, type CSSProperties, type ReactNode } from 'react';
import {
  AlertTriangle,
  Check,
  KeyRound,
  Pencil,
  Settings as SettingsIcon,
  ShieldCheck,
  X,
} from 'lucide-react';
import {
  updateMetadataKeysSettings,
  updateMetadataTypesSettings,
} from '../../services/metadata';
import type {
  MetadataDefaultType,
  MetadataKey,
  MetadataKeysSettings,
  MetadataTypesSettings,
} from '../../../shared/types';
import { Badge } from '../../components/Badge';
import { EmptyState } from '../../components/EmptyState';
import { useToast } from '../../lib/toast';
import { describeApiError } from '../../lib/errors';
import { tf } from '../../lib/i18n';

// ---------------------------------------------------------------------------
// Presentation helpers
// ---------------------------------------------------------------------------

export function ErrorBanner({ children }: { children: ReactNode }) {
  return (
    <div className="warnbox" role="alert">
      <AlertTriangle />
      <span>{children}</span>
    </div>
  );
}

/** Amber variant of .warnbox (aegis only ships the red one). */
const warnBannerStyle: CSSProperties = {
  background: 'var(--amber-soft)',
  borderColor: 'color-mix(in oklch, var(--amber) 35%, transparent)',
  color: 'var(--amber-text, var(--amber))',
};

export function WarnBanner({ children }: { children: ReactNode }) {
  return (
    <div className="warnbox" style={warnBannerStyle}>
      <AlertTriangle />
      <span>{children}</span>
    </div>
  );
}

/** RFC3339 / ISO string -> human readable; passes through unparsable input. */
function formatDate(value: string | null | undefined): string {
  if (!value) return '—';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return value;
  return d.toLocaleString();
}

/** Group an OpenPGP fingerprint into 4-char blocks for readability. */
function formatFingerprint(fp: string): string {
  const clean = fp.replace(/\s+/g, '').toUpperCase();
  return clean.match(/.{1,4}/g)?.join(' ') ?? clean;
}

/** A read-only "yes / no" pill for boolean policy rows. */
function BoolBadge({ value }: { value: boolean }) {
  return (
    <Badge
      variant={value ? 'success' : 'muted'}
      icon={value ? <Check size={12} /> : <X size={12} />}
    >
      {value
        ? tf('app.settings.metadata.bool.yes', '是')
        : tf('app.settings.metadata.bool.no', '否')}
    </Badge>
  );
}

/** Aegis switch button — the edit-mode replacement for the SPA checkbox. */
function Switch({
  on,
  disabled,
  onToggle,
  label,
}: {
  on: boolean;
  disabled?: boolean;
  onToggle: (next: boolean) => void;
  label: string;
}) {
  return (
    <button
      type="button"
      className={`switch${on ? ' on' : ''}`}
      role="switch"
      aria-checked={on}
      aria-label={label}
      disabled={disabled}
      style={disabled ? { opacity: 0.45, cursor: 'not-allowed' } : undefined}
      onClick={() => onToggle(!on)}
    />
  );
}

const subtitleStyle: CSSProperties = {
  padding: '12px 18px 0',
  fontSize: '12.5px',
  color: 'var(--text-3)',
  lineHeight: 1.5,
};

const bannerWrapStyle: CSSProperties = { padding: '12px 18px 0' };

const groupHeadStyle: CSSProperties = {
  padding: '16px 18px 4px',
  fontSize: '11px',
  fontWeight: 600,
  letterSpacing: '0.05em',
  textTransform: 'uppercase',
  color: 'var(--text-3)',
};

const footStyle: CSSProperties = {
  display: 'flex',
  gap: '10px',
  padding: '14px 18px 16px',
  borderTop: '1px solid var(--border)',
  marginTop: '12px',
};

// ===========================================================================
// Section 1 — Metadata types policy
// ===========================================================================
const M = 'app.settings.metadata';

const TYPE_ENTITIES: { key: keyof MetadataTypesSettings; labelKey: string; fb: string }[] = [
  { key: 'default_resource_types', labelKey: `${M}.entities.resources`, fb: '资源' },
  { key: 'default_folder_type', labelKey: `${M}.entities.folders`, fb: '文件夹' },
  { key: 'default_tag_type', labelKey: `${M}.entities.tags`, fb: '标签' },
  { key: 'default_comment_type', labelKey: `${M}.entities.comments`, fb: '评论' },
];

const V5_CREATE_FLAGS: { key: keyof MetadataTypesSettings; labelKey: string; fb: string }[] = [
  { key: 'allow_creation_of_v5_resources', labelKey: `${M}.v5Create.resources`, fb: '允许创建 v5 资源' },
  { key: 'allow_creation_of_v5_folders', labelKey: `${M}.v5Create.folders`, fb: '允许创建 v5 文件夹' },
  { key: 'allow_creation_of_v5_tags', labelKey: `${M}.v5Create.tags`, fb: '允许创建 v5 标签' },
  { key: 'allow_creation_of_v5_comments', labelKey: `${M}.v5Create.comments`, fb: '允许创建 v5 评论' },
];

const V4_CREATE_FLAGS: { key: keyof MetadataTypesSettings; labelKey: string; fb: string }[] = [
  { key: 'allow_creation_of_v4_resources', labelKey: `${M}.v4Create.resources`, fb: '允许创建 v4 资源' },
  { key: 'allow_creation_of_v4_folders', labelKey: `${M}.v4Create.folders`, fb: '允许创建 v4 文件夹' },
  { key: 'allow_creation_of_v4_tags', labelKey: `${M}.v4Create.tags`, fb: '允许创建 v4 标签' },
  { key: 'allow_creation_of_v4_comments', labelKey: `${M}.v4Create.comments`, fb: '允许创建 v4 评论' },
];

const MIGRATION_FLAGS: { key: keyof MetadataTypesSettings; labelKey: string; fb: string }[] = [
  { key: 'allow_v4_v5_upgrade', labelKey: `${M}.migration.upgrade`, fb: '允许 v4 → v5 升级' },
  { key: 'allow_v5_v4_downgrade', labelKey: `${M}.migration.downgrade`, fb: '允许 v5 → v4 降级' },
];

/** The boolean fields that imply v5 is in use (blocked without an active key). */
const V5_DEPENDENT_KEYS: (keyof MetadataTypesSettings)[] = [
  'allow_creation_of_v5_resources',
  'allow_creation_of_v5_folders',
  'allow_creation_of_v5_tags',
  'allow_creation_of_v5_comments',
  'allow_v4_v5_upgrade',
];

export function TypesPolicySection({
  settings,
  hasActiveKey,
  onSaved,
}: {
  settings: MetadataTypesSettings;
  hasActiveKey: boolean;
  onSaved: (next: MetadataTypesSettings) => void;
}) {
  const toast = useToast();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<MetadataTypesSettings>(settings);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const beginEdit = () => {
    setDraft(settings);
    setError(null);
    setEditing(true);
  };

  const cancelEdit = () => {
    setEditing(false);
    setError(null);
  };

  const setDefault = (key: keyof MetadataTypesSettings, value: MetadataDefaultType) =>
    setDraft((d) => ({ ...d, [key]: value }));

  const setBool = (key: keyof MetadataTypesSettings, value: boolean) =>
    setDraft((d) => ({ ...d, [key]: value }));

  /** Will this draft turn any v5-dependent setting ON? */
  const draftEnablesV5 = useMemo(() => {
    const v5DefaultSelected = TYPE_ENTITIES.some((e) => draft[e.key] === 'v5');
    const v5FlagOn = V5_DEPENDENT_KEYS.some((k) => draft[k] === true);
    return v5DefaultSelected || v5FlagOn;
  }, [draft]);

  const blockedNoKey = draftEnablesV5 && !hasActiveKey;

  const handleSave = async () => {
    if (blockedNoKey) {
      setError(tf(`${M}.typesPolicy.blockedNoKey`, '启用 v5 需要一个处于激活状态的组织元数据密钥，请先创建元数据密钥。'));
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const updated = await updateMetadataTypesSettings(draft);
      onSaved(updated);
      setEditing(false);
      toast.success(tf(`${M}.typesPolicy.updated`, '元数据格式策略已更新。'));
    } catch (err: unknown) {
      // The backend 400s when a v5 flag is enabled without an active key —
      // surface its message verbatim instead of failing silently.
      const msg = describeApiError(err);
      setError(msg);
      toast.error(msg);
    } finally {
      setSaving(false);
    }
  };

  return (
    <section className="scard">
      <div className="scard-h">
        <SettingsIcon />
        <h3>{tf(`${M}.typesPolicy.title`, '元数据格式策略')}</h3>
        {!editing && (
          <button type="button" className="btn sm" onClick={beginEdit}>
            <Pencil /> {tf('app.common.actions.edit', '编辑')}
          </button>
        )}
      </div>
      <p style={subtitleStyle}>{tf(`${M}.typesPolicy.subtitle`, '控制新建项目使用的格式，以及是否允许在组织范围内创建和迁移 v4/v5。')}</p>

      {!hasActiveKey && (
        <div style={bannerWrapStyle}>
          <WarnBanner>{tf(`${M}.typesPolicy.noActiveKeyWarn`, '目前尚无处于激活状态的组织元数据密钥。启用任何 v5 选项都需要一个激活的元数据密钥——在创建之前，服务器将拒绝相关更改。')}</WarnBanner>
        </div>
      )}

      {error && (
        <div style={bannerWrapStyle}>
          <ErrorBanner>{error}</ErrorBanner>
        </div>
      )}

      {/* Default formats per entity */}
      <div style={groupHeadStyle}>{tf(`${M}.typesPolicy.defaultFormats`, '默认格式')}</div>
      {TYPE_ENTITIES.map(({ key, labelKey, fb }) => (
        <div className="srow" key={key}>
          <div className="sk">
            <div className="label">{tf(labelKey, fb)}</div>
          </div>
          <div className="sv">
            {editing ? (
              <select
                className="sinput sans"
                style={{ minWidth: '110px' }}
                value={draft[key] as MetadataDefaultType}
                onChange={(e) => setDefault(key, e.target.value as MetadataDefaultType)}
                disabled={saving}
              >
                <option value="v4">v4</option>
                <option value="v5">v5</option>
              </select>
            ) : (
              <Badge variant={settings[key] === 'v5' ? 'primary' : 'muted'}>
                {settings[key] as string}
              </Badge>
            )}
          </div>
        </div>
      ))}

      {/* Boolean policy groups */}
      <BoolFlagGroup
        title={tf(`${M}.typesPolicy.groupV5Create`, 'v5 创建')}
        flags={V5_CREATE_FLAGS}
        editing={editing}
        saving={saving}
        settings={settings}
        draft={draft}
        onToggle={setBool}
        disabledWhenNoKey={!hasActiveKey}
      />
      <BoolFlagGroup
        title={tf(`${M}.typesPolicy.groupV4Create`, 'v4 创建')}
        flags={V4_CREATE_FLAGS}
        editing={editing}
        saving={saving}
        settings={settings}
        draft={draft}
        onToggle={setBool}
      />
      <BoolFlagGroup
        title={tf(`${M}.typesPolicy.groupMigration`, '迁移')}
        flags={MIGRATION_FLAGS}
        editing={editing}
        saving={saving}
        settings={settings}
        draft={draft}
        onToggle={setBool}
        disabledKeys={['allow_v4_v5_upgrade']}
        disabledWhenNoKey={!hasActiveKey}
      />

      {editing && (
        <div style={footStyle}>
          <button
            type="button"
            className="btn primary"
            onClick={() => void handleSave()}
            disabled={saving || blockedNoKey}
          >
            {saving ? <span className="spin-ring" /> : null}
            {saving
              ? tf(`${M}.typesPolicy.saving`, '正在保存……')
              : tf(`${M}.typesPolicy.savePolicy`, '保存策略')}
          </button>
          <button type="button" className="btn" onClick={cancelEdit} disabled={saving}>
            {tf('app.common.actions.cancel', '取消')}
          </button>
        </div>
      )}
    </section>
  );
}

/** A labelled group of boolean policy rows (view = badge, edit = switch). */
function BoolFlagGroup({
  title,
  flags,
  editing,
  saving,
  settings,
  draft,
  onToggle,
  disabledKeys = [],
  disabledWhenNoKey = false,
}: {
  title: string;
  flags: { key: keyof MetadataTypesSettings; labelKey: string; fb: string }[];
  editing: boolean;
  saving: boolean;
  settings: MetadataTypesSettings;
  draft: MetadataTypesSettings;
  onToggle: (key: keyof MetadataTypesSettings, value: boolean) => void;
  /** Subset of flags that depend on an active key (disabled when none). */
  disabledKeys?: (keyof MetadataTypesSettings)[];
  disabledWhenNoKey?: boolean;
}) {
  // When the group itself is v5-dependent (no explicit subset), all rows gate.
  const allGate = disabledWhenNoKey && disabledKeys.length === 0;

  return (
    <>
      <div style={groupHeadStyle}>{title}</div>
      {flags.map(({ key, labelKey, fb }) => {
        const gated = disabledWhenNoKey && (allGate || disabledKeys.includes(key));
        const current = settings[key] as boolean;
        const drafted = draft[key] as boolean;
        const label = tf(labelKey, fb);
        return (
          <div className="srow" key={key}>
            <div className="sk">
              <div className="label">{label}</div>
              {editing && gated && (
                <div className="hint">
                  {tf(`${M}.typesPolicy.needsActiveKey`, '（需要一个激活的元数据密钥）')}
                </div>
              )}
            </div>
            <div className="sv">
              {editing ? (
                <Switch
                  on={drafted}
                  disabled={saving || gated}
                  onToggle={(v) => onToggle(key, v)}
                  label={label}
                />
              ) : (
                <BoolBadge value={current} />
              )}
            </div>
          </div>
        );
      })}
    </>
  );
}

// ===========================================================================
// Section 2 — Keys settings
// ===========================================================================
export function KeysSettingsSection({
  settings,
  onSaved,
}: {
  settings: MetadataKeysSettings;
  onSaved: (next: MetadataKeysSettings) => void;
}) {
  const toast = useToast();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<MetadataKeysSettings>(settings);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const beginEdit = () => {
    setDraft(settings);
    setError(null);
    setEditing(true);
  };

  const cancelEdit = () => {
    setEditing(false);
    setError(null);
  };

  const handleSave = async () => {
    setSaving(true);
    setError(null);
    try {
      const updated = await updateMetadataKeysSettings(draft);
      onSaved(updated);
      setEditing(false);
      toast.success(tf(`${M}.keysSettings.updated`, '元数据密钥设置已更新。'));
    } catch (err: unknown) {
      const msg = describeApiError(err);
      setError(msg);
      toast.error(msg);
    } finally {
      setSaving(false);
    }
  };

  const rows: { key: keyof MetadataKeysSettings; label: string; help: string }[] = [
    {
      key: 'allow_usage_of_personal_keys',
      label: tf(`${M}.keysSettings.allowPersonalKeys`, '允许使用个人密钥'),
      help: tf(
        `${M}.keysSettings.allowPersonalKeysHelp`,
        '允许个人项目的元数据使用用户自己的 GPG 密钥（user_key）加密。',
      ),
    },
    {
      key: 'zero_knowledge_key_share',
      label: tf(`${M}.keysSettings.zeroKnowledge`, '零知识密钥共享'),
      help: tf(
        `${M}.keysSettings.zeroKnowledgeHelp`,
        '在服务器始终不持有元数据密钥私钥部分的前提下共享该密钥。',
      ),
    },
  ];

  return (
    <section className="scard">
      <div className="scard-h">
        <ShieldCheck />
        <h3>{tf(`${M}.keysSettings.title`, '元数据密钥设置')}</h3>
        {!editing && (
          <button type="button" className="btn sm" onClick={beginEdit}>
            <Pencil /> {tf('app.common.actions.edit', '编辑')}
          </button>
        )}
      </div>
      <p style={subtitleStyle}>{tf(`${M}.keysSettings.subtitle`, '管理元数据密钥在组织范围内的使用与共享方式。')}</p>

      {error && (
        <div style={bannerWrapStyle}>
          <ErrorBanner>{error}</ErrorBanner>
        </div>
      )}

      {rows.map(({ key, label, help }) => (
        <div className="srow" key={key}>
          <div className="sk">
            <div className="label">{label}</div>
            <div className="hint">{help}</div>
          </div>
          <div className="sv">
            {editing ? (
              <Switch
                on={draft[key]}
                disabled={saving}
                onToggle={(v) => setDraft((d) => ({ ...d, [key]: v }))}
                label={label}
              />
            ) : (
              <BoolBadge value={settings[key]} />
            )}
          </div>
        </div>
      ))}

      {editing && (
        <div style={footStyle}>
          <button
            type="button"
            className="btn primary"
            onClick={() => void handleSave()}
            disabled={saving}
          >
            {saving ? <span className="spin-ring" /> : null}
            {saving
              ? tf(`${M}.keysSettings.saving`, '正在保存……')
              : tf(`${M}.keysSettings.saveSettings`, '保存设置')}
          </button>
          <button type="button" className="btn" onClick={cancelEdit} disabled={saving}>
            {tf('app.common.actions.cancel', '取消')}
          </button>
        </div>
      )}
    </section>
  );
}

// ===========================================================================
// Section 3 — Org metadata keys (read-only)
// ===========================================================================
function keyStatus(k: MetadataKey): {
  labelKey: string;
  fb: string;
  variant: 'success' | 'muted' | 'danger';
} {
  if (k.deleted !== null)
    return { labelKey: `${M}.orgKeys.statusDeleted`, fb: '已删除', variant: 'danger' };
  if (k.expired !== null)
    return { labelKey: `${M}.orgKeys.statusExpired`, fb: '已过期', variant: 'muted' };
  return { labelKey: `${M}.orgKeys.statusActive`, fb: '激活', variant: 'success' };
}

const thStyle: CSSProperties = {
  textAlign: 'left',
  padding: '8px 12px 8px 0',
  color: 'var(--text-3)',
  fontWeight: 600,
  fontSize: '11px',
  textTransform: 'uppercase',
  letterSpacing: '0.05em',
  borderBottom: '1px solid var(--border)',
};

const tdBase: CSSProperties = {
  padding: '12px 12px 12px 0',
  borderBottom: '1px solid var(--border)',
  verticalAlign: 'top',
};

export function OrgKeysSection({
  keys,
  userCount,
}: {
  keys: MetadataKey[];
  userCount: number | null;
}) {
  return (
    <section className="scard">
      <div className="scard-h">
        <KeyRound />
        <h3>{tf(`${M}.orgKeys.title`, '组织元数据密钥')}</h3>
      </div>
      <p style={subtitleStyle}>{tf(`${M}.orgKeys.subtitle`, '用于加密资源元数据的共享密钥。分发情况显示有多少用户持有每个密钥私钥部分的加密副本。此处暂不支持创建和轮换密钥。')}</p>

      {keys.length === 0 ? (
        <EmptyState
          icon={KeyRound}
          title={tf(`${M}.orgKeys.emptyTitle`, '暂无元数据密钥')}
          description={tf(`${M}.orgKeys.emptyDescription`, '尚未创建任何组织元数据密钥。在创建之前，v5 加密元数据将保持禁用。')}
        />
      ) : (
        <div style={{ padding: '4px 18px 16px' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '13px' }}>
            <thead>
              <tr>
                <th style={thStyle}>{tf(`${M}.orgKeys.thFingerprint`, '指纹')}</th>
                <th style={thStyle}>{tf(`${M}.orgKeys.thStatus`, '状态')}</th>
                <th style={thStyle}>{tf(`${M}.orgKeys.thCreated`, '创建时间')}</th>
                <th style={thStyle}>{tf(`${M}.orgKeys.thDistribution`, '分发情况')}</th>
              </tr>
            </thead>
            <tbody>
              {keys.map((k) => {
                const status = keyStatus(k);
                const distributed = k.metadata_private_keys?.length ?? 0;
                const distLabel =
                  userCount != null
                    ? tf(`${M}.orgKeys.distWithTotal`, '{{distributed}} / {{total}} 位用户', {
                        distributed,
                        total: userCount,
                      })
                    : tf(`${M}.orgKeys.distNoTotal`, '{{distributed}} 位用户', { distributed });
                return (
                  <tr key={k.id}>
                    <td
                      style={{
                        ...tdBase,
                        fontFamily: 'var(--mono)',
                        color: 'var(--text)',
                        wordBreak: 'break-all',
                      }}
                    >
                      {formatFingerprint(k.fingerprint)}
                    </td>
                    <td style={tdBase}>
                      <Badge variant={status.variant}>{tf(status.labelKey, status.fb)}</Badge>
                    </td>
                    <td style={{ ...tdBase, color: 'var(--text-2)' }}>{formatDate(k.created)}</td>
                    <td style={{ ...tdBase, color: 'var(--text-2)' }}>{distLabel}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

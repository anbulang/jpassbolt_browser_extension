/**
 * SecretPanel — the vault's third column (SPA pages/vault/SecretPanel.tsx port).
 *
 * Encrypted-by-default: the password shows as •••••• until the user clicks 显示,
 * which asks the background to fetch + decrypt via the existing REVEAL RPC (the
 * armored secret and the private key never enter this iframe; only the revealed
 * fields do). A revealed secret auto re-locks after REVEAL_SECS; copying goes
 * through the background COPY RPC with `temporary` so the clipboard is cleared
 * on the extension's usual burn timer.
 *
 * Three tabs: 凭据 (details + secret) · 共享 (current ACL) · 评论. The component
 * is keyed by resource.id in the Vault page, so switching rows remounts it and
 * resets all reveal state.
 */
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import {
  Lock,
  Unlock,
  Eye,
  Copy,
  Check,
  Link as LinkIcon,
  Share2,
  Pencil,
  Move as MoveIcon,
  Star,
  KeyRound,
  Clock,
  AlertTriangle,
  User as UserIcon,
  MessageSquare,
  Users as UsersIcon,
  Plus,
  Trash2,
} from 'lucide-react';
import type {
  Comment,
  PermissionWithAro,
  Resource,
  ResourceType,
} from '../../../shared/types';
import { rpc } from '../../../shared/messages';
import { observedEntropy } from '../../../ui/components';
import { t } from '../../../shared/i18n';
import { joinName, initialsFromNames } from '../../../shared/names';
import { getResourcePermissions } from '../../services/permissions';
import { listComments, addComment } from '../../services/comments';
import { useToast } from '../../lib/toast';
import { tf } from '../../lib/i18n';
import { describeApiError } from '../../lib/errors';
import { isEncryptedDescriptionType, isV5Resource } from '../../../shared/vaultFormat';

/**
 * Seconds before a revealed password re-hides. Deliberately a fixed value: the
 * SPA's user-configurable `revealSecs` preference was dropped in the extension
 * (see ProfileTab's storage-key contract note). The clipboard burn notice, by
 * contrast, reflects the user-configurable `jpb_clipboard_clear_ms` — the COPY
 * RPC returns the effective clear delay and the toast renders that.
 */
const REVEAL_SECS = 30;

// ---------------------------------------------------------------------------
// Pure helpers (shared visual language with the list column)
// ---------------------------------------------------------------------------
export function hashHue(seed: string): number {
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) >>> 0;
  return h % 360;
}
export function tileColor(seed: string): string {
  return `oklch(0.58 0.15 ${hashHue(seed)})`;
}
export function tileLetter(name: string): string {
  return name.replace(/^[^A-Za-z一-龥]*/, '').slice(0, 1).toUpperCase() || '•';
}
/** 头像缩写:复用 shared/names 逻辑(CJK 顺序正确、无「张张」重复)。 */
const initialsFrom = initialsFromNames;

/**
 * Map entropy bits to the SecretField 4-bar meter level. Thresholds are the
 * official six-tier ones (60/80/112/128) shared with ui/components
 * strengthFromEntropy — that helper supplies the localized LABEL, this one the
 * bar fill (strong and very-strong both fill 4).
 */
export function barLevelFromBits(bits: number): 0 | 1 | 2 | 3 | 4 {
  if (bits >= 112) return 4;
  if (bits >= 80) return 3;
  if (bits >= 60) return 2;
  if (bits >= 1) return 1;
  return 0;
}

interface ExpiryInfo {
  state: 'expired' | 'soon' | 'ok';
  label: string;
  chip: 'red' | 'amber' | 'neutral';
}
export function expiryInfo(iso: string | null | undefined): ExpiryInfo | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  const days = Math.round((d.getTime() - Date.now()) / 86_400_000);
  if (days < 0)
    return { state: 'expired', label: tf('app.vault.expiry.expired', '已过期'), chip: 'red' };
  if (days <= 14)
    return {
      state: 'soon',
      label:
        days === 0
          ? tf('app.vault.expiry.today', '今天过期')
          : tf('app.vault.expiry.inDays', '{{days}} 天后过期', { days }),
      chip: 'amber',
    };
  return {
    state: 'ok',
    label: tf('app.vault.expiry.inDays', '{{days}} 天后过期', { days }),
    chip: 'neutral',
  };
}

function formatDate(value: string | null | undefined): string {
  if (!value) return '—';
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? value : d.toLocaleString();
}

const PERM_LABEL_KEY: Record<number, string> = {
  15: 'app.vault.perm.owner',
  7: 'app.vault.perm.edit',
  1: 'app.vault.perm.read',
};
const PERM_LABEL_FALLBACK: Record<number, string> = { 15: '拥有者', 7: '可编辑', 1: '只读' };

// ---------------------------------------------------------------------------
// Encrypted secret field — the E2EE reveal moment
// ---------------------------------------------------------------------------
function SecretField({
  resource,
  isV5,
  onDecrypted,
  onRelock,
}: {
  resource: Resource;
  isV5: boolean;
  onDecrypted: (content: { password: string; description: string }) => void;
  /** Called whenever the field re-locks (timer, 立即锁定, or unmount) so the
   *  parent can wipe any plaintext it lifted out via onDecrypted. */
  onRelock: () => void;
}) {
  const toast = useToast();

  const [state, setState] = useState<'locked' | 'decrypting' | 'open'>('locked');
  const [password, setPassword] = useState('');
  const [remain, setRemain] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const relockRef = useRef<number | null>(null);

  const relock = useCallback(() => {
    if (relockRef.current) window.clearInterval(relockRef.current);
    relockRef.current = null;
    setPassword('');
    setRemain(0);
    setState('locked');
    // Also wipe plaintext lifted into the parent (encrypted description).
    onRelock();
  }, [onRelock]);

  // Wipe plaintext + timers on unmount (e.g. switching to the 共享/评论 tab
  // unmounts this field — the parent-held description must not outlive it).
  useEffect(
    () => () => {
      if (relockRef.current) window.clearInterval(relockRef.current);
      onRelock();
    },
    [onRelock],
  );

  const reveal = useCallback(async () => {
    if (state !== 'locked') return;
    setState('decrypting');
    setError(null);
    try {
      // REVEAL fetches the armored secret and decrypts it in the background;
      // only the projected fields reach this iframe.
      const { secret } = await rpc({ type: 'REVEAL', id: resource.id });
      setPassword(secret.password);
      onDecrypted({ password: secret.password, description: secret.description ?? '' });
      setState('open');
      setRemain(REVEAL_SECS);
      relockRef.current = window.setInterval(() => {
        setRemain((r) => {
          if (r <= 1) {
            relock();
            return 0;
          }
          return r - 1;
        });
      }, 1000);
    } catch (err) {
      setError(err instanceof Error ? err.message : describeApiError(err));
      setState('locked');
    }
  }, [state, resource.id, relock, onDecrypted]);

  const copyBurn = useCallback(async () => {
    try {
      // temporary:true = the background clears the clipboard on its burn timer.
      // It returns the effective, user-configured delay (0 = never clear) so
      // the toast reflects reality instead of a hardcoded 30s.
      const { clearMs } = await rpc({ type: 'COPY', text: password, temporary: true });
      toast.success(
        clearMs > 0
          ? tf('app.vault.secret.copiedBurn', '已复制密码 · {{seconds}} 秒后清空剪贴板', {
              seconds: Math.round(clearMs / 1000),
            })
          : tf('app.vault.secret.copiedNoBurn', '已复制密码'),
      );
    } catch {
      toast.error(tf('app.vault.secret.clipboardError', '无法访问剪贴板。'));
    }
  }, [password, toast]);

  const open = state === 'open';
  const dots = '•'.repeat(12);
  const bits = open ? observedEntropy(password) : 0;
  const barLevel = open ? barLevelFromBits(bits) : 0;

  return (
    <div className={`field secret-field${open ? ' unlocked' : ''}${state === 'decrypting' ? ' decrypting' : ''}`}>
      <div className="field-label">
        {open ? <Unlock /> : <Lock />}
        {tf('app.vault.secret.passwordLabel', '密码')} ·{' '}
        {open
          ? tf('app.vault.secret.decryptedLocal', '已解密（本地）')
          : tf('app.vault.secret.encryptedStored', '加密存储')}
      </div>
      <div className="field-row">
        {open ? (
          <div className="secret-plain mono">{password}</div>
        ) : (
          <div className={`secret-cipher${state === 'decrypting' ? ' scramble' : ''}`}>
            <Lock className="lk" />
            {state === 'decrypting' ? tf('app.vault.secret.decrypting', '解密中…') : dots}
          </div>
        )}
        {open ? (
          <button
            className="copybtn"
            title={tf('app.vault.actions.copyPassword', '复制密码')}
            onClick={() => void copyBurn()}
          >
            <Copy />
          </button>
        ) : (
          <button className="btn sm" onClick={() => void reveal()} disabled={state === 'decrypting'}>
            <Eye />{' '}
            {state === 'decrypting'
              ? tf('app.vault.secret.decryptingShort', '解密中')
              : tf('app.vault.secret.reveal', '显示')}
          </button>
        )}
      </div>

      {state === 'decrypting' && (
        <div className="decrypt-bar">
          <i />
        </div>
      )}

      {error && (
        <div className="pf-err" style={{ marginTop: 9 }}>
          <AlertTriangle size={13} /> {error}
        </div>
      )}

      {open && (
        <div className="relock-note">
          <Clock /> {tf('app.vault.secret.relockNote', '{{seconds}}s 后自动重新锁定 ·', { seconds: remain })}{' '}
          <button onClick={relock} type="button">
            {tf('app.vault.actions.lockNow', '立即锁定')}
          </button>
        </div>
      )}

      <div className="field-foot">
        <div className={`strength s${barLevel}${!open ? ' na' : ''}`}>
          {tf('app.vault.secret.strength', '强度')}
          <div className="bars">
            <i />
            <i />
            <i />
            <i />
          </div>
          {open ? (
            <span
              style={{
                color:
                  barLevel >= 4
                    ? 'var(--green-text)'
                    : barLevel <= 2
                      ? 'var(--amber-text)'
                      : 'var(--text-3)',
              }}
            >
              {/* strengthFromEntropy's core `strength.*` keys carry the label */}
              {t(bits >= 128 ? 'strength.veryStrong' : bits >= 112 ? 'strength.strong' : bits >= 80 ? 'strength.fair' : bits >= 60 ? 'strength.weak' : bits >= 1 ? 'strength.veryWeak' : 'strength.notAvailable')}
            </span>
          ) : (
            <span style={{ color: 'var(--text-3)' }}>
              {tf('app.vault.secret.strengthNotDecrypted', 'n/a（未解密）')}
            </span>
          )}
        </div>
        <span>·</span>
        <span>
          {isV5
            ? tf('app.vault.secret.v5MetadataEncrypted', 'v5 元数据加密')
            : tf('app.vault.secret.e2ee', '端到端加密')}
        </span>
      </div>
    </div>
  );
}

function PlainField({ label, icon, value }: { label: string; icon: ReactNode; value: string }) {
  const toast = useToast();
  const [ok, setOk] = useState(false);
  const copy = async () => {
    try {
      await rpc({ type: 'COPY', text: value });
      setOk(true);
      toast.success(tf('app.vault.copy.copied', '已复制{{label}}', { label }));
      window.setTimeout(() => setOk(false), 1400);
    } catch {
      /* ignore */
    }
  };
  return (
    <div className="field">
      <div className="field-label">
        {icon} {label}
      </div>
      <div className="field-row">
        <div className="field-val mono">{value || '—'}</div>
        {value && (
          <button
            className={`copybtn${ok ? ' ok' : ''}`}
            title={tf('app.common.actions.copy', '复制')}
            onClick={() => void copy()}
          >
            {ok ? <Check /> : <Copy />}
          </button>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Panel
// ---------------------------------------------------------------------------
interface SecretPanelProps {
  resource: Resource;
  resourceTypes: ResourceType[];
  onEdit: (resource: Resource) => void;
  onShare: (resource: Resource) => void;
  onToggleFavorite: (resource: Resource) => void;
  onDelete?: (resource: Resource) => void;
  /** Open the standalone "移动到…" dialog (folder change is separate from edit). */
  onMove?: (resource: Resource) => void;
  favBusy?: boolean;
}

export function SecretPanel({
  resource,
  resourceTypes,
  onEdit,
  onShare,
  onToggleFavorite,
  onDelete,
  onMove,
  favBusy,
}: SecretPanelProps) {
  const [tab, setTab] = useState<'detail' | 'shared' | 'comment'>('detail');

  const slug = resourceTypes.find((rt) => rt.id === resource.resource_type_id)?.slug;
  const isV5 = isV5Resource(resource);
  const usesEncryptedDescription = !isV5 && isEncryptedDescriptionType(slug);

  // Description shown in the detail tab. v5 / v4-cleartext descriptions come off
  // the (already-resolved) resource; the encrypted-description type fills in once
  // the secret is revealed, and is wiped again whenever the SecretField re-locks
  // (timer / 立即锁定 / unmount) so the plaintext never outlives the reveal.
  const [encDescription, setEncDescription] = useState('');
  const clearDecrypted = useCallback(() => setEncDescription(''), []);
  const description = usesEncryptedDescription ? encDescription : resource.description;

  // Current ACL (lazy: loaded once per resource for the access count + 共享 tab).
  // 'error' is distinct from the empty list so a failed load never renders as
  // the "no other viewers" false-empty state.
  const [perms, setPerms] = useState<PermissionWithAro[] | null | 'error'>(null);
  const [permsRetry, setPermsRetry] = useState(0);
  useEffect(() => {
    let cancelled = false;
    setPerms(null);
    (async () => {
      try {
        const p = await getResourcePermissions(resource.id, {
          containUser: true,
          containUserProfile: true,
          containGroup: true,
        });
        if (!cancelled) setPerms(p);
      } catch {
        if (!cancelled) setPerms('error');
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [resource.id, permsRetry]);

  // Comments (lazy: loaded when the 评论 tab is first opened). Same
  // error-vs-empty distinction as the ACL above; retrying resets to null,
  // which re-triggers the lazy-load effect.
  const [comments, setComments] = useState<Comment[] | null | 'error'>(null);
  const [draft, setDraft] = useState('');
  const [posting, setPosting] = useState(false);
  const toast = useToast();
  const loadComments = useCallback(async () => {
    try {
      const list = await listComments(resource.id, { creator: true });
      setComments(list);
    } catch {
      setComments('error');
    }
  }, [resource.id]);
  useEffect(() => {
    if (tab === 'comment' && comments === null) void loadComments();
  }, [tab, comments, loadComments]);

  const submitComment = async () => {
    const content = draft.trim();
    if (!content) return;
    setPosting(true);
    try {
      await addComment(resource.id, { content });
      setDraft('');
      await loadComments();
    } catch (err) {
      toast.error(describeApiError(err));
    } finally {
      setPosting(false);
    }
  };

  const exp = expiryInfo(resource.expired);
  const color = tileColor(resource.id);
  // undefined while loading OR on error — the header chip/tab badge hide rather
  // than claiming "0 viewers" off a failed request.
  const accessCount = Array.isArray(perms) ? perms.length : undefined;

  return (
    <div className="panel fadein">
      <div className="panel-scroll">
        {/* header */}
        <div className="panel-head">
          <div className="panel-ico" style={{ background: color }}>
            {tileLetter(resource.name)}
          </div>
          <div className="panel-htext">
            <h2>
              {resource.name}
              {resource.favorite && <Star size={17} style={{ color: 'var(--gold)', fill: 'var(--gold)' }} />}
            </h2>
            {resource.uri && (
              <div className="uri">
                <LinkIcon />
                <a
                  href={/^https?:\/\//.test(resource.uri) ? resource.uri : `https://${resource.uri}`}
                  target="_blank"
                  rel="noreferrer"
                >
                  {resource.uri}
                </a>
              </div>
            )}
            <div className="panel-meta-row">
              <span className="chip neutral">
                <Lock /> {tf('app.vault.panel.e2ee', '端到端加密')}
              </span>
              {exp && (
                <span className={`chip ${exp.chip}`}>
                  {exp.state === 'expired' ? <AlertTriangle /> : <Clock />} {exp.label}
                </span>
              )}
              {accessCount !== undefined && (
                <span className="chip neutral">
                  <Share2 />{' '}
                  {tf('app.vault.panel.accessCount', '{{count}} 个访问者', { count: accessCount })}
                </span>
              )}
            </div>
          </div>
          <div className="panel-actions">
            <button
              className={`iconbtn${resource.favorite ? ' on' : ''}`}
              title={
                resource.favorite
                  ? tf('app.vault.actions.unfavorite', '取消收藏')
                  : tf('app.vault.actions.favorite', '收藏')
              }
              onClick={() => onToggleFavorite(resource)}
              disabled={favBusy}
            >
              <Star style={resource.favorite ? { fill: 'currentColor' } : undefined} />
            </button>
            <button
              className="iconbtn"
              title={tf('app.common.actions.edit', '编辑')}
              onClick={() => onEdit(resource)}
            >
              <Pencil />
            </button>
            {onMove && (
              <button
                className="iconbtn"
                title={tf('app.vault.actions.moveTo', '移动到…')}
                onClick={() => onMove(resource)}
              >
                <MoveIcon />
              </button>
            )}
            {onDelete && (
              <button
                className="iconbtn"
                title={tf('app.common.actions.delete', '删除')}
                style={{ color: 'var(--red-text)' }}
                onClick={() => onDelete(resource)}
              >
                <Trash2 />
              </button>
            )}
            <button className="btn primary" onClick={() => onShare(resource)}>
              <Share2 /> {tf('app.vault.actions.share', '共享')}
            </button>
          </div>
        </div>

        {/* tabs */}
        <div className="panel-tabs">
          <button className={`ptab${tab === 'detail' ? ' active' : ''}`} onClick={() => setTab('detail')}>
            <KeyRound /> {tf('app.vault.panel.tabDetail', '凭据')}
          </button>
          <button className={`ptab${tab === 'shared' ? ' active' : ''}`} onClick={() => setTab('shared')}>
            <Share2 /> {tf('app.vault.panel.tabShared', '共享')}{' '}
            {accessCount !== undefined && <span className="num">{accessCount}</span>}
          </button>
          <button className={`ptab${tab === 'comment' ? ' active' : ''}`} onClick={() => setTab('comment')}>
            <MessageSquare /> {tf('app.vault.panel.tabComment', '评论')}{' '}
            {Array.isArray(comments) && comments.length > 0 && (
              <span className="num">{comments.length}</span>
            )}
          </button>
        </div>

        {tab === 'detail' && (
          <div className="panel-body">
            <PlainField
              label={tf('app.vault.panel.fieldUsername', '用户名')}
              icon={<UserIcon />}
              value={resource.username}
            />
            <SecretField
              resource={resource}
              isV5={isV5}
              onDecrypted={(c) => {
                if (usesEncryptedDescription) setEncDescription(c.description);
              }}
              onRelock={clearDecrypted}
            />
            {description && (
              <div className="field">
                <div className="field-label">
                  <MessageSquare /> {tf('app.vault.panel.fieldDescription', '描述')}
                </div>
                <div style={{ fontSize: 13, color: 'var(--text-2)', lineHeight: 1.55, whiteSpace: 'pre-wrap' }}>
                  {description}
                </div>
              </div>
            )}
            <div style={{ padding: '4px 2px' }}>
              <div className="drow">
                <div className="dk">{tf('app.vault.panel.lastModified', '最后修改')}</div>
                <div className="dv">{formatDate(resource.modified)}</div>
              </div>
              <div className="drow">
                <div className="dk">{tf('app.vault.panel.createdAt', '创建于')}</div>
                <div className="dv">{formatDate(resource.created)}</div>
              </div>
              <div className="drow">
                <div className="dk">{tf('app.vault.panel.resourceId', '资源 ID')}</div>
                <div className="dv mono">{resource.id.toUpperCase()}</div>
              </div>
            </div>
          </div>
        )}

        {tab === 'shared' && (
          <div className="panel-body">
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4 }}>
              <span style={{ fontSize: 12.5, color: 'var(--text-3)' }}>
                {tf('app.vault.panel.encryptedForCount', '此密文已为 {{count}} 个对象单独加密', {
                  count: accessCount ?? (perms === 'error' ? '—' : '…'),
                })}
              </span>
              <button className="btn sm" onClick={() => onShare(resource)}>
                <Plus /> {tf('app.vault.actions.add', '添加')}
              </button>
            </div>
            {perms === null ? (
              <div style={{ textAlign: 'center', color: 'var(--text-3)', padding: '20px 0', fontSize: 13 }}>
                <span className="spin-ring" /> {tf('app.vault.panel.loadingAccess', '正在加载访问列表…')}
              </div>
            ) : perms === 'error' ? (
              <div style={{ textAlign: 'center', color: 'var(--text-3)', padding: '20px 0', fontSize: 13 }}>
                <div style={{ marginBottom: 10, color: 'var(--red-text)' }}>
                  <AlertTriangle size={13} /> {tf('app.vault.panel.accessLoadError', '访问列表加载失败。')}
                </div>
                <button className="btn sm" onClick={() => setPermsRetry((n) => n + 1)}>
                  {tf('app.common.actions.retry', '重试')}
                </button>
              </div>
            ) : perms.length === 0 ? (
              <div style={{ textAlign: 'center', color: 'var(--text-3)', padding: '20px 0', fontSize: 13 }}>
                {tf('app.vault.panel.noOtherViewers', '还没有其他访问者。')}
              </div>
            ) : (
              <div>
                {perms.map((p) => {
                  const isGroup = p.aro === 'Group';
                  const name = isGroup
                    ? p.group?.name ?? tf('app.vault.panel.groupFallback', '群组')
                    : joinName(p.user?.profile?.first_name, p.user?.profile?.last_name) ||
                      p.user?.username ||
                      tf('app.vault.panel.userFallback', '用户');
                  const email = isGroup
                    ? tf('app.vault.panel.groupShare', '群组共享')
                    : p.user?.username ?? '';
                  const av = isGroup ? (
                    <span className="aro-av" style={{ background: tileColor(p.aro_foreign_key) }}>
                      <UsersIcon size={15} />
                    </span>
                  ) : (
                    <span className="aro-av round" style={{ background: tileColor(p.aro_foreign_key) }}>
                      {initialsFrom(p.user?.profile?.first_name, p.user?.profile?.last_name, p.user?.username)}
                    </span>
                  );
                  return (
                    <div className="aro-line" key={p.id}>
                      {av}
                      <div className="aro-info">
                        <div className="an">{name}</div>
                        <div className="ae">{email}</div>
                      </div>
                      <span className={`perm-badge${p.type === 15 ? ' owner' : ''}`}>
                        {PERM_LABEL_KEY[p.type]
                          ? tf(PERM_LABEL_KEY[p.type], PERM_LABEL_FALLBACK[p.type])
                          : tf('app.vault.panel.permLevel', '级别 {{level}}', { level: p.type })}
                      </span>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}

        {tab === 'comment' && (
          <div className="panel-body">
            {comments === null ? (
              <div style={{ textAlign: 'center', color: 'var(--text-3)', padding: '20px 0', fontSize: 13 }}>
                <span className="spin-ring" /> {tf('app.vault.panel.loadingComments', '正在加载评论…')}
              </div>
            ) : comments === 'error' ? (
              <div style={{ textAlign: 'center', color: 'var(--text-3)', padding: '20px 0 8px', fontSize: 13 }}>
                <div style={{ marginBottom: 10, color: 'var(--red-text)' }}>
                  <AlertTriangle size={13} /> {tf('app.vault.panel.commentsLoadError', '评论加载失败。')}
                </div>
                {/* Resetting to null re-triggers the lazy-load effect. */}
                <button className="btn sm" onClick={() => setComments(null)}>
                  {tf('app.common.actions.retry', '重试')}
                </button>
              </div>
            ) : comments.length === 0 ? (
              <div style={{ textAlign: 'center', color: 'var(--text-3)', padding: '20px 0 8px', fontSize: 13 }}>
                {tf('app.vault.panel.noComments', '还没有评论。讨论会与凭据一同保留。')}
              </div>
            ) : (
              comments.map((c) => {
                const author = c.creator;
                const name =
                  joinName(author?.profile?.first_name, author?.profile?.last_name) ||
                  author?.username ||
                  tf('app.vault.panel.userFallback', '用户');
                return (
                  <div className="comment" key={c.id}>
                    <div className="face" style={{ background: tileColor(c.user_id) }}>
                      {initialsFrom(author?.profile?.first_name, author?.profile?.last_name, author?.username)}
                    </div>
                    <div className="cbody">
                      <div className="chead">
                        <b>{name}</b>
                        <span className="t">{formatDate(c.created)}</span>
                      </div>
                      <div className="ctext">{c.content}</div>
                    </div>
                  </div>
                );
              })
            )}
            <div className="comment-box">
              <textarea
                placeholder={tf('app.vault.panel.commentPlaceholder', '写下评论…')}
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && (e.metaKey || e.ctrlKey) && draft.trim()) void submitComment();
                }}
              />
              <button
                className="btn primary sm"
                disabled={!draft.trim() || posting}
                style={{ alignSelf: 'flex-end' }}
                onClick={() => void submitComment()}
              >
                {posting
                  ? tf('app.vault.panel.sendingComment', '发送中…')
                  : tf('app.vault.panel.sendComment', '发送')}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

export default SecretPanel;

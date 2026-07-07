/**
 * Self-registration policy card (admin only) — ported from the SPA
 * Settings.tsx SelfRegistrationCard. Toggle + email-domain allow-list; the
 * only CE provider is 'email_domains'. Turning it off issues a DELETE only
 * when a policy row exists.
 */
import { useEffect, useState } from 'react';
import { UserPlus } from 'lucide-react';
import {
  disableSelfRegistration,
  getSelfRegistrationSettings,
  saveSelfRegistrationSettings,
  type SelfRegistrationSettings,
} from '../../../services/selfRegistration';
import { describeApiError } from '../../../lib/errors';
import { useToast } from '../../../lib/toast';
import { tf } from '../../../lib/i18n';
import { CardSpinner, ErrorBanner } from '../OrgPoliciesSection';

/**
 * Parse a free-text domain list (newline / comma / space separated) into a
 * clean, de-duplicated, lower-cased array. Forgiving pre-filter; the backend
 * runs its own authoritative validation.
 */
function parseDomains(text: string): string[] {
  const looksLikeDomain = /^[^\s@/]+\.[^\s@/]+$/;
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of text.split(/[\s,]+/)) {
    let d = raw.trim().toLowerCase();
    if (d.startsWith('@')) d = d.slice(1);
    if (!d || !looksLikeDomain.test(d) || seen.has(d)) continue;
    seen.add(d);
    out.push(d);
  }
  return out;
}

export function SelfRegistrationCard() {
  const toast = useToast();
  const [settings, setSettings] = useState<SelfRegistrationSettings | null>(null);
  const [enabled, setEnabled] = useState(false);
  const [domainsText, setDomainsText] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    const controller = new AbortController();
    (async () => {
      setLoading(true);
      setError(null);
      try {
        const s = await getSelfRegistrationSettings(controller.signal);
        if (!controller.signal.aborted) {
          setSettings(s);
          setEnabled(s.provider === 'email_domains');
          setDomainsText((s.data?.allowed_domains ?? []).join('\n'));
        }
      } catch (err: unknown) {
        if (controller.signal.aborted) return;
        setError(describeApiError(err));
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    })();
    return () => controller.abort();
  }, []);

  const handleSave = async () => {
    setSaving(true);
    setError(null);
    try {
      if (enabled) {
        const domains = parseDomains(domainsText);
        if (domains.length === 0) {
          const msg = tf(
            'app.administration.selfReg.noDomains',
            '请至少添加一个有效域名，或关闭自助注册。',
          );
          setError(msg);
          toast.error(msg);
          setSaving(false);
          return;
        }
        const updated = await saveSelfRegistrationSettings(domains);
        setSettings(updated);
        setDomainsText((updated.data?.allowed_domains ?? domains).join('\n'));
        toast.success(tf('app.administration.selfReg.savedEnabled', '自助注册已开启。'));
      } else {
        // Turning it off only needs a call when a policy row exists.
        if (settings?.id) {
          const updated = await disableSelfRegistration(settings.id);
          setSettings(updated);
        }
        toast.success(tf('app.administration.selfReg.savedDisabled', '自助注册已关闭。'));
      }
    } catch (err: unknown) {
      const msg = describeApiError(err);
      setError(msg);
      toast.error(msg);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="scard">
      <div className="scard-h">
        <UserPlus />
        <h3>{tf('app.administration.selfReg.title', '自助注册')}</h3>
        {!loading && (
          <span
            className={`chip ${enabled ? 'green' : 'neutral'}`}
            style={{ marginLeft: 'auto' }}
          >
            {enabled
              ? tf('app.common.state.enabled', '已启用')
              : tf('app.common.state.disabled', '已停用')}
          </span>
        )}
      </div>

      {loading ? (
        <div style={{ padding: '15px 18px' }}>
          <CardSpinner
            label={tf('app.administration.selfReg.loading', '正在加载自助注册设置…')}
          />
        </div>
      ) : (
        <>
          <div style={{ padding: '15px 18px 0' }}>
            <div className="hint" style={{ lineHeight: 1.5 }}>
              {tf(
                'app.administration.selfReg.subtitle',
                '当访客邮箱匹配允许的域名时，允许其自行创建账户。关闭后，只有管理员能邀请用户。',
              )}
            </div>
            {error && (
              <div style={{ marginTop: 12 }}>
                <ErrorBanner>{error}</ErrorBanner>
              </div>
            )}
          </div>

          <div className="srow">
            <div className="sk">
              <div className="label">
                {tf('app.administration.selfReg.enable', '允许自助注册')}
              </div>
              <div className="hint">
                {tf(
                  'app.administration.selfReg.enableHint',
                  '开启后，邮箱域名在列表中的访客无需邀请即可注册。',
                )}
              </div>
            </div>
            <div className="sv">
              <button
                type="button"
                className={`switch${enabled ? ' on' : ''}`}
                onClick={() => setEnabled((v) => !v)}
                disabled={saving}
                aria-pressed={enabled}
                aria-label={tf('app.administration.selfReg.enable', '允许自助注册')}
              />
            </div>
          </div>

          {enabled && (
            <div className="srow" style={{ display: 'block' }}>
              <div className="sk" style={{ marginBottom: 8 }}>
                <div className="label">
                  {tf('app.administration.selfReg.domains', '允许的邮箱域名')}
                </div>
                <div className="hint">
                  {tf(
                    'app.administration.selfReg.domainsHint',
                    '每行一个域名（如 example.com）。开头的 @ 可省略；无效条目会被忽略。',
                  )}
                </div>
              </div>
              <textarea
                className="sinput"
                rows={5}
                value={domainsText}
                disabled={saving}
                placeholder={tf(
                  'app.administration.selfReg.domainsPlaceholder',
                  'example.com\nyour-company.org',
                )}
                onChange={(e) => setDomainsText(e.target.value)}
                style={{ width: '100%', fontFamily: 'var(--mono)', resize: 'vertical' }}
              />
            </div>
          )}

          <div style={{ padding: '4px 18px 16px' }}>
            <button
              type="button"
              className="btn primary"
              onClick={() => void handleSave()}
              disabled={saving}
            >
              {saving ? <span className="spin-ring" /> : null}
              {tf('app.common.actions.save', '保存')}
            </button>
          </div>
        </>
      )}
    </div>
  );
}

export default SelfRegistrationCard;

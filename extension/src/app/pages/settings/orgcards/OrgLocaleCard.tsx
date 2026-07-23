/**
 * Organization default-language card (admin only) — ported from the SPA
 * Settings.tsx OrgLocaleCard. Current value and the selectable options both
 * come from GET /settings.json; the write goes to the admin-gated
 * POST /locale/settings.json. This is the ORG default (emails / fallback UI
 * language), distinct from the extension's own jpb_locale UI switch.
 */
import { useEffect, useState } from 'react';
import { Languages } from 'lucide-react';
import { getServerSettings } from '../../../services/settings';
import {
  extractLocaleOptions,
  extractOrgLocale,
  setOrganizationLocale,
  type LocaleOption,
} from '../../../services/orgLocale';
import { describeApiError } from '../../../lib/errors';
import { useToast } from '../../../lib/toast';
import { tf } from '../../../lib/i18n';
import { CardSpinner, CardErrorBanner as ErrorBanner } from '../cardKit';

export function OrgLocaleCard() {
  const toast = useToast();
  const [options, setOptions] = useState<LocaleOption[]>([]);
  const [value, setValue] = useState('');
  const [savedValue, setSavedValue] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError(null);
      try {
        const settings = await getServerSettings();
        if (cancelled) return;
        const opts = extractLocaleOptions(settings);
        const current = extractOrgLocale(settings) ?? 'en-UK';
        setOptions(opts);
        setValue(current);
        setSavedValue(current);
      } catch (err: unknown) {
        if (!cancelled) setError(describeApiError(err));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const handleSave = async () => {
    setSaving(true);
    setError(null);
    try {
      const updated = await setOrganizationLocale(value);
      setSavedValue(updated.value);
      setValue(updated.value);
      toast.success(tf('app.administration.orgLocale.saved', '组织语言已保存。'));
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
        <Languages />
        <h3>{tf('app.administration.orgLocale.title', '组织语言')}</h3>
        {!loading && savedValue && (
          <span className="chip neutral" style={{ marginLeft: 'auto' }}>
            {options.find((o) => o.locale === savedValue)?.label ?? savedValue}
          </span>
        )}
      </div>

      {loading ? (
        <div style={{ padding: '15px 18px' }}>
          <CardSpinner label={tf('app.administration.orgLocale.loading', '正在加载组织语言…')} />
        </div>
      ) : (
        <>
          <div style={{ padding: '15px 18px 0' }}>
            <div className="hint" style={{ lineHeight: 1.5 }}>
              {tf(
                'app.administration.orgLocale.subtitle',
                '组织的默认语言，用于邮件通知，也是未自行选择语言用户的界面回退语言。',
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
                {tf('app.administration.orgLocale.label', '默认语言')}
              </div>
              <div className="hint">
                {tf(
                  'app.administration.orgLocale.hint',
                  '用户仍可在自己的账户设置中覆盖此项。',
                )}
              </div>
            </div>
            <div className="sv">
              <select
                className="sinput"
                value={value}
                disabled={saving}
                onChange={(e) => setValue(e.target.value)}
                aria-label={tf('app.administration.orgLocale.label', '默认语言')}
              >
                {options.map((o) => (
                  <option key={o.locale} value={o.locale}>
                    {o.label}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div style={{ padding: '4px 18px 16px' }}>
            <button
              type="button"
              className="btn primary"
              onClick={() => void handleSave()}
              disabled={saving || value === savedValue}
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

export default OrgLocaleCard;

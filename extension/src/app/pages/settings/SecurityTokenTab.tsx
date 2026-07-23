/**
 * Security token section — the user's personal anti-phishing marker (official
 * Passbolt "security token"): three characters on a colour only they picked.
 *
 * Storage + validation live in shared/securityToken.ts so the passphrase
 * prompts the content scripts inject can read the same value through
 * getSecurityToken() once they grow a token slot. This page only edits it.
 *
 * It is display-only: no cryptographic role, never sent to the server, never
 * mixed into the passphrase. Its whole job is to be something a look-alike page
 * cannot reproduce.
 */
import { useEffect, useState, type FormEvent } from 'react';
import { Check, Lock, ShieldQuestion } from 'lucide-react';
import { t } from '../../../shared/i18n';
import { useToast } from '../../lib/toast';
import {
  DEFAULT_SECURITY_TOKEN,
  getSecurityToken,
  isValidTokenCode,
  setSecurityToken,
  tokenTextColor,
} from '../../../shared/securityToken';
// The palette + code cleaning are shared with the setup/recovery flows' picker
// (which owns them) so the two surfaces can never offer different choices. The
// layouts differ too much to share the markup: this page is a srow/sk/sv grid,
// the flows are a stacked card.
import {
  SECURITY_TOKEN_SWATCHES,
  sanitizeTokenCode,
} from '../../components/SecurityTokenPicker';
import { ErrorBanner, SectionHeader } from './cardKit';

export function SecurityTokenTab() {
  const toast = useToast();
  const [code, setCode] = useState(DEFAULT_SECURITY_TOKEN.code);
  const [color, setColor] = useState(DEFAULT_SECURITY_TOKEN.color);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void getSecurityToken().then((token) => {
      if (cancelled) return;
      setCode(token.code);
      setColor(token.color);
      setLoading(false);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const codeValid = isValidTokenCode(code);

  const save = async (e: FormEvent) => {
    e.preventDefault();
    if (!codeValid) {
      setError(t('app.settings.securityToken.invalidCode'));
      return;
    }
    setSaving(true);
    setError(null);
    try {
      await setSecurityToken({ code, color });
      toast.success(t('app.settings.securityToken.saved'));
    } catch {
      const msg = t('app.settings.securityToken.saveFailed');
      setError(msg);
      toast.error(msg);
    } finally {
      setSaving(false);
    }
  };

  return (
    <form onSubmit={save} style={{ display: 'contents' }}>
      <SectionHeader
        title={t('app.settings.securityToken.title')}
        subtitle={t('app.settings.securityToken.subtitle')}
      />

      {error && (
        <div style={{ marginBottom: 18 }}>
          <ErrorBanner>{error}</ErrorBanner>
        </div>
      )}

      <div className="scard">
        <div className="scard-h">
          <ShieldQuestion />
          <h3>{t('app.settings.securityToken.card.title')}</h3>
        </div>

        <div style={{ padding: '15px 18px' }}>
          <div className="hint" style={{ marginBottom: 4, lineHeight: 1.5 }}>
            {t('app.settings.securityToken.intro')}
          </div>
        </div>

        <div className="srow">
          <div className="sk">
            <div className="label">{t('app.settings.securityToken.code')}</div>
            <div className="hint">{t('app.settings.securityToken.codeHint')}</div>
          </div>
          <div className="sv">
            <input
              className="sinput sectoken-input"
              value={code}
              maxLength={3}
              // Keep the field itself clean; validity is reported below.
              onChange={(e) => setCode(sanitizeTokenCode(e.target.value))}
              disabled={loading || saving}
              aria-label={t('app.settings.securityToken.code')}
              aria-invalid={!codeValid}
            />
          </div>
        </div>

        <div className="srow">
          <div className="sk">
            <div className="label">{t('app.settings.securityToken.color')}</div>
            <div className="hint">{t('app.settings.securityToken.colorHint')}</div>
          </div>
          <div className="sv">
            <div className="sectoken-swatches">
              {SECURITY_TOKEN_SWATCHES.map((swatch) => (
                <button
                  key={swatch}
                  type="button"
                  className={`sectoken-swatch${swatch === color ? ' on' : ''}`}
                  style={{ background: swatch }}
                  onClick={() => setColor(swatch)}
                  disabled={loading || saving}
                  aria-label={swatch}
                  aria-pressed={swatch === color}
                  title={swatch}
                >
                  {swatch === color && <Check size={14} color={tokenTextColor(swatch)} />}
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* Preview: what the token will look like next to a passphrase field. */}
        <div className="srow" style={{ display: 'block' }}>
          <div className="sk" style={{ marginBottom: 10 }}>
            <div className="label">{t('app.settings.securityToken.preview')}</div>
            <div className="hint">{t('app.settings.securityToken.previewHint')}</div>
          </div>
          <div className="sectoken-preview">
            <Lock size={16} />
            <span className="stp-dots">••••••••••••</span>
            <span
              className="sectoken-chip"
              style={{ background: color, color: tokenTextColor(color) }}
            >
              {codeValid ? code.toUpperCase() : '???'}
            </span>
          </div>
        </div>
      </div>

      <div style={{ display: 'flex', gap: 12 }}>
        <button type="submit" className="btn primary" disabled={loading || saving || !codeValid}>
          {saving ? t('app.common.actions.saving') : t('app.common.actions.save')}
        </button>
      </div>
    </form>
  );
}

export default SecurityTokenTab;

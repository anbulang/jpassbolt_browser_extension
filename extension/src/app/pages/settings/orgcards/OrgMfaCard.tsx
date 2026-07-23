/**
 * Organization-wide MFA card (admin) — the TOTP provider toggle formerly nested
 * inside the AccountTab's ServerSettingsCard, now its own settings section.
 *
 * Mounted ONLY behind the page's `{isAdmin && …}` gate so a non-admin browser
 * never fires the admin-only GET /mfa/settings.json. The 403 handling is kept
 * anyway: the role check is a UI convenience, the server is the authority.
 */
import { useEffect, useState } from 'react';
import { ShieldCheck } from 'lucide-react';
import { t } from '../../../../shared/i18n';
import { describeApiError } from '../../../lib/errors';
import { useToast } from '../../../lib/toast';
import { Spinner } from '../../../../ui/components';
import { getOrgMfaSettings, updateOrgMfaSettings } from '../../../services/mfa';
import type { MfaOrgSettings } from '../../../../shared/types';
import { ErrorBanner } from '../cardKit';

function httpStatus(err: unknown): number | undefined {
  return ((err ?? {}) as { response?: { status?: number } }).response?.status;
}

export function OrgMfaCard() {
  const toast = useToast();
  const [orgMfa, setOrgMfa] = useState<MfaOrgSettings | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const m = await getOrgMfaSettings();
        if (!cancelled) setOrgMfa(m);
      } catch (err: unknown) {
        if (!cancelled) {
          setError(
            httpStatus(err) === 403
              ? t('app.settings.errors.orgMfaForbiddenView')
              : describeApiError(err),
          );
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const totpOrgEnabled = !!orgMfa?.providers?.includes('totp');

  const toggleOrgTotp = async () => {
    if (!orgMfa) return;
    setBusy(true);
    setError(null);
    const next = totpOrgEnabled ? [] : ['totp'];
    try {
      const updated = await updateOrgMfaSettings(next);
      setOrgMfa(updated);
      toast.success(
        next.length
          ? t('app.settings.account.orgMfa.enabledToast')
          : t('app.settings.account.orgMfa.disabledToast'),
      );
    } catch (err: unknown) {
      const msg =
        httpStatus(err) === 403
          ? t('app.settings.errors.orgMfaForbiddenChange')
          : describeApiError(err);
      setError(msg);
      toast.error(msg);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="scard">
      <div className="scard-h">
        <ShieldCheck />
        <h3>{t('app.settings.account.orgMfa.title')}</h3>
        {orgMfa && (
          <span
            className={`chip ${totpOrgEnabled ? 'green' : 'neutral'}`}
            style={{ marginLeft: 'auto' }}
          >
            {totpOrgEnabled
              ? t('app.settings.account.orgMfa.totpOn')
              : t('app.settings.account.orgMfa.totpOff')}
          </span>
        )}
      </div>

      {error ? (
        <div style={{ padding: '15px 18px' }}>
          <ErrorBanner>{error}</ErrorBanner>
        </div>
      ) : orgMfa ? (
        <div className="srow">
          <div className="sk">
            <div className="label">{t('app.settings.account.orgMfa.wholeOrgTotp')}</div>
            <div className="hint">
              {totpOrgEnabled
                ? t('app.settings.account.orgMfa.hintOn')
                : t('app.settings.account.orgMfa.hintOff')}
            </div>
          </div>
          <div className="sv">
            <button
              type="button"
              className={`switch${totpOrgEnabled ? ' on' : ''}`}
              onClick={() => void toggleOrgTotp()}
              disabled={busy}
              aria-pressed={totpOrgEnabled}
              aria-label={t('app.settings.account.orgMfa.toggleAria')}
            />
          </div>
        </div>
      ) : (
        <div style={{ padding: '15px 18px' }}>
          <Spinner label={t('app.settings.account.orgMfa.loading')} />
        </div>
      )}
    </div>
  );
}

export default OrgMfaCard;

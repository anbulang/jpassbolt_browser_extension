/**
 * Account / server tab (SPA Settings.tsx AccountTab + ServerSettingsCard).
 *
 *   - GPG key card: fingerprint/keyId/bits come from the KEY_INFO RPC (the
 *     background derives them from the stored account key — this iframe never
 *     sees armored private material), falling back to the server-reported
 *     gpgkey row. Show/hide + copy (background COPY RPC).
 *   - Server settings card: read-only GET /settings.json flattened to rows;
 *     admins additionally get the org-wide MFA TOTP toggle
 *     (GET/POST /mfa/settings.json).
 *   - Org policies section: foundation stub, filled by WP-SETTINGS-ADMIN;
 *     mounted ONLY behind isAdmin so a non-admin never issues the admin-only
 *     notification-settings request.
 *   - Sign out: the background LOGOUT RPC; the shell falls back to the login
 *     flow via the SESSION_CHANGED broadcast.
 */
import { useEffect, useMemo, useState } from 'react';
import {
  Check,
  Copy,
  Eye,
  EyeOff,
  Fingerprint,
  KeyRound,
  LogOut,
  Server,
  ShieldCheck,
} from 'lucide-react';
import { rpc } from '../../../shared/messages';
import type { KeyInfo } from '../../../shared/rpc/auth';
import { t } from '../../../shared/i18n';
import { describeApiError } from '../../lib/errors';
import { useToast } from '../../lib/toast';
import { Badge } from '../../components/Badge';
import { Spinner } from '../../../ui/components';
import { getServerSettings } from '../../services/settings';
import { getOrgMfaSettings, updateOrgMfaSettings } from '../../services/mfa';
import type { MfaOrgSettings, ServerSettings, User } from '../../../shared/types';
import { OrgPoliciesSection } from './OrgPoliciesSection';
import { ErrorBanner } from './index';

function httpStatus(err: unknown): number | undefined {
  return ((err ?? {}) as { response?: { status?: number } }).response?.status;
}

/** Group an OpenPGP fingerprint into 4-char blocks for readability. */
function formatFingerprint(fp: string): string {
  const clean = fp.replace(/\s+/g, '').toUpperCase();
  return clean.match(/.{1,4}/g)?.join(' ') ?? clean;
}

/** Flatten a (possibly nested) ServerSettings map into displayable key/value rows. */
function flattenSettings(
  obj: Record<string, unknown>,
  prefix = '',
): { key: string; value: string }[] {
  const rows: { key: string; value: string }[] = [];
  for (const [k, v] of Object.entries(obj)) {
    const key = prefix ? `${prefix}.${k}` : k;
    if (v == null) {
      rows.push({ key, value: '—' });
    } else if (Array.isArray(v)) {
      rows.push({ key, value: v.map((x) => stringifyScalar(x)).join(', ') || '[]' });
    } else if (typeof v === 'object') {
      rows.push(...flattenSettings(v as Record<string, unknown>, key));
    } else {
      rows.push({ key, value: stringifyScalar(v) });
    }
  }
  return rows;
}

function stringifyScalar(v: unknown): string {
  if (v == null) return '—';
  if (typeof v === 'object') {
    try {
      return JSON.stringify(v);
    } catch {
      return String(v);
    }
  }
  return String(v);
}

// ===========================================================================
// Account tab
// ===========================================================================
export function AccountTab({ me, isAdmin }: { me: User; isAdmin: boolean }) {
  const toast = useToast();
  const [showFp, setShowFp] = useState(false);
  const [fpCopied, setFpCopied] = useState(false);

  // KEY_INFO gives the account key's derived public info; null while loading or
  // when the background has no account key to report (treated as "locked").
  const [keyInfo, setKeyInfo] = useState<KeyInfo | null>(null);
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const info = await rpc({ type: 'KEY_INFO' });
        if (!cancelled) setKeyInfo(info);
      } catch {
        if (!cancelled) setKeyInfo(null);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // Prefer the background-derived fingerprint; fall back to the server gpgkey.
  const fingerprint = keyInfo?.fingerprint ?? me.gpgkey?.fingerprint ?? null;
  const fingerprintPretty = fingerprint ? formatFingerprint(fingerprint) : null;
  const fingerprintMasked = fingerprintPretty
    ? fingerprintPretty.replace(/[0-9A-F]/g, '•')
    : null;
  const keyId = me.gpgkey?.key_id ?? keyInfo?.keyId ?? null;
  const bits = me.gpgkey?.bits ?? keyInfo?.bits ?? null;

  const copyFingerprint = async () => {
    if (!fingerprintPretty) return;
    try {
      await rpc({ type: 'COPY', text: fingerprintPretty });
      setFpCopied(true);
      window.setTimeout(() => setFpCopied(false), 2000);
    } catch {
      /* clipboard unavailable */
    }
  };

  const doLogout = async () => {
    try {
      // The shell reacts to the resulting SESSION_CHANGED broadcast.
      await rpc({ type: 'LOGOUT' });
    } catch (err: unknown) {
      toast.error(describeApiError(err));
    }
  };

  return (
    <span style={{ display: 'contents' }}>
      <h2 className="stitle">{t('app.settings.account.title')}</h2>
      <div className="ssub">{t('app.settings.account.subtitle')}</div>

      {/* GPG key card */}
      <div className="scard">
        <div className="scard-h">
          <Fingerprint />
          <h3>{t('app.settings.account.gpg.title')}</h3>
          <Badge variant={keyInfo ? 'success' : 'muted'}>
            {keyInfo ? t('app.common.state.unlocked') : t('app.common.state.locked')}
          </Badge>
        </div>
        <div className="srow" style={{ display: 'block' }}>
          <div className="hint" style={{ marginBottom: 10, lineHeight: 1.5 }}>
            {t('app.settings.account.gpg.intro')}
          </div>
          {fingerprintPretty ? (
            <div className="fpbox">
              <KeyRound style={{ width: 16, height: 16, color: 'var(--text-3)' }} />
              <span className="fpv">{showFp ? fingerprintPretty : fingerprintMasked}</span>
              <button
                type="button"
                className="copybtn"
                onClick={() => setShowFp((s) => !s)}
                aria-label={showFp ? t('app.common.actions.hide') : t('app.common.actions.show')}
                title={showFp ? t('app.common.actions.hide') : t('app.common.actions.show')}
              >
                {showFp ? <EyeOff size={16} /> : <Eye size={16} />}
              </button>
              <button
                type="button"
                className={`copybtn${fpCopied ? ' ok' : ''}`}
                onClick={() => void copyFingerprint()}
                aria-label={t('app.settings.account.gpg.copyFingerprint')}
                title={t('app.settings.account.gpg.copyFingerprint')}
              >
                {fpCopied ? <Check size={16} /> : <Copy size={16} />}
              </button>
            </div>
          ) : (
            <div style={{ color: 'var(--text-3)', fontSize: '13.5px' }}>
              {t('app.settings.account.gpg.locked')}
            </div>
          )}
        </div>

        {keyId && (
          <div className="srow">
            <div className="sk">
              <div className="label">{t('app.settings.account.gpg.keyId')}</div>
            </div>
            <div
              className="sv"
              style={{ fontFamily: 'var(--mono)', fontSize: 13, color: 'var(--text-2)' }}
            >
              {keyId}
            </div>
          </div>
        )}
        {bits != null && (
          <div className="srow">
            <div className="sk">
              <div className="label">{t('app.settings.account.gpg.keyBits')}</div>
            </div>
            <div
              className="sv"
              style={{ fontFamily: 'var(--mono)', fontSize: 13, color: 'var(--text-2)' }}
            >
              {t('app.settings.account.gpg.bitsValue', { bits })}
            </div>
          </div>
        )}
      </div>

      {/* Server settings card */}
      <ServerSettingsCard isAdmin={isAdmin} />

      {/* Organization policies — admin only (never mounts for non-admins). */}
      {isAdmin && <OrgPoliciesSection />}

      {/* Session / logout card */}
      <div className="scard">
        <div className="srow">
          <div className="sk">
            <div className="label">{t('app.settings.account.logout.label')}</div>
            <div className="hint">{t('app.settings.account.logout.hint')}</div>
          </div>
          <div className="sv">
            <button type="button" className="btn danger" onClick={() => void doLogout()}>
              <LogOut size={16} /> {t('app.settings.account.logout.button')}
            </button>
          </div>
        </div>
      </div>
    </span>
  );
}

// ===========================================================================
// Server settings (read-only) + org MFA toggle (admin)
// ===========================================================================
function ServerSettingsCard({ isAdmin }: { isAdmin: boolean }) {
  const toast = useToast();
  const [settings, setSettings] = useState<ServerSettings | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Org MFA (admin only).
  const [orgMfa, setOrgMfa] = useState<MfaOrgSettings | null>(null);
  const [orgMfaError, setOrgMfaError] = useState<string | null>(null);
  const [orgMfaBusy, setOrgMfaBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError(null);
      try {
        const s = await getServerSettings();
        if (!cancelled) setSettings(s);
      } catch (err: unknown) {
        if (!cancelled) setError(describeApiError(err));
      } finally {
        if (!cancelled) setLoading(false);
      }
      if (isAdmin) {
        try {
          const m = await getOrgMfaSettings();
          if (!cancelled) setOrgMfa(m);
        } catch (err: unknown) {
          if (!cancelled) {
            setOrgMfaError(
              httpStatus(err) === 403
                ? t('app.settings.errors.orgMfaForbiddenView')
                : describeApiError(err),
            );
          }
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [isAdmin]);

  const rows = useMemo(() => (settings ? flattenSettings(settings) : []), [settings]);

  const totpOrgEnabled = !!orgMfa?.providers?.includes('totp');

  const toggleOrgTotp = async () => {
    if (!orgMfa) return;
    setOrgMfaBusy(true);
    setOrgMfaError(null);
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
      setOrgMfaError(msg);
      toast.error(msg);
    } finally {
      setOrgMfaBusy(false);
    }
  };

  return (
    <div className="scard">
      <div className="scard-h">
        <Server />
        <h3>{t('app.settings.account.server.title')}</h3>
      </div>

      <div style={{ padding: '15px 18px' }}>
        <div className="hint" style={{ marginBottom: rows.length ? 14 : 0 }}>
          {t('app.settings.account.server.readonly')}
        </div>

        {loading ? (
          <Spinner label={t('app.settings.account.server.loading')} />
        ) : error ? (
          <ErrorBanner>{error}</ErrorBanner>
        ) : rows.length === 0 ? (
          <div style={{ color: 'var(--text-3)', fontSize: '13.5px' }}>
            {t('app.settings.account.server.empty')}
          </div>
        ) : (
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
            <tbody>
              {rows.map(({ key, value }) => (
                <tr key={key} style={{ borderBottom: '1px solid var(--border)' }}>
                  <td
                    style={{
                      padding: '8px 12px 8px 0',
                      color: 'var(--text-2)',
                      whiteSpace: 'nowrap',
                      verticalAlign: 'top',
                      fontFamily: 'var(--mono)',
                    }}
                  >
                    {key}
                  </td>
                  <td
                    style={{
                      padding: '8px 0',
                      color: 'var(--text)',
                      wordBreak: 'break-word',
                      fontFamily: 'var(--mono)',
                    }}
                  >
                    {value}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* Org MFA control (admin only) */}
      {isAdmin && (
        <>
          <div className="scard-h" style={{ borderTop: '1px solid var(--border)' }}>
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
          {orgMfaError ? (
            <div style={{ padding: '15px 18px' }}>
              <ErrorBanner>{orgMfaError}</ErrorBanner>
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
                  disabled={orgMfaBusy}
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
        </>
      )}
    </div>
  );
}

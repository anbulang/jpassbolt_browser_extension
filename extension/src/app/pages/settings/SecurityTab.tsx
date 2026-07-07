/**
 * Security tab — per-user TOTP MFA (SPA Settings.tsx SecurityTab).
 *
 * On mount probes GET /mfa/setup/totp/start.json to learn whether MFA is
 * already configured. If not: GET /mfa/setup/totp.json for the otpauth://
 * provisioning URI, rendered as a client-side QR (qr.ts) + a copyable secret,
 * then a 6-digit code POST enables it. If configured: verified timestamp + a
 * Disable control. Brute-force 429 surfaces a dedicated banner; an org-level
 * "provider not enabled" 400 gets friendly guidance instead of the raw string.
 *
 * Copies go through the background COPY RPC (offscreen document) — the app
 * iframe cannot rely on navigator.clipboard inside the host page.
 */
import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { Check, Copy, ShieldCheck, ShieldOff } from 'lucide-react';
import { rpc } from '../../../shared/messages';
import { t } from '../../../shared/i18n';
import { describeApiError } from '../../lib/errors';
import { useToast } from '../../lib/toast';
import { ConfirmDialog } from '../../components/ConfirmDialog';
import { Spinner } from '../../../ui/components';
import {
  disableTotp,
  enableTotp,
  getTotpSetupState,
  startTotpSetup,
} from '../../services/mfa';
import type { MfaSetupState } from '../../../shared/types';
import { buildQrMatrix } from './qr';
import { ErrorBanner } from './index';

// ---------------------------------------------------------------------------
// Error helpers
// ---------------------------------------------------------------------------
interface ApiErrorLike {
  response?: { status?: number; data?: { header?: { message?: string } | null } };
  message?: string;
}

function httpStatus(err: unknown): number | undefined {
  return ((err ?? {}) as ApiErrorLike).response?.status;
}

/**
 * The TOTP setup/probe endpoints return HTTP 400 with "This authentication
 * provider is not enabled for your organization." when org-level TOTP is off.
 * Detect that case so we can surface friendly guidance instead of the raw
 * backend string.
 */
function isTotpProviderDisabled(err: unknown): boolean {
  const e = (err ?? {}) as ApiErrorLike;
  const raw = (e.response?.data?.header?.message || e.message || '').toLowerCase();
  return raw.includes('not enabled for your organization');
}

// ---------------------------------------------------------------------------
// otpauth:// parsing
// ---------------------------------------------------------------------------

/** Pull the base32 `secret` and human-readable label out of an otpauth:// URI. */
function parseOtpauth(uri: string): {
  secret: string | null;
  issuer: string | null;
  label: string | null;
} {
  try {
    // otpauth://totp/Issuer:account?secret=...&issuer=...
    const u = new URL(uri);
    const secret = u.searchParams.get('secret');
    const issuer = u.searchParams.get('issuer');
    const label = decodeURIComponent(u.pathname.replace(/^\/+/, '')) || null;
    return { secret, issuer, label };
  } catch {
    return { secret: null, issuer: null, label: null };
  }
}

/** RFC3339 / ISO string -> human readable; passes through unparsable input. */
function formatDate(value: string): string {
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return value;
  return d.toLocaleString();
}

// ---------------------------------------------------------------------------
// Canvas QR for the provisioning URI (matrix from qr.ts; white background so
// the dark theme doesn't break scanning).
// ---------------------------------------------------------------------------
function OtpauthQr({ data, size = 196 }: { data: string; size?: number }) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  // Compute the matrix during render so the failure state is derived.
  const matrix = useMemo<boolean[][] | null>(() => {
    try {
      return buildQrMatrix(data);
    } catch {
      return null;
    }
  }, [data]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !matrix) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const n = matrix.length;
    const quiet = 4; // quiet-zone modules
    const total = n + quiet * 2;
    const scale = Math.max(1, Math.floor(size / total));
    const px = total * scale;
    canvas.width = px;
    canvas.height = px;
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, px, px);
    ctx.fillStyle = '#000000';
    for (let r = 0; r < n; r++) {
      for (let c = 0; c < n; c++) {
        if (matrix[r][c]) {
          ctx.fillRect((c + quiet) * scale, (r + quiet) * scale, scale, scale);
        }
      }
    }
  }, [matrix, size]);

  if (!matrix) {
    return (
      <div
        style={{
          width: size,
          height: size,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          textAlign: 'center',
          background: 'var(--surface-3)',
          border: '1px dashed var(--border-strong)',
          borderRadius: 'var(--r)',
          color: 'var(--text-3)',
          fontSize: 12,
          padding: 12,
        }}
      >
        {t('app.settings.security.qr.unavailable')}
      </div>
    );
  }

  return <canvas ref={canvasRef} aria-label={t('app.settings.security.qr.ariaLabel')} />;
}

// ---------------------------------------------------------------------------
// Inline copy button matching the .qr-secret design. Copies via the background
// COPY RPC (no auto-clear for a TOTP secret the user is transcribing).
// ---------------------------------------------------------------------------
function CopyButton({ value }: { value: string }) {
  const [copied, setCopied] = useState(false);
  const onCopy = async () => {
    try {
      await rpc({ type: 'COPY', text: value });
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      /* clipboard unavailable */
    }
  };
  return (
    <button
      type="button"
      onClick={() => void onCopy()}
      aria-label={t('app.common.actions.copy')}
      title={t('app.common.actions.copy')}
    >
      {copied ? <Check size={14} color="var(--green)" /> : <Copy size={14} />}
    </button>
  );
}

// ===========================================================================
// Security (MFA / TOTP) tab
// ===========================================================================
type MfaStatus = 'loading' | 'disabled' | 'enabled' | 'error';

export function SecurityTab() {
  const toast = useToast();

  const [status, setStatus] = useState<MfaStatus>('loading');
  const [verified, setVerified] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [rateLimited, setRateLimited] = useState(false);

  // Setup flow state.
  const [setup, setSetup] = useState<MfaSetupState | null>(null);
  const [provisioning, setProvisioning] = useState(false);
  const [code, setCode] = useState('');
  const [enabling, setEnabling] = useState(false);

  // Disable flow state.
  const [confirmDisable, setConfirmDisable] = useState(false);
  const [disabling, setDisabling] = useState(false);

  const probe = useCallback(async () => {
    setStatus('loading');
    setError(null);
    setRateLimited(false);
    try {
      // start.json: body present (with verified) => configured; null => not configured.
      const started = await startTotpSetup();
      if (started && started.verified) {
        setVerified(started.verified ?? null);
        setStatus('enabled');
        return;
      }
      // Fall back to the fuller state which may also carry `verified`.
      const state = await getTotpSetupState();
      if (state.verified) {
        setVerified(state.verified ?? null);
        setStatus('enabled');
      } else {
        setStatus('disabled');
      }
    } catch (err: unknown) {
      if (httpStatus(err) === 429) setRateLimited(true);
      if (isTotpProviderDisabled(err)) {
        setError(t('app.settings.security.orgDisabled'));
      } else {
        setError(describeApiError(err));
      }
      setStatus('error');
    }
  }, []);

  useEffect(() => {
    void probe();
  }, [probe]);

  const beginSetup = async () => {
    setProvisioning(true);
    setError(null);
    setRateLimited(false);
    try {
      const state = await getTotpSetupState();
      if (!state.otpProvisioningUri) {
        throw new Error(t('app.settings.security.setup.noProvisioningUri'));
      }
      setSetup(state);
      setCode('');
    } catch (err: unknown) {
      if (httpStatus(err) === 429) setRateLimited(true);
      if (isTotpProviderDisabled(err)) {
        setError(t('app.settings.security.orgDisabled'));
      } else {
        setError(describeApiError(err));
      }
    } finally {
      setProvisioning(false);
    }
  };

  const cancelSetup = () => {
    setSetup(null);
    setCode('');
    setError(null);
  };

  const handleEnable = async (e: FormEvent) => {
    e.preventDefault();
    if (!setup?.otpProvisioningUri) return;
    if (!/^\d{6}$/.test(code)) {
      setError(t('app.settings.security.setup.invalidCode'));
      return;
    }
    setEnabling(true);
    setError(null);
    setRateLimited(false);
    try {
      const result = await enableTotp({
        otpProvisioningUri: setup.otpProvisioningUri,
        totp: code,
      });
      setVerified(result.verified ?? new Date().toISOString());
      setSetup(null);
      setCode('');
      setStatus('enabled');
      toast.success(t('app.settings.security.setup.enabled'));
    } catch (err: unknown) {
      if (httpStatus(err) === 429) {
        setRateLimited(true);
        setError(t('app.settings.security.rateLimited'));
      } else {
        setError(describeApiError(err));
      }
    } finally {
      setEnabling(false);
    }
  };

  const handleDisable = async () => {
    setDisabling(true);
    setError(null);
    try {
      await disableTotp();
      setVerified(null);
      setStatus('disabled');
      setConfirmDisable(false);
      toast.success(t('app.settings.security.disabled.done'));
    } catch (err: unknown) {
      const msg = describeApiError(err);
      setError(msg);
      toast.error(msg);
    } finally {
      setDisabling(false);
    }
  };

  const parsed = useMemo(
    () => (setup?.otpProvisioningUri ? parseOtpauth(setup.otpProvisioningUri) : null),
    [setup],
  );

  return (
    <span style={{ display: 'contents' }}>
      <h2 className="stitle">{t('app.settings.security.title')}</h2>
      <div className="ssub">{t('app.settings.security.subtitle')}</div>

      {rateLimited && (
        <div style={{ marginBottom: 16 }}>
          <ErrorBanner>{t('app.settings.security.rateLimited')}</ErrorBanner>
        </div>
      )}
      {error && !rateLimited && (
        <div style={{ marginBottom: 16 }}>
          <ErrorBanner>{error}</ErrorBanner>
        </div>
      )}

      <div className="scard">
        <div className="scard-h">
          <ShieldCheck
            style={{ color: status === 'enabled' ? 'var(--green)' : 'var(--text-2)' }}
          />
          <h3>{t('app.settings.security.card.title')}</h3>
          {status === 'enabled' && (
            <span className="chip green" style={{ marginLeft: 'auto' }}>
              <Check /> {t('app.settings.security.card.enabled')}
            </span>
          )}
          {status === 'disabled' && (
            <span className="chip neutral" style={{ marginLeft: 'auto' }}>
              {t('app.settings.security.card.notConfigured')}
            </span>
          )}
        </div>

        <div style={{ padding: '15px 18px' }}>
          <div className="hint" style={{ marginBottom: 14, lineHeight: 1.5 }}>
            {t('app.settings.security.card.intro')}
          </div>

          {status === 'loading' && (
            <Spinner label={t('app.settings.security.card.checking')} />
          )}

          {status === 'error' && (
            <button type="button" className="btn" onClick={() => void probe()}>
              {t('app.common.actions.retry')}
            </button>
          )}

          {/* ENABLED state */}
          {status === 'enabled' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 10,
                  color: 'var(--text-2)',
                  fontSize: '13.5px',
                }}
              >
                <Check size={18} color="var(--green)" />
                <span>
                  {verified
                    ? t('app.settings.security.card.enabledOn', { date: formatDate(verified) })
                    : t('app.settings.security.card.enabledPlain')}
                </span>
              </div>
              <div>
                <button
                  type="button"
                  className="btn danger"
                  onClick={() => setConfirmDisable(true)}
                >
                  <ShieldOff size={16} /> {t('app.settings.security.card.disableButton')}
                </button>
              </div>
            </div>
          )}

          {/* DISABLED state — CTA or active setup flow */}
          {status === 'disabled' && !setup && (
            <button
              type="button"
              className="btn primary"
              onClick={() => void beginSetup()}
              disabled={provisioning}
            >
              <ShieldCheck size={16} />
              {provisioning
                ? t('app.settings.security.card.preparing')
                : t('app.settings.security.card.setupButton')}
            </button>
          )}
        </div>

        {status === 'disabled' && setup?.otpProvisioningUri && (
          <div className="qr-setup">
            <div className="qr">
              <OtpauthQr data={setup.otpProvisioningUri} />
            </div>
            <div className="qr-info">
              <ol>
                <li>{t('app.settings.security.setup.scanStep')}</li>
                {parsed?.secret && (
                  <li>
                    {t('app.settings.security.setup.manualKeyStep')}
                    <br />
                    <span className="qr-secret">
                      {parsed.secret}
                      <CopyButton value={parsed.secret} />
                    </span>
                  </li>
                )}
                <li>
                  {/* SPA used <Trans> with an inline <code>; our flat t() splits the
                      sentence around the literal instead. */}
                  {t('app.settings.security.setup.uriStepBefore')}
                  <code>otpauth://</code>
                  {t('app.settings.security.setup.uriStepAfter')}
                  <br />
                  <span className="qr-secret" style={{ maxWidth: '100%' }}>
                    <span
                      style={{
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap',
                        maxWidth: 200,
                      }}
                    >
                      {setup.otpProvisioningUri}
                    </span>
                    <CopyButton value={setup.otpProvisioningUri} />
                  </span>
                </li>
                <li>
                  {t('app.settings.security.setup.codeStep')}
                  <form onSubmit={handleEnable} style={{ marginTop: 10 }}>
                    <input
                      id="totp-code"
                      className="sinput"
                      aria-label={t('app.settings.security.setup.codeStep')}
                      inputMode="numeric"
                      autoComplete="one-time-code"
                      maxLength={6}
                      placeholder="000000"
                      value={code}
                      onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                      disabled={enabling}
                      style={{ letterSpacing: '0.3em', minWidth: 0, width: 160 }}
                      autoFocus
                    />
                    <div style={{ display: 'flex', gap: 10, marginTop: 12 }}>
                      <button
                        type="submit"
                        className="btn primary sm"
                        disabled={enabling || code.length !== 6}
                      >
                        {enabling
                          ? t('app.settings.security.setup.verifying')
                          : t('app.settings.security.setup.verifyEnable')}
                      </button>
                      <button
                        type="button"
                        className="btn sm"
                        onClick={cancelSetup}
                        disabled={enabling}
                      >
                        {t('app.common.actions.cancel')}
                      </button>
                    </div>
                  </form>
                </li>
              </ol>
            </div>
          </div>
        )}
      </div>

      <ConfirmDialog
        open={confirmDisable}
        title={t('app.settings.security.confirmDisable.title')}
        message={t('app.settings.security.confirmDisable.message')}
        confirmLabel={t('app.settings.security.confirmDisable.confirmLabel')}
        danger
        loading={disabling}
        onConfirm={() => void handleDisable()}
        onCancel={() => setConfirmDisable(false)}
      />
    </span>
  );
}

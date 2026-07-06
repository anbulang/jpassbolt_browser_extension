/**
 * MfaChallenge.tsx — the login-time MFA (TOTP) challenge screen, ported from
 * the SPA's components/MfaChallenge.tsx and rewired onto the background RPC:
 *
 *   UNLOCK returns StatusResult{ mfa: { required, providers } } when the server
 *   gates the fresh session behind MFA; the pending JWT stays in worker memory.
 *   This component submits the 6-digit code via MFA_VERIFY; on success the
 *   background finalizes the session and returns the unlocked StatusResult,
 *   which is handed to onDone (the shared Flow then renders the vault).
 *
 * It never touches the private key or passphrase — it only satisfies the
 * server-side MFA gate. Error text arrives ALREADY LOCALIZED from the
 * background handler (429 / invalid-code mapping happens there because the RPC
 * envelope carries no HTTP status), so err.message is shown verbatim.
 *
 * Mounted from ui/components.tsx Flow, so it must render correctly in BOTH the
 * popup and the full app page (both load aegis.css → lock-overlay styling).
 */
import { useEffect, useRef, useState, type JSX } from 'react';
import { AlertTriangle, KeyRound, Shield, ShieldCheck } from 'lucide-react';
import { rpc, type StatusResult } from '../../shared/messages';
import { t } from '../../shared/i18n';

interface Props {
  /** Called with the unlocked StatusResult once the code is accepted. */
  onDone: (s: StatusResult) => void;
  /** Optional: cancel the challenge (the caller drops the pending session). */
  onCancel?: () => void;
}

type Stage = 'mfa' | 'verifying';

export default function MfaChallenge({ onDone, onCancel }: Props): JSX.Element {
  const [stage, setStage] = useState<Stage>('mfa');
  const [code, setCode] = useState('');
  const [error, setError] = useState('');
  const [shake, setShake] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  // Keep the background service worker alive while the user fetches their
  // authenticator: each extension message resets the MV3 idle timer, so a 20s
  // GET_STATUS ping prevents the ~30s teardown. The parked JWT survives a
  // teardown anyway (session-storage mirror in the background), but keeping the
  // worker — and with it the parked decrypted KEY — alive spares the user a
  // second passphrase entry after the code is accepted.
  useEffect(() => {
    const id = setInterval(() => {
      void rpc({ type: 'GET_STATUS' }).catch(() => undefined);
    }, 20_000);
    return () => clearInterval(id);
  }, []);

  // Drive the 6 cells from a single invisible numeric input. Once 6 digits are
  // entered, submit to the background. `code` is the only source of truth.
  const onCodeChange = async (raw: string) => {
    if (stage === 'verifying') return;
    const digits = raw.replace(/\D/g, '').slice(0, 6);
    setCode(digits);
    setError('');
    setShake(false);
    if (digits.length < 6) return;

    setStage('verifying');
    try {
      // remember=false: the login challenge is per-session; "remember this
      // device" is a Settings concern, not the login gate (SPA parity).
      const status = await rpc({ type: 'MFA_VERIFY', provider: 'totp', code: digits });
      onDone(status);
    } catch (err: unknown) {
      // If the parked challenge no longer exists at all (TTL expired, or a
      // lock/teardown raced the submit), this screen is a dead end — no code
      // can ever succeed. Detect it by behavior, not by message text: an
      // invalid code keeps the challenge parked (GET_STATUS still reports
      // mfa.required), a vanished challenge does not. Auto-route back to the
      // passphrase step instead of stranding the user.
      try {
        const now = await rpc({ type: 'GET_STATUS' });
        if (!now.mfa?.required) {
          onDone(now);
          return;
        }
      } catch {
        /* background unreachable — fall through to the inline error */
      }
      setError(err instanceof Error ? err.message : String(err));
      // Reset for another attempt with the error shake.
      setStage('mfa');
      setShake(true);
      setCode('');
      setTimeout(() => inputRef.current?.focus(), 60);
      setTimeout(() => setShake(false), 600);
    }
  };

  const verifying = stage === 'verifying';

  return (
    <div className="lock-overlay">
      <div className="lock-card">
        <div
          className="lock-badge"
          style={{ background: verifying ? 'var(--green)' : 'var(--accent)' }}
        >
          {verifying ? <ShieldCheck size={28} /> : <Shield size={28} />}
        </div>
        <h2>{verifying ? t('app.components.mfa.verified') : t('app.components.mfa.title')}</h2>
        <div className="who">
          {verifying ? t('app.components.mfa.entering') : t('app.components.mfa.prompt')}
        </div>

        <div style={{ position: 'relative', marginTop: 22 }}>
          <div className={'mfa-dots' + (shake ? ' err' : '')}>
            {[0, 1, 2, 3, 4, 5].map((i) => (
              <div
                key={i}
                className={
                  'mfa-cell' +
                  (code[i] ? ' filled' : '') +
                  (i === code.length && !verifying ? ' cur' : '') +
                  (shake ? ' err' : '')
                }
              >
                {code[i] || ''}
              </div>
            ))}
          </div>
          <input
            ref={inputRef}
            inputMode="numeric"
            autoComplete="one-time-code"
            value={code}
            onChange={(e) => void onCodeChange(e.target.value)}
            disabled={verifying}
            autoFocus
            style={{ position: 'absolute', inset: 0, opacity: 0, cursor: 'text' }}
          />
        </div>

        {error && (
          <div className="pf-err" style={{ justifyContent: 'center' }}>
            <AlertTriangle size={13} /> {error}
          </div>
        )}

        {verifying ? (
          <div className="lock-foot" style={{ marginTop: 10 }}>
            <span className="spin-ring" /> {t('app.components.mfa.verifyingChallenge')}
          </div>
        ) : (
          <div className="lock-foot">
            <KeyRound size={13} /> {t('app.components.mfa.openAuthenticator')}
          </div>
        )}

        {onCancel && !verifying && (
          <div className="lock-foot" style={{ marginTop: 10 }}>
            <button type="button" className="lock-link" onClick={onCancel}>
              {t('app.components.mfa.backToLogin')}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

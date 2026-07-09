/**
 * RecoveryPage — the guest account-recovery flow (账户 → 验证 → 重设 → 完成),
 * ported from the SPA's pages/Recovery.tsx onto the extension trust model.
 *
 * CE recovery semantics (PHP Recover parity): recovery does NOT mint a new key.
 * The user re-imports their existing passphrase-protected private-key backup;
 * the SERVER enforces that the submitted PUBLIC key's fingerprint matches the
 * key on file (a mismatch is rejected and surfaced verbatim).
 *
 * Two entry modes (guest hash routes):
 *   * Request mode (/recover, no params): collect the account email and call
 *     requestRecovery (guest API_CALL) → "check your email" confirmation.
 *   * Complete mode (/recover/:userId/:tokenId): startRecovery validates the
 *     link; the pasted .asc backup goes to the worker via SETUP_IMPORT_KEY
 *     (validated + STAGED there — this page never parses key material itself),
 *     which returns the fingerprint/public key for the confirmation step;
 *     completeRecovery uploads ONLY the public key; SETUP_COMMIT then promotes
 *     the staged key to the account key; the extension's own UNLOCK signs in.
 *     Staging means an abandoned or failed recovery never overwrites a
 *     previously configured account's key on this browser.
 *
 * Caveat vs the SPA, inherent to the worker key model: the backup's passphrase
 * cannot be pre-verified in this iframe (no OpenPGP here); a wrong passphrase
 * surfaces at the final UNLOCK. The `recovered`/`committed` flags keep the
 * consumed token (and the one-shot staged-key promotion) from being
 * re-submitted so only the UNLOCK is retried.
 */
import { useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import {
  AlertTriangle,
  CheckCircle2,
  Download,
  Eye,
  EyeOff,
  Fingerprint,
  KeyRound,
  Lock,
  Mail,
  RefreshCw,
  ShieldCheck,
  Unlock,
  User as UserIcon,
  Users,
  X,
} from 'lucide-react';
import { rpc } from '../../../shared/messages';
import { t } from '../../../shared/i18n';
import type { User } from '../../../shared/types';
import { requestRecovery, startRecovery, completeRecovery } from '../../services/setup';
import { describeApiError } from '../../lib/errors';
import {
  KeyFileButton,
  Stepper,
  accountIdentity,
  formatFingerprint,
  fullName,
} from './flowHelpers';

/** The supported recovery method (CE): re-import the existing key backup. */
type VerifyMethod = 'backup' | 'code' | 'admin';

export default function RecoveryPage() {
  const navigate = useNavigate();
  const STEPS = [
    t('app.auth.recovery.steps.account'),
    t('app.auth.recovery.steps.verify'),
    t('app.auth.recovery.steps.reset'),
    t('app.auth.recovery.steps.done'),
  ];

  const params = useParams<{ userId?: string; tokenId?: string }>();
  const userId = params.userId ?? '';
  const token = params.tokenId ?? '';
  // Complete mode iff the link carries both a user id and a token.
  const isComplete = Boolean(userId && token);

  // Flow state
  const [step, setStep] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  // Request mode — email + "email sent" confirmation.
  const [email, setEmail] = useState('');
  const [sent, setSent] = useState(false);

  // Complete mode — validated identity + import method.
  const [user, setUser] = useState<User | null>(null);
  const [linkValidated, setLinkValidated] = useState(false);
  const [method, setMethod] = useState<VerifyMethod>('backup');
  const [importArmored, setImportArmored] = useState('');

  // Passphrase (unlocks the imported backup at sign-in — NOT a new passphrase).
  const [pf, setPf] = useState('');
  const [showPf, setShowPf] = useState(false);

  // Fingerprint + public key of the STAGED backup (returned by SETUP_IMPORT_KEY;
  // KEY_INFO would still describe the previous account key at this point).
  const [fingerprint, setFingerprint] = useState('');
  const [publicKeyArmored, setPublicKeyArmored] = useState('');

  // completeRecovery consumed the one-time token / SETUP_COMMIT consumed the
  // staged pair → a retry only re-runs the UNLOCK.
  const [recovered, setRecovered] = useState(false);
  const [committed, setCommitted] = useState(false);
  // UNLOCK may come back MFA-gated (the account may have TOTP enabled); the
  // done step then routes into the protected shell where Flow shows the
  // challenge (GET_STATUS carries the pending-MFA flag).
  const [mfaPending, setMfaPending] = useState(false);

  const emailOk = /\S+@\S+\.\S+/.test(email);

  // ---- Request mode (step 0): ask the backend to email a recover link ----
  const sendRecoveryEmail = async () => {
    if (loading || !emailOk) return;
    setLoading(true);
    setError('');
    try {
      await requestRecovery({ username: email.trim() });
      setSent(true);
    } catch (err: unknown) {
      // Backends often respond 200 regardless (anti-enumeration); a real error
      // is surfaced verbatim.
      setError(describeApiError(err) || t('app.auth.recovery.errors.sendFailed'));
    } finally {
      setLoading(false);
    }
  };

  // ---- Complete mode: validate the recover link, then enter the verify step ----
  const validateLink = async () => {
    if (loading) return;
    setLoading(true);
    setError('');
    try {
      const u = await startRecovery(userId, token);
      setUser(u);
      setLinkValidated(true);
      setStep(1);
    } catch (err: unknown) {
      setError(describeApiError(err) || t('app.auth.recovery.errors.linkInvalid'));
    } finally {
      setLoading(false);
    }
  };

  // ---- Complete mode (step 1 -> 2): import the backup into the worker ----
  const verifyImportAndAdvance = async () => {
    if (loading) return;
    setError('');
    setLoading(true);
    try {
      const armored = importArmored.trim();
      if (!armored) {
        throw new Error(t('app.auth.recovery.errors.missingBackup'));
      }
      // Background validates (parseable + passphrase-protected) and STAGES it —
      // the account key is only replaced by SETUP_COMMIT after the server
      // accepted the recovery; the passphrase itself is verified at UNLOCK.
      const info = await rpc({ type: 'SETUP_IMPORT_KEY', armoredPrivateKey: armored });
      setFingerprint(info.fingerprint);
      setPublicKeyArmored(info.publicKeyArmored);
      setStep(2);
    } catch (err: unknown) {
      setError(
        (err instanceof Error && err.message) || t('app.auth.recovery.errors.missingBackup'),
      );
    } finally {
      setLoading(false);
    }
  };

  // ---- Complete mode (step 2 -> 3): finalize recovery + worker sign-in ----
  const finishRecovery = async () => {
    if (loading) return;
    setLoading(true);
    setError('');
    try {
      if (!recovered) {
        // Upload ONLY the armored PUBLIC key of the STAGED backup; the server
        // enforces the fingerprint match against the key on file. A rejection
        // (or abandoning here) leaves any previous account key untouched.
        if (!publicKeyArmored) {
          throw new Error(t('app.auth.recovery.errors.missingBackup'));
        }
        await completeRecovery(userId, { token, armoredPublicKey: publicKeyArmored });
        setRecovered(true);
      }
      if (!committed) {
        // Server accepted the recovery — NOW promote the staged backup to the
        // account key (replacing any previous account on this browser and
        // dropping its session). The link-validated identity rides along so
        // the unlock screen greets this user even before the UNLOCK below
        // succeeds (e.g. a mistyped passphrase, or another tab meanwhile).
        await rpc({ type: 'SETUP_COMMIT', account: accountIdentity(user) });
        setCommitted(true);
      }
      // recover/complete issues NO JWT (PHP parity) — UNLOCK runs the real
      // GpgAuth with the recovered key. An MFA-enabled account comes back with
      // status.mfa: the done step still shows, and entering the vault routes
      // through the protected shell's MFA challenge.
      const status = await rpc({ type: 'UNLOCK', passphrase: pf });
      setMfaPending(Boolean(status.mfa?.required));
      setStep(3);
    } catch (err: unknown) {
      // completeRecovery throws ApiError (enveloped → describeApiError, e.g.
      // the server's fingerprint-mismatch message verbatim); UNLOCK throws a
      // plain Error already localized by the background.
      const msg =
        err && typeof err === 'object' && 'response' in err
          ? describeApiError(err)
          : err instanceof Error
            ? err.message
            : '';
      setError(msg || t('app.auth.recovery.errors.recoverFailed'));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flow-overlay">
      <div className="flow-card">
        <div className="flow-top">
          <div className="flow-brand">
            <span className="lg">
              <KeyRound />
            </span>
            <span className="bn">{t('app.auth.recovery.brand')}</span>
            <button
              className="iconbtn bx"
              onClick={() => navigate('/')}
              title={t('app.auth.recovery.backToLogin')}
              style={{
                marginLeft: 'auto',
                background: 'none',
                border: 'none',
                color: 'var(--text-3)',
                cursor: 'pointer',
                display: 'grid',
                placeItems: 'center',
              }}
            >
              <X size={18} />
            </button>
          </div>
          <Stepper steps={STEPS} cur={step} />
        </div>

        <div className="flow-body">
          {error && (
            <div className="warnbox" style={{ marginBottom: 16 }}>
              <AlertTriangle />
              <div>{error}</div>
            </div>
          )}

          {/* 0 · account (request mode: email; complete mode: validate link) */}
          {step === 0 && (
            <>
              <div className="flow-h">
                <div className="flow-badge">
                  <RefreshCw />
                </div>
                <h2>{t('app.auth.recovery.request.title')}</h2>
                <p>{t('app.auth.recovery.request.subtitle')}</p>
              </div>

              {isComplete ? (
                <>
                  <div className="invite-meta" style={{ marginBottom: 18 }}>
                    <div className="invite-line">
                      <Mail />
                      <span className="k">{t('app.auth.recovery.request.linkLabel')}</span>
                      <span className="v" style={{ marginLeft: 'auto', color: 'var(--text-2)' }}>
                        {t('app.auth.recovery.request.linkPending')}
                      </span>
                    </div>
                  </div>
                  <button
                    className="btn primary"
                    style={{ width: '100%', height: 44, fontSize: 14 }}
                    onClick={() => void validateLink()}
                    disabled={loading}
                  >
                    {loading ? (
                      <>
                        <span className="spin-ring" /> {t('app.auth.recovery.request.validating')}
                      </>
                    ) : (
                      t('app.auth.recovery.request.validateAndContinue')
                    )}
                  </button>
                  <div className="flow-note">
                    <ShieldCheck /> {t('app.auth.recovery.request.noteNoExpose')}
                  </div>
                </>
              ) : sent ? (
                <>
                  <div className="kit-row" style={{ marginTop: 2 }}>
                    <span
                      className="kr-ico"
                      style={{ background: 'var(--green-soft)', color: 'var(--green-text)' }}
                    >
                      <CheckCircle2 />
                    </span>
                    <div className="kr-t">
                      <div className="a">{t('app.auth.recovery.request.sentTitle')}</div>
                      <div className="b">{t('app.auth.recovery.request.sentDesc')}</div>
                    </div>
                  </div>
                  <div className="warn-soft">
                    <Mail /> {t('app.auth.recovery.request.sentHint')}
                  </div>
                  <div className="flow-note">
                    <ShieldCheck /> {t('app.auth.recovery.request.noteNoExpose')}
                  </div>
                </>
              ) : (
                <>
                  <div className="pf-label">
                    <UserIcon size={15} /> {t('app.auth.recovery.request.emailLabel')}
                  </div>
                  <div className="pf-input">
                    <Mail size={17} />
                    <input
                      type="email"
                      autoFocus
                      value={email}
                      placeholder={t('app.auth.recovery.request.emailPlaceholder')}
                      style={{ letterSpacing: 0, fontFamily: 'var(--sans)' }}
                      onChange={(e) => setEmail(e.target.value)}
                    />
                  </div>
                  <button
                    className="btn primary"
                    style={{ width: '100%', height: 44, marginTop: 18, fontSize: 14 }}
                    disabled={!emailOk || loading}
                    onClick={() => void sendRecoveryEmail()}
                  >
                    {loading ? (
                      <>
                        <span className="spin-ring" /> {t('app.auth.recovery.request.sending')}
                      </>
                    ) : (
                      t('app.auth.recovery.request.continue')
                    )}
                  </button>
                  <div className="flow-note">
                    <ShieldCheck /> {t('app.auth.recovery.request.noteNoExposeOld')}
                  </div>
                </>
              )}
            </>
          )}

          {/* 1 · verify (complete mode): import the existing key backup + passphrase */}
          {step === 1 && (
            <>
              <div className="flow-h">
                <div className="flow-badge">
                  <ShieldCheck />
                </div>
                <h2>{t('app.auth.recovery.verify.title')}</h2>
                <p>
                  {t('app.auth.recovery.verify.subtitlePrefix')}
                  {linkValidated && user
                    ? ` ${fullName(user, 'app.auth.recovery.accountFallback')} `
                    : ` ${t('app.auth.recovery.verify.subtitleAccountFallback')}`}
                  {t('app.auth.recovery.verify.subtitleSuffix')}
                </p>
              </div>

              {/* Supported method: import an existing key backup. */}
              <div
                className={'opt-card' + (method === 'backup' ? ' sel' : '')}
                onClick={() => setMethod('backup')}
              >
                <span className="oc-ico">
                  <Download />
                </span>
                <div className="oc-t">
                  <div className="a">
                    {t('app.auth.recovery.verify.methodBackupTitle')}{' '}
                    <span className="recommend">
                      {t('app.auth.recovery.verify.methodBackupBadge')}
                    </span>
                  </div>
                  <div className="b">{t('app.auth.recovery.verify.methodBackupDesc')}</div>
                </div>
                <span className="oc-radio" />
              </div>

              {/* Present-but-unsupported methods (honest: disabled). */}
              <div
                className="opt-card"
                style={{ opacity: 0.55, cursor: 'not-allowed' }}
                title={t('app.auth.recovery.verify.unsupportedTitle')}
              >
                <span className="oc-ico">
                  <KeyRound />
                </span>
                <div className="oc-t">
                  <div className="a">
                    {t('app.auth.recovery.verify.methodCodeTitle')}{' '}
                    <span
                      className="recommend"
                      style={{ background: 'var(--surface-3)', color: 'var(--text-3)' }}
                    >
                      {t('app.auth.recovery.verify.unsupportedBadge')}
                    </span>
                  </div>
                  <div className="b">{t('app.auth.recovery.verify.methodCodeDesc')}</div>
                </div>
                <span className="oc-radio" />
              </div>
              <div
                className="opt-card"
                style={{ opacity: 0.55, cursor: 'not-allowed' }}
                title={t('app.auth.recovery.verify.unsupportedTitle')}
              >
                <span className="oc-ico">
                  <Users />
                </span>
                <div className="oc-t">
                  <div className="a">
                    {t('app.auth.recovery.verify.methodAdminTitle')}{' '}
                    <span
                      className="recommend"
                      style={{ background: 'var(--surface-3)', color: 'var(--text-3)' }}
                    >
                      {t('app.auth.recovery.verify.unsupportedBadge')}
                    </span>
                  </div>
                  <div className="b">{t('app.auth.recovery.verify.methodAdminDesc')}</div>
                </div>
                <span className="oc-radio" />
              </div>

              {method === 'backup' && (
                <>
                  <div
                    className="pf-label"
                    style={{ display: 'flex', alignItems: 'center', margin: '0 0 6px' }}
                  >
                    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                      <Download size={15} /> {t('app.auth.recovery.verify.pasteLabel')}
                    </span>
                    <span style={{ marginLeft: 'auto' }}>
                      <KeyFileButton
                        onLoaded={(txt) => setImportArmored(txt)}
                        label={t('app.auth.recovery.verify.chooseBackup')}
                      />
                    </span>
                  </div>
                  <textarea
                    // jpb-masked (-webkit-text-security: disc) hides the pasted
                    // armored private key like a password field — same shoulder-
                    // surfing defence KeyImportForm uses (commit dd4a481).
                    className="flow-textarea jpb-masked"
                    placeholder={t('app.auth.recovery.verify.keyPlaceholder')}
                    value={importArmored}
                    onChange={(e) => setImportArmored(e.target.value)}
                    rows={6}
                    spellCheck={false}
                    style={{ marginTop: 6 }}
                  />

                  <div className="pf-label" style={{ marginTop: 14 }}>
                    <KeyRound size={15} /> {t('app.auth.recovery.verify.passphraseLabel')}
                  </div>
                  <div className="pf-input">
                    <Lock size={17} />
                    <input
                      type={showPf ? 'text' : 'password'}
                      value={pf}
                      placeholder={t('app.auth.recovery.verify.passphrasePlaceholder')}
                      onChange={(e) => setPf(e.target.value)}
                    />
                    <button type="button" className="pf-eye" onClick={() => setShowPf((s) => !s)}>
                      {showPf ? <EyeOff size={17} /> : <Eye size={17} />}
                    </button>
                  </div>
                </>
              )}

              <div className="flow-foot">
                <button className="btn" onClick={() => navigate('/')}>
                  {t('app.auth.recovery.verify.backToLogin')}
                </button>
                <span className="spacer" />
                <button
                  className="btn primary"
                  disabled={
                    method !== 'backup' ||
                    importArmored.trim().length === 0 ||
                    pf.length === 0 ||
                    loading
                  }
                  onClick={() => void verifyImportAndAdvance()}
                >
                  {loading ? (
                    <>
                      <span className="spin-ring" /> {t('app.auth.recovery.verify.verifyingKey')}
                    </>
                  ) : (
                    t('app.auth.recovery.verify.next')
                  )}
                </button>
              </div>
            </>
          )}

          {/* 2 · reset (complete mode): confirm + submit to the server */}
          {step === 2 && (
            <>
              <div className="flow-h">
                <div className="flow-badge">
                  <Lock />
                </div>
                <h2>{t('app.auth.recovery.reset.title')}</h2>
                <p>{t('app.auth.recovery.reset.subtitle')}</p>
              </div>

              <div className="done-fp">
                <div className="dfp-l">
                  <Fingerprint /> {t('app.auth.recovery.reset.fingerprintLabel')}
                </div>
                <div className="dfp-v">{formatFingerprint(fingerprint)}</div>
              </div>

              <div className="invite-meta" style={{ marginBottom: 18 }}>
                <div className="invite-line">
                  <UserIcon />
                  <span className="k">{t('app.auth.recovery.reset.accountLabel')}</span>
                  <span className="v">{fullName(user, 'app.auth.recovery.accountFallback')}</span>
                </div>
                <div className="invite-line">
                  <Mail />
                  <span className="k">{t('app.auth.recovery.reset.usernameLabel')}</span>
                  <span className="v" style={{ fontFamily: 'var(--mono)', fontSize: 12.5 }}>
                    {user?.username ?? ''}
                  </span>
                </div>
              </div>

              <div className="warn-soft">
                <AlertTriangle /> {t('app.auth.recovery.reset.warning')}
              </div>

              <div className="flow-foot">
                <button className="btn" onClick={() => setStep(1)} disabled={loading}>
                  {t('app.auth.recovery.reset.prev')}
                </button>
                <span className="spacer" />
                <button className="btn primary" disabled={loading} onClick={() => void finishRecovery()}>
                  {loading ? (
                    <>
                      <span className="spin-ring" /> {t('app.auth.recovery.reset.recovering')}
                    </>
                  ) : (
                    <>
                      <RefreshCw size={16} /> {t('app.auth.recovery.reset.recover')}
                    </>
                  )}
                </button>
              </div>
            </>
          )}

          {/* 3 · done (complete mode): recovered, enter the vault */}
          {step === 3 && (
            <>
              <div className="flow-h">
                <div className="flow-badge green">
                  <ShieldCheck />
                </div>
                <h2>{t('app.auth.recovery.done.title')}</h2>
                <p>{t('app.auth.recovery.done.subtitle')}</p>
              </div>

              <div className="invite-meta" style={{ marginBottom: 18 }}>
                <div className="invite-line">
                  <CheckCircle2 />
                  <span className="k">{t('app.auth.recovery.done.identityLabel')}</span>
                  <span className="v" style={{ marginLeft: 'auto', color: 'var(--green-text)' }}>
                    {t('app.auth.recovery.done.identityValue')}
                  </span>
                </div>
                <div className="invite-line">
                  <KeyRound />
                  <span className="k">{t('app.auth.recovery.done.fingerprintLabel')}</span>
                  <span className="v" style={{ marginLeft: 'auto', color: 'var(--green-text)' }}>
                    {t('app.auth.recovery.done.fingerprintValue')}
                  </span>
                </div>
                <div className="invite-line">
                  <Unlock />
                  <span className="k">{t('app.auth.recovery.done.vaultLabel')}</span>
                  <span className="v" style={{ marginLeft: 'auto', color: 'var(--text-2)' }}>
                    {mfaPending
                      ? t('app.auth.recovery.done.mfaPending')
                      : t('app.auth.recovery.done.vaultValue')}
                  </span>
                </div>
              </div>

              <button
                className="btn primary"
                style={{ width: '100%', height: 44, fontSize: 14 }}
                onClick={() => navigate('/')}
              >
                <Unlock size={16} /> {t('app.auth.recovery.done.enterVault')}
              </button>
              <div className="flow-note">
                <ShieldCheck /> {t('app.auth.recovery.done.note')}
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

/**
 * SetupPage — the guest account-onboarding flow (邀请 → 密钥 → 口令 → 完成),
 * ported from the SPA's pages/Setup.tsx onto the extension trust model:
 *
 *   - startSetup / completeSetup go through the guest API_CALL pass-through
 *     (app/services/setup.ts) — only the armored PUBLIC key is ever uploaded;
 *   - key material is produced INSIDE the background worker and only STAGED
 *     there: generate mode via SETUP_GENERATE_KEY (returns the
 *     passphrase-protected armored private key ONCE for the recovery-kit
 *     download), import mode via SETUP_IMPORT_KEY. The staged pair is promoted
 *     to the account keys by SETUP_COMMIT only AFTER completeSetup succeeded,
 *     so abandoning the flow (or a failed activation) on a browser already
 *     configured for another account leaves that account's key untouched;
 *   - the final sign-in is the extension's own UNLOCK (GpgAuth + JWT live in
 *     the worker), replacing the SPA's loginWithGpg/localStorage handoff;
 *   - the SPA's hardcoded BASE_URL is gone: the server is the extension's
 *     configured serverUrl (with a referrer-origin SET_SERVER fallback for a
 *     direct app.html open, since the invite page normally mounts us via the
 *     appBootstrap iframe on the server origin).
 *
 * Import-mode caveat vs the SPA: the passphrase cannot be checked against the
 * pasted key inside this iframe (no OpenPGP here) and there is no RPC for a
 * dry-run decrypt, so a wrong passphrase surfaces at the final UNLOCK. The
 * `activated` flag keeps the consumed setup token from being re-submitted so
 * the user can simply retry unlocking (or go back and re-enter).
 */
import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import {
  AlertTriangle,
  Check,
  Download,
  Fingerprint,
  Globe,
  KeyRound,
  Lock,
  Mail,
  ShieldCheck,
  Unlock,
  User as UserIcon,
  Users,
  Vault,
} from 'lucide-react';
import { rpc, type StatusResult } from '../../../shared/messages';
import { t } from '../../../shared/i18n';
import type { User } from '../../../shared/types';
import { startSetup, completeSetup } from '../../services/setup';
import { describeApiError } from '../../lib/errors';
import PassphraseInput from '../../components/PassphraseInput';
import SecurityTokenPicker from '../../components/SecurityTokenPicker';
import { BrandMark } from '../../../ui/BrandMark';
import {
  DEFAULT_SECURITY_TOKEN,
  getSecurityToken,
  isValidTokenCode,
} from '../../../shared/securityToken';
import {
  ExistingAccountGate,
  KeyFileButton,
  KeyGen,
  PP_LABEL,
  Stepper,
  accountIdentity,
  downloadRecoveryKit,
  enterVaultHref,
  formatFingerprint,
  fullName,
  persistSecurityToken,
  ppScore,
} from './flowHelpers';

type KeyMode = 'gen' | 'import';

export default function SetupPage() {
  const navigate = useNavigate();
  const STEPS = [
    t('app.auth.setup.steps.invite'),
    t('app.auth.setup.steps.key'),
    t('app.auth.setup.steps.passphrase'),
    t('app.auth.setup.steps.done'),
  ];

  const params = useParams<{ userId?: string; tokenId?: string }>();
  const userId = params.userId ?? '';
  const token = params.tokenId ?? '';

  // Flow state
  const [step, setStep] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  // Extension status (server display + no_server guard)
  const [status, setStatus] = useState<StatusResult | null>(null);
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        let s = await rpc({ type: 'GET_STATUS' });
        // Direct app.html open (not via the server-page iframe): adopt the
        // invite link's origin as the server so the guest calls can go out.
        if (!s.serverUrl && document.referrer) {
          try {
            const origin = new URL(document.referrer).origin;
            if (origin.startsWith('http')) s = await rpc({ type: 'SET_SERVER', serverUrl: origin });
          } catch {
            /* unparseable referrer — leave unconfigured */
          }
        }
        if (!cancelled) setStatus(s);
      } catch {
        /* background unreachable — the first API call will surface it */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // Step 0 — invited user
  const [user, setUser] = useState<User | null>(null);
  const [inviteLoaded, setInviteLoaded] = useState(false);

  // Step 1 — key choice
  const [keyMode, setKeyMode] = useState<KeyMode>('gen');
  const [importArmored, setImportArmored] = useState('');
  const [generating, setGenerating] = useState(false);

  // Step 2 — security token (anti-phishing mark, chosen alongside the passphrase).
  // SEEDED from storage rather than hard-started at DEFAULT on purpose: on a
  // device that already holds an account this returns the user's REAL mark, so
  // the picker agrees with the badge rendered inside the passphrase fields
  // below. Starting at DEFAULT would show 'JPB' to a user whose mark is
  // something else — a self-inflicted phishing false alarm. A fresh device
  // simply gets DEFAULT, and leaving it untouched is a valid choice (it is then
  // written explicitly at commit, which is what stops the next account on this
  // device from inheriting the previous user's mark).
  const [tokenCode, setTokenCode] = useState(DEFAULT_SECURITY_TOKEN.code);
  const [tokenColor, setTokenColor] = useState(DEFAULT_SECURITY_TOKEN.color);
  // The account IS set up but the mark could not be stored — non-blocking hint.
  const [tokenSaveFailed, setTokenSaveFailed] = useState(false);
  useEffect(() => {
    let cancelled = false;
    void getSecurityToken().then((tk) => {
      if (cancelled) return;
      setTokenCode(tk.code);
      setTokenColor(tk.color);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  // Step 2 — passphrase
  const [pf, setPf] = useState('');
  const [pf2, setPf2] = useState('');
  // Non-blocking HIBP breach warning for the chosen master passphrase (white-paper
  // SP-09). null = not checked / clean / service unreachable; >0 = breach count.
  const [pfPwned, setPfPwned] = useState<number | null>(null);
  // k-anonymity check (only the SHA-1 prefix leaves the device, in the worker).
  // Purely informational — it never gates the flow; a failed lookup stays silent.
  const checkPassphrasePwned = async () => {
    if (!pf) return;
    try {
      const { count } = await rpc({ type: 'PWNED', password: pf });
      setPfPwned(count > 0 ? count : null);
    } catch {
      setPfPwned(null);
    }
  };

  // Derived key material. The armored private key is held ONLY when the
  // background returned it (generate mode) or the user pasted it (import mode),
  // solely for the recovery-kit download; it never goes to the network.
  const [armoredPrivateKey, setArmoredPrivateKey] = useState('');
  const [armoredPublicKey, setArmoredPublicKey] = useState('');
  const [fingerprint, setFingerprint] = useState('');

  // Guard enterVault retries: the setup token is single-use, so once
  // completeSetup succeeded only the later stages are retried; likewise the
  // staged-key promotion (SETUP_COMMIT clears the staged slots) runs once.
  const [activated, setActivated] = useState(false);
  const [committed, setCommitted] = useState(false);
  // Set by ExistingAccountGate when this browser already holds an account key and
  // the user explicitly accepted replacing it. Forwarded to SETUP_COMMIT as
  // `allowReplace`, which the background REQUIRES before overwriting a key.
  const [replaceConfirmed, setReplaceConfirmed] = useState(false);
  // Activation finished: show the top-target "enter vault" link (see enterVaultHref).
  const [entered, setEntered] = useState(false);

  const score = ppScore(pf);
  const match = pf.length > 0 && pf === pf2;
  const tokenOk = isValidTokenCode(tokenCode);
  // Feed the picker's live value to the badges below. The chosen mark is only
  // written to storage after SETUP_COMMIT, so an uncontrolled badge would show
  // the stale/default mark while the picker right beside it shows the new one.
  const pickedToken = useMemo(
    () => ({ code: tokenCode, color: tokenColor }),
    [tokenCode, tokenColor],
  );
  // Step 2 is complete only when BOTH the passphrase and the mark are valid:
  // the token is picked on this step, so a half-typed code must not advance.
  const ppOk = score >= 3 && match && tokenOk;

  // ---- Step 0: validate the invite link ----
  const acceptInvite = async () => {
    if (loading) return;
    if (!userId || !token) {
      setError(t('app.auth.setup.errors.missingLink'));
      return;
    }
    if (!status?.serverUrl) {
      setError(t('app.auth.setup.errors.noServer'));
      return;
    }
    setLoading(true);
    setError('');
    try {
      const u = await startSetup(userId, token);
      setUser(u);
      setInviteLoaded(true);
      setStep(1);
    } catch (err: unknown) {
      setError(describeApiError(err) || t('app.auth.setup.errors.inviteInvalid'));
    } finally {
      setLoading(false);
    }
  };

  // ---- Step 2 -> Step 3: produce the key material behind the KeyGen animation ----
  const produceKeyAndAdvance = async () => {
    if (loading) return;
    setError('');

    if (keyMode === 'gen') {
      setGenerating(true);
      try {
        const res = await rpc({
          type: 'SETUP_GENERATE_KEY',
          name: fullName(user),
          email: user?.username ?? '',
          passphrase: pf,
        });
        setArmoredPrivateKey(res.privateKeyArmored);
        setArmoredPublicKey(res.publicKeyArmored);
        setFingerprint(res.fingerprint);
        setGenerating(false);
        setStep(3);
      } catch (err: unknown) {
        setGenerating(false);
        setError(
          (err instanceof Error && err.message) || t('app.auth.setup.errors.genFailed'),
        );
      }
      return;
    }

    // import-mode: hand the pasted key to the background, which validates and
    // STAGES it (the account key is untouched until SETUP_COMMIT) and returns
    // its fingerprint/public key for display + upload.
    setLoading(true);
    try {
      const armored = importArmored.trim();
      if (!armored) {
        throw new Error(t('app.auth.setup.errors.missingKey'));
      }
      const info = await rpc({ type: 'SETUP_IMPORT_KEY', armoredPrivateKey: armored });
      setArmoredPrivateKey(armored);
      setArmoredPublicKey(info.publicKeyArmored);
      setFingerprint(info.fingerprint);
      setStep(3);
    } catch (err: unknown) {
      setError(
        (err instanceof Error && err.message) || t('app.auth.setup.errors.missingKey'),
      );
    } finally {
      setLoading(false);
    }
  };

  // ---- Step 3: activate the account, then sign in through the worker ----
  const enterVault = async () => {
    if (loading) return;
    setLoading(true);
    setError('');
    try {
      if (!activated) {
        // Upload ONLY the armored PUBLIC key; consumes the one-time token.
        await completeSetup(userId, { token, armoredPublicKey });
        setActivated(true);
      }
      if (!committed) {
        // Account is activated server-side — NOW promote the staged pair to
        // the account keys (replacing any previous account on this browser and
        // dropping its session). Before this point the flow is abandonable
        // without side effects on an existing account. The invite-validated
        // identity rides along so the unlock screen can greet this user even
        // before the UNLOCK below succeeds. `allowReplace` carries the gate's
        // explicit consent; without it the background refuses to overwrite a key.
        await rpc({ type: 'SETUP_COMMIT', account: accountIdentity(user), allowReplace: replaceConfirmed });
        setCommitted(true);
        // The account is ours from this line on, so NOW the chosen mark may be
        // written — and it is written before the UNLOCK below, which is allowed
        // to fail and repaint a passphrase prompt: that prompt must already
        // show the user's own mark. Never throws (see persistSecurityToken for
        // the storage-ordering proof and the swallow rationale).
        setTokenSaveFailed(!(await persistSecurityToken({ code: tokenCode, color: tokenColor })));
      }
      // setup/complete activates the account but issues NO JWT (PHP parity):
      // UNLOCK runs the real GpgAuth with the just-persisted key and enters the
      // vault unlocked. A brand-new account has no MFA provider yet, but if the
      // server ever gates it the protected shell's Flow shows the challenge.
      const st = await rpc({ type: 'UNLOCK', passphrase: pf });
      if (st.mfa?.required) {
        // The challenge lives in the protected shell — stay inside the iframe.
        navigate('/');
        return;
      }
      // Signed in. Do NOT navigate in-iframe: the HOST tab is still sitting on
      // the one-time /setup/... link, so a refresh would replay this flow. Reveal
      // the target="_top" vault link instead — the user's click navigates the
      // whole tab to /app, where appBootstrap re-mounts the vault (see
      // enterVaultHref). Only when the server URL is unknown do we fall back to
      // an in-iframe navigate.
      const href = enterVaultHref(status?.serverUrl);
      if (!href) {
        navigate('/');
        return;
      }
      setEntered(true);
    } catch (err: unknown) {
      // completeSetup throws ApiError (enveloped → describeApiError); UNLOCK
      // throws a plain Error whose message the background already localized.
      const msg =
        err && typeof err === 'object' && 'response' in err
          ? describeApiError(err)
          : err instanceof Error
            ? err.message
            : '';
      setError(msg || t('app.auth.setup.errors.activateFailed'));
    } finally {
      setLoading(false);
    }
  };

  return (
    // A setup link always ends in SETUP_COMMIT, which would overwrite any account
    // key already on this browser — so the gate blocks (and demands an explicit,
    // backup-aware confirmation) before the wizard is even mounted.
    <ExistingAccountGate confirmed={replaceConfirmed} onConfirm={() => setReplaceConfirmed(true)}>
    <div className="flow-overlay">
      <div className="flow-card">
        <div className="flow-top">
          <div className="flow-brand">
            <span className="lg">
              <BrandMark />
            </span>
            <span className="bn">{t('app.auth.brand')}</span>
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

          {/* 0 · invite */}
          {step === 0 && (
            <>
              <div className="flow-h">
                <div className="flow-badge">
                  <Vault />
                </div>
                <h2>{t('app.auth.setup.invite.title')}</h2>
                <p>{t('app.auth.setup.invite.subtitle')}</p>
              </div>

              {inviteLoaded && user && (
                <div className="invite-meta" style={{ marginBottom: 18 }}>
                  <div className="invite-line">
                    <UserIcon />
                    <span className="k">{t('app.auth.setup.invite.nameLabel')}</span>
                    <span className="v">{fullName(user)}</span>
                  </div>
                  <div className="invite-line">
                    <Mail />
                    <span className="k">{t('app.auth.setup.invite.usernameLabel')}</span>
                    <span className="v" style={{ fontFamily: 'var(--mono)', fontSize: 12.5 }}>
                      {user.username}
                    </span>
                  </div>
                  <div className="invite-line">
                    <Users />
                    <span className="k">{t('app.auth.setup.invite.roleLabel')}</span>
                    <span className="v">{user.role?.name ?? 'user'}</span>
                  </div>
                  <div className="invite-line">
                    <Globe />
                    <span className="k">{t('app.auth.setup.invite.serverLabel')}</span>
                    <span className="v" style={{ fontFamily: 'var(--mono)', fontSize: 12.5 }}>
                      {status?.serverUrl ?? ''}
                    </span>
                  </div>
                </div>
              )}

              <button
                className="btn primary"
                style={{ width: '100%', height: 44, fontSize: 14 }}
                onClick={() => void acceptInvite()}
                disabled={loading}
              >
                {loading ? (
                  <>
                    <span className="spin-ring" /> {t('app.auth.setup.invite.validating')}
                  </>
                ) : (
                  t('app.auth.setup.invite.accept')
                )}
              </button>
              <div className="flow-note">
                <ShieldCheck /> {t('app.auth.setup.invite.note')}
              </div>
            </>
          )}

          {/* 1 · key */}
          {step === 1 && (
            <>
              <div className="flow-h">
                <div className="flow-badge">
                  <KeyRound />
                </div>
                <h2>{t('app.auth.setup.key.title')}</h2>
                <p>{t('app.auth.setup.key.subtitle')}</p>
              </div>

              <div
                className={'opt-card' + (keyMode === 'gen' ? ' sel' : '')}
                onClick={() => setKeyMode('gen')}
              >
                <span className="oc-ico">
                  <KeyRound />
                </span>
                <div className="oc-t">
                  <div className="a">
                    {t('app.auth.setup.key.genTitle')}{' '}
                    <span className="recommend">{t('app.auth.setup.key.genBadge')}</span>
                  </div>
                  <div className="b">{t('app.auth.setup.key.genDesc')}</div>
                </div>
                <span className="oc-radio" />
              </div>

              <div
                className={'opt-card' + (keyMode === 'import' ? ' sel' : '')}
                onClick={() => setKeyMode('import')}
              >
                <span className="oc-ico">
                  <Download />
                </span>
                <div className="oc-t">
                  <div className="a">{t('app.auth.setup.key.importTitle')}</div>
                  <div className="b">{t('app.auth.setup.key.importDesc')}</div>
                </div>
                <span className="oc-radio" />
              </div>

              {keyMode === 'import' && (
                <>
                  <div
                    className="pf-label"
                    style={{ display: 'flex', alignItems: 'center', margin: '4px 0 6px' }}
                  >
                    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                      <KeyRound size={15} /> {t('app.auth.setup.key.pasteLabel')}
                    </span>
                    <span style={{ marginLeft: 'auto' }}>
                      <KeyFileButton onLoaded={(txt) => setImportArmored(txt)} />
                    </span>
                  </div>
                  <textarea
                    // Shown in plain text (aligned with official Passbolt): the
                    // armored backup is itself passphrase-encrypted, and plain text
                    // lets the user eyeball the BEGIN/END blocks when pasting.
                    className="flow-textarea"
                    placeholder={t('app.auth.setup.key.keyPlaceholder')}
                    value={importArmored}
                    onChange={(e) => setImportArmored(e.target.value)}
                    rows={6}
                    spellCheck={false}
                    style={{ marginTop: 4 }}
                  />
                  <div className="jpb-muted" style={{ fontSize: 11.5, marginTop: 6 }}>
                    {t('app.auth.plaintextBackupNote')}
                  </div>
                </>
              )}

              <div className="flow-foot">
                <button className="btn" onClick={() => setStep(0)}>
                  {t('app.auth.setup.key.prev')}
                </button>
                <span className="spacer" />
                <button
                  className="btn primary"
                  onClick={() => setStep(2)}
                  disabled={keyMode === 'import' && importArmored.trim().length === 0}
                >
                  {t('app.auth.setup.key.next')}
                </button>
              </div>
            </>
          )}

          {/* 2 · passphrase */}
          {step === 2 && (
            <>
              <div className="flow-h">
                <div className="flow-badge">
                  <Lock />
                </div>
                <h2>{t('app.auth.setup.passphrase.title')}</h2>
                <p>{t('app.auth.setup.passphrase.subtitle')}</p>
              </div>

              {generating ? (
                <KeyGen onDone={() => { /* real key comes from SETUP_GENERATE_KEY */ }} />
              ) : (
                <>
                  <div className="pp-fields">
                    <div>
                      <div className="pf-label">
                        <KeyRound size={15} /> {t('app.auth.setup.passphrase.label')}
                      </div>
                      {/* Anti-phishing token (white-paper SP-27): the badge inside
                          the field + the tinted focus ring show the picker's LIVE
                          value (token={pickedToken}), not storage — the mark is not
                          persisted until the account is committed. The onBlur keeps
                          the non-blocking HIBP breach check. */}
                      <PassphraseInput
                        value={pf}
                        onChange={(v) => {
                          setPf(v);
                          setPfPwned(null);
                        }}
                        token={pickedToken}
                        autoFocus
                        autoComplete="new-password"
                        onBlur={() => void checkPassphrasePwned()}
                      />
                      {pf && (
                        <>
                          <div className={'pp-meter s' + score} style={{ marginTop: 10 }}>
                            <i />
                            <i />
                            <i />
                            <i />
                          </div>
                          <div className="pp-meter-row">
                            <span style={{ color: 'var(--text-3)' }}>
                              {t('app.auth.setup.passphrase.strength')}
                            </span>
                            <span
                              style={{
                                color: score >= 3 ? 'var(--green-text)' : 'var(--amber-text)',
                                fontWeight: 500,
                              }}
                            >
                              {PP_LABEL(score)}
                            </span>
                          </div>
                          {/* Non-blocking breach warning (SP-09): informs but never
                              stops the user from continuing, matching official. */}
                          {pfPwned != null && (
                            <div
                              className="pf-err"
                              style={{ color: 'var(--amber-text)', marginTop: 8 }}
                            >
                              <AlertTriangle size={13} />{' '}
                              {t('app.auth.setup.passphrase.pwnedWarning', {
                                count: pfPwned.toLocaleString(),
                              })}
                            </div>
                          )}
                        </>
                      )}
                    </div>
                    <div>
                      <div className="pf-label">
                        <Check size={15} /> {t('app.auth.setup.passphrase.confirmLabel')}
                      </div>
                      <PassphraseInput
                        value={pf2}
                        onChange={setPf2}
                        token={pickedToken}
                        err={Boolean(pf2) && !match}
                        showToggle={false}
                        autoComplete="new-password"
                      />
                      {pf2 && !match && (
                        <div className="pf-err">
                          <AlertTriangle size={13} /> {t('app.auth.setup.passphrase.mismatch')}
                        </div>
                      )}
                    </div>
                  </div>

                  <div className="req-list">
                    <div className={'req' + (pf.length >= 8 ? ' ok' : '')}>
                      <span className="rc">{pf.length >= 8 && <Check />}</span>{' '}
                      {t('app.auth.setup.passphrase.reqLength')}
                    </div>
                    <div
                      className={
                        'req' +
                        (/[A-Z]/.test(pf) && /[a-z]/.test(pf) && /\d/.test(pf) ? ' ok' : '')
                      }
                    >
                      <span className="rc">
                        {/[A-Z]/.test(pf) && /[a-z]/.test(pf) && /\d/.test(pf) && <Check />}
                      </span>{' '}
                      {t('app.auth.setup.passphrase.reqMixed')}
                    </div>
                    <div className={'req' + (/[^A-Za-z0-9]/.test(pf) ? ' ok' : '')}>
                      <span className="rc">{/[^A-Za-z0-9]/.test(pf) && <Check />}</span>{' '}
                      {t('app.auth.setup.passphrase.reqSymbol')}
                    </div>
                  </div>

                  <div className="warn-soft">
                    <AlertTriangle /> {t('app.auth.setup.passphrase.warning')}
                  </div>

                  {/* Anti-phishing mark (white-paper SP-27), chosen here and
                      stored only once the account is really ours (see
                      enterVault). It is merged into the passphrase step rather
                      than made a 5th step: the flow's step indices are
                      hardcoded (step === 0..3), so inserting one would mean
                      renumbering every branch and jump in this file for two
                      controls that do not fill a screen. */}
                  <SecurityTokenPicker
                    code={tokenCode}
                    color={tokenColor}
                    invalid={!tokenOk}
                    disabled={loading}
                    onChange={(tk) => {
                      setTokenCode(tk.code);
                      setTokenColor(tk.color);
                    }}
                  />

                  <div className="flow-foot">
                    <button className="btn" onClick={() => setStep(1)}>
                      {t('app.auth.setup.passphrase.prev')}
                    </button>
                    <span className="spacer" />
                    <button
                      className="btn primary"
                      disabled={!ppOk || loading}
                      onClick={() => void produceKeyAndAdvance()}
                    >
                      {loading ? (
                        <>
                          <span className="spin-ring" /> {t('app.auth.setup.passphrase.processing')}
                        </>
                      ) : keyMode === 'gen' ? (
                        <>
                          <KeyRound size={16} /> {t('app.auth.setup.passphrase.generateKey')}
                        </>
                      ) : (
                        t('app.auth.setup.passphrase.next')
                      )}
                    </button>
                  </div>
                </>
              )}
            </>
          )}

          {/* 3 · done */}
          {step === 3 && (
            <>
              <div className="flow-h">
                <div className="flow-badge green">
                  <ShieldCheck />
                </div>
                <h2>{t('app.auth.setup.done.title')}</h2>
                <p>{t('app.auth.setup.done.subtitle')}</p>
              </div>

              <div className="done-fp">
                <div className="dfp-l">
                  <Fingerprint /> {t('app.auth.setup.done.fingerprintLabel')}
                </div>
                <div className="dfp-v">{formatFingerprint(fingerprint)}</div>
              </div>

              {/* The mark could not be stored. Deliberately NOT the error
                  warnbox: the account is fully set up, only a display-only
                  preference is missing, and it can be set later. */}
              {tokenSaveFailed && (
                <div className="warn-soft">
                  <AlertTriangle /> {t('app.auth.securityToken.saveFailed')}
                </div>
              )}

              <div className="kit-row">
                <span className="kr-ico">
                  <Download />
                </span>
                <div className="kr-t">
                  <div className="a">{t('app.auth.setup.done.kitTitle')}</div>
                  <div className="b">{t('app.auth.setup.done.kitDesc')}</div>
                </div>
                <button
                  className="btn sm"
                  onClick={() =>
                    downloadRecoveryKit(
                      `jpassbolt-${user?.username ?? 'key'}-private.asc`,
                      armoredPrivateKey,
                    )
                  }
                >
                  <Download /> {t('app.auth.setup.done.kitDownload')}
                </button>
              </div>

              {entered ? (
                // target="_top" leaves the extension iframe and points the HOST
                // tab at the server's /app URL, replacing the spent /setup token
                // in the address bar. The click is the user activation that makes
                // top-level navigation from a cross-origin frame legal.
                <a
                  className="btn primary"
                  style={{ width: '100%', height: 44, fontSize: 14, textDecoration: 'none' }}
                  href={enterVaultHref(status?.serverUrl)}
                  target="_top"
                >
                  <Unlock size={16} /> {t('app.auth.setup.done.enterVault')}
                </a>
              ) : (
                <button
                  className="btn primary"
                  style={{ width: '100%', height: 44, fontSize: 14 }}
                  onClick={() => void enterVault()}
                  disabled={loading}
                >
                  {loading ? (
                    <>
                      <span className="spin-ring" /> {t('app.auth.setup.done.activating')}
                    </>
                  ) : (
                    <>
                      <Unlock size={16} /> {t('app.auth.setup.done.enterVault')}
                    </>
                  )}
                </button>
              )}
              <div className="flow-note">
                <ShieldCheck />{' '}
                {entered ? t('app.auth.setup.done.activated') : t('app.auth.setup.done.note')}
              </div>
            </>
          )}
        </div>
      </div>
    </div>
    </ExistingAccountGate>
  );
}

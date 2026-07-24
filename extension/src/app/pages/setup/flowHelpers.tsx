/* eslint-disable react-refresh/only-export-components */
/**
 * flowHelpers.tsx — shared primitives for the Setup AND Recovery guest flows,
 * ported from the SPA's pages/flowHelpers.tsx (i18next → shared/i18n t()).
 *
 * Small pure helpers (ppScore / PP_LABEL / formatFingerprint / fullName /
 * downloadRecoveryKit) are co-located with three presentational components
 * (Stepper / KeyGen / KeyFileButton) by design — hence the react-refresh
 * disable above.
 *
 * KeyGen is JUST an animation: the CALLER awaits the real SETUP_GENERATE_KEY
 * RPC and decides when generation is truly done; KeyGen also fires onDone after
 * its own animation as a fallback so the UI never hangs, so onDone must be
 * idempotent.
 */
import { useEffect, useRef, useState, type JSX, type ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  AlertTriangle,
  Check,
  Fingerprint,
  Globe,
  KeyRound,
  Mail,
  ShieldAlert,
  Upload,
  User as UserIcon,
} from 'lucide-react';
import { rpc, type StatusResult } from '../../../shared/messages';
import { t } from '../../../shared/i18n';
import { joinName } from '../../../shared/names';
import type { User } from '../../../shared/types';
import { setSecurityToken, type SecurityToken } from '../../../shared/securityToken';
import { BrandMark } from '../../../ui/BrandMark';

// ---------------------------------------------------------------------------
// Security token persistence (setup / recovery)
// ---------------------------------------------------------------------------

/**
 * Persist the security token chosen during a setup/recovery flow. Call this
 * ONLY after the SETUP_COMMIT that installs the new account, and never let its
 * result gate the flow.
 *
 * WHY AFTER THE COMMIT — the intuition ("commit will wipe it, so write later")
 * is wrong, but the conclusion still holds, for the opposite reason:
 *
 *   * SETUP_COMMIT does NOT clear this key. Its cleanup is a pinpoint
 *     whitelist — `del([K.jwt, K.user, K.account, K.stagedPrivateKey,
 *     K.stagedPublicKey])` in background/handlers/auth.ts — and
 *     SECURITY_TOKEN_KEY appears in neither it nor the K registry at all (the
 *     key is owned by shared/securityToken.ts). SET_SERVER's origin-change
 *     cleanup (background/index.ts) is likewise a whitelist that omits it, and
 *     the extension contains no storage.local.clear() anywhere.
 *   * The ONLY code path that deletes it is removeAccount()
 *     (background/index.ts), which the onboarding flows never call.
 *
 * So an early write is not lost — it is PERMANENT. A browser configured for
 * account A that opens account B's invite link and then abandons the flow (or
 * has the activation rejected, e.g. a spent token) would keep B's mark forever,
 * silently rewriting A's anti-phishing marker. That is precisely the class of
 * side effect the staged-key design exists to prevent ("a setup/recovery flow
 * must NOT touch the account keys until the server-side activation has
 * succeeded", handlers/auth.ts). The token is that same kind of account-scoped
 * state, so it obeys the same rule: nothing is written until the account is
 * really ours.
 *
 * Writing it on EVERY completed flow also closes an existing gap that
 * removeAccount's own comment warns about ("the NEXT account on this device
 * inherits the previous user's chosen mark and the mark stops meaning
 * anything"): the gate-replace path runs through SETUP_COMMIT, which does not
 * clear the key, so account B used to inherit account A's mark. It cannot now.
 *
 * WHY IT MUST NEVER FAIL THE FLOW — the token is display-only, device-local
 * state with no cryptographic role (shared/securityToken.ts: "same trust level
 * as the theme switch"). By the time this runs, the one-time server token is
 * spent and the account key is installed; failing the flow over a decorative
 * preference would strand the user on an error page for nothing. Same argument
 * and same swallow as the greet block inside SETUP_COMMIT itself ("the greet
 * must NEVER be able to fail the commit, so the whole block is swallowed").
 *
 * @returns true when stored; false when it could not be — the caller may show a
 *          non-blocking hint pointing at Settings → Security token.
 */
export async function persistSecurityToken(token: SecurityToken): Promise<boolean> {
  try {
    await setSecurityToken(token);
    return true;
  } catch (err) {
    console.warn('[jpb] security token not saved; the flow continues without it', err);
    return false;
  }
}

// ---------------------------------------------------------------------------
// Passphrase strength (Aegis ppScore parity)
// ---------------------------------------------------------------------------

/**
 * Score a passphrase 0–4:
 *   +1 length >= 8, +1 length >= 14,
 *   +1 has lower AND upper AND digit, +1 has a symbol. Capped at 4.
 */
export function ppScore(p: string): number {
  let s = 0;
  if (p.length >= 8) s++;
  if (p.length >= 14) s++;
  if (/[a-z]/.test(p) && /[A-Z]/.test(p) && /\d/.test(p)) s++;
  if (/[^A-Za-z0-9]/.test(p)) s++;
  return Math.min(4, s);
}

/** Strength labels indexed by ppScore() (0 = empty), locale-aware via t(). */
export function PP_LABEL(score: number): string {
  const labels = [
    '',
    t('app.auth.keygen.strengthLabels.weak'),
    t('app.auth.keygen.strengthLabels.fair'),
    t('app.auth.keygen.strengthLabels.good'),
    t('app.auth.keygen.strengthLabels.strong'),
  ];
  return labels[score] ?? '';
}

// ---------------------------------------------------------------------------
// Display helpers
// ---------------------------------------------------------------------------

/** Pretty-print an armored fingerprint into the spaced 4-char groups Aegis shows. */
export function formatFingerprint(fp: string): string {
  const up = fp.toUpperCase().replace(/\s+/g, '');
  return up.replace(/(.{4})/g, '$1 ').trim();
}

/** Full display name from a profile, falling back to the username. */
export function fullName(user: User | null, fallbackKey = 'app.auth.setup.newMemberFallback'): string {
  return joinName(user?.profile?.first_name, user?.profile?.last_name) || user?.username || t(fallbackKey);
}

/**
 * SETUP_COMMIT `account` payload from the flow-validated user (setup/recover
 * start response). Unlike fullName() this never substitutes localized
 * placeholder text — a missing profile falls back to the raw username, since
 * the value is PERSISTED as the account identity, not just displayed.
 */
export function accountIdentity(
  user: User | null,
): { userId: string; username: string; fullName: string } | undefined {
  if (!user?.username) return undefined;
  return {
    userId: user.id,
    username: user.username,
    fullName: joinName(user.profile?.first_name, user.profile?.last_name) || user.username,
  };
}

// ---------------------------------------------------------------------------
// Stepper
// ---------------------------------------------------------------------------

/**
 * The flow header stepper (flow-steps / fstep / fs-dot / fs-l / fstep-line).
 * `cur` is the active step index; earlier steps render a Check icon (done).
 */
export function Stepper({ steps, cur }: { steps: string[]; cur: number }): JSX.Element {
  return (
    <div className="flow-steps">
      {steps.map((s, i) => (
        <span style={{ display: 'contents' }} key={i}>
          <div className={'fstep ' + (i === cur ? 'on' : i < cur ? 'done' : '')}>
            <span className="fs-dot">{i < cur ? <Check /> : i + 1}</span>
            <span className="fs-l">{s}</span>
          </div>
          {i < steps.length - 1 && (
            <span className={'fstep-line' + (i < cur ? ' done' : '')} />
          )}
        </span>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// KeyGen (visual only)
// ---------------------------------------------------------------------------

export function KeyGen({ onDone }: { onDone: () => void }): JSX.Element {
  const logs = [
    t('app.auth.keygen.logs.entropy'),
    t('app.auth.keygen.logs.generating'),
    t('app.auth.keygen.logs.deriving'),
    t('app.auth.keygen.logs.encrypting'),
    t('app.auth.keygen.logs.done'),
  ];
  const total = 36;
  const [li, setLi] = useState(0);
  const [bits, setBits] = useState(0);

  useEffect(() => {
    const bi = setInterval(() => setBits((b) => Math.min(total, b + 2)), 70);
    const ll = setInterval(
      () =>
        setLi((i) => {
          if (i >= logs.length - 1) {
            clearInterval(ll);
            return i;
          }
          return i + 1;
        }),
      520,
    );
    // Fallback completion so the UI never hangs; the caller's real onDone
    // (fired when the RPC resolves) is the authoritative signal.
    const done = setTimeout(onDone, 2500);
    return () => {
      clearInterval(bi);
      clearInterval(ll);
      clearTimeout(done);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="keygen">
      <div className="keygen-ring">
        <div className="keygen-spin" />
        <div className="kr-core">
          <KeyRound />
        </div>
      </div>
      <div className="keygen-bits">
        {Array.from({ length: total }).map((_, i) => (
          <i key={i} className={i < bits ? 'on' : ''} />
        ))}
      </div>
      <div className="keygen-log" style={{ fontFamily: 'var(--mono)' }}>{logs[li]}</div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Key file picker (SPA components/KeyFileButton.tsx, inlined for this flow)
// ---------------------------------------------------------------------------

/**
 * "Choose .asc file" button that reads the picked file as text and hands it to
 * the caller. The file is read entirely in this page; nothing is uploaded.
 */
export function KeyFileButton({
  onLoaded,
  label,
}: {
  onLoaded: (text: string) => void;
  label?: string;
}): JSX.Element {
  const inputRef = useRef<HTMLInputElement>(null);
  return (
    <>
      <button type="button" className="btn sm" onClick={() => inputRef.current?.click()}>
        <Upload /> {label ?? t('app.auth.setup.key.chooseFile')}
      </button>
      <input
        ref={inputRef}
        type="file"
        accept=".asc,.txt,.key,.pgp"
        style={{ display: 'none' }}
        onChange={async (e) => {
          const f = e.target.files?.[0];
          if (f) onLoaded(await f.text());
          // allow re-picking the same file
          e.target.value = '';
        }}
      />
    </>
  );
}

// ---------------------------------------------------------------------------
// Recovery kit download
// ---------------------------------------------------------------------------

/**
 * Trigger a browser download of the user's armored PRIVATE key as a .asc file —
 * their offline recovery backup. This is the ONE sanctioned place the (still
 * passphrase-protected) private key surfaces in the UI, and it goes only to the
 * user's local disk, never the network.
 */
export function downloadRecoveryKit(filename: string, armoredPrivateKey: string): void {
  const blob = new Blob([armoredPrivateKey], { type: 'application/pgp-keys' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename.endsWith('.asc') ? filename : `${filename}.asc`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  // Release the object URL on the next tick so the click has a chance to start.
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

// ---------------------------------------------------------------------------
// Host-URL correction after a completed setup / recovery
// ---------------------------------------------------------------------------

/**
 * The server-origin vault URL. Setup/recovery run inside the extension-origin
 * iframe the content script mounted over the server's skeleton page, so the HOST
 * tab's address is still the one-time /setup/... token link. We cannot rewrite it
 * from here (cross-origin), so the finish step offers a `target="_top"` link to
 * this URL: the user's click (a real activation) navigates the whole tab to /app,
 * where appBootstrap re-mounts the vault. Returns '' when no server is known, and
 * the caller falls back to in-iframe navigation.
 */
export function enterVaultHref(serverUrl: string | undefined | null): string {
  if (!serverUrl) return '';
  try {
    // Only ever produce an absolute http(s) URL on the configured server origin —
    // never a caller-supplied path (no open-redirect surface).
    const u = new URL(serverUrl);
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return '';
    return u.origin + '/app';
  } catch {
    return '';
  }
}

// ---------------------------------------------------------------------------
// Existing-account replace gate (setup / recovery COMPLETE mode)
// ---------------------------------------------------------------------------

function GateLoading(): JSX.Element {
  return (
    <div className="flow-overlay">
      <div className="flow-card">
        <div
          className="flow-body"
          style={{ display: 'grid', placeItems: 'center', gap: 12, padding: '56px 28px' }}
        >
          <span className="spin-ring" />
          <div style={{ color: 'var(--text-3)', fontSize: 13 }}>{t('app.auth.gate.loading')}</div>
        </div>
      </div>
    </div>
  );
}

/**
 * Blocks a setup/recovery wizard when this browser ALREADY holds an account key,
 * because completing the flow would overwrite it — and the server keeps no copy
 * of a private key, so an unbacked-up replacement is unrecoverable data loss.
 *
 * Renders nothing but a loading card until GET_STATUS answers (so the wizard
 * never flashes for a user who is about to be blocked), then either the block
 * card or `children`. The block card shows WHO this device is bound to, POINTS AT
 * (but does not perform) the key backup, and demands an explicit acknowledgement
 * before letting the user through.
 *
 * It deliberately does NOT export the key itself: a private-key download offered
 * mid-flow reads as a required step of the flow and trains users to save private
 * keys to disk whenever prompted. The export is a self-initiated action in
 * Settings → Keys instead, mirroring official Passbolt's Keys Inspector.
 *
 * `confirmed` is owned by the PAGE (not the gate) because the page must forward
 * it to SETUP_COMMIT as `allowReplace` — the background refuses to overwrite an
 * account key without it, so a bypassed gate still cannot destroy a key.
 *
 * `active` is false for flows that cannot replace anything (recovery REQUEST
 * mode just emails a link), so a signed-in user can still ask for another
 * account's recovery email from the lock screen.
 */
export function ExistingAccountGate({
  active = true,
  confirmed,
  onConfirm,
  children,
}: {
  active?: boolean;
  confirmed: boolean;
  onConfirm: () => void;
  children: ReactNode;
}): JSX.Element {
  const navigate = useNavigate();
  const [status, setStatus] = useState<StatusResult | null>(null);
  const [ack, setAck] = useState(false);

  useEffect(() => {
    if (!active) return;
    let cancelled = false;
    void (async () => {
      try {
        const s = await rpc({ type: 'GET_STATUS' });
        if (!cancelled) setStatus(s);
      } catch {
        // Background unreachable: we cannot prove an account exists here. Fail
        // OPEN into the wizard rather than dead-ending the user — SETUP_COMMIT's
        // own allowReplace guard is the authoritative defence and will still
        // refuse to overwrite a key without an explicit confirmation.
        if (!cancelled) setStatus({ phase: 'no_server', serverUrl: '', account: null });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [active]);

  if (!active || confirmed) return <>{children}</>;
  if (!status) return <GateLoading />;
  // Only a device holding an account KEY can lose one ('locked' = key at rest,
  // 'unlocked' = key in memory too). no_server / no_account have nothing to lose.
  const hasAccount = status.phase === 'locked' || status.phase === 'unlocked';
  if (!hasAccount) return <>{children}</>;

  return (
    <div className="flow-overlay">
      <div className="flow-card">
        <div className="flow-top">
          <div className="flow-brand">
            <span className="lg">
              <BrandMark />
            </span>
            <span className="bn">{t('app.auth.brand')}</span>
          </div>
        </div>

        <div className="flow-body">
          <div className="flow-h">
            <div className="flow-badge">
              <AlertTriangle />
            </div>
            <h2>{t('app.auth.gate.title')}</h2>
            <p>{t('app.auth.gate.subtitle')}</p>
          </div>

          <div className="invite-meta" style={{ marginBottom: 18 }}>
            <div className="invite-line">
              <UserIcon />
              <span className="k">{t('app.auth.gate.boundIdentity')}</span>
              <span className="v">
                {status.account?.fullName || t('app.auth.gate.unknownAccount')}
              </span>
            </div>
            <div className="invite-line">
              <Mail />
              <span className="k">{t('app.auth.gate.usernameLabel')}</span>
              <span className="v" style={{ fontFamily: 'var(--mono)', fontSize: 12.5 }}>
                {status.account?.username ?? ''}
              </span>
            </div>
            <div className="invite-line">
              <Globe />
              <span className="k">{t('app.auth.gate.serverLabel')}</span>
              <span className="v" style={{ fontFamily: 'var(--mono)', fontSize: 12.5 }}>
                {status.serverUrl}
              </span>
            </div>
          </div>

          {status.account?.fingerprint ? (
            <div className="done-fp">
              <div className="dfp-l">
                <Fingerprint /> {t('app.auth.gate.fingerprintLabel')}
              </div>
              <div className="dfp-v">{formatFingerprint(status.account.fingerprint)}</div>
            </div>
          ) : null}

          <div className="warnbox" style={{ margin: '16px 0' }}>
            <AlertTriangle />
            <div>{t('app.auth.gate.warning')}</div>
          </div>

          {/* No key export here by design. A private-key download offered mid-
              flow is the worst possible moment for it: the user is trying to do
              something else, so it reads as a required step and trains them to
              save private keys to disk on prompt. The export lives in Settings →
              Keys instead (the deliberate, self-initiated place for it, matching
              official Passbolt's Keys Inspector), and this only points there. */}
          <div className="kit-row">
            <span className="kr-ico">
              <KeyRound />
            </span>
            <div className="kr-t">
              <div className="a">{t('app.auth.gate.backupTitle')}</div>
              <div className="b">{t('app.auth.gate.backupDesc')}</div>
            </div>
          </div>

          <label
            style={{
              display: 'flex',
              alignItems: 'flex-start',
              gap: 9,
              margin: '18px 0 4px',
              fontSize: 13,
              lineHeight: 1.5,
              color: 'var(--text-2)',
              cursor: 'pointer',
            }}
          >
            <input
              type="checkbox"
              checked={ack}
              onChange={(e) => setAck(e.target.checked)}
              style={{ marginTop: 3, flex: '0 0 auto' }}
            />
            <span>{t('app.auth.gate.ack')}</span>
          </label>

          <div className="flow-foot">
            <button className="btn" onClick={() => navigate('/')}>
              {t('app.auth.gate.back')}
            </button>
            <span className="spacer" />
            <button className="btn primary" disabled={!ack} onClick={onConfirm}>
              {t('app.auth.gate.continue')}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

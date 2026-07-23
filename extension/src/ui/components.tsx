import {
  useCallback,
  useEffect,
  useState,
  type MouseEvent as ReactMouseEvent,
  type ReactNode,
} from 'react';
import { Copy, Dices, Eye, EyeOff, Loader2, Lock, LogIn, Mail, Plus, Power, RefreshCw, Save, Server, ShieldAlert, ShieldCheck, X } from 'lucide-react';
import { rpc, type CreateResourceInput, type StatusResult, type VaultItem } from '../shared/messages';
import { t } from '../shared/i18n';
import { initialsFromName } from '../shared/names';
import { generateTotp, isValidTotp, type TotpConfig } from '../shared/totp';
import {
  DEFAULT_PASSPHRASE_OPTIONS, DEFAULT_PASSWORD_OPTIONS,
  generatePassphrase, generatePassword,
  passphraseEntropyBits, passwordEntropyBits, passwordPoolSize,
  type PassphraseOptions, type PasswordOptions,
} from '../shared/passgen';
import MfaChallenge from '../app/components/MfaChallenge';
import PassphraseInput from '../app/components/PassphraseInput';

// ---- primitives -----------------------------------------------------------
export function Btn(props: {
  children: ReactNode;
  onClick?: (e: ReactMouseEvent<HTMLButtonElement>) => void;
  type?: 'button' | 'submit';
  variant?: 'primary' | 'default' | 'ghost';
  block?: boolean;
  small?: boolean;
  disabled?: boolean;
  title?: string;
}) {
  const cls = [
    'jpb-btn',
    props.variant === 'primary' ? 'jpb-btn-primary' : '',
    props.variant === 'ghost' ? 'jpb-btn-ghost' : '',
    props.block ? 'jpb-btn-block' : '',
    props.small ? 'jpb-btn-sm' : '',
  ].filter(Boolean).join(' ');
  return (
    <button className={cls} type={props.type ?? 'button'} onClick={props.onClick} disabled={props.disabled} title={props.title}>
      {props.children}
    </button>
  );
}

export function ErrorMsg({ text }: { text: string | null }) {
  if (!text) return null;
  return <div className="jpb-error">{text}</div>;
}

export function Spinner({ label }: { label?: string }) {
  return (
    <div className="jpb-center">
      <Loader2 size={22} style={{ animation: 'jpbspin 1s linear infinite' }} />
      {label ? <div className="jpb-muted">{label}</div> : null}
    </div>
  );
}

/**
 * A spinner that stays INVISIBLE for the first ~300ms, then fades in. Used for
 * the GET_STATUS round-trip on cold start: a sub-300ms answer (the common case)
 * shows nothing at all rather than a spinner that flashes for one frame — which,
 * on the full-page surface, is what made the login card blink on every refresh.
 */
export function DelayedSpinner({ label, delayMs = 300 }: { label?: string; delayMs?: number }) {
  const [show, setShow] = useState(false);
  useEffect(() => {
    const h = window.setTimeout(() => setShow(true), delayMs);
    return () => window.clearTimeout(h);
  }, [delayMs]);
  if (!show) return null;
  return <Spinner label={label} />;
}

// ---- status hook ----------------------------------------------------------
export function useStatus() {
  const [status, setStatus] = useState<StatusResult | null>(null);
  const refresh = useCallback(async () => {
    setStatus(await rpc({ type: 'GET_STATUS' }));
  }, []);
  useEffect(() => { void refresh(); }, [refresh]);
  return { status, setStatus, refresh };
}

// ---- flow forms (server -> email-token onboarding -> unlock) --------------
/**
 * Which surface a flow step renders on. The popup is a 380px panel where the
 * steps are plain stacked `jpb-card`s ('compact', the default — omitting the
 * prop keeps the popup's markup byte-for-byte identical). app.html renders them
 * as a centered 460px aegis `flow-card` overlay ('page'), matching the guest
 * setup/recovery wizards. Explicit rather than sniffed from viewport width so
 * the popup can never accidentally inherit the full-page treatment.
 */
export type FlowSurface = 'compact' | 'page';

export function ServerForm({ initial, onDone, surface }: {
  initial?: string;
  onDone: (s: StatusResult) => void;
  surface?: FlowSurface;
}) {
  const [url, setUrl] = useState(initial ?? 'http://localhost:8090');
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const submit = async () => {
    setErr(null); setBusy(true);
    try { onDone(await rpc({ type: 'SET_SERVER', serverUrl: url })); }
    catch (e) { setErr(e instanceof Error ? e.message : String(e)); }
    finally { setBusy(false); }
  };
  return (
    // 'page': FlowFrame's .flow-body already supplies the card + padding, so a
    // nested .jpb-card here would render a card-in-a-card.
    <div className={surface === 'page' ? undefined : 'jpb-card'}>
      <div className="jpb-h2"><Server size={16} style={{ verticalAlign: '-2px', marginRight: 6 }} />{t('server.title')}</div>
      <p className="jpb-muted">{t('server.intro')}</p>
      <div className="jpb-field" style={{ marginTop: 12 }}>
        <label className="jpb-label">{t('server.label')}</label>
        <input className="jpb-input" value={url} onChange={(e) => setUrl(e.target.value)} placeholder={t('server.placeholder')} />
      </div>
      <ErrorMsg text={err} />
      <Btn variant="primary" block onClick={submit} disabled={busy}>{busy ? t('server.saving') : t('common.continue')}</Btn>
    </div>
  );
}

/**
 * The no_account onboarding card. Arbitrary private-key import is deliberately
 * GONE (official parity: provisioning a new person always goes through an
 * emailed setup/recovery token, never a pasted key) — this card just points the
 * user at their invitation/recovery email, with a shortcut to request a recovery
 * email. `onRecover` routes to the recovery-request flow; when it is absent the
 * button is hidden (the caller has no reachable recovery route).
 */
export function NoAccountGuide({ onRecover, surface }: { onRecover?: () => void; surface?: FlowSurface }) {
  return (
    <div className={surface === 'page' ? undefined : 'jpb-card'}>
      <div className="jpb-h2"><Mail size={16} style={{ verticalAlign: '-2px', marginRight: 6 }} />{t('noaccount.title')}</div>
      <p className="jpb-muted">{t('noaccount.body')}</p>
      {onRecover ? (
        <Btn variant="primary" block onClick={onRecover}>{t('noaccount.sendRecovery')}</Btn>
      ) : null}
    </div>
  );
}

/**
 * Wraps a flow step in the surface's chrome.
 *
 * 'compact' (popup) returns the children untouched — the popup keeps stacking
 * bare `jpb-card`s inside its own `.jpb-body`, exactly as before.
 *
 * 'page' (app.html) reproduces the guest wizards' shell: a fixed, full-viewport
 * `.flow-overlay` centering a 460px `.flow-card` with the brand header. The card
 * must stay a DIRECT child of the overlay — `.flow-card{margin:auto}` is what
 * stops `place-items:center` from clipping the top of over-tall content while
 * scrolling, and an intermediate wrapper would break it.
 */
function FlowFrame({ surface, children }: { surface: FlowSurface; children: ReactNode }) {
  if (surface === 'compact') return <>{children}</>;
  return (
    <div className="flow-overlay">
      <div className="flow-card">
        <div className="flow-top">
          <div className="flow-brand">
            {/* Bare tag: aegis sizes brand icons via `.flow-brand .lg svg`, so an
                explicit size= (the jpb-* convention) would break alignment. */}
            <span className="lg"><ShieldCheck /></span>
            <span className="bn">{t('app.auth.brand')}</span>
          </div>
        </div>
        <div className="flow-body">{children}</div>
      </div>
    </div>
  );
}

export function UnlockForm({ account, onDone, onRecover, surface }: {
  account: StatusResult['account'];
  onDone: (s: StatusResult) => void;
  onRecover?: () => void;
  surface?: FlowSurface;
}) {
  const [pass, setPass] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [recoverSent, setRecoverSent] = useState(false);
  // Official state-D login card shows WHO is signing in: initials avatar +
  // full name + email, not just a "signed in as" line.
  const initials = initialsFromName(account?.fullName || account?.username || '?');
  const submit = async (e?: React.FormEvent) => {
    e?.preventDefault();
    setErr(null); setBusy(true);
    try { onDone(await rpc({ type: 'UNLOCK', passphrase: pass })); setPass(''); }
    catch (e2) { setErr(e2 instanceof Error ? e2.message : String(e2)); }
    finally { setBusy(false); }
  };
  // "Help, I lost my passphrase." (official parity): self-service account
  // recover — fire the same enumeration-safe endpoint the server's state-A
  // email triage uses, for the account we already know, then point the user
  // at their mailbox. Flip the flash first: the endpoint always answers
  // success by design, so there is nothing to conditionally report.
  const lostPassphrase = () => {
    // Only a server-VERIFIED account may drive this POST. An unverified greet's
    // serverUrl is an unverified guess — possibly an attacker origin adopted via
    // a guest link — so POSTing the username there would disclose the email to it.
    if (!account?.verified || recoverSent) return;
    setRecoverSent(true);
    void fetch(`${account.serverUrl}/api/users/recover.json`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ username: account.username }),
    }).catch(() => undefined);
  };
  return (
    // 'page': a bare <form> is display:block and contributes no box of its own,
    // so it drops cleanly into FlowFrame's .flow-body (onSubmit/Enter unchanged).
    <form className={surface === 'page' ? undefined : 'jpb-card'} onSubmit={submit}>
      <div className="jpb-h2"><Lock size={16} style={{ verticalAlign: '-2px', marginRight: 6 }} />{t('unlock.title')}</div>
      {account ? (
        <div className="jpb-account">
          <div className="jpb-avatar">{initials}</div>
          <div>
            <div className="an">{account.fullName}</div>
            <div className="ae">{account.username}</div>
          </div>
        </div>
      ) : (
        <p className="jpb-muted">{t('unlock.enterPassphrase')}</p>
      )}
      <div className="jpb-field" style={{ marginTop: 12 }}>
        <label className="jpb-label">{t('unlock.passphrase')}</label>
        {/* PassphraseInput anchors the security token badge INSIDE the field (not
            page chrome a host page could forge) and tints the focus ring to the
            token's colour — markers a phishing look-alike cannot reproduce
            (white-paper SP-27). It reads the stored mark itself (no token prop). */}
        <PassphraseInput value={pass} onChange={setPass} autoFocus compact autoComplete="current-password" />
      </div>
      <ErrorMsg text={err} />
      <Btn type="submit" variant="primary" block disabled={busy || !pass}>{busy ? t('unlock.signingIn') : t('unlock.signIn')}</Btn>
      <div style={{ textAlign: 'center', marginTop: 10, display: 'grid', gap: 6 }}>
        {recoverSent
          ? <span className="jpb-muted">{t('unlock.recoverSent')}</span>
          : account?.verified && <button type="button" className="jpb-link" onClick={lostPassphrase}>{t('unlock.lostPassphrase')}</button>}
        {/* Signing in as someone else goes through the emailed recovery token,
            NOT a one-click account wipe: the local key stays until the new
            account's setup/recovery flow explicitly confirms replacing it. */}
        {onRecover ? (
          <button type="button" className="jpb-link" onClick={onRecover}>{t('unlock.switchAccount')}</button>
        ) : null}
      </div>
    </form>
  );
}

/**
 * Renders the right onboarding/unlock step for the current phase, or the
 * children once the vault is unlocked. Centralizes the flow for popup + app.
 *
 * `onRecover` opens the recovery-request flow. It is caller-supplied because the
 * route differs per surface: the app iframe navigates its hash router, while the
 * popup (no router) opens app.html at that route in a tab.
 *
 * `surface` picks the chrome (see FlowSurface). It defaults to 'compact' so the
 * popup keeps its existing rendering without passing anything.
 */
export function Flow({ status, onChange, onRecover, children, surface = 'compact' }: {
  status: StatusResult | null;
  onChange: (s: StatusResult) => void;
  onRecover?: () => void;
  surface?: FlowSurface;
  children: ReactNode;
}) {
  // First paint, before GET_STATUS answers. On 'page' we must NOT render the
  // flow-card/brand header here: that is the login card's own shell, and showing
  // it for the one frame before status arrives is exactly what made the login box
  // blink on every refresh. Render only the .flow-overlay background (same app
  // gradient) with a DelayedSpinner — a sub-300ms load stays silent. The popup
  // ('compact') keeps its original framed spinner byte-for-byte.
  if (!status) {
    if (surface === 'page') {
      return (
        <div className="flow-overlay">
          <DelayedSpinner label={t('flow.loading')} />
        </div>
      );
    }
    return <FlowFrame surface={surface}><Spinner label={t('flow.loading')} /></FlowFrame>;
  }
  // Login-time MFA gate: UNLOCK (or GET_STATUS while a challenge is parked in
  // the worker) reports phase:'locked' + mfa.required — the session's pending
  // JWT lives only in background memory until MFA_VERIFY succeeds. Cancelling
  // sends LOCK, which wipes the parked challenge and falls back to UnlockForm.
  if (status.mfa?.required) {
    return (
      <MfaChallenge
        onDone={onChange}
        onCancel={async () => onChange(await rpc({ type: 'LOCK' }))}
      />
    );
  }
  switch (status.phase) {
    case 'no_server':
      return (
        <FlowFrame surface={surface}>
          <ServerForm onDone={onChange} surface={surface} />
        </FlowFrame>
      );
    case 'no_account':
      // Two steps in one frame. In the popup they are two cards separated by
      // .jpb-body's gap; inside a single flow-card that gap is gone, so the
      // second gets the hairline divider used elsewhere in the design system
      // (.mfa-method + .mfa-method, .session-row + .session-row) — existing
      // --border token, no new class.
      return (
        <FlowFrame surface={surface}>
          <ServerForm initial={status.serverUrl} onDone={onChange} surface={surface} />
          {surface === 'page' ? (
            <div style={{ marginTop: 20, paddingTop: 20, borderTop: '1px solid var(--border)' }}>
              <NoAccountGuide onRecover={onRecover} surface={surface} />
            </div>
          ) : (
            <NoAccountGuide onRecover={onRecover} surface={surface} />
          )}
        </FlowFrame>
      );
    case 'locked':
      return (
        <FlowFrame surface={surface}>
          <UnlockForm account={status.account} onDone={onChange} onRecover={onRecover} surface={surface} />
        </FlowFrame>
      );
    case 'unlocked':
      // Never framed: the app hands off to AppLayout, the popup to Quickaccess.
      return <>{children}</>;
    default:
      return null;
  }
}

export function Header({ account, onLock, onSignOut, right }: {
  account: StatusResult['account'];
  onLock?: () => void;
  /**
   * Official quickaccess parity: the power button in the top-right. It ends the
   * SESSION (LOGOUT semantics — locks and drops the JWT, keeps the account key),
   * which is what the official popup's power icon does. Rendered last so it sits
   * at the far right like the original. Callers that want the padlock instead
   * keep passing `onLock`; passing both renders both.
   */
  onSignOut?: () => void;
  right?: ReactNode;
}) {
  return (
    <header className="jpb-header">
      <div className="jpb-logo">JP</div>
      <div>
        <div className="jpb-title">JPassbolt</div>
        {account ? <div className="jpb-sub">{account.username}</div> : null}
      </div>
      <div className="jpb-spacer" />
      {right}
      {onLock ? (
        <Btn small variant="ghost" onClick={onLock} title={t('header.lockVault')}><Lock size={14} /></Btn>
      ) : null}
      {onSignOut ? (
        <Btn small variant="ghost" onClick={onSignOut} title={t('header.signOut')}><Power size={14} /></Btn>
      ) : null}
    </header>
  );
}

// ---- vault data hook ------------------------------------------------------
export function useVault(active: boolean) {
  const [items, setItems] = useState<VaultItem[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const load = useCallback(async (force = false) => {
    setErr(null);
    try { setItems((await rpc({ type: 'LIST', force })).items); }
    catch (e) { setErr(e instanceof Error ? e.message : String(e)); }
  }, []);
  useEffect(() => { if (active) void load(); }, [active, load]);
  return { items, err, reload: load };
}

export function initials(name: string): string {
  const t = name.trim();
  return t ? t[0].toUpperCase() : '?';
}

// ---- TOTP live code -------------------------------------------------------
/** Ticks the current TOTP code once a second; null when there is no valid config. */
export function useTotp(cfg?: TotpConfig | null) {
  const [state, setState] = useState<{ code: string; expiresInSec: number; period: number } | null>(null);
  const key = isValidTotp(cfg) ? `${cfg.secret_key}|${cfg.period}|${cfg.digits}|${cfg.algorithm}` : '';
  useEffect(() => {
    if (!isValidTotp(cfg)) { setState(null); return; }
    let alive = true;
    const tick = async () => {
      try { const r = await generateTotp(cfg); if (alive) setState(r); }
      catch { if (alive) setState(null); }
    };
    void tick();
    const h = setInterval(tick, 1000);
    return () => { alive = false; clearInterval(h); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  return state;
}

export function TotpView({ cfg, onCopy, onFill }: {
  cfg: TotpConfig;
  onCopy: (code: string) => void;
  onFill?: () => void;
}) {
  const tick = useTotp(cfg);
  if (!tick) return null;
  const pretty = tick.code.length === 6 ? `${tick.code.slice(0, 3)} ${tick.code.slice(3)}` : tick.code;
  return (
    <div className="jpb-field" style={{ margin: 0 }}>
      <span className="jpb-label">{t('totp.label')}</span>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <div className="jpb-secret-val" style={{ flex: 1, fontSize: 18, letterSpacing: '0.12em' }}>{pretty}</div>
        <span className="jpb-totp-clock" title={t('totp.secondsUntilRefresh')}>{tick.expiresInSec}s</span>
        <Btn small variant="ghost" title={t('totp.copyCode')} onClick={() => onCopy(tick.code)}><Copy size={14} /></Btn>
        {onFill ? <Btn small variant="ghost" title={t('totp.fillCodeOnPage')} onClick={onFill}><LogIn size={14} /></Btn> : null}
      </div>
    </div>
  );
}

// ---- strength labelling (shared by generator + create form) ---------------
// Tiers mirror the official styleguide ENTROPY_THRESHOLDS (not_available 0 /
// very-weak >=1 / weak >=60 / fair >=80 / strong >=112 / very-strong >=128).
export function strengthFromEntropy(bits: number): { label: string; cls: string } {
  if (bits >= 128) return { label: t('strength.veryStrong'), cls: 'very-strong' };
  if (bits >= 112) return { label: t('strength.strong'), cls: 'strong' };
  if (bits >= 80) return { label: t('strength.fair'), cls: 'fair' };
  if (bits >= 60) return { label: t('strength.weak'), cls: 'weak' };
  if (bits >= 1) return { label: t('strength.veryWeak'), cls: 'very-weak' };
  return { label: t('strength.notAvailable'), cls: 'na' };
}

// ---- password / passphrase generator --------------------------------------
export function PasswordGenerator({ onUse }: { onUse?: (value: string) => void }) {
  const [mode, setMode] = useState<'password' | 'passphrase'>('password');
  const [pw, setPw] = useState<PasswordOptions>(DEFAULT_PASSWORD_OPTIONS);
  const [pp, setPp] = useState<PassphraseOptions>(DEFAULT_PASSPHRASE_OPTIONS);
  const [value, setValue] = useState('');
  const [pwned, setPwned] = useState<number | null>(null);
  const [checking, setChecking] = useState(false);

  const regen = useCallback(() => {
    setValue(mode === 'password' ? generatePassword(pw) : generatePassphrase(pp));
    setPwned(null);
  }, [mode, pw, pp]);
  useEffect(() => { regen(); }, [regen]);

  const entropy = mode === 'password'
    ? passwordEntropyBits(pw.length, passwordPoolSize(pw))
    : passphraseEntropyBits(pp.words);
  const strength = strengthFromEntropy(entropy);

  const copy = async () => { try { await rpc({ type: 'COPY', text: value, temporary: true }); } catch { /* ignore */ } };
  const check = async () => {
    setChecking(true);
    try { setPwned((await rpc({ type: 'PWNED', password: value })).count); }
    catch { setPwned(-1); }
    finally { setChecking(false); }
  };
  const toggle = (k: keyof PasswordOptions) => setPw((o) => ({ ...o, [k]: !o[k] }));

  return (
    <div className="jpb-card">
      <div className="jpb-h2"><Dices size={16} style={{ verticalAlign: '-2px', marginRight: 6 }} />{t('gen.title')}</div>

      <div style={{ display: 'flex', gap: 6, margin: '4px 0 12px' }}>
        <Btn small variant={mode === 'password' ? 'primary' : 'default'} onClick={() => setMode('password')}>{t('gen.password')}</Btn>
        <Btn small variant={mode === 'passphrase' ? 'primary' : 'default'} onClick={() => setMode('passphrase')}>{t('gen.passphrase')}</Btn>
      </div>

      <div className="jpb-secret-val" style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 14, wordBreak: 'break-all' }}>
        <span style={{ flex: 1 }}>{value}</span>
        <Btn small variant="ghost" title={t('gen.regenerate')} onClick={regen}><RefreshCw size={14} /></Btn>
        <Btn small variant="ghost" title={t('gen.copy')} onClick={copy}><Copy size={14} /></Btn>
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: 8, margin: '8px 0' }}>
        <span className={`jpb-strength ${strength.cls}`}>{strength.label}</span>
        <span className="jpb-muted" style={{ fontSize: 12 }}>{t('gen.bits', { bits: entropy })}</span>
        <span style={{ flex: 1 }} />
        <Btn small variant="ghost" onClick={check} disabled={checking || !value}>{checking ? t('detail.checking') : t('gen.checkBreaches')}</Btn>
      </div>
      {pwned !== null ? (
        pwned === -1 ? <div className="jpb-muted" style={{ fontSize: 12 }}>{t('breach.unavailable')}</div>
          : pwned === 0 ? <div className="jpb-ok">{t('breach.notFound')}</div>
            : <div className="jpb-error">{t('breach.foundChooseAnother', { count: pwned.toLocaleString() })}</div>
      ) : null}

      {mode === 'password' ? (
        <div style={{ marginTop: 10 }}>
          <label className="jpb-label" style={{ display: 'block', marginBottom: 6 }}>{t('gen.length', { n: pw.length })}</label>
          <input type="range" min={8} max={64} value={pw.length} onChange={(e) => setPw((o) => ({ ...o, length: Number(e.target.value) }))} style={{ width: '100%' }} />
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, marginTop: 8, fontSize: 13 }}>
            <label><input type="checkbox" checked={pw.upper} onChange={() => toggle('upper')} /> A-Z</label>
            <label><input type="checkbox" checked={pw.lower} onChange={() => toggle('lower')} /> a-z</label>
            <label><input type="checkbox" checked={pw.digits} onChange={() => toggle('digits')} /> 0-9</label>
            <label><input type="checkbox" checked={pw.special} onChange={() => toggle('special')} /> !@#</label>
            <label><input type="checkbox" checked={pw.excludeLookAlike} onChange={() => toggle('excludeLookAlike')} /> {t('gen.noLookAlikes')}</label>
          </div>
        </div>
      ) : (
        <div style={{ marginTop: 10 }}>
          <label className="jpb-label" style={{ display: 'block', marginBottom: 6 }}>{t('gen.words', { n: pp.words })}</label>
          <input type="range" min={4} max={16} value={pp.words} onChange={(e) => setPp((o) => ({ ...o, words: Number(e.target.value) }))} style={{ width: '100%' }} />
          <div style={{ display: 'flex', gap: 8, marginTop: 8, alignItems: 'center', fontSize: 13 }}>
            <span>{t('gen.separator')}</span>
            <input className="jpb-input" style={{ width: 60, height: 30 }} maxLength={3} value={pp.separator} onChange={(e) => setPp((o) => ({ ...o, separator: e.target.value }))} />
            <select className="jpb-input" style={{ height: 30, width: 'auto' }} value={pp.wordCase} onChange={(e) => setPp((o) => ({ ...o, wordCase: e.target.value as PassphraseOptions['wordCase'] }))}>
              <option value="lower">{t('gen.case.lower')}</option>
              <option value="capitalize">{t('gen.case.capitalize')}</option>
              <option value="upper">{t('gen.case.upper')}</option>
            </select>
          </div>
        </div>
      )}

      {onUse ? (
        <div style={{ marginTop: 12 }}>
          <Btn variant="primary" block onClick={() => onUse(value)}>{t('gen.useThis')}</Btn>
        </div>
      ) : null}
    </div>
  );
}

// ---- create-resource form (shared by manual "New" + post-login autosave) --
/** Rough Shannon-entropy estimate for a *typed* password from observed classes. */
export function observedEntropy(pw: string): number {
  if (!pw) return 0;
  let pool = 0;
  if (/[a-z]/.test(pw)) pool += 26;
  if (/[A-Z]/.test(pw)) pool += 26;
  if (/[0-9]/.test(pw)) pool += 10;
  if (/[^a-zA-Z0-9]/.test(pw)) pool += 33;
  return passwordEntropyBits(pw.length, pool || 1);
}

/**
 * Create a password resource. The plaintext password/description are sent to the
 * background in a single CREATE_RESOURCE rpc, which encrypts+signs them for the
 * user's own key before POSTing — nothing here ever touches the server directly.
 * `initial` pre-fills the form (used by autosave / "save current page").
 */
export function CreateResourceForm({ initial, onCreated, onCancel, compact }: {
  initial?: Partial<CreateResourceInput>;
  onCreated: (item: VaultItem) => void;
  onCancel?: () => void;
  compact?: boolean;
}) {
  const [name, setName] = useState(initial?.name ?? '');
  const [username, setUsername] = useState(initial?.username ?? '');
  const [uri, setUri] = useState(initial?.uri ?? '');
  const [password, setPassword] = useState(initial?.password ?? '');
  const [description, setDescription] = useState(initial?.description ?? '');
  const [showPw, setShowPw] = useState(false);
  const [showGen, setShowGen] = useState(false);
  const [pwned, setPwned] = useState<number | null>(null);
  const [checking, setChecking] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const strength = strengthFromEntropy(observedEntropy(password));
  const canSubmit = name.trim().length > 0 && password.length > 0 && !busy;

  const check = async () => {
    if (!password) return;
    setChecking(true);
    try { setPwned((await rpc({ type: 'PWNED', password })).count); }
    catch { setPwned(-1); }
    finally { setChecking(false); }
  };

  const submit = async () => {
    if (!canSubmit) return;
    setErr(null); setBusy(true);
    try {
      const { item } = await rpc({
        type: 'CREATE_RESOURCE',
        input: { name: name.trim(), username: username.trim(), uri: uri.trim(), password, description },
      });
      onCreated(item);
    } catch (e) { setErr(e instanceof Error ? e.message : String(e)); }
    finally { setBusy(false); }
  };

  return (
    <div className={compact ? '' : 'jpb-card'}>
      <div className="jpb-h2"><Plus size={16} style={{ verticalAlign: '-2px', marginRight: 6 }} />{t('create.title')}</div>

      <div className="jpb-field" style={{ marginTop: 8 }}>
        <label className="jpb-label">{t('create.name')}</label>
        <input className="jpb-input" value={name} autoFocus onChange={(e) => setName(e.target.value)} placeholder={t('create.namePlaceholder')} />
      </div>
      <div className="jpb-field">
        <label className="jpb-label">{t('create.username')}</label>
        <input className="jpb-input" value={username} onChange={(e) => setUsername(e.target.value)} placeholder={t('create.usernamePlaceholder')} />
      </div>
      <div className="jpb-field">
        <label className="jpb-label">{t('create.website')}</label>
        <input className="jpb-input" value={uri} onChange={(e) => setUri(e.target.value)} placeholder={t('create.websitePlaceholder')} />
      </div>

      <div className="jpb-field">
        <label className="jpb-label">{t('create.passwordRequired')}</label>
        <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
          <input
            className="jpb-input"
            style={{ flex: 1 }}
            type={showPw ? 'text' : 'password'}
            value={password}
            onChange={(e) => { setPassword(e.target.value); setPwned(null); }}
            placeholder={t('create.passwordPlaceholder')}
          />
          <Btn small variant="ghost" title={showPw ? t('detail.hide') : t('detail.show')} onClick={() => setShowPw((s) => !s)}>{showPw ? <EyeOff size={14} /> : <Eye size={14} />}</Btn>
          <Btn small variant="ghost" title={t('create.generator')} onClick={() => setShowGen((s) => !s)}><Dices size={14} /></Btn>
        </div>
        {password ? (
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 6 }}>
            <span className={`jpb-strength ${strength.cls}`}>{strength.label}</span>
            <span style={{ flex: 1 }} />
            <Btn small variant="ghost" onClick={check} disabled={checking}><ShieldAlert size={13} /> {checking ? t('detail.checking') : t('detail.breachCheck')}</Btn>
          </div>
        ) : null}
        {pwned !== null ? (
          pwned === -1 ? <div className="jpb-muted" style={{ fontSize: 12 }}>{t('breach.unavailable')}</div>
            : pwned === 0 ? <div className="jpb-ok">{t('breach.notFound')}</div>
              : <div className="jpb-error">{t('breach.foundChooseAnother', { count: pwned.toLocaleString() })}</div>
        ) : null}
      </div>

      {showGen ? (
        <PasswordGenerator onUse={(v) => { setPassword(v); setPwned(null); setShowGen(false); setShowPw(true); }} />
      ) : null}

      <div className="jpb-field">
        <label className="jpb-label">{t('detail.description')}</label>
        <textarea className="jpb-textarea" value={description} onChange={(e) => setDescription(e.target.value)} placeholder={t('create.descriptionPlaceholder')} />
      </div>

      <ErrorMsg text={err} />
      <div style={{ display: 'flex', gap: 8, marginTop: 4 }}>
        <Btn variant="primary" block onClick={submit} disabled={!canSubmit}><Save size={14} /> {busy ? t('create.saving') : t('create.savePassword')}</Btn>
        {onCancel ? <Btn variant="ghost" onClick={onCancel} title={t('common.cancel')}><X size={14} /></Btn> : null}
      </div>
    </div>
  );
}

export { ShieldCheck };

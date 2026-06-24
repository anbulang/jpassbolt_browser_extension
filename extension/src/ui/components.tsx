import {
  useCallback,
  useEffect,
  useState,
  type ReactNode,
} from 'react';
import { Copy, Dices, KeyRound, Loader2, Lock, LogIn, RefreshCw, Server, ShieldCheck } from 'lucide-react';
import { rpc, type StatusResult, type VaultItem } from '../shared/messages';
import { generateTotp, isValidTotp, type TotpConfig } from '../shared/totp';
import {
  DEFAULT_PASSPHRASE_OPTIONS, DEFAULT_PASSWORD_OPTIONS,
  generatePassphrase, generatePassword,
  passphraseEntropyBits, passwordEntropyBits, passwordPoolSize,
  type PassphraseOptions, type PasswordOptions,
} from '../shared/passgen';

// ---- primitives -----------------------------------------------------------
export function Btn(props: {
  children: ReactNode;
  onClick?: () => void;
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

// ---- status hook ----------------------------------------------------------
export function useStatus() {
  const [status, setStatus] = useState<StatusResult | null>(null);
  const refresh = useCallback(async () => {
    setStatus(await rpc({ type: 'GET_STATUS' }));
  }, []);
  useEffect(() => { void refresh(); }, [refresh]);
  return { status, setStatus, refresh };
}

// ---- flow forms (server -> import key -> unlock) --------------------------
export function ServerForm({ initial, onDone }: { initial?: string; onDone: (s: StatusResult) => void }) {
  const [url, setUrl] = useState(initial ?? 'http://localhost:8080');
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const submit = async () => {
    setErr(null); setBusy(true);
    try { onDone(await rpc({ type: 'SET_SERVER', serverUrl: url })); }
    catch (e) { setErr(e instanceof Error ? e.message : String(e)); }
    finally { setBusy(false); }
  };
  return (
    <div className="jpb-card">
      <div className="jpb-h2"><Server size={16} style={{ verticalAlign: '-2px', marginRight: 6 }} />Connect to your server</div>
      <p className="jpb-muted">Enter the URL of your JPassbolt server.</p>
      <div className="jpb-field" style={{ marginTop: 12 }}>
        <label className="jpb-label">Server URL</label>
        <input className="jpb-input" value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://passbolt.example.com" />
      </div>
      <ErrorMsg text={err} />
      <Btn variant="primary" block onClick={submit} disabled={busy}>{busy ? 'Saving…' : 'Continue'}</Btn>
    </div>
  );
}

export function KeyImportForm({ onDone }: { onDone: (s: StatusResult) => void }) {
  const [key, setKey] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const submit = async () => {
    setErr(null); setBusy(true);
    try { onDone(await rpc({ type: 'IMPORT_KEY', armoredPrivateKey: key })); }
    catch (e) { setErr(e instanceof Error ? e.message : String(e)); }
    finally { setBusy(false); }
  };
  const onFile = async (f: File | null) => { if (f) setKey(await f.text()); };
  return (
    <div className="jpb-card">
      <div className="jpb-h2"><KeyRound size={16} style={{ verticalAlign: '-2px', marginRight: 6 }} />Import your private key</div>
      <p className="jpb-muted">Paste your passphrase-protected OpenPGP private key. It is stored only in the extension and never leaves your browser.</p>
      <div className="jpb-field" style={{ marginTop: 12 }}>
        <label className="jpb-label">Armored private key</label>
        <textarea className="jpb-textarea" value={key} onChange={(e) => setKey(e.target.value)} placeholder="-----BEGIN PGP PRIVATE KEY BLOCK-----" />
      </div>
      <input type="file" accept=".asc,.txt,.key,.pgp" onChange={(e) => onFile(e.target.files?.[0] ?? null)} style={{ fontSize: 12, marginBottom: 12 }} />
      <ErrorMsg text={err} />
      <Btn variant="primary" block onClick={submit} disabled={busy || !key.trim()}>{busy ? 'Importing…' : 'Import key'}</Btn>
    </div>
  );
}

export function UnlockForm({ account, onDone, onLogout }: {
  account: StatusResult['account'];
  onDone: (s: StatusResult) => void;
  onLogout: () => void;
}) {
  const [pass, setPass] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const submit = async (e?: React.FormEvent) => {
    e?.preventDefault();
    setErr(null); setBusy(true);
    try { onDone(await rpc({ type: 'UNLOCK', passphrase: pass })); setPass(''); }
    catch (e2) { setErr(e2 instanceof Error ? e2.message : String(e2)); }
    finally { setBusy(false); }
  };
  return (
    <form className="jpb-card" onSubmit={submit}>
      <div className="jpb-h2"><Lock size={16} style={{ verticalAlign: '-2px', marginRight: 6 }} />Unlock your vault</div>
      <p className="jpb-muted">{account ? `Signed in as ${account.username}` : 'Enter your passphrase to unlock.'}</p>
      <div className="jpb-field" style={{ marginTop: 12 }}>
        <label className="jpb-label">Passphrase</label>
        <input className="jpb-input" type="password" autoFocus value={pass} onChange={(e) => setPass(e.target.value)} />
      </div>
      <ErrorMsg text={err} />
      <Btn type="submit" variant="primary" block disabled={busy || !pass}>{busy ? 'Unlocking…' : 'Unlock'}</Btn>
      <div style={{ textAlign: 'center', marginTop: 10 }}>
        <button type="button" className="jpb-link" onClick={onLogout}>Use a different account</button>
      </div>
    </form>
  );
}

/**
 * Renders the right onboarding/unlock step for the current phase, or the
 * children once the vault is unlocked. Centralizes the flow for popup + app.
 */
export function Flow({ status, onChange, children }: {
  status: StatusResult | null;
  onChange: (s: StatusResult) => void;
  children: ReactNode;
}) {
  const logout = async () => onChange(await rpc({ type: 'LOGOUT' }));
  if (!status) return <Spinner label="Loading…" />;
  switch (status.phase) {
    case 'no_server':
      return <ServerForm onDone={onChange} />;
    case 'no_account':
      return (
        <>
          <ServerForm initial={status.serverUrl} onDone={onChange} />
          <KeyImportForm onDone={onChange} />
        </>
      );
    case 'locked':
      return <UnlockForm account={status.account} onDone={onChange} onLogout={logout} />;
    case 'unlocked':
      return <>{children}</>;
    default:
      return null;
  }
}

export function Header({ account, onLock, right }: {
  account: StatusResult['account'];
  onLock?: () => void;
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
        <Btn small variant="ghost" onClick={onLock} title="Lock vault"><Lock size={14} /></Btn>
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
  const t = useTotp(cfg);
  if (!t) return null;
  const pretty = t.code.length === 6 ? `${t.code.slice(0, 3)} ${t.code.slice(3)}` : t.code;
  return (
    <div className="jpb-field" style={{ margin: 0 }}>
      <span className="jpb-label">Verification code (TOTP)</span>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <div className="jpb-secret-val" style={{ flex: 1, fontSize: 18, letterSpacing: '0.12em' }}>{pretty}</div>
        <span className="jpb-totp-clock" title="Seconds until refresh">{t.expiresInSec}s</span>
        <Btn small variant="ghost" title="Copy code" onClick={() => onCopy(t.code)}><Copy size={14} /></Btn>
        {onFill ? <Btn small variant="ghost" title="Fill code on page" onClick={onFill}><LogIn size={14} /></Btn> : null}
      </div>
    </div>
  );
}

// ---- strength labelling (shared by generator + create form) ---------------
export function strengthFromEntropy(bits: number): { label: string; cls: string } {
  if (bits < 60) return { label: 'Weak', cls: 'weak' };
  if (bits < 80) return { label: 'Fair', cls: 'fair' };
  if (bits < 120) return { label: 'Strong', cls: 'strong' };
  return { label: 'Excellent', cls: 'excellent' };
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
      <div className="jpb-h2"><Dices size={16} style={{ verticalAlign: '-2px', marginRight: 6 }} />Password generator</div>

      <div style={{ display: 'flex', gap: 6, margin: '4px 0 12px' }}>
        <Btn small variant={mode === 'password' ? 'primary' : 'default'} onClick={() => setMode('password')}>Password</Btn>
        <Btn small variant={mode === 'passphrase' ? 'primary' : 'default'} onClick={() => setMode('passphrase')}>Passphrase</Btn>
      </div>

      <div className="jpb-secret-val" style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 14, wordBreak: 'break-all' }}>
        <span style={{ flex: 1 }}>{value}</span>
        <Btn small variant="ghost" title="Regenerate" onClick={regen}><RefreshCw size={14} /></Btn>
        <Btn small variant="ghost" title="Copy" onClick={copy}><Copy size={14} /></Btn>
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: 8, margin: '8px 0' }}>
        <span className={`jpb-strength ${strength.cls}`}>{strength.label}</span>
        <span className="jpb-muted" style={{ fontSize: 12 }}>~{entropy} bits</span>
        <span style={{ flex: 1 }} />
        <Btn small variant="ghost" onClick={check} disabled={checking || !value}>{checking ? 'Checking…' : 'Check breaches'}</Btn>
      </div>
      {pwned !== null ? (
        pwned === -1 ? <div className="jpb-muted" style={{ fontSize: 12 }}>Breach check unavailable.</div>
          : pwned === 0 ? <div className="jpb-ok">Not found in known breaches.</div>
            : <div className="jpb-error">Found in {pwned.toLocaleString()} known breaches — choose another.</div>
      ) : null}

      {mode === 'password' ? (
        <div style={{ marginTop: 10 }}>
          <label className="jpb-label" style={{ display: 'block', marginBottom: 6 }}>Length: {pw.length}</label>
          <input type="range" min={8} max={64} value={pw.length} onChange={(e) => setPw((o) => ({ ...o, length: Number(e.target.value) }))} style={{ width: '100%' }} />
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, marginTop: 8, fontSize: 13 }}>
            <label><input type="checkbox" checked={pw.upper} onChange={() => toggle('upper')} /> A-Z</label>
            <label><input type="checkbox" checked={pw.lower} onChange={() => toggle('lower')} /> a-z</label>
            <label><input type="checkbox" checked={pw.digits} onChange={() => toggle('digits')} /> 0-9</label>
            <label><input type="checkbox" checked={pw.special} onChange={() => toggle('special')} /> !@#</label>
            <label><input type="checkbox" checked={pw.excludeLookAlike} onChange={() => toggle('excludeLookAlike')} /> No look-alikes</label>
          </div>
        </div>
      ) : (
        <div style={{ marginTop: 10 }}>
          <label className="jpb-label" style={{ display: 'block', marginBottom: 6 }}>Words: {pp.words}</label>
          <input type="range" min={4} max={16} value={pp.words} onChange={(e) => setPp((o) => ({ ...o, words: Number(e.target.value) }))} style={{ width: '100%' }} />
          <div style={{ display: 'flex', gap: 8, marginTop: 8, alignItems: 'center', fontSize: 13 }}>
            <span>Separator</span>
            <input className="jpb-input" style={{ width: 60, height: 30 }} maxLength={3} value={pp.separator} onChange={(e) => setPp((o) => ({ ...o, separator: e.target.value }))} />
            <select className="jpb-input" style={{ height: 30, width: 'auto' }} value={pp.wordCase} onChange={(e) => setPp((o) => ({ ...o, wordCase: e.target.value as PassphraseOptions['wordCase'] }))}>
              <option value="lower">lower</option>
              <option value="capitalize">Capitalize</option>
              <option value="upper">UPPER</option>
            </select>
          </div>
        </div>
      )}

      {onUse ? (
        <div style={{ marginTop: 12 }}>
          <Btn variant="primary" block onClick={() => onUse(value)}>Use this</Btn>
        </div>
      ) : null}
    </div>
  );
}

export { ShieldCheck };

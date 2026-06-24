import {
  useCallback,
  useEffect,
  useState,
  type ReactNode,
} from 'react';
import { KeyRound, Lock, Server, ShieldCheck, Loader2 } from 'lucide-react';
import { rpc, type StatusResult, type VaultItem } from '../shared/messages';

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

export { ShieldCheck };

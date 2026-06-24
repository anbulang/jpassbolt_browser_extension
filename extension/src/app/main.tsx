import { StrictMode, useMemo, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { Copy, Eye, EyeOff, LogIn, RefreshCw, Search, Settings } from 'lucide-react';
import '../ui/base.css';
import '../ui/aegis.css';
import '../ui/jpb.css';
import {
  Btn, ErrorMsg, Flow, Header, Spinner, initials, useStatus, useVault,
} from '../ui/components';
import { rpc, type SecretFields, type StatusResult, type VaultItem } from '../shared/messages';

function Detail({ item }: { item: VaultItem }) {
  const [secret, setSecret] = useState<SecretFields | null>(null);
  const [show, setShow] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [flash, setFlash] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const reveal = async () => {
    setErr(null); setBusy(true);
    try { setSecret((await rpc({ type: 'REVEAL', id: item.id })).secret); setShow(true); }
    catch (e) { setErr(e instanceof Error ? e.message : String(e)); }
    finally { setBusy(false); }
  };
  const copy = async () => {
    try {
      const s = secret ?? (await rpc({ type: 'REVEAL', id: item.id })).secret;
      setSecret(s);
      await navigator.clipboard.writeText(s.password);
      setFlash('Copied'); setTimeout(() => setFlash(null), 1800);
    } catch (e) { setErr(e instanceof Error ? e.message : String(e)); }
  };
  const fill = async () => {
    try {
      const r = await rpc({ type: 'FILL', id: item.id });
      setFlash(r.filled ? 'Filled active tab' : 'No login form on the active tab');
      setTimeout(() => setFlash(null), 2200);
    } catch (e) { setErr(e instanceof Error ? e.message : String(e)); }
  };

  return (
    <div className="jpb-card jpb-secret">
      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        <div className="jpb-row-icon" style={{ width: 44, height: 44, fontSize: 18 }}>{initials(item.name)}</div>
        <div style={{ minWidth: 0 }}>
          <div className="jpb-h2" style={{ margin: 0 }}>{item.name}</div>
          {item.uri ? <a className="jpb-link" href={item.uri.includes('://') ? item.uri : `https://${item.uri}`} target="_blank" rel="noreferrer">{item.uri}</a> : null}
        </div>
      </div>

      <div className="jpb-field" style={{ margin: 0 }}>
        <span className="jpb-label">Username</span>
        <div className="jpb-secret-val" style={{ fontFamily: 'var(--sans)' }}>{item.username || '—'}</div>
      </div>

      <div className="jpb-field" style={{ margin: 0 }}>
        <span className="jpb-label">Password</span>
        {secret ? (
          <div className="jpb-secret-val">{show ? secret.password : '•'.repeat(Math.min(secret.password.length || 8, 24))}</div>
        ) : (
          <div className="jpb-secret-val" style={{ color: 'var(--text-muted)' }}>•••••••• (locked)</div>
        )}
      </div>

      {secret?.description ? (
        <div className="jpb-field" style={{ margin: 0 }}>
          <span className="jpb-label">Description</span>
          <div className="jpb-secret-val" style={{ fontFamily: 'var(--sans)' }}>{secret.description}</div>
        </div>
      ) : null}

      <ErrorMsg text={err} />
      {flash ? <div className="jpb-ok">{flash}</div> : null}

      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        {!secret ? (
          <Btn variant="primary" onClick={reveal} disabled={busy}><Eye size={14} /> {busy ? 'Decrypting…' : 'Reveal'}</Btn>
        ) : (
          <Btn onClick={() => setShow((s) => !s)}>{show ? <><EyeOff size={14} /> Hide</> : <><Eye size={14} /> Show</>}</Btn>
        )}
        <Btn onClick={copy}><Copy size={14} /> Copy password</Btn>
        <Btn onClick={fill}><LogIn size={14} /> Fill active tab</Btn>
      </div>
    </div>
  );
}

function Vault() {
  const { items, err, reload } = useVault(true);
  const [q, setQ] = useState('');
  const [selected, setSelected] = useState<VaultItem | null>(null);

  const filtered = useMemo(() => {
    const all = items ?? [];
    const n = q.trim().toLowerCase();
    return n ? all.filter((i) => [i.name, i.username, i.uri].some((f) => f.toLowerCase().includes(n))) : all;
  }, [items, q]);

  return (
    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 18, alignItems: 'start' }}>
      <div className="jpb-card" style={{ padding: 12 }}>
        <div style={{ display: 'flex', gap: 8, marginBottom: 10 }}>
          <div style={{ position: 'relative', flex: 1 }}>
            <Search size={15} style={{ position: 'absolute', left: 10, top: 10, color: 'var(--text-muted)' }} />
            <input className="jpb-search" style={{ paddingLeft: 32 }} placeholder="Search…" value={q} onChange={(e) => setQ(e.target.value)} />
          </div>
          <Btn variant="ghost" title="Refresh" onClick={() => reload(true)}><RefreshCw size={14} /></Btn>
        </div>
        <ErrorMsg text={err} />
        {!items ? <Spinner label="Loading vault…" /> :
          filtered.length === 0 ? <div className="jpb-empty">No passwords yet.</div> :
            <div className="jpb-list" style={{ maxHeight: '70vh' }}>
              {filtered.map((i) => (
                <div key={i.id} className="jpb-row" onClick={() => setSelected(i)} style={selected?.id === i.id ? { background: 'var(--surface-2)', borderColor: 'var(--border)' } : undefined}>
                  <div className="jpb-row-icon">{initials(i.name)}</div>
                  <div className="jpb-row-main">
                    <div className="jpb-row-name">{i.name}</div>
                    <div className="jpb-row-sub">{i.username || i.uri || '—'}</div>
                  </div>
                </div>
              ))}
            </div>}
      </div>
      <div>
        {selected ? <Detail key={selected.id} item={selected} /> : <div className="jpb-card jpb-empty">Select a password to view its details.</div>}
      </div>
    </div>
  );
}

function App() {
  const { status, setStatus } = useStatus();
  const lock = async () => setStatus(await rpc({ type: 'LOCK' }));
  return (
    <div className="jpb-shell">
      <Header
        account={status?.account ?? null}
        onLock={status?.phase === 'unlocked' ? lock : undefined}
        right={<Btn small variant="ghost" title="Settings" onClick={() => chrome.runtime.openOptionsPage()}><Settings size={14} /></Btn>}
      />
      <div className="jpb-body">
        <Flow status={status} onChange={(s: StatusResult) => setStatus(s)}>
          <Vault />
        </Flow>
      </div>
    </div>
  );
}

createRoot(document.getElementById('root')!).render(
  <StrictMode><App /></StrictMode>,
);

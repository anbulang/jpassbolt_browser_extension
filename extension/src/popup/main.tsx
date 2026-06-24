import { StrictMode, useEffect, useMemo, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { Copy, KeyRound, LogIn, Settings, Search } from 'lucide-react';
import '../ui/base.css';
import '../ui/aegis.css';
import '../ui/jpb.css';
import {
  Btn, Flow, Header, Spinner, initials, useStatus, useVault,
} from '../ui/components';
import { rpc, type StatusResult, type VaultItem } from '../shared/messages';

function openVault() {
  chrome.tabs.create({ url: chrome.runtime.getURL('app.html') });
}

function Quickaccess() {
  const { items, err, reload } = useVault(true);
  const [matches, setMatches] = useState<VaultItem[] | null>(null);
  const [q, setQ] = useState('');
  const [flash, setFlash] = useState<string | null>(null);

  // Current-tab suggestions (autofill candidates for the active site).
  useEffect(() => {
    (async () => {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (tab?.url) setMatches((await rpc({ type: 'FIND_FOR_URL', url: tab.url })).items);
      else setMatches([]);
    })();
  }, []);

  const filtered = useMemo(() => {
    const all = items ?? [];
    const needle = q.trim().toLowerCase();
    if (!needle) return all;
    return all.filter((i) =>
      [i.name, i.username, i.uri].some((f) => f.toLowerCase().includes(needle)),
    );
  }, [items, q]);

  const fill = async (id: string) => {
    try {
      const r = await rpc({ type: 'FILL', id });
      setFlash(r.filled ? 'Filled the login form.' : 'No login form found on this page.');
    } catch (e) { setFlash(e instanceof Error ? e.message : String(e)); }
    setTimeout(() => setFlash(null), 2500);
    window.close();
  };
  const copy = async (id: string) => {
    try {
      const { secret } = await rpc({ type: 'REVEAL', id });
      await rpc({ type: 'COPY', text: secret.password, temporary: true });
      setFlash('Password copied · clears in 30s.');
    } catch (e) { setFlash(e instanceof Error ? e.message : String(e)); }
    setTimeout(() => setFlash(null), 2500);
  };

  const Row = ({ i }: { i: VaultItem }) => (
    <div className="jpb-row" onClick={() => fill(i.id)} title="Fill this login">
      <div className="jpb-row-icon">{initials(i.name)}</div>
      <div className="jpb-row-main">
        <div className="jpb-row-name">{i.name}</div>
        <div className="jpb-row-sub">{i.username || i.uri || '—'}</div>
      </div>
      <div className="jpb-row-actions">
        <Btn small variant="ghost" title="Copy password" onClick={() => copy(i.id)}><Copy size={14} /></Btn>
        <Btn small variant="ghost" title="Fill login" onClick={() => fill(i.id)}><LogIn size={14} /></Btn>
      </div>
    </div>
  );

  return (
    <>
      <div style={{ position: 'relative' }}>
        <Search size={15} style={{ position: 'absolute', left: 10, top: 10, color: 'var(--text-muted)' }} />
        <input className="jpb-search" style={{ paddingLeft: 32 }} placeholder="Search vault…" value={q} onChange={(e) => setQ(e.target.value)} autoFocus />
      </div>
      {flash ? <div className="jpb-ok">{flash}</div> : null}
      {err ? <div className="jpb-error">{err}</div> : null}

      {matches && matches.length > 0 && !q ? (
        <div>
          <div className="jpb-label" style={{ marginBottom: 4 }}>For this site</div>
          <div className="jpb-list">{matches.map((i) => <Row key={'m' + i.id} i={i} />)}</div>
        </div>
      ) : null}

      <div>
        {!q && matches && matches.length > 0 ? <div className="jpb-label" style={{ marginBottom: 4 }}>All passwords</div> : null}
        {!items ? <Spinner label="Loading vault…" /> :
          filtered.length === 0 ? <div className="jpb-empty">No matching passwords.</div> :
            <div className="jpb-list">{filtered.map((i) => <Row key={i.id} i={i} />)}</div>}
      </div>

      <div style={{ display: 'flex', gap: 8 }}>
        <Btn block onClick={openVault}><KeyRound size={14} /> Open vault</Btn>
        <Btn block variant="ghost" onClick={() => reload(true)}>Refresh</Btn>
      </div>
    </>
  );
}

function Popup() {
  const { status, setStatus } = useStatus();
  const onChange = (s: StatusResult) => setStatus(s);
  const lock = async () => setStatus(await rpc({ type: 'LOCK' }));
  return (
    <div className="jpb-shell">
      <Header
        account={status?.account ?? null}
        onLock={status?.phase === 'unlocked' ? lock : undefined}
        right={
          <Btn small variant="ghost" title="Settings" onClick={() => chrome.runtime.openOptionsPage()}>
            <Settings size={14} />
          </Btn>
        }
      />
      <div className="jpb-body">
        <Flow status={status} onChange={onChange}>
          <Quickaccess />
        </Flow>
      </div>
    </div>
  );
}

createRoot(document.getElementById('root')!).render(
  <StrictMode><Popup /></StrictMode>,
);

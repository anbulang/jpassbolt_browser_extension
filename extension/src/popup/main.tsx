import { StrictMode, useEffect, useMemo, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { Copy, ExternalLink, KeyRound, LogIn, Plus, Settings, Search } from 'lucide-react';
import '../ui/base.css';
import '../ui/aegis.css';
import '../ui/jpb.css';
import {
  Btn, CreateResourceForm, Flow, Header, Spinner, initials, useStatus, useVault,
} from '../ui/components';
import { rpc, type CreateResourceInput, type StatusResult, type VaultItem } from '../shared/messages';

// Detached mode: this popup was re-opened as a standalone window (chrome.windows
// .create). In that case `currentWindow` is the popup itself, so the originating
// page tab id is carried in the URL and used to target autofill / suggestions.
const PARAMS = new URLSearchParams(location.search);
const DETACHED = PARAMS.get('detached') === '1';
const DETACHED_TAB_ID = PARAMS.get('tabId') ? Number(PARAMS.get('tabId')) : null;

function openVault() {
  chrome.tabs.create({ url: chrome.runtime.getURL('app.html') });
}

/** The content page tab this quickaccess acts on (the detached tab, else active). */
async function pageTab(): Promise<chrome.tabs.Tab | null> {
  if (DETACHED && DETACHED_TAB_ID != null) {
    try { return await chrome.tabs.get(DETACHED_TAB_ID); } catch { return null; }
  }
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab ?? null;
}

/** Pop the quickaccess out into its own resizable window, carrying the page tab. */
async function detach() {
  const tab = await pageTab();
  const qs = tab?.id ? `?detached=1&tabId=${tab.id}` : '?detached=1';
  await chrome.windows.create({
    url: chrome.runtime.getURL('popup.html' + qs),
    type: 'popup',
    width: 380,
    height: 600,
  });
  window.close();
}

function Quickaccess() {
  const { items, err, reload } = useVault(true);
  const [matches, setMatches] = useState<VaultItem[] | null>(null);
  const [q, setQ] = useState('');
  const [flash, setFlash] = useState<string | null>(null);
  // Non-null -> show the create form, prefilled from the current page (⑩).
  const [creating, setCreating] = useState<Partial<CreateResourceInput> | null>(null);

  const startCreate = async () => {
    const tab = await pageTab();
    setCreating({ name: tab?.title ?? '', uri: tab?.url ?? '' });
  };

  // Current-tab suggestions (autofill candidates for the active site).
  useEffect(() => {
    (async () => {
      const tab = await pageTab();
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
      const tab = await pageTab();
      // In a detached window the source tab can be gone; never fall back to
      // whatever tab happens to be active (that could fill the wrong site).
      if (DETACHED && !tab) {
        setFlash('The original page is no longer open.');
        setTimeout(() => setFlash(null), 2500);
        return;
      }
      const r = await rpc({ type: 'FILL', id, tabId: tab?.id });
      setFlash(r.filled ? 'Filled the login form.' : 'No login form found on this page.');
    } catch (e) { setFlash(e instanceof Error ? e.message : String(e)); }
    setTimeout(() => setFlash(null), 2500);
    if (!DETACHED) window.close(); // keep the detached window open for further actions
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

  if (creating) {
    return (
      <CreateResourceForm
        initial={creating}
        compact
        onCreated={() => { setCreating(null); reload(true); }}
        onCancel={() => setCreating(null)}
      />
    );
  }

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
        <Btn block variant="primary" onClick={startCreate}><Plus size={14} /> New</Btn>
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
          <>
            {!DETACHED ? (
              <Btn small variant="ghost" title="Open in a separate window" onClick={detach}>
                <ExternalLink size={14} />
              </Btn>
            ) : null}
            <Btn small variant="ghost" title="Settings" onClick={() => chrome.runtime.openOptionsPage()}>
              <Settings size={14} />
            </Btn>
          </>
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

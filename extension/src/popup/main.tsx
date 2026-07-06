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
import { t } from '../shared/i18n';

// Detached mode: this popup was re-opened as a standalone window (chrome.windows
// .create). In that case `currentWindow` is the popup itself, so the originating
// page tab id is carried in the URL and used to target autofill / suggestions.
const PARAMS = new URLSearchParams(location.search);
const DETACHED = PARAMS.get('detached') === '1';
const DETACHED_TAB_ID = PARAMS.get('tabId') ? Number(PARAMS.get('tabId')) : null;

/**
 * Official-parity vault entry: the vault lives at the server's /app URL, where
 * the content script swaps in the extension-hosted app iframe (appBootstrap).
 * Falls back to the raw extension page while no server is configured yet.
 */
async function openVault() {
  try {
    const s = await rpc({ type: 'GET_STATUS' });
    if (s.serverUrl) {
      await chrome.tabs.create({ url: s.serverUrl.replace(/\/+$/, '') + '/app' });
      return;
    }
  } catch { /* fall through to the extension page */ }
  await chrome.tabs.create({ url: chrome.runtime.getURL('app.html') });
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
        setFlash(t('flash.originalPageClosed'));
        setTimeout(() => setFlash(null), 2500);
        return;
      }
      const r = await rpc({ type: 'FILL', id, tabId: tab?.id });
      setFlash(r.filled ? t('flash.filledLogin') : t('flash.noLoginForm'));
    } catch (e) { setFlash(e instanceof Error ? e.message : String(e)); }
    setTimeout(() => setFlash(null), 2500);
    if (!DETACHED) window.close(); // keep the detached window open for further actions
  };
  const copy = async (id: string) => {
    try {
      const { secret } = await rpc({ type: 'REVEAL', id });
      await rpc({ type: 'COPY', text: secret.password, temporary: true });
      setFlash(t('flash.passwordCopied30s'));
    } catch (e) { setFlash(e instanceof Error ? e.message : String(e)); }
    setTimeout(() => setFlash(null), 2500);
  };

  const Row = ({ i }: { i: VaultItem }) => (
    <div className="jpb-row" onClick={() => fill(i.id)} title={t('vault.fillThisLogin')}>
      <div className="jpb-row-icon">{initials(i.name)}</div>
      <div className="jpb-row-main">
        <div className="jpb-row-name">{i.name}</div>
        <div className="jpb-row-sub">{i.username || i.uri || t('common.dash')}</div>
      </div>
      {/* Stop propagation so the action buttons don't also trigger the row's
          fill-and-close click handler (double FILL / interrupted copy). */}
      <div className="jpb-row-actions" onClick={(e) => e.stopPropagation()}>
        <Btn small variant="ghost" title={t('vault.copyPassword')} onClick={(e) => { e.stopPropagation(); void copy(i.id); }}><Copy size={14} /></Btn>
        <Btn small variant="ghost" title={t('vault.fillLogin')} onClick={(e) => { e.stopPropagation(); void fill(i.id); }}><LogIn size={14} /></Btn>
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
        <input className="jpb-search" style={{ paddingLeft: 32 }} placeholder={t('vault.searchPlaceholder')} value={q} onChange={(e) => setQ(e.target.value)} autoFocus />
      </div>
      {flash ? <div className="jpb-ok">{flash}</div> : null}
      {err ? <div className="jpb-error">{err}</div> : null}

      {matches && matches.length > 0 && !q ? (
        <div>
          <div className="jpb-label" style={{ marginBottom: 4 }}>{t('vault.forThisSite')}</div>
          <div className="jpb-list">{matches.map((i) => <Row key={'m' + i.id} i={i} />)}</div>
        </div>
      ) : null}

      <div>
        {!q && matches && matches.length > 0 ? <div className="jpb-label" style={{ marginBottom: 4 }}>{t('vault.allPasswords')}</div> : null}
        {!items ? <Spinner label={t('flow.loadingVault')} /> :
          filtered.length === 0 ? <div className="jpb-empty">{t('vault.noMatching')}</div> :
            <div className="jpb-list">{filtered.map((i) => <Row key={i.id} i={i} />)}</div>}
      </div>

      <div style={{ display: 'flex', gap: 8 }}>
        <Btn block variant="primary" onClick={startCreate}><Plus size={14} /> {t('common.new')}</Btn>
        <Btn block onClick={() => void openVault()}><KeyRound size={14} /> {t('vault.openVault')}</Btn>
        <Btn block variant="ghost" onClick={() => reload(true)}>{t('common.refresh')}</Btn>
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
              <Btn small variant="ghost" title={t('header.openSeparateWindow')} onClick={detach}>
                <ExternalLink size={14} />
              </Btn>
            ) : null}
            <Btn small variant="ghost" title={t('header.settings')} onClick={() => chrome.runtime.openOptionsPage()}>
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

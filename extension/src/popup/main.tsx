import { StrictMode, useEffect, useMemo, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { ExternalLink, KeyRound, Plus, Settings, Search } from 'lucide-react';
import '../ui/base.css';
import '../ui/aegis.css';
import '../ui/jpb.css';
import {
  Btn, CreateResourceForm, Flow, Header, useStatus, useVault,
} from '../ui/components';
import { rpc, type CreateResourceInput, type StatusResult, type VaultItem } from '../shared/messages';
import type { QuickFilter, QuickFilterKind, QuickGroup } from '../shared/rpc/vault';
import { t } from '../shared/i18n';
import { ResourceList } from './ResourceList';
import { BrowseSection, FilterList, GroupList, NavBar, filterLabel } from './Browse';

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

/**
 * The popup has no router, so the recovery-request flow (a guest hash route of
 * the extension app) is opened as a full tab. Used by the onboarding card and by
 * the lock screen's "sign in with another account" link.
 */
async function openRecover() {
  await chrome.tabs.create({ url: chrome.runtime.getURL('app.html') + '#/recover' });
  window.close();
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

// ---------------------------------------------------------------------------
// navigation — the popup has no router, so screens are a plain view stack
// ---------------------------------------------------------------------------
type View =
  | { kind: 'home' }
  | { kind: 'filters' }
  | { kind: 'groups' }
  | { kind: 'filter'; filter: QuickFilterKind }
  | { kind: 'group'; group: QuickGroup };

/** The drill-down title shown in the return bar ('home' never renders one). */
function viewTitle(v: View): string {
  switch (v.kind) {
    case 'filters': return t('qa.filters');
    case 'groups': return t('qa.groups');
    case 'filter': return filterLabel(v.filter);
    case 'group': return v.group.name;
    case 'home': return '';
  }
}

/**
 * A server-filtered credential list (Favorites / Items I own / Recently
 * modified / Shared with me / one group). Every filter is resolved in the
 * background — the popup never issues HTTP itself.
 */
function FilteredView({ filter, empty, onFill, onCopy, onError }: {
  filter: QuickFilter;
  empty: string;
  onFill: (id: string) => void;
  onCopy: (id: string) => void;
  onError: (message: string) => void;
}) {
  const [items, setItems] = useState<VaultItem[] | null>(null);
  // `filter` is a fresh object literal on every parent render, so it cannot be
  // the dependency — this stable projection of it is.
  const fkey = filter.kind === 'group' ? `group:${filter.groupId}` : filter.kind;

  useEffect(() => {
    let alive = true;
    setItems(null);
    void (async () => {
      try {
        const r = await rpc({ type: 'LIST_FILTERED', filter });
        if (alive) setItems(r.items);
      } catch (e) {
        if (!alive) return;
        setItems([]);
        onError(e instanceof Error ? e.message : String(e));
      }
    })();
    return () => { alive = false; };
    // Re-fetch only when the selection itself changes (see fkey above).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fkey]);

  return <ResourceList items={items} empty={empty} onFill={onFill} onCopy={onCopy} />;
}

function Quickaccess() {
  const { items, err, reload } = useVault(true);
  const [matches, setMatches] = useState<VaultItem[] | null>(null);
  const [q, setQ] = useState('');
  const [flash, setFlash] = useState<string | null>(null);
  const [navErr, setNavErr] = useState<string | null>(null);
  // Non-null -> show the create form, prefilled from the current page.
  const [creating, setCreating] = useState<Partial<CreateResourceInput> | null>(null);
  // Bottom of the stack is always 'home'; pushing drills down, popping returns.
  const [stack, setStack] = useState<View[]>([{ kind: 'home' }]);
  const view = stack[stack.length - 1];

  const push = (v: View) => { setNavErr(null); setStack((s) => [...s, v]); };
  const back = () => { setNavErr(null); setStack((s) => (s.length > 1 ? s.slice(0, -1) : s)); };

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
  // Decryption happens in the background service worker only — the popup asks
  // for the reveal and hands the plaintext straight back for the clipboard.
  const copy = async (id: string) => {
    try {
      const { secret } = await rpc({ type: 'REVEAL', id });
      await rpc({ type: 'COPY', text: secret.password, temporary: true });
      setFlash(t('flash.passwordCopied30s'));
    } catch (e) { setFlash(e instanceof Error ? e.message : String(e)); }
    setTimeout(() => setFlash(null), 2500);
  };

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

  // ---- screens ------------------------------------------------------------
  let screen: React.ReactNode;
  if (view.kind === 'home') {
    screen = q ? (
      <ResourceList items={items ? filtered : null} empty={t('vault.noMatching')} onFill={fill} onCopy={copy} />
    ) : (
      <>
        <div>
          <div className="jpb-section">{t('qa.suggested')}</div>
          {/* No match for the current page -> the official empty line, which
              points the user at the search field right above. */}
          <ResourceList items={matches} empty={t('qa.noSuggestions')} onFill={fill} onCopy={copy} />
        </div>
        <BrowseSection onFilters={() => push({ kind: 'filters' })} onGroups={() => push({ kind: 'groups' })} />
      </>
    );
  } else if (view.kind === 'filters') {
    screen = <FilterList onPick={(filter) => push({ kind: 'filter', filter })} />;
  } else if (view.kind === 'groups') {
    screen = <GroupList onPick={(group) => push({ kind: 'group', group })} onError={setNavErr} />;
  } else if (view.kind === 'filter') {
    screen = (
      <FilteredView
        filter={{ kind: view.filter }}
        empty={t('qa.emptyList')}
        onFill={fill}
        onCopy={copy}
        onError={setNavErr}
      />
    );
  } else {
    screen = (
      <FilteredView
        filter={{ kind: 'group', groupId: view.group.id }}
        empty={t('qa.emptyGroup')}
        onFill={fill}
        onCopy={copy}
        onError={setNavErr}
      />
    );
  }

  return (
    <div className="jpb-qa">
      {view.kind === 'home' ? (
        <div className="jpb-searchwrap">
          <input
            className="jpb-search"
            placeholder={t('vault.searchPlaceholder')}
            value={q}
            onChange={(e) => setQ(e.target.value)}
            autoFocus
          />
          <span className="jpb-search-ico"><Search size={15} /></span>
        </div>
      ) : (
        <NavBar title={viewTitle(view)} onBack={back} onClose={() => window.close()} />
      )}

      {flash ? <div className="jpb-ok">{flash}</div> : null}
      {/* A drill-down's own failure takes precedence over the background LIST's. */}
      {(navErr ?? err) ? <div className="jpb-error">{navErr ?? err}</div> : null}

      <div className="jpb-qa-scroll">{screen}</div>

      {/* Pinned on every screen, exactly like the official popup. */}
      <div className="jpb-qa-foot">
        <Btn block variant="primary" onClick={startCreate}><Plus size={14} /> {t('qa.createNew')}</Btn>
      </div>
    </div>
  );
}

function Popup() {
  const { status, setStatus } = useStatus();
  const onChange = (s: StatusResult) => setStatus(s);
  // The header's power button ends the SESSION (official quickaccess parity):
  // LOGOUT locks and drops the JWT but KEEPS the account key, so the popup lands
  // on the unlock screen rather than back at onboarding.
  const signOut = async () => setStatus(await rpc({ type: 'LOGOUT' }));
  return (
    <div className="jpb-shell">
      <Header
        account={status?.account ?? null}
        onSignOut={status?.phase === 'unlocked' ? signOut : undefined}
        right={
          <>
            {!DETACHED ? (
              <Btn small variant="ghost" title={t('header.openSeparateWindow')} onClick={detach}>
                <ExternalLink size={14} />
              </Btn>
            ) : null}
            {status?.phase === 'unlocked' ? (
              <Btn small variant="ghost" title={t('vault.openVault')} onClick={() => void openVault()}>
                <KeyRound size={14} />
              </Btn>
            ) : null}
            <Btn small variant="ghost" title={t('header.settings')} onClick={() => chrome.runtime.openOptionsPage()}>
              <Settings size={14} />
            </Btn>
          </>
        }
      />
      <div className="jpb-body">
        <Flow status={status} onChange={onChange} onRecover={() => void openRecover()}>
          <Quickaccess />
        </Flow>
      </div>
    </div>
  );
}

createRoot(document.getElementById('root')!).render(
  <StrictMode><Popup /></StrictMode>,
);

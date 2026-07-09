/**
 * Full-page app entry: HashRouter + the existing Flow phase machine + AppLayout.
 *
 * Route table lives in app/routes.tsx (foundation-owned). Protected routes
 * render inside <ProtectedShell> — the Flow onboarding/unlock machine until the
 * vault is unlocked, then the Aegis rail shell (AppLayout) with the router
 * Outlet. Guest routes (setup / recovery) bypass Flow entirely: no account
 * exists yet.
 *
 * Deep links: content/appBootstrap.ts mounts this page as an iframe with
 * `?pathname=<host tab path>`; primeInitialRoute() maps that server path onto
 * the hash router before React mounts (official HandleApplicationFirstLoadRoute
 * parity). An explicit #hash (in-app navigation state) always wins.
 */
import { StrictMode, useEffect } from 'react';
import { createRoot } from 'react-dom/client';
import { HashRouter, Navigate, Outlet, Route, Routes } from 'react-router-dom';
import '../ui/base.css';
import '../ui/aegis.css';
import '../ui/jpb.css';
import { SESSION_DESYNC_EVENT, rpc } from '../shared/messages';
import { Flow, Header, useStatus } from '../ui/components';
import { AppLayout } from './Layout';
import { ToastProvider } from './lib/toast';
import { guestRoutes, protectedRoutes } from './routes';

// ---- embed-origin gate ------------------------------------------------------
// app.html is a web-accessible resource (the server-page pagemod embeds it),
// so a web origin that learns its URL could iframe the real vault UI under a
// transparent overlay and clickjack an unlocked session (e.g. steer one click
// onto a Share confirm), or full-screen it for UI redressing. The manifest
// cannot express the policy statically — `frame-ancestors 'self'` would also
// block the legitimate server-origin mount, and the server URL is only known
// at runtime — so it is enforced here, before anything renders: when framed,
// EVERY ancestor frame must be the configured server origin (or the extension
// itself). Anything else gets a refusal page instead of the app.
// Returns the offending origin, or null when rendering is allowed.
async function findForbiddenEmbedder(): Promise<string | null> {
  // Top-level tab (popup "open app", direct open): nothing to check.
  if (window.top === window.self) return null;
  const ancestors = Array.from(window.location.ancestorOrigins ?? []);
  // Framed but the ancestor chain cannot be attested — fail closed.
  if (ancestors.length === 0) return 'unknown origin';
  const allowed = new Set([new URL(chrome.runtime.getURL('')).origin]);
  try {
    const status = await rpc({ type: 'GET_STATUS' });
    // The pagemod only ever mounts on the configured server origin
    // (appBootstrap checks serverUrl before injecting), so that is the one
    // web origin allowed to frame us. No serverUrl configured -> no
    // legitimate embedder exists yet.
    if (status.serverUrl) allowed.add(new URL(status.serverUrl).origin);
  } catch {
    // Background unreachable / malformed serverUrl: extension-only — fail closed.
  }
  return ancestors.find((origin) => !allowed.has(origin)) ?? null;
}

function EmbedRefusal({ origin }: { origin: string }) {
  return (
    <div
      style={{
        minHeight: '100vh',
        display: 'grid',
        placeContent: 'center',
        textAlign: 'center',
        padding: '2rem',
        background: '#0f1115',
        color: '#e6e8ee',
        fontFamily: 'system-ui, sans-serif',
      }}
    >
      <h1 style={{ fontSize: '1.1rem', margin: '0 0 0.5rem' }}>JPassbolt</h1>
      <p style={{ margin: 0 }}>
        Refused to load: this page was embedded by an unauthorized origin ({origin}).
      </p>
    </div>
  );
}

// ---- host-path → hash-route mapping ----------------------------------------
/** '/app/users' → '/users'; '/setup/recover/…' → '/recover/…'; '/' | '/app' → '/'. */
function mapHostPathname(p: string): string {
  // Recover links: {domain}/setup/recover/start/{userId}/{tokenId} (new shape) and
  // the legacy {domain}/setup/recover/{userId}/{tokenId}. Strip the whole prefix so
  // both collapse to two path segments matching the '/recover/:userId/:tokenId' route
  // — '/recover/start/U/T' (3 segments) would fall through to Navigate('/') and blank.
  if (p.startsWith('/setup/recover/start/')) return '/recover/' + p.slice('/setup/recover/start/'.length);
  if (p.startsWith('/setup/recover/')) return '/recover/' + p.slice('/setup/recover/'.length);
  // Setup-invite links: {domain}/setup/start/{userId}/{tokenId} (new) and legacy
  // /setup/install/{userId}/{tokenId} → '/setup/:userId/:tokenId'.
  if (p.startsWith('/setup/install/')) return '/setup/' + p.slice('/setup/install/'.length);
  if (p.startsWith('/setup/start/')) return '/setup/' + p.slice('/setup/start/'.length);
  if (p.startsWith('/setup/')) return p;
  if (p === '/recover' || p.startsWith('/recover/')) return p;
  if (p === '/app' || p === '/app/') return '/';
  if (p.startsWith('/app/')) return p.slice('/app'.length);
  return '/';
}

(function primeInitialRoute() {
  const raw = new URLSearchParams(location.search).get('pathname');
  if (!raw || !raw.startsWith('/')) return;
  if (location.hash && location.hash !== '#' && location.hash !== '#/') return;
  location.hash = '#' + mapHostPathname(raw);
})();

// ---- protected shell --------------------------------------------------------
function ProtectedShell() {
  const { status, setStatus, refresh } = useStatus();

  // Fall back to the lock screen when the background locks the session behind
  // our back (idle alarm, 401 dead-session teardown, action in another surface):
  // state.ts broadcasts SESSION_CHANGED to extension pages on every transition,
  // and background/index.ts re-broadcasts once on every MV3 worker cold start.
  // Belt-and-braces: shared/messages.ts rpc() additionally fires a local
  // SESSION_DESYNC_EVENT whenever any RPC returns a vault-locked error while
  // this shell still renders the unlocked UI (e.g. the worker was torn down
  // and its storage.session rehydrate failed) — refresh then, too, so the user
  // lands on the unlock screen instead of a wall of error toasts.
  useEffect(() => {
    const onMsg = (msg: unknown) => {
      if ((msg as { type?: string } | null)?.type === 'SESSION_CHANGED') void refresh();
    };
    const onDesync = () => void refresh();
    chrome.runtime.onMessage.addListener(onMsg);
    window.addEventListener(SESSION_DESYNC_EVENT, onDesync);
    return () => {
      chrome.runtime.onMessage.removeListener(onMsg);
      window.removeEventListener(SESSION_DESYNC_EVENT, onDesync);
    };
  }, [refresh]);

  if (status?.phase === 'unlocked') {
    return <AppLayout status={status} onStatus={setStatus} />;
  }
  // Onboarding / locked: the centered card flow (server → key import → unlock).
  return (
    <div className="jpb-shell">
      <Header account={status?.account ?? null} />
      <div className="jpb-body">
        <Flow status={status} onChange={setStatus}>
          {null}
        </Flow>
      </div>
    </div>
  );
}

function App() {
  return (
    <HashRouter>
      <ToastProvider>
        <Routes>
          {guestRoutes.map(({ path, Component }) => (
            <Route key={path} path={path} element={<Component />} />
          ))}
          <Route element={<ProtectedShell />}>
            {protectedRoutes.map(({ path, Component }) => (
              <Route key={path} path={path} element={<Component />} />
            ))}
          </Route>
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </ToastProvider>
    </HashRouter>
  );
}

const root = createRoot(document.getElementById('root')!);
void findForbiddenEmbedder().then((forbidden) => {
  if (forbidden) {
    console.warn(`JPassbolt: refusing to render app.html inside disallowed embedder (${forbidden})`);
    root.render(<StrictMode><EmbedRefusal origin={forbidden} /></StrictMode>);
    return;
  }
  root.render(<StrictMode><App /></StrictMode>);
});

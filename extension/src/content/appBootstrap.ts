/**
 * Official-Passbolt-style app bootstrap (the "pagemod").
 *
 * When the top frame is a page on the CONFIGURED SERVER DOMAIN whose path is
 * the app URL — `/` or `/app...`, the same shape as passbolt's
 * ParseAppUrlService regex `^{domain}/?(/app.*)?$` — and the extension has an
 * account set up, the skeleton page the server served is replaced by a
 * full-viewport iframe hosting the extension-origin app (app.html).
 *
 * Security model (same as upstream Passbolt): the real UI runs in the
 * chrome-extension:// origin inside the iframe, so the host web page — even a
 * compromised one — cannot reach into it (cross-origin), and private-key
 * material never leaves the background service worker either way.
 */
import { rpc } from '../shared/messages';

/** '/', '/app', '/app/...' — never '/api/...'. */
const APP_PATH = /^\/(app(\/.*)?)?$/;

/**
 * Guest flows served by the server skeleton: '/setup/...' (invite + recover
 * links) and '/recover...'. These take over even BEFORE an account exists —
 * the whole point of setup is that there is no account yet. The extension-side
 * guest routes render them (app/routes.tsx); app/main.tsx maps the pathname.
 */
const GUEST_PATH = /^\/(setup\/.+|recover(\/.*)?)$/;

let mounted = false;

/**
 * Mount the app iframe if this page qualifies. Idempotent — safe to call again
 * on every SESSION_CHANGED broadcast (e.g. the user imports a key in the popup
 * while sitting on the skeleton page: the takeover then happens live).
 */
export async function maybeBootstrapApp(): Promise<void> {
  if (mounted || window.top !== window) return;

  let status;
  try { status = await rpc({ type: 'GET_STATUS' }); } catch { return; }
  if (!status.serverUrl) return;

  let serverOrigin: string;
  try { serverOrigin = new URL(status.serverUrl).origin; } catch { return; }
  if (location.origin !== serverOrigin) return;
  const isGuestPath = GUEST_PATH.test(location.pathname);
  if (!isGuestPath && !APP_PATH.test(location.pathname)) return;

  // App paths: only take over once an account exists (locked/unlocked). Before
  // setup the skeleton page's own "install / configure the extension" guidance
  // must stay visible — an empty iframe would just hide it. Guest paths
  // (setup/recovery) take over regardless: they exist to CREATE the account.
  if (!isGuestPath && status.phase !== 'locked' && status.phase !== 'unlocked') return;

  mount();
}

function mount(): void {
  if (mounted) return;
  mounted = true;

  const iframe = document.createElement('iframe');
  // Pass the host tab's path so the app can land on the matching hash route
  // (deep links / refresh keep their page; setup links reach the guest flow).
  iframe.src =
    chrome.runtime.getURL('app.html') +
    `?pathname=${encodeURIComponent(location.pathname)}`;
  iframe.setAttribute('title', 'JPassbolt');
  iframe.setAttribute(
    'style',
    'position:fixed;inset:0;width:100vw;height:100vh;border:0;margin:0;padding:0;z-index:2147483647;background:#0f1115;',
  );

  // Hide the skeleton instead of removing it: if anything ever unmounts the
  // iframe the page is still intact underneath.
  document.documentElement.style.overflow = 'hidden';
  for (const el of Array.from(document.body?.children ?? [])) {
    if (el instanceof HTMLElement) el.style.display = 'none';
  }

  (document.body ?? document.documentElement).appendChild(iframe);
}

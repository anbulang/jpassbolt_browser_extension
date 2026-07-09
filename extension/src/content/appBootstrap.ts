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
 * Guest links served by the server skeleton, matched with the SAME two-UUID
 * shape official Passbolt requires (parse{Setup,Recover}UrlService) before it
 * will act on a URL:
 *   setup invite  /setup/(install|start)/{uuid}/{uuid}
 *   recover       /setup/recover(/start)?/{uuid}/{uuid}
 * The old `/^\/(setup\/.+|recover(\/.*)?)$/` matched a bare `/recover` or any
 * `/setup/x` with NO token — which let ANY website with such a path trigger the
 * cross-origin server adoption below (drive-by trusted-server hijack). The token
 * pair is the trust anchor, so it MUST actually be present before we act.
 */
const UUID = '[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}';
const GUEST_PATH = new RegExp(
  `^/setup/(?:recover/start|recover|start|install)/${UUID}/${UUID}/?$`,
);

/**
 * Sign-in triage, official ParseAuthUrlService shape (`^{domain}/auth/login/?…`).
 * Unlike guest paths, this behaves like an APP path: it only takes over once a
 * local account exists (state D — greet the returning user, ask passphrase). If
 * NO account exists yet, we deliberately DON'T attach, so the server-rendered
 * "enter your email" page (state A) stays visible — matching upstream, where
 * AuthBootstrap requires GetActiveAccountService to succeed.
 */
const AUTH_PATH = /^\/auth\/login\/?$/;

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

  // Guest flows (setup / recover) PROVISION a new device: there is normally no
  // server configured yet (phase 'no_server'), or one pointing at a different
  // origin (e.g. :8080 while this recover link is :8090). Official Passbolt's
  // Recover/SetupBootstrap attaches on the token URL with NO preconfigured-server
  // precondition and infers the server from the page origin. So for guest paths
  // we adopt THIS page's origin as the server (only when it differs — SET_SERVER
  // tears down any session bound to a different origin) and mount regardless of
  // the prior serverUrl. The one-time token in the URL is the trust anchor, same
  // as upstream. Without this, a fresh/mis-pointed extension stays stuck on the
  // skeleton's "Extension detected" card because the mount below never runs.
  if (GUEST_PATH.test(location.pathname)) {
    let currentOrigin = '';
    try { currentOrigin = status.serverUrl ? new URL(status.serverUrl).origin : ''; } catch { /* ignore */ }
    if (currentOrigin !== location.origin) {
      // Adopting a NEW origin tears the existing session down and repoints the
      // trusted server (SET_SERVER). Only safe on a device with NO account yet —
      // the genuine setup/recover target. A device that already has an account
      // (phase locked/unlocked) must NEVER be silently repointed by a guest page
      // on a foreign origin: that is a drive-by session teardown / trusted-server
      // hijack. Refuse to take over cross-origin then — a real server move is
      // handled by the deliberate ServerForm consent step, not a page visit.
      if (status.phase === 'locked' || status.phase === 'unlocked') return;
      try { await rpc({ type: 'SET_SERVER', serverUrl: location.origin }); } catch { return; }
    }
    mount();
    return;
  }

  // App / auth paths: only ever take over an EXISTING account on the SAME origin.
  // Before an account exists the skeleton's own guidance (install / enter-email
  // state A) must stay visible — an empty iframe would just hide it.
  if (!status.serverUrl) return;
  let serverOrigin: string;
  try { serverOrigin = new URL(status.serverUrl).origin; } catch { return; }
  if (location.origin !== serverOrigin) return;
  if (!AUTH_PATH.test(location.pathname) && !APP_PATH.test(location.pathname)) return;
  if (status.phase !== 'locked' && status.phase !== 'unlocked') return;

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

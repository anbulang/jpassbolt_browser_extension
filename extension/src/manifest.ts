import { defineManifest } from '@crxjs/vite-plugin';

// MV3 manifest. The background service worker is the ONLY context that holds
// private-key material and runs OpenPGP — every UI surface (popup, options,
// the full vault page, and the autofill content script) talks to it by message.
//
// host_permissions is broad (<all_urls>) for two reasons: (1) the Passbolt
// server URL is configured at runtime so it cannot be known at build time, and
// (2) autofill must read/fill login forms on arbitrary sites. A hardened build
// would narrow this to the configured server + optional per-site host grants.
export default defineManifest({
  manifest_version: 3,
  name: 'JPassbolt',
  version: '0.1.0',
  description:
    'Aegis-styled, Passbolt-compatible E2EE password manager. Keys and crypto run in the isolated background service worker.',
  icons: {
    16: 'src/icons/icon-16.png',
    32: 'src/icons/icon-32.png',
    48: 'src/icons/icon-48.png',
    128: 'src/icons/icon-128.png',
  },
  action: {
    default_popup: 'popup.html',
    default_title: 'JPassbolt',
    default_icon: {
      16: 'src/icons/icon-16.png',
      32: 'src/icons/icon-32.png',
      48: 'src/icons/icon-48.png',
      128: 'src/icons/icon-128.png',
    },
  },
  options_page: 'options.html',
  // 'wasm-unsafe-eval' lets hash-wasm instantiate its Argon2 wasm module (KDBX
  // import/export) in both the service worker and extension pages.
  //
  // Anti-clickjacking note: `frame-ancestors 'self'` is deliberately ABSENT.
  // The one legitimate embedder of app.html is the configured Passbolt server
  // page (content/appBootstrap.ts mounts the iframe there), and that origin is
  // only known at runtime, so a static CSP directive would break the pagemod
  // mount. Framing is instead policed by (1) `use_dynamic_url` on the
  // web_accessible_resources entry below — web origins cannot even address
  // app.html by a guessable URL — and (2) a runtime embed-origin gate in
  // app/main.tsx that refuses to render when any ancestor frame is not the
  // configured server origin (or the extension itself).
  content_security_policy: {
    extension_pages: "script-src 'self' 'wasm-unsafe-eval'; object-src 'self'",
  },
  background: {
    service_worker: 'src/background/index.ts',
    type: 'module',
  },
  permissions: ['storage', 'scripting', 'activeTab', 'tabs', 'clipboardWrite', 'clipboardRead', 'alarms', 'offscreen', 'webNavigation'],
  host_permissions: ['<all_urls>'],
  content_scripts: [
    {
      matches: ['http://*/*', 'https://*/*'],
      js: ['src/content/index.ts'],
      run_at: 'document_idle',
      // Inject into sub-frames too — login forms frequently live in an iframe.
      // The script self-guards (idempotency + server-origin exclusion) so this
      // stays cheap and never runs on the JPassbolt app's own pages.
      all_frames: true,
    },
  ],
  web_accessible_resources: [
    {
      resources: ['app.html', 'assets/*'],
      // <all_urls> because the server origin is configured at runtime and thus
      // unknown at build time. use_dynamic_url compensates: the resources are
      // only reachable from web origins through a per-session random GUID host
      // (chrome-extension://<guid>/…), so arbitrary websites can neither probe
      // the static URL to fingerprint the extension nor iframe app.html at a
      // guessable address for UI redressing / clickjacking. The legitimate
      // mount path is unaffected: content/appBootstrap.ts builds the iframe
      // src with chrome.runtime.getURL(), which resolves to the dynamic URL in
      // content scripts (Chrome 130+), and extension-initiated navigations
      // (popup "open app" tab) bypass web-accessibility checks entirely.
      // app/main.tsx adds a second, defense-in-depth embed-origin gate on top.
      matches: ['<all_urls>'],
      use_dynamic_url: true,
    },
  ],
});

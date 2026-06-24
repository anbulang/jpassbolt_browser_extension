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
  action: {
    default_popup: 'popup.html',
    default_title: 'JPassbolt',
  },
  options_page: 'options.html',
  background: {
    service_worker: 'src/background/index.ts',
    type: 'module',
  },
  permissions: ['storage', 'scripting', 'activeTab', 'tabs', 'clipboardWrite', 'alarms', 'offscreen', 'webNavigation'],
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
      matches: ['<all_urls>'],
    },
  ],
});

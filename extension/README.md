# JPassbolt Browser Extension

An **Aegis-styled**, **Passbolt-compatible** end-to-end-encrypted password manager
browser extension (MV3). It talks to the JPassbolt backend over the same GpgAuth +
JWT API as the web frontend, but moves all key material and cryptography into the
isolated **background service worker** — and adds cross-site **autofill**, which a
plain web app cannot do.

## Why an extension (and not just the SPA)

- **Security:** the decrypted private key and all OpenPGP operations live only in
  the background service worker. Web pages never receive the key or passphrase.
  The armored (passphrase-protected) key + JWT are kept in `chrome.storage.local`;
  the passphrase is never persisted; the vault auto-locks after 15 min idle.
- **Autofill:** content scripts can read/fill login forms on any site — impossible
  for a same-origin SPA.
- **Look & feel:** the UI is built on the JPassbolt **Aegis** design tokens
  (`src/ui/aegis.css` + `base.css`), so it matches the web frontend instead of the
  official `passbolt-styleguide`.

## Architecture

```
background/index.ts   trusted core: chrome.storage + OpenPGP + GpgAuth + session/lock
                      + vault (list / reveal / find-for-url) + autofill orchestration
shared/messages.ts    typed message protocol + rpc() helper (UI <-> background)
ui/                   Aegis design system (aegis.css, base.css) + jpb.css + components.tsx
popup/                quickaccess: per-site matches, search, copy/fill, open vault
app/                  full vault page: list + detail (reveal / copy / fill)
options/              server URL, key import, lock / remove account
content/index.ts      autofill: detect login form, fill username + password
```

Every UI surface is "dumb": it sends a message and renders the reply. Only the
background ever sees plaintext.

## Phases

- **Phase 1** — extension shell, keys + crypto in the background, GpgAuth login,
  unlock/lock, and the Aegis vault UI (list + reveal/copy).
- **Phase 2** — autofill: content script + URL→resource matching + in-popup
  "For this site" suggestions + one-click fill of the active tab.
- **Phase 3** — quickaccess popup, options page, idle auto-lock, build + zip
  packaging.

## Develop / build

```bash
npm install
npm run dev      # HMR dev build (load dist/ unpacked, or use the @crxjs dev server)
npm run build    # production build -> dist/
npm run zip      # package dist/ -> jpassbolt-extension.zip
```

Load it in Chrome: `chrome://extensions` → enable Developer mode → **Load unpacked**
→ select `dist/`.

## First run

1. Open **Settings** (gear) and set your JPassbolt server URL (e.g.
   `http://localhost:8080`).
2. Import your **passphrase-protected** OpenPGP private key (paste or file).
3. Click the toolbar icon and **Unlock** with your passphrase — this runs GpgAuth
   and loads your vault.

## Notes / limitations

- Targets the JPassbolt backend (API under `/api`, `.json` endpoints, GpgAuth
  three-stage + JWT). Cross-origin response headers (`X-GPGAuth-*`, `Authorization`)
  are readable because background fetches with `host_permissions` are privileged —
  no server CORS changes needed.
- v5 encrypted-metadata resources display their name as `(encrypted item)` in this
  MVP (metadata-key decryption for the list is a follow-on); secrets still decrypt
  for both v4 and v5.
- `host_permissions` is `<all_urls>` (runtime-configurable server + autofill on any
  site). A hardened build would scope this to the configured server plus per-site
  grants.
- Read/copy/fill are implemented; create/edit/share/folders are reachable in the
  web frontend and can be ported into the app page incrementally over the same
  message protocol.

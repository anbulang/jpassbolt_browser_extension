/**
 * Autofill content script orchestrator. Runs in the page's isolated world in
 * EVERY frame (all_frames). It holds NO secrets and does NO crypto — it:
 *   - reports / performs fills when the background sends DO_FILL(_TOTP);
 *   - shows the in-form CTA + menu when a login field is focused (⑧⑨);
 *   - captures submitted credentials and offers an autosave banner (⑩);
 *   - re-detects forms across SPA navigation (⑦).
 *
 * Hardening (⑦): a window-level idempotency guard (all_frames + any future
 * re-injection can run this twice), a runtime exclusion of the configured
 * JPassbolt server origin (never act on our own app), and history/MutationObserver
 * hooks because tabs.onUpdated never fires on SPA route changes.
 */
import { rpc, type BridgeSessionSnapshot, type ContentReq, type ContentResult, type SessionChangedMsg } from '../shared/messages';
import { fill, fillTotp, passwordFields, ctaAnchor, captureCredentials } from './dom';
import { InForm } from './inform';

// --- idempotency: never initialize twice in one frame ----------------------
declare global { interface Window { __jpbContent?: true } }
if (window.__jpbContent) {
  // already initialized — do nothing
} else {
  window.__jpbContent = true;
  init();
}

function init(): void {
  const TOP = window.top === window;

  // Announce presence to JPassbolt web pages (the SPA reads this to decide
  // whether to show an "install the extension" prompt). Harmless elsewhere.
  try {
    document.documentElement.setAttribute('data-jpassbolt-extension', chrome.runtime.getManifest().version);
  } catch { /* not a normal DOM document */ }

  // --- exclusion gate (fail-closed until status is known) ------------------
  // No listener acts until `ready` is set: before we know the configured server
  // origin we must NOT show the CTA or stage credentials, or a race at t=0 could
  // act on the JPassbolt app's own login page (the "never act on our own app"
  // invariant). Unknown status therefore counts as excluded.
  let serverOrigin: string | null = null;
  let excludedHere = false;
  let ready = false;
  const active = () => ready && !excludedHere;
  void (async () => {
    try {
      const status = await rpc({ type: 'GET_STATUS' });
      if (status.serverUrl) {
        try { serverOrigin = new URL(status.serverUrl).origin; } catch { /* ignore */ }
      }
    } catch { /* background unavailable — leave excluded until known */ }
    excludedHere = !!serverOrigin && location.origin === serverOrigin;
    ready = true;
    if (active() && TOP) void checkPendingSave();
  })();

  // --- background-driven autofill ------------------------------------------
  // Gated by active(): fail-closed before the exclusion status is known and on
  // our own JPassbolt app origin, so a REVEAL'd plaintext is never typed into
  // the app's own pages (or acted on before we know the server origin).
  chrome.runtime.onMessage.addListener((msg: ContentReq, _sender, sendResponse) => {
    if (!active()) { sendResponse({ filled: false } as ContentResult); return; }
    if (msg.type === 'DO_FILL') {
      sendResponse({ filled: fill(msg.username, msg.password) } as ContentResult);
      return;
    }
    if (msg.type === 'DO_FILL_TOTP') {
      sendResponse({ filled: fillTotp(msg.code) } as ContentResult);
      return;
    }
  });

  // --- in-form CTA + menu (⑧⑨) --------------------------------------------
  let ui: InForm | null = null;
  const informUi = () => (ui ??= new InForm());
  let hideTimer: number | undefined;

  function eligibleField(t: EventTarget | null): HTMLInputElement | null {
    if (!(t instanceof HTMLInputElement)) return null;
    if (t.type === 'password') return t;
    // a username-like text field that belongs to a login form
    const pw = passwordFields()[0];
    if (pw && (t.type === 'text' || t.type === 'email' || t.type === 'tel' || !t.getAttribute('type'))) {
      return t === ctaAnchor() ? t : null;
    }
    return null;
  }

  document.addEventListener('focusin', (e) => {
    if (!active()) return;
    // Skip tiny sub-frames (ad/tracking iframes) — never a real login form.
    if (!TOP && (window.innerWidth < 200 || window.innerHeight < 200)) return;
    const field = eligibleField(e.target);
    if (!field) return;
    window.clearTimeout(hideTimer);
    void (async () => {
      let count = 0;
      try { count = (await rpc({ type: 'FIND_FOR_URL', url: location.href })).items.length; } catch { /* show CTA with no badge */ }
      // The round-trip may outlive the focus (a cold SW can take >250ms, longer
      // than the focusout hide timer): only show the CTA if this field is STILL
      // focused, else we'd re-show a badge for a field the user already left.
      const root = field.getRootNode() as Document | ShadowRoot;
      if (field !== document.activeElement && field !== root.activeElement) return;
      informUi().showCta(field, count);
    })();
  }, true);

  document.addEventListener('focusout', () => {
    // Delay so a click on the CTA (which blurs the field) still registers, and
    // never hide while the menu the click just opened is showing.
    window.clearTimeout(hideTimer);
    hideTimer = window.setTimeout(() => { if (!ui?.isMenuOpen()) ui?.hideCta(); }, 250);
  }, true);

  // --- autosave capture (⑩) ------------------------------------------------
  function maybeStage(): void {
    if (!active()) return;
    const creds = captureCredentials();
    if (!creds || !creds.password) return;
    void rpc({
      type: 'STAGE_SAVE',
      name: (document.title || location.hostname).trim().slice(0, 200),
      username: creds.username,
      uri: location.href,
      password: creds.password,
    }).catch(() => undefined);
  }

  // Capture as early as possible — a login submit usually navigates away.
  const SUBMIT_HINT = /log\s?in|sign\s?in|sign\s?on|continue|submit|登录|登入|登錄|登陆/i;
  document.addEventListener('submit', maybeStage, true);
  // Enter only stages when it lands on the login form (the password/username
  // field or an element inside the same form) — not on any Enter anywhere.
  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter') return;
    const t = e.target;
    if (!(t instanceof HTMLElement)) return;
    const pw = passwordFields()[0];
    if (!pw || !pw.value) return;
    if (t === pw || t === ctaAnchor() || (pw.form?.contains(t) ?? false)) maybeStage();
  }, true);
  // SPA logins often POST via a button without a form submit. Only react to a
  // submit-LIKE control while a password field actually holds a value, so we
  // don't ship the plaintext to the background on unrelated button clicks.
  document.addEventListener('click', (e) => {
    const t = e.target as HTMLElement | null;
    if (!t) return;
    const btn = t.closest<HTMLElement>('button, input[type="submit"], [role="button"]');
    if (!btn) return;
    const looksSubmit = btn.getAttribute('type') === 'submit'
      || SUBMIT_HINT.test(`${btn.textContent ?? ''} ${btn.getAttribute('aria-label') ?? ''} ${btn.id} ${(btn as HTMLInputElement).value ?? ''}`);
    if (looksSubmit && passwordFields().some((p) => p.value)) maybeStage();
  }, true);

  async function checkPendingSave(): Promise<void> {
    if (!active() || !TOP) return;
    try {
      const { pending } = await rpc({ type: 'GET_PENDING_SAVE' });
      if (pending) {
        informUi().showBanner(
          pending,
          // Return the promise so the banner can surface a failure and let the
          // user retry (the staged credential survives a failed create now).
          () => rpc({ type: 'COMMIT_SAVE' }).then(() => undefined),
          () => void rpc({ type: 'DISCARD_SAVE' }).catch(() => undefined),
        );
      }
    } catch { /* nothing staged */ }
  }

  // --- SPA session-state bridge (extension -> web app, ONE-WAY) ------------
  // Activates ONLY when this top frame IS the user-configured web-app origin
  // (chrome.storage.local 'app_origin'; unset = bridge off). This gate is
  // deliberately independent of `excludedHere` above: on the app origin the
  // bridge is ON while autofill/CTA/autosave stay OFF per the exclusion gate.
  // SECURITY (see shared/messages.ts): only { state, username } may ever cross
  // window.postMessage here — never keys, passphrases, JWTs or secrets.
  if (TOP) {
    void (async () => {
      let appOrigin: string | null = null;
      try {
        const raw = (await chrome.storage.local.get('app_origin')).app_origin as string | undefined;
        if (raw?.trim()) appOrigin = new URL(raw.trim()).origin;
      } catch { /* unset or invalid -> bridge stays off */ }
      if (!appOrigin || location.origin !== appOrigin) return;
      const origin = appOrigin;

      const post = (snap: BridgeSessionSnapshot): void => {
        window.postMessage(
          { source: 'jpassbolt-ext', type: 'SESSION_CHANGED', state: snap.state, username: snap.username },
          origin,
        );
      };

      // (a) background broadcast on unlock/lock/logout -> relay into the page.
      chrome.runtime.onMessage.addListener((msg: SessionChangedMsg | ContentReq) => {
        if (msg?.type === 'SESSION_CHANGED') post({ state: msg.state, username: msg.username });
      });

      // (b) page query -> forward to the background, relay the snapshot back.
      // Same-window, same-origin, and an explicit SPA source marker required.
      window.addEventListener('message', (event: MessageEvent) => {
        if (event.source !== window || event.origin !== origin) return;
        const data = event.data as { source?: unknown; type?: unknown } | null;
        if (!data || data.source !== 'jpassbolt-spa' || data.type !== 'GET_SESSION_STATE') return;
        void rpc({ type: 'BRIDGE_GET_SESSION_STATE' }).then(post).catch(() => undefined);
      });

      // (c) initial snapshot on attach. Content scripts inject at
      // document_idle, so the page may have posted GET_SESSION_STATE before
      // the listener above existed and given up; push the current state once
      // to close that handshake race (subscribers pick it up like any
      // SESSION_CHANGED broadcast).
      void rpc({ type: 'BRIDGE_GET_SESSION_STATE' }).then(post).catch(() => undefined);
    })();
  }

  // --- SPA navigation + dynamic forms (⑦) ---------------------------------
  let lastHref = location.href;
  const onNav = () => {
    ui?.hideCta();
    ui?.closeMenu();
    // A post-login route change is our best "logged in" signal in an SPA;
    // re-check for a staged credential after the new view settles.
    if (TOP) window.setTimeout(() => void checkPendingSave(), 700);
  };
  window.addEventListener('popstate', onNav);

  // The page's router calls history.pushState in the MAIN world, which an
  // isolated-world content script cannot intercept — so we detect SPA route
  // changes by watching the shared location.href, and re-detect dynamic forms,
  // both from one MutationObserver. The DOM-liveness check is coalesced into a
  // single rAF and only runs while a CTA is actually shown, so a mutation-heavy
  // SPA does not trigger a layout-thrashing field scan on every mutation.
  let scanScheduled = false;
  const mo = new MutationObserver(() => {
    if (location.href !== lastHref) { lastHref = location.href; onNav(); }
    if (!ui?.isCtaVisible() || scanScheduled) return;
    scanScheduled = true;
    requestAnimationFrame(() => {
      scanScheduled = false;
      // Check the element the CTA is actually pinned to (not a recomputed
      // ctaAnchor(), which can resolve to a different field across steps).
      if (ui?.isCtaVisible() && !ui.isAnchorConnected()) { ui.hideCta(); ui.closeMenu(); }
    });
  });
  try { mo.observe(document.documentElement, { childList: true, subtree: true }); } catch { /* ignore */ }
}

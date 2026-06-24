/**
 * Autofill content script (Phase 2). Runs in the page's isolated world. It holds
 * NO secrets and does NO crypto — it only (a) reports whether the page has a
 * login form and (b) fills username/password fields when the background, after
 * decrypting in its own context, sends DO_FILL.
 */
import type { ContentReq, ContentResult } from '../shared/messages';

// Announce presence to JPassbolt web pages (the SPA reads this to decide whether
// to show an "install the extension" prompt). Harmless on third-party sites.
try {
  document.documentElement.setAttribute(
    'data-jpassbolt-extension',
    chrome.runtime.getManifest().version,
  );
} catch {
  /* not a normal DOM document — ignore */
}

function isVisible(el: HTMLElement): boolean {
  const r = el.getBoundingClientRect();
  const s = getComputedStyle(el);
  return r.width > 0 && r.height > 0 && s.visibility !== 'hidden' && s.display !== 'none';
}

function passwordFields(): HTMLInputElement[] {
  return Array.from(document.querySelectorAll<HTMLInputElement>('input[type="password"]')).filter(isVisible);
}

/** Pick the username field associated with a password field. */
function usernameFieldFor(pw: HTMLInputElement): HTMLInputElement | null {
  const candidates = Array.from(
    document.querySelectorAll<HTMLInputElement>(
      'input[type="text"], input[type="email"], input[type="tel"], input:not([type])',
    ),
  ).filter(isVisible);
  if (candidates.length === 0) return null;

  // Prefer an explicit username/email signal.
  const byHint = candidates.find((c) => {
    const hay = `${c.autocomplete} ${c.name} ${c.id} ${c.getAttribute('aria-label') ?? ''} ${c.placeholder}`.toLowerCase();
    return /user|email|login|account|e-?mail/.test(hay);
  });
  if (byHint) return byHint;

  // Else the last visible text-like input that appears before the password in DOM order.
  const before = candidates.filter(
    (c) => pw.compareDocumentPosition(c) & Node.DOCUMENT_POSITION_PRECEDING,
  );
  return before.length ? before[before.length - 1] : candidates[0];
}

function setValue(input: HTMLInputElement, value: string): void {
  const proto = Object.getPrototypeOf(input) as object;
  const setter = Object.getOwnPropertyDescriptor(proto, 'value')?.set;
  if (setter) setter.call(input, value);
  else input.value = value;
  // Fire the events frameworks (React/Vue/Angular) listen to.
  input.dispatchEvent(new Event('input', { bubbles: true }));
  input.dispatchEvent(new Event('change', { bubbles: true }));
}

function fill(username: string, password: string): boolean {
  const pws = passwordFields();
  if (pws.length === 0) return false;
  const pw = pws[0];
  if (username) {
    const user = usernameFieldFor(pw);
    if (user) setValue(user, username);
  }
  setValue(pw, password);
  pw.focus();
  return true;
}

/** Find the page's one-time-code (TOTP/2FA) input, if any. */
function oneTimeCodeField(): HTMLInputElement | null {
  const explicit = Array.from(
    document.querySelectorAll<HTMLInputElement>('input[autocomplete="one-time-code"]'),
  ).filter(isVisible);
  if (explicit.length) return explicit[0];

  const candidates = Array.from(
    document.querySelectorAll<HTMLInputElement>(
      'input[type="text"], input[type="number"], input[type="tel"], input:not([type])',
    ),
  ).filter(isVisible);
  const re = /otp|totp|2fa|mfa|one.?time|verif|auth.?code|security.?code|\btoken\b|\bcode\b/i;
  const byHint = candidates.find((c) =>
    re.test(`${c.autocomplete} ${c.name} ${c.id} ${c.getAttribute('aria-label') ?? ''} ${c.placeholder} ${c.getAttribute('inputmode') ?? ''}`),
  );
  if (byHint) return byHint;

  // A short numeric field is the usual single-box OTP input.
  return candidates.find((c) => c.maxLength > 0 && c.maxLength <= 8) ?? null;
}

function fillTotp(code: string): boolean {
  // One-digit-per-box pattern (each <input maxlength="1">).
  const boxes = Array.from(
    document.querySelectorAll<HTMLInputElement>('input[maxlength="1"]'),
  ).filter(isVisible);
  if (boxes.length >= code.length) {
    for (let i = 0; i < code.length; i++) setValue(boxes[i], code[i]);
    boxes[code.length - 1].focus();
    return true;
  }
  const field = oneTimeCodeField();
  if (!field) return false;
  setValue(field, code);
  field.focus();
  return true;
}

chrome.runtime.onMessage.addListener((msg: ContentReq, _sender, sendResponse) => {
  if (msg.type === 'HAS_LOGIN_FORM') {
    const res: ContentResult = { hasForm: passwordFields().length > 0, origin: location.origin };
    sendResponse(res);
    return;
  }
  if (msg.type === 'DO_FILL') {
    const res: ContentResult = { filled: fill(msg.username, msg.password) };
    sendResponse(res);
    return;
  }
  if (msg.type === 'DO_FILL_TOTP') {
    const res: ContentResult = { filled: fillTotp(msg.code) };
    sendResponse(res);
    return;
  }
});

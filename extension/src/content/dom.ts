/**
 * Pure DOM helpers for the autofill content script — field detection and value
 * setting. No crypto, no chrome APIs, no secrets retained: shared by the
 * orchestrator (index.ts) and the in-page UI (inform.ts).
 */

export function isVisible(el: HTMLElement): boolean {
  const r = el.getBoundingClientRect();
  const s = getComputedStyle(el);
  return r.width > 0 && r.height > 0 && s.visibility !== 'hidden' && s.display !== 'none';
}

export function passwordFields(): HTMLInputElement[] {
  return Array.from(document.querySelectorAll<HTMLInputElement>('input[type="password"]')).filter(isVisible);
}

/** All visible inputs that could plausibly hold a username/email. */
export function textLikeFields(): HTMLInputElement[] {
  return Array.from(
    document.querySelectorAll<HTMLInputElement>(
      'input[type="text"], input[type="email"], input[type="tel"], input:not([type])',
    ),
  ).filter(isVisible);
}

const USER_HINT = /user|email|login|account|e-?mail/i;

/** Pick the username field associated with a password field. */
export function usernameFieldFor(pw: HTMLInputElement): HTMLInputElement | null {
  const candidates = textLikeFields();
  if (candidates.length === 0) return null;

  const byHint = candidates.find((c) => USER_HINT.test(
    `${c.autocomplete} ${c.name} ${c.id} ${c.getAttribute('aria-label') ?? ''} ${c.placeholder}`,
  ));
  if (byHint) return byHint;

  // Else the last visible text-like input that appears before the password.
  const before = candidates.filter(
    (c) => pw.compareDocumentPosition(c) & Node.DOCUMENT_POSITION_PRECEDING,
  );
  return before.length ? before[before.length - 1] : candidates[0];
}

export function setValue(input: HTMLInputElement, value: string): void {
  const proto = Object.getPrototypeOf(input) as object;
  const setter = Object.getOwnPropertyDescriptor(proto, 'value')?.set;
  if (setter) setter.call(input, value);
  else input.value = value;
  // Fire the events frameworks (React/Vue/Angular) listen to.
  input.dispatchEvent(new Event('input', { bubbles: true }));
  input.dispatchEvent(new Event('change', { bubbles: true }));
}

/** Fill the first visible login form. Returns false when no password field exists. */
export function fill(username: string, password: string): boolean {
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
export function oneTimeCodeField(): HTMLInputElement | null {
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

export function fillTotp(code: string): boolean {
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

/** The field the in-form CTA should anchor to: the username field if present, else the password. */
export function ctaAnchor(): HTMLInputElement | null {
  const pws = passwordFields();
  if (pws.length === 0) return null;
  return usernameFieldFor(pws[0]) ?? pws[0];
}

/** Snapshot the typed credentials at submit time (synchronous; page may navigate). */
export function captureCredentials(): { username: string; password: string } | null {
  const pws = passwordFields();
  if (pws.length === 0) return null;
  const pw = pws[0];
  if (!pw.value) return null;
  const user = usernameFieldFor(pw);
  return { username: user?.value ?? '', password: pw.value };
}

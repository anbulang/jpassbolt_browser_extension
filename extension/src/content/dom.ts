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

/**
 * Visible AND interactable: a disabled field is not submitted with the form and
 * a readonly one rejects user-style edits, so filling either writes a value the
 * page ignores while the real field is skipped. Exclude both (and aria-hidden).
 */
export function isFillable(el: HTMLInputElement): boolean {
  return isVisible(el) && !el.disabled && !el.readOnly && el.getAttribute('aria-hidden') !== 'true';
}

/** True when an input is meant for digits (used to spot OTP/code boxes). */
function hasNumericHint(el: HTMLInputElement): boolean {
  const type = (el.getAttribute('type') ?? '').toLowerCase();
  const mode = (el.getAttribute('inputmode') ?? '').toLowerCase();
  return type === 'number' || type === 'tel' || mode === 'numeric' || mode === 'tel';
}

export function passwordFields(): HTMLInputElement[] {
  return Array.from(document.querySelectorAll<HTMLInputElement>('input[type="password"]')).filter(isFillable);
}

/** All visible, fillable inputs that could plausibly hold a username/email. */
export function textLikeFields(): HTMLInputElement[] {
  return Array.from(
    document.querySelectorAll<HTMLInputElement>(
      'input[type="text"], input[type="email"], input[type="tel"], input:not([type])',
    ),
  ).filter(isFillable);
}

const USER_HINT = /user|email|login|account|e-?mail/i;

/** Pick the username field associated with a password field. */
export function usernameFieldFor(pw: HTMLInputElement): HTMLInputElement | null {
  const all = textLikeFields();
  // Prefer fields in the password's OWN form, so a header search box or a
  // newsletter "email" input in a different form is never chosen. Only widen to
  // the whole document when the password's form has no text-like field.
  const scoped = pw.form ? all.filter((c) => c.form === pw.form) : [];
  const candidates = scoped.length ? scoped : all;
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

/**
 * Set an input's value the way the page expects. Always fires input/change for
 * controlled (React/Vue/Angular) inputs. With `withKeys`, also fires a
 * keydown/keyup pair — split-box OTP widgets and some masked inputs only accept
 * a digit (and auto-advance focus) on key events, not on a programmatic set.
 */
export function setValue(input: HTMLInputElement, value: string, withKeys = false): void {
  if (withKeys) input.dispatchEvent(new KeyboardEvent('keydown', { key: value, bubbles: true }));
  const proto = Object.getPrototypeOf(input) as object;
  const setter = Object.getOwnPropertyDescriptor(proto, 'value')?.set;
  if (setter) setter.call(input, value);
  else input.value = value;
  // Fire the events frameworks (React/Vue/Angular) listen to.
  input.dispatchEvent(new Event('input', { bubbles: true }));
  input.dispatchEvent(new Event('change', { bubbles: true }));
  if (withKeys) input.dispatchEvent(new KeyboardEvent('keyup', { key: value, bubbles: true }));
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
  ).filter(isFillable);
  if (explicit.length) return explicit[0];

  const candidates = Array.from(
    document.querySelectorAll<HTMLInputElement>(
      'input[type="text"], input[type="number"], input[type="tel"], input:not([type])',
    ),
  ).filter(isFillable);
  const re = /otp|totp|2fa|mfa|one.?time|verif|auth.?code|security.?code|\btoken\b|\bcode\b/i;
  const byHint = candidates.find((c) =>
    re.test(`${c.autocomplete} ${c.name} ${c.id} ${c.getAttribute('aria-label') ?? ''} ${c.placeholder} ${c.getAttribute('inputmode') ?? ''}`),
  );
  if (byHint) return byHint;

  // Fallback: a short NUMERIC field. Require numeric semantics + a code-like
  // length so a ZIP / quantity / coupon box is never mistaken for an OTP field.
  return candidates.find((c) => hasNumericHint(c) && c.maxLength >= 4 && c.maxLength <= 8) ?? null;
}

/**
 * A contiguous group of exactly `n` single-char sibling boxes that looks like a
 * split OTP entry (one digit per box). Scoped to a common parent and ordered by
 * visual position, so unrelated `maxlength="1"` inputs elsewhere on the page
 * (a PIN widget, a date day/month box) are never filled.
 */
function splitCodeBoxes(n: number): HTMLInputElement[] | null {
  if (n <= 0) return null;
  const all = Array.from(
    document.querySelectorAll<HTMLInputElement>('input[maxlength="1"]'),
  ).filter(isFillable);
  if (all.length < n) return null;
  const byParent = new Map<Element, HTMLInputElement[]>();
  for (const box of all) {
    const p = box.parentElement;
    if (!p) continue;
    const group = byParent.get(p) ?? [];
    group.push(box);
    byParent.set(p, group);
  }
  for (const group of byParent.values()) {
    if (group.length < n) continue;
    group.sort((a, b) => {
      const ra = a.getBoundingClientRect();
      const rb = b.getBoundingClientRect();
      return ra.top - rb.top || ra.left - rb.left;
    });
    return group.slice(0, n);
  }
  return null;
}

export function fillTotp(code: string): boolean {
  // One-digit-per-box pattern (a contiguous group of <input maxlength="1">).
  const boxes = splitCodeBoxes(code.length);
  if (boxes) {
    for (let i = 0; i < code.length; i++) setValue(boxes[i], code[i], true);
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

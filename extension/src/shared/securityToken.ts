/**
 * Security token — the user's personal anti-phishing marker (official Passbolt
 * "security token": three characters on a colour the user picked). It is shown
 * on every surface that asks for the passphrase, so a look-alike page that does
 * not know the token is recognisable as a fake.
 *
 * It is a DISPLAY-ONLY secret with no cryptographic role: it lives in
 * chrome.storage.local (same trust level as the theme switch), never leaves the
 * device, and is never sent to the server. Kept in shared/ rather than in the
 * settings page so the passphrase prompts injected by the content scripts can
 * read it through the same accessor once they grow a token slot.
 */

export interface SecurityToken {
  /** Exactly three characters, [A-Za-z0-9]. */
  code: string;
  /** Background colour as a #rrggbb hex string. */
  color: string;
}

export const SECURITY_TOKEN_KEY = 'jpb_security_token';

export const DEFAULT_SECURITY_TOKEN: SecurityToken = { code: 'JPB', color: '#3b82f6' };

const CODE_RE = /^[A-Za-z0-9]{3}$/;
const COLOR_RE = /^#[0-9a-fA-F]{6}$/;

export function isValidTokenCode(code: string): boolean {
  return CODE_RE.test(code);
}

export function isValidTokenColor(color: string): boolean {
  return COLOR_RE.test(color);
}

/** Narrow an arbitrary stored value to a SecurityToken, falling back per field. */
function coerce(raw: unknown): SecurityToken {
  const o = (raw ?? {}) as Partial<Record<keyof SecurityToken, unknown>>;
  const code = typeof o.code === 'string' && isValidTokenCode(o.code) ? o.code : DEFAULT_SECURITY_TOKEN.code;
  const color =
    typeof o.color === 'string' && isValidTokenColor(o.color)
      ? o.color.toLowerCase()
      : DEFAULT_SECURITY_TOKEN.color;
  return { code, color };
}

/**
 * Read the security token. Never rejects: an unreadable/absent/corrupt entry
 * yields the default, because a passphrase prompt must render either way.
 */
export async function getSecurityToken(): Promise<SecurityToken> {
  try {
    const o = await chrome.storage?.local?.get(SECURITY_TOKEN_KEY);
    return coerce(o?.[SECURITY_TOKEN_KEY]);
  } catch {
    return DEFAULT_SECURITY_TOKEN;
  }
}

/** Persist the security token. Throws when the input fails validation. */
export async function setSecurityToken(token: SecurityToken): Promise<void> {
  if (!isValidTokenCode(token.code) || !isValidTokenColor(token.color)) {
    throw new Error('Invalid security token.');
  }
  await chrome.storage.local.set({
    [SECURITY_TOKEN_KEY]: { code: token.code, color: token.color.toLowerCase() },
  });
}

/**
 * Pick a readable foreground for `color` (per-channel sRGB luminance, the same
 * cheap heuristic the official styleguide uses for its token swatches).
 */
export function tokenTextColor(color: string): string {
  if (!isValidTokenColor(color)) return '#ffffff';
  const r = parseInt(color.slice(1, 3), 16);
  const g = parseInt(color.slice(3, 5), 16);
  const b = parseInt(color.slice(5, 7), 16);
  const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  return luminance > 0.6 ? '#1f2937' : '#ffffff';
}

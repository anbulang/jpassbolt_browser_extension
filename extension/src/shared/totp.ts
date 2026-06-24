/**
 * RFC 6238 TOTP / RFC 4226 HOTP generation.
 *
 * Runs in BOTH the service worker and page/UI contexts (only uses WebCrypto +
 * Date), so the popup/app can tick a live code without an IPC round-trip every
 * second. The TOTP secret is part of an already-revealed secret, so computing
 * the code in the UI is inside the same trust boundary as displaying the
 * password — no extra exposure.
 */

/** Shape of the `totp` object stored inside a Passbolt secret JSON. */
export interface TotpConfig {
  secret_key: string;
  period: number;
  digits: number;
  algorithm: string; // 'SHA1' | 'SHA256' | 'SHA512'
}

export interface TotpResult {
  /** The current N-digit code, zero-padded. */
  code: string;
  /** Whole seconds until this code rolls over. */
  expiresInSec: number;
  /** The configured step length in seconds. */
  period: number;
}

const BASE32_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

/** Decode an RFC 4648 base32 string (the format Passbolt/authenticators use). */
function base32Decode(input: string): Uint8Array<ArrayBuffer> {
  const clean = input.replace(/=+$/, '').replace(/\s+/g, '').toUpperCase();
  const out: number[] = [];
  let bits = 0;
  let value = 0;
  for (const ch of clean) {
    const idx = BASE32_ALPHABET.indexOf(ch);
    if (idx === -1) continue; // skip anything that is not valid base32
    value = (value << 5) | idx;
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }
  return new Uint8Array(out);
}

function subtleHashName(algorithm: string): 'SHA-1' | 'SHA-256' | 'SHA-512' {
  switch ((algorithm || 'SHA1').toUpperCase()) {
    case 'SHA256': return 'SHA-256';
    case 'SHA512': return 'SHA-512';
    default: return 'SHA-1';
  }
}

/** True if `cfg` looks like a usable TOTP configuration. */
export function isValidTotp(cfg: Partial<TotpConfig> | null | undefined): cfg is TotpConfig {
  return !!cfg && typeof cfg.secret_key === 'string' && cfg.secret_key.trim().length > 0;
}

/** Compute the current TOTP code for `cfg`. */
export async function generateTotp(cfg: TotpConfig, nowMs: number = Date.now()): Promise<TotpResult> {
  const period = cfg.period && cfg.period > 0 ? cfg.period : 30;
  const digits = cfg.digits && cfg.digits > 0 ? cfg.digits : 6;
  const nowSec = Math.floor(nowMs / 1000);
  const counter = Math.floor(nowSec / period);

  const keyBytes = base32Decode(cfg.secret_key);
  // 8-byte big-endian counter.
  const counterBuf = new ArrayBuffer(8);
  const view = new DataView(counterBuf);
  view.setUint32(0, Math.floor(counter / 0x1_0000_0000));
  view.setUint32(4, counter >>> 0);

  const key = await crypto.subtle.importKey(
    'raw',
    keyBytes,
    { name: 'HMAC', hash: subtleHashName(cfg.algorithm) },
    false,
    ['sign'],
  );
  const sig = new Uint8Array(await crypto.subtle.sign('HMAC', key, counterBuf));

  // Dynamic truncation (RFC 4226 §5.3).
  const offset = sig[sig.length - 1] & 0x0f;
  const binary =
    ((sig[offset] & 0x7f) << 24) |
    ((sig[offset + 1] & 0xff) << 16) |
    ((sig[offset + 2] & 0xff) << 8) |
    (sig[offset + 3] & 0xff);

  const code = (binary % 10 ** digits).toString().padStart(digits, '0');
  const expiresInSec = period - (nowSec % period);
  return { code, expiresInSec, period };
}

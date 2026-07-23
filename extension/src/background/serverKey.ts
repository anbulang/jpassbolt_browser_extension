/**
 * SP-11 — server key pinning (GpgAuth Stage 0 / server verify).
 *
 * Zero-knowledge does NOT mean the server needs no authentication: the server
 * is the middleman for public-key exchange, so a MITM that can swap the server
 * (or a recipient's) public key can make the client encrypt secrets to a key
 * the attacker holds — defeating E2EE without ever seeing a private key. Pinning
 * the server's OpenPGP key to its origin, and proving on every login that the
 * server still holds the matching PRIVATE key (Stage 0), closes that door.
 *
 * Trust model — TOFU (trust on first use): the very first pin is captured during
 * setup/recover, a flow reached through an emailed one-time-token link (an
 * out-of-band channel a network MITM does not control). After that the pinned
 * fingerprint is the anchor; any change is refused, never silently accepted —
 * re-pinning requires going through recovery again (another out-of-band link).
 */
import * as openpgp from 'openpgp';
import { t } from '../shared/i18n';
import { K, get, set } from './state';
import { verifyArmoredKeyFingerprint } from './crypto';

export interface PinnedServerKey {
  /** normalized (lowercase, no spaces) fingerprint of the pinned server key */
  fingerprint: string;
  /** armored server PUBLIC key */
  armoredKey: string;
  /** scheme://host[:port] this key is pinned to — a pin only applies to its origin */
  origin: string;
  /** epoch ms the pin was captured */
  pinnedAt: number;
}

/**
 * A refused server-key verification (Stage 0 failed, or the presented key does
 * not match the pin). Callers MUST let this propagate — never fall back to an
 * unverified login, or SP-11 is worthless.
 */
export class ServerKeyMismatchError extends Error {
  constructor(message?: string) {
    super(message ?? t('bg.serverKeyMismatch'));
    this.name = 'ServerKeyMismatchError';
  }
}

function originOf(serverUrl: string): string {
  return new URL(serverUrl).origin;
}

/** GET {base}/auth/verify.json → { fingerprint, keydata } (server public key). */
async function fetchServerKey(base: string): Promise<{ fingerprint: string; keydata: string }> {
  const res = await fetch(base + '/auth/verify.json', { method: 'GET' });
  const env = (await res.json().catch(() => null)) as {
    body?: { fingerprint?: string; keydata?: string };
  } | null;
  const fingerprint = env?.body?.fingerprint;
  const keydata = env?.body?.keydata;
  if (!fingerprint || !keydata) throw new Error(t('bg.serverKeyPinFailed'));
  return { fingerprint, keydata };
}

/**
 * The pin currently in force for {@code serverUrl}, or null if none / the pin
 * belongs to a different origin (a moved server — the stale pin must not be
 * misapplied; SET_SERVER clears it on an origin change, this is defence in depth).
 */
export async function getPinnedServerKey(serverUrl: string): Promise<PinnedServerKey | null> {
  const pinned = await get<PinnedServerKey>(K.serverKey);
  if (!pinned || !pinned.fingerprint || !pinned.armoredKey) return null;
  try {
    if (pinned.origin !== originOf(serverUrl)) return null;
  } catch {
    return null;
  }
  return pinned;
}

/**
 * TOFU pin: download the server's public key, cross-check its armored body
 * against the fingerprint the server reports, and bind it to the origin. Trust
 * in this first value rests on the out-of-band link that got the user here.
 * Overwrites any existing pin for this origin (a caller only pins when there is
 * a legitimate reason to establish/refresh the anchor).
 */
export async function pinServerKey(base: string, serverUrl: string): Promise<PinnedServerKey> {
  const { fingerprint, keydata } = await fetchServerKey(base);
  // Reuse the armored↔reported-fingerprint cross-check (throws on mismatch/parse).
  const normalized = await verifyArmoredKeyFingerprint(keydata, fingerprint, 'the server');
  const pin: PinnedServerKey = {
    fingerprint: normalized,
    armoredKey: keydata,
    origin: originOf(serverUrl),
    pinnedAt: Date.now(),
  };
  await set({ [K.serverKey]: pin });
  return pin;
}

/**
 * GpgAuth Stage 0 (server verify). Prove the server holds the private key for
 * the PINNED public key: encrypt a fresh nonce to the pinned key, POST it, and
 * require the server to echo the EXACT plaintext back in X-GPGAuth-Verify-Response.
 * A MITM presenting a different key cannot produce it (it lacks the pinned
 * private key). Stage 0 is always HTTP 200 — only the echoed nonce proves it,
 * so we compare byte-for-byte. Throws {@link ServerKeyMismatchError} on any
 * failure; the caller aborts the login.
 */
export async function serverVerifyStage0(
  base: string,
  pinned: PinnedServerKey,
  keyid: string,
): Promise<void> {
  const nonce = `gpgauthv1.3.0|36|${crypto.randomUUID()}|gpgauthv1.3.0`;

  let token: string;
  try {
    const pubKey = await openpgp.readKey({ armoredKey: pinned.armoredKey });
    token = await openpgp.encrypt({
      message: await openpgp.createMessage({ text: nonce }),
      encryptionKeys: pubKey,
    });
  } catch {
    // A pinned key we can no longer parse/encrypt to is itself a red flag.
    throw new ServerKeyMismatchError(t('bg.serverKeyPinFailed'));
  }

  const res = await fetch(base + '/auth/login.json', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ data: { gpg_auth: { keyid, server_verify_token: token } } }),
  });

  // Stage 0 is ALWAYS HTTP 200 on the real backend (success and failure alike),
  // so a non-2xx here is a transport/gateway hiccup (a reverse proxy 502/503, an
  // error envelope) — NOT evidence the server key changed. Attributing that to a
  // key mismatch would fire a scary "server tampered with" warning for a plain
  // network blip. Fail closed (login still aborts) but with a generic error.
  if (!res.ok) {
    throw new Error(t('bg.serverKeyPinFailed'));
  }

  // The backend sets X-GPGAuth-Verify-Response RAW (no urlencoding, unlike the
  // stage-1 token), so compare the header value verbatim. On a 200, only a
  // server holding the pinned private key could have decrypted our nonce back
  // to this exact string; a missing/different value IS a key mismatch.
  const verifyResp = res.headers.get('x-gpgauth-verify-response');
  if (verifyResp !== nonce) {
    throw new ServerKeyMismatchError();
  }
}

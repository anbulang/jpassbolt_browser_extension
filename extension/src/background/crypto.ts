/**
 * Background OpenPGP primitives — ported from the SPA's gpg.ts, adapted to the
 * worker's key model: instead of (armoredPrivateKey, passphrase) pairs, decrypt
 * paths default to the in-memory unlocked session key from state.ts.
 *
 * SECURITY: these primitives are NOT exposed to the UI as RPCs. They are the
 * internal implementation of the domain RPCs (RESOURCE_SAVE / SHARE_APPLY /
 * GROUP_SAVE_REENCRYPT / …); the UI never gains a raw encrypt/decrypt surface.
 * Whenever a handler encrypts to a key the SERVER supplied (another user, the
 * shared metadata key), it MUST call verifyArmoredKeyFingerprint first — that
 * key-substitution defence only means anything on this trusted side.
 */
import * as openpgp from 'openpgp';
import { t } from '../shared/i18n';
import { K, get, getUnlockedKey } from './state';

/** openpgp may return a WebStream when the input is streamed; coerce to string. */
export async function streamToText(s: unknown): Promise<string> {
  return await new Response(s as ReadableStream).text();
}

/**
 * Decrypt an armored PGP message. Defaults to the unlocked session key; pass an
 * explicit key to decrypt with another PrivateKey (e.g. the shared metadata key).
 */
export async function decryptMessage(
  armoredMessage: string,
  privateKey?: openpgp.PrivateKey,
): Promise<string> {
  const key = privateKey ?? getUnlockedKey();
  if (!key) throw new Error(t('bg.vaultLocked'));
  const message = await openpgp.readMessage({ armoredMessage });
  const { data } = await openpgp.decrypt({ message, decryptionKeys: key });
  return typeof data === 'string' ? data : streamToText(data);
}

/**
 * Extract the key ID (fingerprint) from an armored private key.
 * The backend expects a 40-character fingerprint or a 16-character key ID.
 */
export async function extractKeyId(armoredPrivateKey: string): Promise<string> {
  try {
    const privateKey = await openpgp.readPrivateKey({ armoredKey: armoredPrivateKey });
    return privateKey.getFingerprint();
  } catch {
    throw new Error(t('bg.invalidPrivateKey'));
  }
}

/** Normalize a fingerprint for comparison: strip whitespace, lowercase. */
export function normalizeFingerprint(fp: string): string {
  return fp.replace(/\s+/g, '').toLowerCase();
}

/**
 * Compute the OpenPGP fingerprint (lowercase hex, no spaces) of an armored
 * PUBLIC (or private) key. Throws if the key cannot be parsed.
 */
export async function fingerprintOf(armoredKey: string): Promise<string> {
  const key = await openpgp.readKey({ armoredKey });
  return normalizeFingerprint(key.getFingerprint());
}

/**
 * Verify that an armored key the server returned actually matches the fingerprint
 * the server INDEPENDENTLY reported for that key (gpgkey.fingerprint).
 *
 * THREAT MODEL: in this zero-knowledge architecture the server is untrusted on key
 * distribution. A compromised backend could hand back an attacker-controlled public
 * key for a victim recipient; encrypting a secret to it would silently leak the
 * plaintext to the attacker (and lock the legitimate recipient out). Cross-checking
 * the armored body against the separately-reported fingerprint raises the bar:
 * to defeat it the server must lie consistently in two fields, and any out-of-band
 * pinned/known fingerprint can then be compared against this single value.
 *
 * @returns the verified (normalized) fingerprint.
 * @throws if the key is unparseable, the expected fingerprint is missing, or they differ.
 */
export async function verifyArmoredKeyFingerprint(
  armoredKey: string,
  expectedFingerprint: string | null | undefined,
  who: string,
): Promise<string> {
  let actual: string;
  try {
    actual = await fingerprintOf(armoredKey);
  } catch {
    throw new Error(`The public key for ${who} could not be parsed and cannot be trusted.`);
  }
  if (!expectedFingerprint) {
    throw new Error(
      `No fingerprint was reported for ${who}, so their public key cannot be verified.`,
    );
  }
  if (normalizeFingerprint(expectedFingerprint) !== actual) {
    throw new Error(
      `Public-key fingerprint mismatch for ${who}. The key returned by the server does not match its reported fingerprint; refusing to encrypt to an unverified key.`,
    );
  }
  return actual;
}

/**
 * Generate a fresh RSA OpenPGP key pair for account setup / recovery.
 *
 * SECURITY: the generated private key is ALWAYS passphrase-protected — an empty
 * passphrase THROWS, matching the importKey() invariant (never persist an
 * unprotected armored private key). Only the public key ever goes to the server.
 */
export async function generateKeyPair(opts: {
  name: string;
  email: string;
  passphrase: string;
  rsaBits?: number;
}): Promise<{ armoredPrivateKey: string; armoredPublicKey: string; fingerprint: string }> {
  if (!opts.passphrase || opts.passphrase.length === 0) {
    throw new Error(t('bg.keyNotProtected'));
  }
  const { privateKey, publicKey } = await openpgp.generateKey({
    type: 'rsa',
    rsaBits: opts.rsaBits ?? 3072,
    userIDs: [{ name: opts.name, email: opts.email }],
    passphrase: opts.passphrase,
    format: 'armored',
  });
  const fingerprint = await fingerprintOf(publicKey);
  return { armoredPrivateKey: privateKey, armoredPublicKey: publicKey, fingerprint };
}

/**
 * Encrypt a text message to one or more public keys (multi-recipient; used by
 * the share/group/resource-update re-encryption flows). Callers are responsible
 * for having verified server-supplied keys via verifyArmoredKeyFingerprint
 * beforehand. Pass `signingKey` (e.g. the unlocked session key) to also sign
 * the message, matching the official plugin's signed per-recipient secrets.
 */
export async function encryptMessage(
  text: string,
  armoredPublicKeys: string[],
  signingKey?: openpgp.PrivateKey,
): Promise<string> {
  const encryptionKeys = await Promise.all(
    armoredPublicKeys.map((key) => openpgp.readKey({ armoredKey: key })),
  );
  const message = await openpgp.createMessage({ text });
  const armoredMessage = await openpgp.encrypt({
    message,
    encryptionKeys,
    ...(signingKey ? { signingKeys: signingKey } : {}),
  });
  return armoredMessage as string;
}

/**
 * Encrypt a secret plaintext to the current user's OWN public key, signing with
 * the in-memory private key. Produces exactly one Secret row for the creator —
 * zero-knowledge is preserved (the server only ever sees ciphertext).
 */
export async function encryptForSelf(plaintext: string): Promise<string> {
  const unlockedKey = getUnlockedKey();
  if (!unlockedKey) throw new Error(t('bg.vaultLocked'));
  const armoredPub = await get<string>(K.publicKey);
  if (!armoredPub) throw new Error(t('bg.publicKeyUnavailable'));
  const pub = await openpgp.readKey({ armoredKey: armoredPub });
  const message = await openpgp.createMessage({ text: plaintext });
  const armored = await openpgp.encrypt({
    message,
    encryptionKeys: pub,
    signingKeys: unlockedKey, // sign so the secret looks native to official clients
  });
  return armored as string;
}

/**
 * Shared v5 metadata key — background session service. Port of the SPA's
 * MetadataKeyContext two-hop decrypt chain, minus React: one worker-wide cache
 * instead of a per-tab context (popup and app now share it by design).
 *
 * SECURITY MODEL: the decrypted SHARED metadata PRIVATE key lives ONLY in this
 * module's memory — never serialized, never persisted. wipe() runs on every
 * lock() (registered below) and bumps a generation token so an in-flight load
 * started before a lock can never resurrect the decrypted key afterwards.
 *
 * TWO-HOP DECRYPT CHAIN (shared_key):
 *   GET /metadata/keys.json?contain[metadata_private_keys]=1
 *     -> pick the active key (deleted == null && expired == null)
 *     -> find the current user's metadata_private_keys[].data
 *     -> decryptMessage(data)                       (hop 1: own unlocked GPG key)
 *     -> narrow to PASSBOLT_METADATA_PRIVATE_KEY, readPrivateKey(+passphrase)
 *     -> READ-SIDE fingerprint triple-check (fail closed)
 *     -> cache PrivateKey + active record.           (hop 2 serves decrypts)
 */
import * as openpgp from 'openpgp';
import type { MetadataKeyType } from '../shared/rpc/vault';
import { K, get, registerLockHook, registerSessionResetHook } from './state';
import { apiCall } from './http';
import {
  decryptMessage,
  encryptMessage,
  fingerprintOf,
  normalizeFingerprint,
  verifyArmoredKeyFingerprint,
} from './crypto';

interface MetadataPrivateKeyRow {
  user_id?: string;
  data: string;
}
interface MetadataKeyRow {
  id: string;
  fingerprint?: string | null;
  armored_key: string;
  deleted?: string | null;
  expired?: string | null;
  metadata_private_keys?: MetadataPrivateKeyRow[];
}

/** The decrypted PASSBOLT_METADATA_PRIVATE_KEY cleartext shape (narrowed at runtime). */
interface MetadataPrivateKeyBlob {
  armored_key: string;
  fingerprint: string;
  passphrase: string;
}

function narrowPrivateKeyBlob(plaintext: string): MetadataPrivateKeyBlob | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(plaintext);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== 'object') return null;
  const obj = parsed as Record<string, unknown>;
  if (obj.object_type !== 'PASSBOLT_METADATA_PRIVATE_KEY') return null;
  if (typeof obj.armored_key !== 'string' || obj.armored_key.length === 0) return null;
  return {
    armored_key: obj.armored_key,
    fingerprint: typeof obj.fingerprint === 'string' ? obj.fingerprint : '',
    passphrase: typeof obj.passphrase === 'string' ? obj.passphrase : '',
  };
}

// ---------------------------------------------------------------------------
// session cache (memory only)
// ---------------------------------------------------------------------------
let sharedPrivateKey: openpgp.PrivateKey | null = null;
let activeKey: MetadataKeyRow | null = null;
/**
 * True once a load attempt settled in a CACHEABLE terminal state: success, or
 * the server confirming there is no active key / no private-key copy for this
 * user. Transient failures (network error, decrypt/verify error) do NOT set
 * this — they set `failedAt` and are retried after a short backoff, so one
 * blip at unlock time cannot poison the whole session (v5 rows stuck on
 * placeholders, saves silently degrading to v4, exports dropping v5 rows).
 */
let loaded = false;
let lastError: string | null = null;
/** Epoch ms of the last FAILED load attempt (0 = none). */
let failedAt = 0;
/** Backoff before a failed load may be retried (~1 fetch / 5s while broken). */
const FAILURE_RETRY_MS = 5_000;
// Generation token: bumped by wipe() and each load() entry so a superseded
// load's post-await writes are all skipped (the lock-mid-flight race).
let gen = 0;
let inflight: Promise<void> | null = null;

/** Drop everything. Runs on every lock(); also the reset for forced reloads. */
export function wipe(): void {
  gen += 1;
  sharedPrivateKey = null;
  activeKey = null;
  loaded = false;
  lastError = null;
  failedAt = 0;
  inflight = null;
}
registerLockHook(wipe);
// Also wipe on every UNLOCK (session-reset): the cached shared metadata key may
// belong to a previous account/server (IMPORT_KEY/SET_SERVER flows) — never
// decrypt/encrypt with a stale one across a session-identity change.
registerSessionResetHook(wipe);

async function load(): Promise<void> {
  const myGen = (gen += 1);
  const isCurrent = () => gen === myGen;
  lastError = null;
  try {
    // The contain NAME carries square brackets, which Tomcat's query parser
    // rejects unencoded (400 HTML page, before Spring runs) — never hand-build
    // this query string. URLSearchParams emits %5B/%5D, which the servlet
    // decodes back to the literal name the @RequestParam binds.
    const sp = new URLSearchParams({ 'contain[metadata_private_keys]': '1' });
    const keys = await apiCall<MetadataKeyRow[]>('GET', `/metadata/keys.json?${sp}`);
    if (!isCurrent()) return;
    const active = (keys ?? []).find((k) => k.deleted == null && k.expired == null) ?? null;

    // No active shared metadata key configured: tolerate it — loaded=true but
    // unavailable, so v4-only orgs see no errors (SPA parity).
    if (!active) {
      sharedPrivateKey = null;
      activeKey = null;
      loaded = true;
      failedAt = 0;
      return;
    }

    const user = await get<{ id?: string }>(K.user);
    if (!isCurrent()) return;
    const copies = active.metadata_private_keys ?? [];
    const myCopy =
      (user?.id ? copies.find((p) => p.user_id === user.id) : undefined) ??
      // The server scopes these to the current user, so a single entry is the
      // user's own copy even if the cached user blob was unavailable.
      copies[0];

    if (!myCopy) {
      // Active key exists but the user has no private-key copy: degrade to
      // unavailable (v4 fallback), no throw.
      sharedPrivateKey = null;
      activeKey = active;
      loaded = true;
      failedAt = 0;
      return;
    }

    // Hop 1: decrypt the user's copy with their own (unlocked) GPG key.
    const cleartext = await decryptMessage(myCopy.data);
    if (!isCurrent()) return;
    const blob = narrowPrivateKeyBlob(cleartext);
    if (!blob) throw new Error('Malformed shared metadata private-key blob.');

    let priv = await openpgp.readPrivateKey({ armoredKey: blob.armored_key });
    if (!priv.isDecrypted()) {
      try {
        priv = await openpgp.decryptKey({ privateKey: priv, passphrase: blob.passphrase });
      } catch {
        throw new Error('The shared metadata private key could not be unlocked.');
      }
    }

    // READ-side key-substitution defence (symmetric to the encrypt path's
    // verifyArmoredKeyFingerprint): the recovered key's fingerprint must match
    // BOTH the fingerprint the blob itself declares AND the active public
    // MetadataKey record's fingerprint. Any mismatch FAILS CLOSED (catch below
    // -> unavailable + lastError, never a cached key).
    const recoveredFp = await fingerprintOf(blob.armored_key);
    if (!isCurrent()) return;
    const declaredFp = normalizeFingerprint(blob.fingerprint);
    if (!declaredFp || declaredFp !== recoveredFp) {
      throw new Error('Shared metadata key fingerprint does not match its declared fingerprint.');
    }
    const activeFp = active.fingerprint ? normalizeFingerprint(active.fingerprint) : '';
    if (!activeFp || activeFp !== recoveredFp) {
      throw new Error('Shared metadata key fingerprint does not match the server key record.');
    }

    // The vault may have locked while the pure-openpgp steps above ran; if so
    // wipe() bumped gen — do NOT write the decrypted key back.
    if (!isCurrent()) return;
    sharedPrivateKey = priv;
    activeKey = active;
    loaded = true;
    failedAt = 0;
  } catch (err: unknown) {
    if (!isCurrent()) return;
    // Transient failure (fetch/decrypt/verify): do NOT mark `loaded` — that
    // would freeze this session in "unavailable" with no retry path (v5 rows
    // stuck on placeholders forever, RESOURCE_SAVE silently writing v4,
    // exports dropping every v5 row). Record the failure time instead so
    // ensureLoaded() retries after a short backoff. Fail-closed states (e.g.
    // fingerprint mismatch) simply keep failing closed on each retry.
    sharedPrivateKey = null;
    activeKey = null;
    loaded = false;
    failedAt = Date.now();
    lastError = err instanceof Error && err.message ? err.message : String(err);
  }
}

/**
 * Ensure the shared metadata key has been (attempted to be) loaded for this
 * session. `force` re-fetches (metadata key rotation), bypassing the failure
 * backoff. Single-flight; a load failure degrades to available=false with
 * `error` set, it never throws.
 *
 * Failure handling: only terminal states (success / server-confirmed no key)
 * are cached for the session. A failed attempt is retried on the next call
 * once FAILURE_RETRY_MS has elapsed — so the vault's periodic refetch, a
 * later save, or an export self-heals after a transient network blip, while
 * a 100-row decrypt batch against a broken server still costs one fetch.
 */
export async function ensureLoaded(
  force = false,
): Promise<{ available: boolean; activeKeyId: string | null; error: string | null }> {
  if (force) loaded = false;
  if (!loaded) {
    if (inflight) {
      // A load is already running (possibly started by another caller): join
      // it — never stack a second fetch, even when forced.
      await inflight;
    } else if (force || failedAt === 0 || Date.now() - failedAt >= FAILURE_RETRY_MS) {
      inflight = load().finally(() => {
        inflight = null;
      });
      await inflight;
    }
    // else: the last attempt failed < FAILURE_RETRY_MS ago — serve the cached
    // failure (available:false + error) without hammering the server; the
    // first call after the backoff window retries automatically.
  }
  return {
    available: !!(sharedPrivateKey && activeKey),
    activeKeyId: activeKey?.id ?? null,
    error: lastError,
  };
}

/**
 * Decrypt a v5 resource `metadata` blob encrypted to the SHARED metadata key
 * (user_key blobs are decrypted with the session key directly, not here).
 */
export async function decryptResourceMetadata(armoredMetadata: string): Promise<string> {
  const { available, error } = await ensureLoaded();
  if (!available || !sharedPrivateKey) {
    throw new Error(error ?? 'The shared metadata key is not available.');
  }
  return decryptMessage(armoredMetadata, sharedPrivateKey);
}

/**
 * Encrypt a v5 metadata JSON blob to the active SHARED metadata key. FIRST
 * verifies the active key's armored PUBLIC key against its reported fingerprint
 * (server-substitution defence), then returns the v5 write triple.
 */
export async function encryptResourceMetadata(plaintextJson: string): Promise<{
  metadata: string;
  metadata_key_id: string;
  metadata_key_type: MetadataKeyType;
}> {
  const { available, error } = await ensureLoaded();
  const active = activeKey;
  if (!available || !active || !sharedPrivateKey) {
    throw new Error(error ?? 'No usable shared metadata key to encrypt with.');
  }
  await verifyArmoredKeyFingerprint(
    active.armored_key,
    active.fingerprint,
    'the shared metadata key',
  );
  const metadata = await encryptMessage(plaintextJson, [active.armored_key]);
  return { metadata, metadata_key_id: active.id, metadata_key_type: 'shared_key' };
}

/**
 * Auth-domain handlers (WP-AUTH-SETUP): the staged onboarding-key RPCs
 * (SETUP_GENERATE_KEY / SETUP_IMPORT_KEY / SETUP_COMMIT) and MFA_VERIFY per
 * shared/rpc/auth.ts, plus registry OVERRIDES of the legacy UNLOCK/GET_STATUS
 * cases (the registry is consulted before index.ts's switch) to add the
 * login-time MFA phase:
 *
 *   UNLOCK: decrypt key → ensure a JWT (GpgAuth if needed) → probe a genuinely
 *   MFA-gated endpoint (GET /users/me.json, the SPA's probeMfaRequired
 *   semantics). A 403 carrying a non-empty mfa_providers list means the server
 *   demands a code: the decrypted key is PARKED IN WORKER MEMORY ONLY (never
 *   any storage) while the pending JWT+providers are additionally mirrored
 *   into chrome.storage.session so the challenge survives an MV3 worker
 *   teardown; the returned StatusResult stays phase:'locked' with
 *   `mfa:{required,providers}` — the vault is not usable until MFA_VERIFY
 *   succeeds.
 *
 *   MFA_VERIFY: POST /mfa/verify/{provider}.json with the parked JWT; on
 *   success the session is finalized exactly like a normal unlock (JWT stored,
 *   key armed in memory, account cached, broadcast).
 *
 *   GET_STATUS: identical to the legacy handler except it re-attaches the
 *   pending-MFA flag, so a popup/app re-render (SESSION_CHANGED refresh) keeps
 *   showing the challenge instead of bouncing back to the passphrase form.
 *
 * KEY_INFO is foundation-owned and lives in handlers/core.ts.
 */
import * as openpgp from 'openpgp';
import { t } from '../../shared/i18n';
import type { AccountInfo, Req, StatusResult } from '../../shared/messages';
import { apiBase, gpgAuth } from '../http';
import { generateKeyPair, normalizeFingerprint } from '../crypto';
import {
  K,
  get,
  set,
  del,
  lock,
  armLock,
  currentStatus,
  broadcastSessionState,
  invalidateResourceCache,
  setResourceTypeCache,
  setUnlockedKey,
  registerLockHook,
  runSessionResetHooks,
} from '../state';
import type { HandlerMap } from '../registry';

type SetupGenerateKeyReq = Extract<Req, { type: 'SETUP_GENERATE_KEY' }>;
type SetupImportKeyReq = Extract<Req, { type: 'SETUP_IMPORT_KEY' }>;
type SetupCommitReq = Extract<Req, { type: 'SETUP_COMMIT' }>;
type MfaVerifyReq = Extract<Req, { type: 'MFA_VERIFY' }>;
type UnlockReq = Extract<Req, { type: 'UNLOCK' }>;

interface RawUser {
  id: string;
  username: string;
  profile?: { first_name?: string; last_name?: string } | null;
  gpgkey?: { fingerprint?: string } | null;
}

// ---------------------------------------------------------------------------
// pending login-time MFA state. The decrypted PRIVATE KEY is parked in worker
// memory ONLY (never any storage, by design). The pending JWT + providers are
// ALSO mirrored into chrome.storage.session (memory-backed, TRUSTED_CONTEXTS
// only, cleared when the browser closes) so the advertised 5-minute TTL
// survives the ~30s MV3 service-worker teardown while the user fetches their
// authenticator — without the mirror, MFA_VERIFY on a cold-started worker found
// no pending state and threw the user all the way back to a fresh passphrase +
// GpgAuth run. After a teardown the key is unrecoverable (that IS the security
// model), so a rehydrated entry carries key:null; MFA_VERIFY still clears the
// server-side gate with the mirrored JWT, persists it, and the user only
// re-types the passphrase (cheap storedJwt path — no GpgAuth, no second code).
// Wiped from BOTH places on every lock()/logout.
// ---------------------------------------------------------------------------
interface PendingMfa {
  /** null after a worker restart: the decrypted key never leaves worker memory. */
  key: openpgp.PrivateKey | null;
  jwt: string;
  providers: string[];
  ts: number;
}
const PENDING_MFA_TTL_MS = 5 * 60_000;
const PENDING_MFA_SS_KEY = 'pending_mfa';
let pendingMfa: PendingMfa | null = null;

function clearPendingMfa(): void {
  pendingMfa = null;
  // Lock hooks must stay synchronous — the mirror removal is fire-and-forget.
  void chrome.storage.session.remove(PENDING_MFA_SS_KEY).catch(() => undefined);
}
registerLockHook(clearPendingMfa);

async function alivePendingMfa(): Promise<PendingMfa | null> {
  if (pendingMfa && Date.now() - pendingMfa.ts > PENDING_MFA_TTL_MS) clearPendingMfa();
  if (pendingMfa) return pendingMfa;
  // Cold-started worker: rehydrate the parked JWT (NEVER the key) while the
  // 5-minute window is still open; scrub an expired mirror.
  try {
    const o = await chrome.storage.session.get(PENDING_MFA_SS_KEY);
    const raw = o[PENDING_MFA_SS_KEY] as
      | { jwt?: unknown; providers?: unknown; ts?: unknown }
      | undefined;
    if (raw && typeof raw.jwt === 'string' && typeof raw.ts === 'number') {
      if (Date.now() - raw.ts <= PENDING_MFA_TTL_MS) {
        pendingMfa = {
          key: null,
          jwt: raw.jwt,
          providers: Array.isArray(raw.providers)
            ? raw.providers.filter((p): p is string => typeof p === 'string')
            : [],
          ts: raw.ts,
        };
        return pendingMfa;
      }
      void chrome.storage.session.remove(PENDING_MFA_SS_KEY).catch(() => undefined);
    }
  } catch {
    /* storage.session unavailable — memory-only behavior (legacy) */
  }
  return null;
}

// ---------------------------------------------------------------------------
// MFA probe (SPA services/mfa.ts probeMfaRequired, worker edition)
// ---------------------------------------------------------------------------
type ProbeResult =
  | { kind: 'ok'; me: RawUser }
  | { kind: 'mfa'; providers: string[] }
  | { kind: 'dead'; message: string };

/**
 * Probe GET /users/me.json with an EXPLICIT bearer token (which may not be in
 * storage.local yet — a pending JWT is persisted there only once the MFA gate
 * is cleared; until then it lives in worker memory + the session-only mirror).
 *   2xx                              → session usable, `me` returned;
 *   403 with non-empty mfa_providers → MFA gate (providers returned);
 *   anything else                    → dead/unusable session.
 * Side-effect free: unlike apiCallRaw it never drops K.jwt or locks.
 */
async function probeMe(jwt: string): Promise<ProbeResult> {
  const base = await apiBase();
  let res: Response;
  try {
    res = await fetch(base + '/users/me.json', {
      headers: { Authorization: `Bearer ${jwt}` },
    });
  } catch {
    return { kind: 'dead', message: t('bg.requestFailed', { status: 0 }) };
  }
  const json = (await res.json().catch(() => null)) as Record<string, unknown> | null;
  const hasEnvelope = !!(json && typeof json === 'object' && 'header' in json);
  const body = (hasEnvelope ? (json as { body?: unknown }).body : json) as
    | (Partial<RawUser> & { mfa_providers?: unknown })
    | null;

  if (res.ok && body && typeof body.id === 'string' && typeof body.username === 'string') {
    return { kind: 'ok', me: body as RawUser };
  }
  const providers =
    body && Array.isArray(body.mfa_providers)
      ? body.mfa_providers.filter((p): p is string => typeof p === 'string')
      : [];
  if (res.status === 403 && providers.length > 0) {
    return { kind: 'mfa', providers };
  }
  const message =
    (hasEnvelope && (json?.header as { message?: string } | undefined)?.message) ||
    t('bg.requestFailed', { status: res.status });
  return { kind: 'dead', message };
}

// ---------------------------------------------------------------------------
// session finalization (shared by the no-MFA unlock path and MFA_VERIFY)
// ---------------------------------------------------------------------------
function buildAccount(serverUrl: string, user: RawUser, fingerprint: string): AccountInfo {
  const p = user.profile;
  const fullName = p ? `${p.first_name ?? ''} ${p.last_name ?? ''}`.trim() : user.username;
  return {
    serverUrl,
    username: user.username,
    fullName: fullName || user.username,
    fingerprint,
    userId: user.id,
    // Server-authoritative (finalizeSession, after a real sign-in): may drive
    // network actions. The cosmetic greet writers leave verified falsy.
    verified: true,
  };
}

async function finalizeSession(
  unlocked: openpgp.PrivateKey,
  jwt: string,
  me: RawUser,
): Promise<StatusResult> {
  clearPendingMfa();
  const serverUrl = (await get<string>(K.serverUrl)) ?? '';
  await set({ [K.jwt]: jwt });
  setUnlockedKey(unlocked);
  const account = buildAccount(serverUrl, me, unlocked.getFingerprint());
  await set({ [K.user]: me, [K.account]: account });
  armLock();
  void broadcastSessionState();
  return currentStatus();
}

/** Park the not-yet-usable session and answer locked + mfa-required. */
async function stashPendingMfa(
  unlocked: openpgp.PrivateKey,
  jwt: string,
  providers: string[],
): Promise<StatusResult> {
  const ts = Date.now();
  pendingMfa = { key: unlocked, jwt, providers, ts };
  // Mirror the JWT + providers (NEVER the decrypted key) into storage.session
  // so the challenge survives an MV3 worker teardown for the full TTL. Awaited:
  // the worker may be torn down right after this handler returns.
  try {
    await chrome.storage.session.set({ [PENDING_MFA_SS_KEY]: { jwt, providers, ts } });
  } catch {
    /* storage.session unavailable — memory-only behavior (legacy) */
  }
  // Drop any stale in-memory key from a previous session: the vault must read
  // as 'locked' (and be unusable) until the challenge is answered.
  setUnlockedKey(null);
  const status = await currentStatus();
  return { ...status, mfa: { required: true, providers } };
}

// ---------------------------------------------------------------------------
// UNLOCK (override of the legacy index.ts case, + MFA probe)
// ---------------------------------------------------------------------------
async function unlockHandler(req: UnlockReq): Promise<StatusResult> {
  clearPendingMfa();
  // Drop caches from a previous session/account (legacy-unlock parity), and run
  // the session-reset hooks: the account/server may have changed WITHOUT a
  // lock() in between (IMPORT_KEY / SET_SERVER historically didn't lock), so
  // account-scoped residue is purged here too — staged autosave plaintext
  // (index.ts pendingSaves: credentials captured under account A must never be
  // committable into account B's vault) and the shared v5 metadata key
  // (metadataKey.ts: never encrypt new-server data to the old server's key).
  invalidateResourceCache();
  setResourceTypeCache(null);
  runSessionResetHooks();

  const armored = await get<string>(K.privateKey);
  const serverUrl = await get<string>(K.serverUrl);
  if (!serverUrl) throw new Error(t('bg.noServerConfiguredShort'));
  if (!armored) throw new Error(t('bg.noPrivateKeyImported'));

  let key: openpgp.PrivateKey;
  try {
    key = await openpgp.readPrivateKey({ armoredKey: armored });
  } catch {
    throw new Error(t('bg.storedKeyCorrupt'));
  }
  let unlocked: openpgp.PrivateKey;
  try {
    unlocked = await openpgp.decryptKey({ privateKey: key, passphrase: req.passphrase });
  } catch {
    throw new Error(t('bg.incorrectPassphrase'));
  }

  // 1) Try the stored JWT (cheap re-unlock path).
  const storedJwt = await get<string>(K.jwt);
  if (storedJwt) {
    const probe = await probeMe(storedJwt);
    if (probe.kind === 'ok') {
      // Guard against a stale JWT minted for a DIFFERENT key (setup/recovery
      // just replaced the account key): reuse the session only when the
      // server-side account's key fingerprint matches the key being unlocked.
      // No fingerprint in the payload → legacy behavior (reuse).
      const serverFpr = probe.me.gpgkey?.fingerprint;
      if (!serverFpr || normalizeFingerprint(serverFpr) === normalizeFingerprint(unlocked.getFingerprint())) {
        return finalizeSession(unlocked, storedJwt, probe.me);
      }
      // fingerprint mismatch → fall through to a fresh GpgAuth with THIS key
    }
    if (probe.kind === 'mfa') {
      // The stored JWT is kept in place until MFA_VERIFY secures a usable
      // replacement (finalizeSession re-persists it): deleting it here made
      // every retry after a failed/expired challenge pay a full GpgAuth run.
      // It was already at rest before this unlock, so nothing new is exposed.
      return stashPendingMfa(unlocked, storedJwt, probe.providers);
    }
    // dead → fall through to a fresh GpgAuth
  }

  // 2) Full 3-stage GpgAuth. The fresh JWT stays in memory until the MFA
  //    question is answered (finalizeSession is what persists it).
  const { jwt } = await gpgAuth(unlocked);
  const probe = await probeMe(jwt);
  if (probe.kind === 'ok') return finalizeSession(unlocked, jwt, probe.me);
  if (probe.kind === 'mfa') return stashPendingMfa(unlocked, jwt, probe.providers);
  throw new Error(probe.message);
}

// ---------------------------------------------------------------------------
// MFA_VERIFY
// ---------------------------------------------------------------------------
async function mfaVerifyHandler(req: MfaVerifyReq): Promise<StatusResult> {
  const pending = await alivePendingMfa();
  if (!pending) throw new Error(t('app.auth.bg.mfaNoPending'));

  const base = await apiBase();
  const res = await fetch(base + `/mfa/verify/${req.provider}.json`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${pending.jwt}`,
    },
    // `remember` is the 0|1 integer enum the backend expects (SPA verifyTotp).
    body: JSON.stringify({ totp: req.code, remember: req.remember ? 1 : 0 }),
  });
  if (!res.ok) {
    // The RPC envelope carries no HTTP status, so the class mapping the SPA's
    // MfaChallenge did from err.response.status happens HERE, pre-localized.
    if (res.status === 429) throw new Error(t('app.components.mfa.errors.tooManyAttempts'));
    if (res.status === 400 || res.status === 403) {
      throw new Error(t('app.components.mfa.errors.invalidCode'));
    }
    const json = (await res.json().catch(() => null)) as {
      header?: { message?: string };
    } | null;
    throw new Error(json?.header?.message || t('bg.requestFailed', { status: res.status }));
  }

  // Gate cleared — the probe must now pass; only then does the JWT get stored.
  const probe = await probeMe(pending.jwt);
  if (probe.kind !== 'ok') throw new Error(t('app.auth.bg.mfaSessionRejected'));
  if (pending.key) return finalizeSession(pending.key, pending.jwt, probe.me);

  // Worker was torn down while the user typed the code: the decrypted key is
  // gone (memory-only, by design) but the JWT is now MFA-cleared, so persisting
  // it honors the "storage ⇒ MFA-satisfied" invariant. The returned status has
  // phase:'locked' WITHOUT the mfa flag — the UI falls back to the passphrase
  // step, and that UNLOCK takes the cheap storedJwt path (no GpgAuth, no second
  // MFA code): the user only re-types the passphrase to re-arm the key.
  clearPendingMfa();
  await set({ [K.jwt]: pending.jwt });
  void broadcastSessionState();
  return currentStatus();
}

// ---------------------------------------------------------------------------
// GET_STATUS (override: legacy behavior + the pending-MFA flag)
// ---------------------------------------------------------------------------
async function getStatusHandler(): Promise<StatusResult> {
  const status = await currentStatus();
  const pending = await alivePendingMfa();
  if (pending && status.phase === 'locked') {
    return { ...status, mfa: { required: true, providers: pending.providers } };
  }
  return status;
}

// ---------------------------------------------------------------------------
// SETUP_GENERATE_KEY / SETUP_IMPORT_KEY / SETUP_COMMIT — staged onboarding keys
//
// A setup/recovery flow must NOT touch the account keys until the server-side
// activation (setup/complete or recover/complete) has succeeded: a browser
// already configured for account A that opens account B's invite/recover link
// and then abandons the flow (or fails it) must leave A fully intact. The
// generated/pasted pair is therefore parked in the staged_* storage slots
// (passphrase-protected armored form — the same at-rest trust as the account
// key, and it survives a worker teardown mid-flow) and only SETUP_COMMIT,
// called by the page right after the complete call succeeded, promotes it.
// ---------------------------------------------------------------------------
async function setupGenerateKeyHandler(req: SetupGenerateKeyReq): Promise<{
  fingerprint: string;
  publicKeyArmored: string;
  privateKeyArmored: string;
}> {
  // generateKeyPair enforces a non-empty passphrase (RSA-3072 default).
  const { armoredPrivateKey, armoredPublicKey, fingerprint } = await generateKeyPair({
    name: req.name,
    email: req.email,
    passphrase: req.passphrase,
    rsaBits: req.rsaBits,
  });

  // STAGE only — the existing account (if any) keeps working until commit.
  await set({ [K.stagedPrivateKey]: armoredPrivateKey, [K.stagedPublicKey]: armoredPublicKey });

  // privateKeyArmored is returned ONCE, solely for the recovery-kit download:
  // it is the passphrase-protected at-rest form, the same trust level as a
  // user-imported private key.
  return { fingerprint, publicKeyArmored: armoredPublicKey, privateKeyArmored: armoredPrivateKey };
}

/** Validate a pasted setup/recovery key and stage it (never the account key). */
async function setupImportKeyHandler(req: SetupImportKeyReq): Promise<{
  fingerprint: string;
  publicKeyArmored: string;
}> {
  // Same validation as the deliberate IMPORT_KEY: parseable AND
  // passphrase-protected (the staged slot must never hold a clear key).
  let key: openpgp.PrivateKey;
  try {
    key = await openpgp.readPrivateKey({ armoredKey: req.armoredPrivateKey });
  } catch {
    throw new Error(t('bg.invalidPrivateKey'));
  }
  if (key.isDecrypted()) throw new Error(t('bg.keyNotProtected'));
  const publicKeyArmored = key.toPublic().armor();
  await set({ [K.stagedPrivateKey]: req.armoredPrivateKey, [K.stagedPublicKey]: publicKeyArmored });
  return { fingerprint: key.getFingerprint(), publicKeyArmored };
}

/**
 * Promote the staged pair to the account keys. The page calls this ONLY once
 * setup/recover complete succeeded server-side. The new identity replaces
 * whatever account lived here: tear down any live session first (also wipes
 * pending MFA / staged saves / metadata key via the lock hooks), then persist
 * the pair and drop the old credentials — the subsequent UNLOCK must run a
 * fresh GpgAuth with THIS key, never reuse a JWT minted for the previous one.
 */
async function setupCommitHandler(req: SetupCommitReq): Promise<StatusResult> {
  const stagedPrivate = await get<string>(K.stagedPrivateKey);
  const stagedPublic = await get<string>(K.stagedPublicKey);
  if (!stagedPrivate || !stagedPublic) throw new Error(t('bg.noPrivateKeyImported'));
  lock();
  await set({ [K.privateKey]: stagedPrivate, [K.publicKey]: stagedPublic });
  await del([K.jwt, K.user, K.account, K.stagedPrivateKey, K.stagedPublicKey]);
  // Persist the flow-validated identity NOW (official parity: the account
  // entity exists from setup/recover completion, not from the first sign-in),
  // so the unlock screen in any tab greets the user by name/email even before
  // the first UNLOCK succeeds. finalizeSession later overwrites this with the
  // server-authoritative /users/me.json data. Entirely best-effort: the staged
  // slots are already consumed above, so a throw here (readKey/set) would leave
  // the promoted keys uncommittable on retry — the greet must NEVER be able to
  // fail the commit, so the whole block is swallowed.
  if (req.account?.username) {
    try {
      let fingerprint = '';
      try {
        fingerprint = (await openpgp.readKey({ armoredKey: stagedPublic })).getFingerprint();
      } catch {
        /* unparseable staged public key — greet without a fingerprint */
      }
      const account: AccountInfo = {
        serverUrl: (await get<string>(K.serverUrl)) ?? '',
        username: req.account.username,
        fullName: req.account.fullName || req.account.username,
        fingerprint,
        userId: req.account.userId,
      };
      await set({ [K.account]: account });
    } catch {
      /* greet is cosmetic — the next successful unlock writes the real account */
    }
  }
  void broadcastSessionState();
  return currentStatus();
}

export const authHandlers: HandlerMap = {
  SETUP_GENERATE_KEY: setupGenerateKeyHandler,
  SETUP_IMPORT_KEY: setupImportKeyHandler,
  SETUP_COMMIT: setupCommitHandler,
  MFA_VERIFY: mfaVerifyHandler,
  UNLOCK: unlockHandler,
  GET_STATUS: getStatusHandler,
};

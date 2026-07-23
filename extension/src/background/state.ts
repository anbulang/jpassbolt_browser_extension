/**
 * Background session & storage state — the single owner of chrome.storage keys,
 * the in-memory unlocked private key, resource caches, the auto-lock alarm and
 * the session-state broadcast. Extracted verbatim from index.ts (behavior
 * unchanged except LOCK_MINUTES 15 -> 30, aligning with the official Passbolt
 * idle timeout per the settled product decision).
 *
 * The decrypted private key lives here in module memory, mirrored into
 * chrome.storage.session (memory-backed, TRUSTED_CONTEXTS only, cleared when
 * the browser closes) so the unlock state survives Chrome's ~30s idle teardown
 * of the MV3 service worker — official Passbolt keeps the passphrase in
 * storage.session for exactly this reason. It is dropped from BOTH places on
 * lock / logout / idle alarm, so the idle-lock alarm (not the SW lifetime) is
 * what ends a session. Other background modules reach the key through the
 * accessors; UI surfaces never see it at all.
 */
import * as openpgp from 'openpgp';
import type {
  AccountInfo,
  SessionChangedMsg,
  SessionSnapshot,
  SessionState,
  StatusResult,
} from '../shared/messages';

// ---------------------------------------------------------------------------
// storage
// ---------------------------------------------------------------------------
export const K = {
  serverUrl: 'server_url',
  privateKey: 'private_key_armored',
  publicKey: 'public_key_armored',
  // Setup/recovery STAGING slots: the pair produced/pasted during an onboarding
  // flow lives here (passphrase-protected armored form, same at-rest trust as
  // privateKey) until SETUP_COMMIT promotes it to the account keys — so an
  // abandoned or failed setup/recovery never clobbers an existing account.
  stagedPrivateKey: 'staged_private_key_armored',
  stagedPublicKey: 'staged_public_key_armored',
  jwt: 'jwt',
  user: 'user',
  account: 'account',
  // SP-11 server-key pin: the server's OpenPGP public key + fingerprint bound to
  // its origin, captured TOFU during setup/recover. Every login runs GpgAuth
  // Stage 0 against it; a change is refused, not silently accepted. Cleared when
  // SET_SERVER moves to a different origin (new server = new trust root).
  serverKey: 'server_key',
  // One-shot marker for the legacy account-identity backfill (index.ts): the
  // heal must run at most once per install, or it would also "heal" states
  // where K.account was deleted ON PURPOSE (SET_SERVER origin change).
  accountBackfillDone: 'account_backfill_done',
} as const;

export async function get<T>(key: string): Promise<T | undefined> {
  const o = await chrome.storage.local.get(key);
  return o[key] as T | undefined;
}
export async function set(items: Record<string, unknown>): Promise<void> {
  await chrome.storage.local.set(items);
}
export async function del(keys: string[]): Promise<void> {
  await chrome.storage.local.remove(keys);
}

// ---------------------------------------------------------------------------
// raw server rows (shared by the caches and the vault read/write paths)
// ---------------------------------------------------------------------------
export interface RawResource {
  id: string;
  name?: string;
  username?: string;
  uri?: string;
  resource_type_id?: string;
  metadata?: string | null;
}
export interface RawResourceType {
  id: string;
  slug: string;
  deleted?: string | null;
}

// ---------------------------------------------------------------------------
// in-memory session (mirrored into chrome.storage.session so it survives MV3
// service-worker teardown; wiped everywhere on lock — that is the point)
// ---------------------------------------------------------------------------
let unlockedKey: openpgp.PrivateKey | null = null;
let resourceCache: RawResource[] | null = null;
let resourceTypeCache: RawResourceType[] | null = null;

/**
 * chrome.storage.session slot holding the DECRYPTED private key (armored).
 * storage.session is memory-backed (never written to disk), cleared when the
 * browser closes, and — with the TRUSTED_CONTEXTS access level enforced below —
 * unreadable from content scripts and web pages. It exists solely so the
 * unlocked session survives Chrome's ~30s idle SW teardown; every lock path
 * clears it via setUnlockedKey(null).
 */
const SESSION_UNLOCKED_KEY = 'unlocked_private_key';
try {
  // TRUSTED_CONTEXTS is already the default; pinning it explicitly guards
  // against a future setAccessLevel loosening elsewhere. Best-effort.
  void chrome.storage.session
    .setAccessLevel({ accessLevel: chrome.storage.AccessLevel.TRUSTED_CONTEXTS })
    .catch(() => undefined);
} catch {
  /* very old Chrome without setAccessLevel — the default is already trusted-only */
}

export function getUnlockedKey(): openpgp.PrivateKey | null {
  return unlockedKey;
}
export function setUnlockedKey(key: openpgp.PrivateKey | null): void {
  unlockedKey = key;
  // Keep the storage.session mirror in lockstep (fire-and-forget: a mirror
  // failure only degrades to the old worker-lifetime unlock, never blocks).
  try {
    if (key) {
      void chrome.storage.session
        .set({ [SESSION_UNLOCKED_KEY]: key.armor() })
        .catch(() => undefined);
    } else {
      void chrome.storage.session.remove(SESSION_UNLOCKED_KEY).catch(() => undefined);
    }
  } catch {
    /* storage.session unavailable — in-memory state remains authoritative */
  }
}

/**
 * Cold-start rehydration of the unlocked key from the storage.session mirror.
 * `sessionEpoch` guards the async gap: every lock() bumps it, and the
 * rehydrate only installs its key when no lock ran meanwhile — otherwise a
 * rehydrate finishing after the idle alarm's lock() (the alarm is often the
 * very event that woke this worker) would resurrect the key lock just wiped.
 */
let sessionEpoch = 0;

const rehydrated: Promise<void> = (async () => {
  const epochAtStart = sessionEpoch;
  try {
    const o = await chrome.storage.session.get(SESSION_UNLOCKED_KEY);
    const armored = o?.[SESSION_UNLOCKED_KEY] as string | undefined;
    if (!armored) return;
    const key = await openpgp.readPrivateKey({ armoredKey: armored });
    if (!key.isDecrypted()) return; // defensive: only ever restore a decrypted key
    if (sessionEpoch === epochAtStart && unlockedKey === null) {
      // Assign directly (not setUnlockedKey): no need to rewrite the mirror.
      // Do NOT re-arm the idle alarm here — chrome.alarms persist across SW
      // restarts, so the user's idle countdown keeps running untouched.
      unlockedKey = key;
    }
  } catch {
    /* unreadable mirror — stay locked; the UI falls back to the unlock screen */
  }
})();

/**
 * Resolves once the cold-start rehydrate has settled. Every read of
 * getUnlockedKey() that can run right after an SW cold start must be behind
 * this (the message router awaits it; currentStatus() does too) — otherwise a
 * request that WOKE the worker would race the rehydrate and see 'locked'.
 */
export function sessionReady(): Promise<void> {
  return rehydrated;
}

export function getResourceCache(): RawResource[] | null {
  return resourceCache;
}
export function setResourceCache(list: RawResource[] | null): void {
  resourceCache = list;
}
/**
 * Single invalidation entry point for every write path (create/share/import/…):
 * forces the next LIST to re-fetch so popup and app never read stale data.
 */
export function invalidateResourceCache(): void {
  resourceCache = null;
}

export function getResourceTypeCache(): RawResourceType[] | null {
  return resourceTypeCache;
}
export function setResourceTypeCache(list: RawResourceType[] | null): void {
  resourceTypeCache = list;
}

// ---------------------------------------------------------------------------
// auto-lock
// ---------------------------------------------------------------------------
const LOCK_ALARM = 'jpb-lock';
export const LOCK_MINUTES = 30;

type LockHook = () => void;
const lockHooks: LockHook[] = [];
/**
 * Register extra teardown to run inside every lock() — e.g. the metadata-key
 * wipe and the pending-autosave purge. Hooks must be synchronous and never
 * throw material errors (failures are swallowed: lock must always complete).
 */
export function registerLockHook(hook: LockHook): void {
  lockHooks.push(hook);
}

/**
 * Session-reset hooks run at the top of every UNLOCK — the moment the session
 * identity may be changing WITHOUT a lock() in between (IMPORT_KEY/SET_SERVER
 * now lock, but unlock stays the belt-and-braces choke point). They purge
 * account-scoped residue that must never leak across accounts/servers: staged
 * autosave plaintext (index.ts pendingSaves) and the shared v5 metadata key
 * (metadataKey.ts). Same contract as lock hooks: synchronous, best-effort.
 */
const sessionResetHooks: LockHook[] = [];
export function registerSessionResetHook(hook: LockHook): void {
  sessionResetHooks.push(hook);
}
export function runSessionResetHooks(): void {
  for (const hook of sessionResetHooks) {
    try {
      hook();
    } catch {
      /* best-effort — a failing hook must not block the unlock */
    }
  }
}

/**
 * (Re)arm the idle-lock alarm. The delay is user-configurable from the app's
 * settings page via chrome.storage.local 'jpb_lock_minutes' (0 = never lock on
 * idle); LOCK_MINUTES is the default when unset. Best-effort async: on any
 * storage failure fall back to the default rather than leaving no alarm.
 */
export function armLock(): void {
  void chrome.storage.local
    .get('jpb_lock_minutes')
    .then((o) => {
      const raw = o['jpb_lock_minutes'] as unknown;
      const minutes = typeof raw === 'number' && raw >= 0 ? raw : LOCK_MINUTES;
      if (minutes === 0) {
        void chrome.alarms.clear(LOCK_ALARM);
        return;
      }
      chrome.alarms.create(LOCK_ALARM, { delayInMinutes: minutes });
    })
    .catch(() => chrome.alarms.create(LOCK_ALARM, { delayInMinutes: LOCK_MINUTES }));
}
export function lock(): void {
  sessionEpoch++; // invalidate any in-flight rehydrate so it cannot resurrect the key
  setUnlockedKey(null); // wipes worker memory AND the storage.session mirror
  resourceCache = null;
  resourceTypeCache = null; // drop the type catalogue too (account/server may change)
  for (const hook of lockHooks) {
    try {
      hook();
    } catch {
      /* teardown is best-effort — a failing hook must not block the lock */
    }
  }
  chrome.alarms.clear(LOCK_ALARM);
  // Covers every lock path (manual, idle alarm, 401 expiry, logout's teardown).
  void broadcastSessionState();
}
chrome.alarms.onAlarm.addListener((a) => {
  if (a.name === LOCK_ALARM) lock();
});

// ---------------------------------------------------------------------------
// status / session-state broadcast (background -> server-domain tabs)
// ---------------------------------------------------------------------------
export async function currentStatus(): Promise<StatusResult> {
  // Never report a phase before the cold-start rehydrate settles — a status
  // computed in that window would claim 'locked' for a still-live session.
  await sessionReady();
  const serverUrl = (await get<string>(K.serverUrl)) ?? '';
  const account = (await get<AccountInfo>(K.account)) ?? null;
  let phase: StatusResult['phase'];
  if (!serverUrl) phase = 'no_server';
  else if (!(await get<string>(K.privateKey))) phase = 'no_account';
  else if (!unlockedKey) phase = 'locked';
  else phase = 'unlocked';
  return { phase, serverUrl, account };
}

/**
 * Current session state reduced to the broadcast enum + username. This is the
 * ENTIRE surface the broadcast is allowed to expose (see messages.ts) — never
 * return anything richer from here.
 */
export async function sessionSnapshot(): Promise<SessionSnapshot> {
  const { phase, account } = await currentStatus();
  const state: SessionState =
    phase === 'unlocked' ? 'unlocked' : phase === 'locked' ? 'locked' : 'logged_out';
  return account?.username ? { state, username: account.username } : { state };
}

/**
 * Broadcast the session state to every open tab on the configured SERVER
 * origin, so the app-takeover bootstrap there can (re)mount the extension
 * iframe (official-Passbolt-style pagemod re-evaluation). Best-effort by
 * design: tabs without a (loaded) content script make sendMessage reject,
 * which is swallowed per tab. No-op while no server is configured.
 */
export async function broadcastSessionState(): Promise<void> {
  try {
    const msg: SessionChangedMsg = { type: 'SESSION_CHANGED', ...(await sessionSnapshot()) };
    // Also notify extension pages (the app iframe, popup, options): the app
    // shell re-checks GET_STATUS on this signal and falls back to the lock
    // screen when the background locked behind its back (idle alarm / 401).
    // Rejected when no page is open — swallowed, best-effort like the tab loop.
    void chrome.runtime.sendMessage(msg).catch(() => undefined);
    const serverUrl = await get<string>(K.serverUrl);
    if (!serverUrl) return;
    let serverOrigin: string;
    try {
      serverOrigin = new URL(serverUrl).origin;
    } catch {
      return;
    }
    const tabs = await chrome.tabs.query({});
    for (const tab of tabs) {
      if (tab.id == null || !tab.url) continue;
      let origin: string;
      try {
        origin = new URL(tab.url).origin;
      } catch {
        continue;
      }
      if (origin !== serverOrigin) continue;
      void chrome.tabs.sendMessage(tab.id, msg).catch(() => undefined);
    }
  } catch {
    /* broadcast is best-effort — never let it break the state transition itself */
  }
}

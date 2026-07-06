/**
 * JPassbolt background service worker — the trusted core.
 *
 * This is the ONLY context that ever holds the decrypted private key or runs
 * OpenPGP. Every UI surface (popup, full vault page, options, autofill content
 * script) talks to it through the message protocol in ../shared/messages.ts and
 * never receives the armored private key or the passphrase.
 *
 * Security model (parity with the official Passbolt extension):
 *  - armored (passphrase-protected) private key + JWT live in chrome.storage.local;
 *  - the DECRYPTED private key lives ONLY in worker memory (state.ts) and is
 *    dropped on lock / logout / idle alarm / worker teardown;
 *  - the passphrase is never persisted.
 *
 * Module layout (see the migration blueprint): state.ts (session/state/lock),
 * http.ts (envelope HTTP + GpgAuth), crypto.ts (OpenPGP primitives),
 * metadataKey.ts (shared v5 metadata key), handlers/* (domain RPCs, merged into
 * a registry consulted before the legacy switch below).
 */
import * as openpgp from 'openpgp';
import type {
  AccountInfo,
  ContentReq,
  ContentResult,
  CreateResourceInput,
  Req,
  RpcResult,
  SecretFields,
  StatusResult,
  VaultItem,
} from '../shared/messages';
import { generateTotp, isValidTotp } from '../shared/totp';
import { pwnedCount } from '../shared/pwned';
import { t } from '../shared/i18n';
import {
  K,
  get,
  set,
  del,
  type RawResource,
  type RawResourceType,
  getUnlockedKey,
  setUnlockedKey,
  getResourceCache,
  setResourceCache,
  invalidateResourceCache,
  getResourceTypeCache,
  setResourceTypeCache,
  armLock,
  lock,
  registerLockHook,
  registerSessionResetHook,
  currentStatus,
  broadcastSessionState,
  sessionReady,
} from './state';
import { apiCall, gpgAuth } from './http';
import { decryptMessage, encryptForSelf } from './crypto';
import type { HandlerMap } from './registry';
import { coreHandlers } from './handlers/core';
import { vaultHandlers } from './handlers/vault';
import { shareHandlers } from './handlers/share';
import { groupsHandlers } from './handlers/groups';
import { authHandlers } from './handlers/auth';
import { importExportHandlers } from './handlers/importexport';

// The retired SPA session-state bridge stored its target origin here; the app
// is extension-hosted now (official-Passbolt-style iframe takeover), so drop
// the stale key on every worker start (idempotent, best-effort).
void chrome.storage.local.remove('app_origin').catch(() => undefined);

// MV3 cold-start compensation: after Chrome tears the idle worker down and
// restarts it, re-announce the (rehydrated) session state so every already-open
// surface — the app iframe, popup, server-origin tabs — re-checks GET_STATUS
// instead of trusting a phase from before the teardown. currentStatus() awaits
// the storage.session rehydrate internally, so this broadcast is accurate; if
// the rehydrate found nothing the UIs fall back to the lock screen right away.
void broadcastSessionState();

const CLIPBOARD_CLEAR_MS = 30_000;

/**
 * Post-submit credentials captured by the content script, awaiting an autosave
 * decision. Keyed by tab id; holds PLAINTEXT only in worker memory and only
 * until the user saves/dismisses or it expires. Cleared on lock/logout (hook).
 */
interface PendingSave { name: string; username: string; uri: string; password: string; ts: number }
const pendingSaves = new Map<number, PendingSave>();
const PENDING_SAVE_TTL_MS = 3 * 60_000;
registerLockHook(() => pendingSaves.clear()); // never retain captured plaintext past a lock
// Also purge on every UNLOCK (session-reset): the account may have changed via
// IMPORT_KEY/recovery without a lock in between — plaintext captured under the
// previous account must never be committable into the new account's vault.
registerSessionResetHook(() => pendingSaves.clear());

// ---------------------------------------------------------------------------
// vault
// ---------------------------------------------------------------------------
interface RawSecret { data: string }

/**
 * Canonical Passbolt v4 resource-type seed UUIDs. The server ships these exact
 * ids; we prefer the live /resource-types.json list but fall back to these so a
 * create still works if that fetch is unavailable. Mirrors the SPA's
 * RESOURCE_TYPE_ID (secretFormat.ts) so resources made here are interoperable.
 */
const RESOURCE_TYPE_ID = {
  PASSWORD_STRING: '669f8c64-242a-59fb-92fc-81f660975fd3',
  PASSWORD_AND_DESCRIPTION: 'a28a04cd-6f53-518a-967c-9963bf9cec51',
} as const;

function toItem(r: RawResource): VaultItem {
  return {
    id: r.id,
    name: r.name || t('bg.encryptedItem'),
    username: r.username || '',
    uri: r.uri || '',
    resourceTypeId: r.resource_type_id || '',
  };
}

async function listResources(force = false): Promise<VaultItem[]> {
  let cache = getResourceCache();
  if (!cache || force) {
    cache = await apiCall<RawResource[]>('GET', '/resources.json');
    setResourceCache(cache);
  }
  armLock();
  return (cache ?? []).map(toItem);
}

/** Live resource-type catalogue (cached); used to resolve a create's type id. */
async function listResourceTypes(): Promise<RawResourceType[]> {
  // Cache only a successful, non-empty fetch. An empty array is truthy, so
  // caching a failed first fetch would pin the seed-UUID fallback for the whole
  // session even after connectivity returns; re-try until we get a real list.
  const cached = getResourceTypeCache();
  if (!cached || cached.length === 0) {
    const fetched = await apiCall<RawResourceType[]>('GET', '/resource-types.json').catch(() => null);
    if (fetched && fetched.length) setResourceTypeCache(fetched);
    return fetched ?? [];
  }
  return cached;
}

/**
 * Resolve the resource_type_id to create under. We always create a
 * "password and description" v4 resource (description encrypted inside the
 * secret) — the most capable v4 shape and the SPA's default. Prefer the live
 * catalogue's id for that slug; fall back to the seed UUID.
 */
async function passwordAndDescriptionTypeId(): Promise<string> {
  const types = await listResourceTypes();
  const match = types.find((t) => t.slug === 'password-and-description' && !t.deleted);
  return match?.id ?? RESOURCE_TYPE_ID.PASSWORD_AND_DESCRIPTION;
}

/** Decrypt the current user's secret for a resource into named fields. */
async function revealSecret(id: string): Promise<{ item: VaultItem; secret: SecretFields }> {
  if (!getUnlockedKey()) throw new Error(t('bg.vaultLocked'));
  const items = await listResources();
  const item = items.find((i) => i.id === id);
  if (!item) {
    // The id came from a previously served list, so the cache is stale (the
    // item was deleted elsewhere). Drop it so FIND_FOR_URL / LIST stop
    // suggesting the ghost entry.
    invalidateResourceCache();
    throw new Error(t('bg.resourceNotFound'));
  }

  let sec: RawSecret;
  try {
    sec = await apiCall<RawSecret>('GET', `/secrets/resource/${id}.json`);
  } catch (e) {
    // The cached list said the item exists but its secret fetch failed — the
    // 404 case means it was deleted server-side after the list was cached.
    // Blanket invalidation is cheap (lazily reloaded full table) and safe even
    // when the failure was transient, so drop the cache and rethrow.
    invalidateResourceCache();
    throw e;
  }
  const clear = await decryptMessage(sec.data);
  const secret = parseSecret(clear);
  armLock();
  return { item, secret };
}

function parseSecret(clear: string): SecretFields {
  try {
    const obj = JSON.parse(clear) as Record<string, unknown>;
    // Object schemas: password-and-description, password-description-totp, and
    // standalone-totp (no password). Legacy 'string' schema falls through.
    if (obj && typeof obj === 'object' && ('password' in obj || 'totp' in obj)) {
      const totp = obj.totp as Record<string, unknown> | undefined;
      return {
        password: typeof obj.password === 'string' ? obj.password : '',
        description: typeof obj.description === 'string' ? obj.description : undefined,
        totp: totp && typeof totp === 'object'
          ? {
              secret_key: String(totp.secret_key ?? ''),
              period: Number(totp.period ?? 30),
              digits: Number(totp.digits ?? 6),
              algorithm: String(totp.algorithm ?? 'SHA1'),
            }
          : undefined,
      };
    }
  } catch {
    // not JSON -> password-string type: the whole clear text is the password
  }
  return { password: clear };
}

function hostOf(u: string): string {
  try {
    return new URL(u.includes('://') ? u : `https://${u}`).hostname.replace(/^www\./, '');
  } catch {
    return '';
  }
}

/**
 * True if `host` is exactly `base` or a subdomain of it. ONE-directional on
 * purpose: a credential scoped to login.example.com must NOT be treated as a
 * match for a broader example.com (or a bare public suffix) frame — that is the
 * direction that would leak plaintext to a different-origin parent. `base` must
 * contain a dot so a garbage/bare-TLD host ("com") never matches everything.
 * Not full public-suffix-aware, but it removes the dangerous over-matches.
 */
function isHostOrSub(host: string, base: string): boolean {
  if (!host || !base || !base.includes('.')) return false;
  return host === base || host.endsWith('.' + base);
}

async function findForUrl(url: string): Promise<VaultItem[]> {
  const target = hostOf(url);
  if (!target) return [];
  const items = await listResources();
  // Suggest an item when the page is on the item's host (or a subdomain of it),
  // or vice-versa. isHostOrSub rejects bare-suffix matches so a junk uri like
  // "com" no longer matches every site.
  return items.filter((i) => {
    const h = hostOf(i.uri);
    return !!h && (isHostOrSub(target, h) || isHostOrSub(h, target));
  });
}

// ---------------------------------------------------------------------------
// resource creation (write path) — encrypt+sign for self, POST /resources.json
// ---------------------------------------------------------------------------
/**
 * Create a new v4 "password and description" resource. Encrypts+signs the secret
 * for the creator only, POSTs to /resources.json (the creator is granted OWNER
 * server-side), then invalidates the cache so the item appears everywhere.
 */
async function createResource(input: CreateResourceInput): Promise<{ item: VaultItem }> {
  if (!getUnlockedKey()) throw new Error(t('bg.vaultLocked'));
  const name = input.name.trim();
  if (!name) throw new Error(t('bg.nameRequired'));
  if (!input.password) throw new Error(t('bg.passwordRequired'));

  const resourceTypeId = await passwordAndDescriptionTypeId();
  // password-and-description: the description is encrypted INSIDE the secret JSON;
  // the cleartext `description` column is therefore sent empty.
  const plaintext = JSON.stringify({
    password: input.password,
    description: input.description ?? '',
  });
  const data = await encryptForSelf(plaintext);

  const dto = {
    name,
    username: input.username.trim(),
    uri: input.uri.trim(),
    description: '',
    resource_type_id: resourceTypeId,
    secrets: [{ data }],
  };
  const created = await apiCall<RawResource>('POST', '/resources.json', dto);
  invalidateResourceCache(); // force a fresh list on next read
  armLock();
  return { item: toItem(created) };
}

// ---------------------------------------------------------------------------
// autosave — stage submitted credentials, then create on user confirmation
// ---------------------------------------------------------------------------
function stageSave(tabId: number, p: Omit<PendingSave, 'ts'>): { ok: true } {
  // Only stage while unlocked AND when there is a password worth saving.
  if (getUnlockedKey() && p.password) {
    pendingSaves.set(tabId, { ...p, ts: Date.now() });
  }
  return { ok: true };
}

/** Read (and prune if expired) the pending save for a tab — WITHOUT the password. */
async function getPendingSave(tabId: number): Promise<{ pending: { name: string; username: string; uri: string } | null }> {
  const p = pendingSaves.get(tabId);
  if (!p) return { pending: null };
  if (Date.now() - p.ts > PENDING_SAVE_TTL_MS) { pendingSaves.delete(tabId); return { pending: null }; }
  // Suppress the prompt if this exact login is already saved. Ensure the list is
  // loaded first (the cache may be cold on a fresh page) and compare host +
  // username case-insensitively (createResource trims; captured creds may not).
  let list: RawResource[] = getResourceCache() ?? [];
  try { await listResources(); list = getResourceCache() ?? list; } catch { /* offline — best-effort */ }
  const host = hostOf(p.uri);
  const user = p.username.trim().toLowerCase();
  const dup = list.some(
    (r) => hostOf(r.uri ?? '') === host && (r.username ?? '').trim().toLowerCase() === user,
  );
  if (dup) { pendingSaves.delete(tabId); return { pending: null }; }
  return { pending: { name: p.name, username: p.username, uri: p.uri } };
}

async function commitSave(tabId: number): Promise<{ item: VaultItem }> {
  const p = pendingSaves.get(tabId);
  if (!p) throw new Error(t('bg.nothingToSave'));
  // Create FIRST; drop the staged plaintext only once the resource is persisted.
  // A recoverable failure (auto-locked vault, expired JWT, server/network error)
  // then leaves the captured credential available for a retry instead of losing
  // the only in-memory copy. lock() still purges it independently.
  const result = await createResource({ name: p.name, username: p.username, uri: p.uri, password: p.password, description: '' });
  pendingSaves.delete(tabId);
  return result;
}

function discardSave(tabId: number): { ok: true } {
  pendingSaves.delete(tabId);
  return { ok: true };
}

// ---------------------------------------------------------------------------
// account lifecycle
// ---------------------------------------------------------------------------
interface RawUser {
  id: string;
  username: string;
  profile?: { first_name?: string; last_name?: string } | null;
}

function buildAccount(serverUrl: string, user: RawUser, fingerprint: string): AccountInfo {
  const p = user.profile;
  const fullName = p ? `${p.first_name ?? ''} ${p.last_name ?? ''}`.trim() : user.username;
  return { serverUrl, username: user.username, fullName: fullName || user.username, fingerprint, userId: user.id };
}

/** Validate + persist the armored private key (must be passphrase-protected). */
async function importKey(armoredPrivateKey: string): Promise<StatusResult> {
  let key: openpgp.PrivateKey;
  try {
    key = await openpgp.readPrivateKey({ armoredKey: armoredPrivateKey });
  } catch {
    throw new Error(t('bg.invalidPrivateKey'));
  }
  if (key.isDecrypted()) {
    throw new Error(t('bg.keyNotProtected'));
  }
  // A (possibly different) identity replaces whatever account lived here —
  // mirror SETUP_GENERATE_KEY: tear down any live session FIRST. lock() fires
  // every registered hook (pendingSaves plaintext, pending MFA, shared metadata
  // key, import/export staging, vault caches), then the previous account's
  // credentials are dropped so the next UNLOCK runs a fresh GpgAuth with THIS
  // key instead of reusing a JWT minted for the previous one — a stale session
  // must never be able to write state captured under account A into account B.
  lock();
  await set({
    [K.privateKey]: armoredPrivateKey,
    [K.publicKey]: key.toPublic().armor(),
  });
  await del([K.jwt, K.user, K.account]);
  void broadcastSessionState();
  return currentStatus();
}

/**
 * Unlock: decrypt the stored key into memory, then ensure a valid JWT (running
 * GpgAuth if needed). Used for both first login and re-unlock after idle/lock.
 */
async function unlock(passphrase: string): Promise<StatusResult> {
  // Drop any in-memory caches from a previous session/account so a re-import +
  // unlock never serves the prior account's resource list or type catalogue.
  invalidateResourceCache();
  setResourceTypeCache(null);
  pendingSaves.clear();

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
    unlocked = await openpgp.decryptKey({ privateKey: key, passphrase });
  } catch {
    throw new Error(t('bg.incorrectPassphrase'));
  }
  setUnlockedKey(unlocked);

  // Ensure a session JWT. Try the existing one with a cheap authenticated call;
  // if it's missing/expired, run the full 3-stage GpgAuth.
  let haveSession = false;
  if (await get<string>(K.jwt)) {
    try {
      await apiCall<RawUser>('GET', '/users/me.json');
      haveSession = true;
    } catch {
      haveSession = false;
    }
  }
  if (!haveSession) {
    const { jwt } = await gpgAuth(unlocked);
    await set({ [K.jwt]: jwt });
  }

  const me = await apiCall<RawUser>('GET', '/users/me.json');
  const account = buildAccount(serverUrl, me, unlocked.getFingerprint());
  await set({ [K.user]: me, [K.account]: account });
  armLock();
  void broadcastSessionState();
  return currentStatus();
}

async function logout(): Promise<StatusResult> {
  lock();
  await del([K.privateKey, K.publicKey, K.jwt, K.user, K.account]);
  void broadcastSessionState(); // now resolves to 'logged_out' (key removed)
  return currentStatus();
}

// ---------------------------------------------------------------------------
// autofill: decrypt then ask the active tab's content script to fill
// ---------------------------------------------------------------------------
/**
 * Resolve which tab to fill. The popup normally targets the active tab of the
 * current window; the DETACHED quickaccess window is itself the current window,
 * so it passes the originating page's tabId explicitly.
 */
async function targetTabId(explicit?: number): Promise<number> {
  if (explicit != null) return explicit;
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id) throw new Error(t('bg.noActiveTab'));
  return tab.id;
}

/**
 * Deliver a fill message to every frame of a tab (top frame first) and return
 * true on the first frame that reports a successful fill. With all_frames
 * injection a login form may live in a sub-frame, so a single tab-wide send
 * (which resolves with a nondeterministic first responder) is not enough.
 */
async function fillAcrossFrames(tabId: number, msg: ContentReq, wantedHost?: string): Promise<boolean> {
  let frames: chrome.webNavigation.GetAllFrameResultDetails[] | null = null;
  try {
    frames = await chrome.webNavigation.getAllFrames({ tabId });
  } catch { /* webNavigation unavailable */ }

  let frameIds: number[];
  if (wantedHost) {
    // Deliver the decrypted cleartext ONLY to frames on the resource's own host
    // (exact or a subdomain). If NOTHING matches — including the top frame —
    // refuse: never type site-A's password into a mismatched/cross-origin frame,
    // and never broadcast it to unrelated sub-frames (ads/widgets/trackers).
    frameIds = (frames ?? [])
      .filter((f) => isHostOrSub(hostOf(f.url ?? ''), wantedHost))
      .map((f) => f.frameId)
      .sort((a, b) => a - b);
    // No frame inventory at all (permission/edge) -> we cannot prove the top
    // frame's host, so refuse rather than blind-fill a possibly-wrong site.
  } else {
    // Unknown intended host (a uri-less item the user explicitly chose to fill):
    // target the visible TOP frame only — never sub-frames.
    frameIds = [0];
  }

  for (const frameId of frameIds) {
    const res = (await chrome.tabs.sendMessage(tabId, msg, { frameId }).catch(() => null)) as ContentResult | null;
    if (res && 'filled' in res && res.filled) return true;
  }
  return false;
}

async function fillActiveTab(id: string, tabId?: number): Promise<{ filled: boolean }> {
  const { item, secret } = await revealSecret(id);
  const target = await targetTabId(tabId);
  const msg: ContentReq = { type: 'DO_FILL', username: item.username, password: secret.password };
  return { filled: await fillAcrossFrames(target, msg, hostOf(item.uri) || undefined) };
}

/** Decrypt the resource's TOTP, compute the current code, and fill it on the page. */
async function fillTotpActiveTab(id: string, tabId?: number): Promise<{ filled: boolean }> {
  const { item, secret } = await revealSecret(id);
  if (!isValidTotp(secret.totp)) throw new Error(t('bg.noTotpConfigured'));
  const { code } = await generateTotp(secret.totp);
  const target = await targetTabId(tabId);
  const msg: ContentReq = { type: 'DO_FILL_TOTP', code };
  return { filled: await fillAcrossFrames(target, msg, hostOf(item.uri) || undefined) };
}

// ---------------------------------------------------------------------------
// quickaccess launcher (in-page "browse all passwords")
// ---------------------------------------------------------------------------
/**
 * Open the quickaccess popup. Prefer chrome.action.openPopup() (Chrome 127+),
 * which shows the SAME popup UI anchored to the toolbar icon; it needs a user
 * gesture and is not available everywhere, so on any failure fall back to the
 * existing DETACHED quickaccess window (still the popup UI, not a full-page
 * tab). The originating tab id is carried so the small window can target the
 * page it was opened from.
 */
async function openQuickaccess(): Promise<{ ok: true }> {
  if (typeof chrome.action?.openPopup === 'function') {
    try {
      await chrome.action.openPopup();
      return { ok: true };
    } catch { /* needs a gesture / unsupported — fall through to the window */ }
  }
  let tabId: number | undefined;
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    tabId = tab?.id;
  } catch { /* no active tab discoverable — open without a target */ }
  const qs = tabId != null ? `?detached=1&tabId=${tabId}` : '?detached=1';
  await chrome.windows.create({
    url: chrome.runtime.getURL('popup.html' + qs),
    type: 'popup',
    width: 380,
    height: 600,
  });
  return { ok: true };
}

// ---------------------------------------------------------------------------
// clipboard (via an offscreen document — the SW has no DOM of its own)
// ---------------------------------------------------------------------------
let creatingOffscreen: Promise<void> | null = null;

async function ensureOffscreen(): Promise<void> {
  if (await chrome.offscreen.hasDocument?.()) return;
  if (!creatingOffscreen) {
    creatingOffscreen = chrome.offscreen.createDocument({
      url: 'offscreen.html',
      reasons: [chrome.offscreen.Reason.CLIPBOARD],
      justification: 'Write and auto-clear the clipboard for password copy.',
    }).catch(() => undefined) as Promise<void>;
  }
  try { await creatingOffscreen; } finally { creatingOffscreen = null; }
}

/** Copy `text`; when `clearAfterMs > 0` the offscreen doc wipes it afterwards. */
async function copyToClipboard(text: string, clearAfterMs: number): Promise<void> {
  await ensureOffscreen();
  // The offscreen doc reports execCommand('copy')'s result; a failed write
  // must reject the COPY RPC so the UI shows an error instead of a fake
  // "copied" toast while the clipboard still holds its previous content.
  const res = (await chrome.runtime.sendMessage({ target: 'offscreen', type: 'clipboard-write', text, clearAfterMs })) as
    | { ok?: boolean }
    | undefined;
  if (!res?.ok) throw new Error(t('bg.clipboardWriteFailed'));
}

// ---------------------------------------------------------------------------
// message router — registry first (domain handlers), legacy switch fallback
// ---------------------------------------------------------------------------
const handlers: HandlerMap = {
  ...coreHandlers,
  ...vaultHandlers,
  ...shareHandlers,
  ...groupsHandlers,
  ...authHandlers,
  ...importExportHandlers,
};

function senderTabId(sender: chrome.runtime.MessageSender): number {
  const id = sender.tab?.id;
  if (id == null) throw new Error(t('bg.requiresTabContext'));
  return id;
}

async function handle(req: Req, sender: chrome.runtime.MessageSender): Promise<unknown> {
  // A request is frequently the very event that woke a torn-down worker: gate
  // EVERY dispatch on the storage.session rehydrate so the synchronous
  // getUnlockedKey() checks inside the handlers (and crypto.ts) never race it
  // and throw a spurious 'vault locked' for a session that is still live.
  await sessionReady();
  const handler = handlers[req.type];
  if (handler) return handler(req, sender);
  switch (req.type) {
    case 'GET_STATUS':
      return currentStatus();
    case 'SET_SERVER': {
      const nextUrl = req.serverUrl.trim();
      const prevUrl = (await get<string>(K.serverUrl)) ?? '';
      await set({ [K.serverUrl]: nextUrl });
      if (prevUrl && prevUrl !== nextUrl) {
        // The server actually changed: the live session, JWT, cached user /
        // account and the shared v5 metadata key all belong to the OLD server.
        // lock() clears every session-scoped hook (metadata key included) so a
        // later UNLOCK can never encrypt new-server data to the old server's
        // metadata key; the old JWT/user/account are dropped alongside. The
        // account PRIVATE key is kept — pointing an existing account at a moved
        // server must not destroy the key.
        lock();
        await del([K.jwt, K.user, K.account]);
        void broadcastSessionState();
      }
      return currentStatus();
    }
    case 'IMPORT_KEY':
      return importKey(req.armoredPrivateKey);
    case 'UNLOCK':
      return unlock(req.passphrase);
    case 'LOCK':
      lock();
      return currentStatus();
    case 'LOGOUT':
      return logout();
    case 'OPEN_QUICKACCESS':
      return openQuickaccess();
    case 'LIST':
      return { items: await listResources(req.force) };
    case 'REVEAL':
      return revealSecret(req.id);
    case 'FIND_FOR_URL':
      return { items: await findForUrl(req.url) };
    case 'FILL':
      return fillActiveTab(req.id, req.tabId);
    case 'FILL_TOTP':
      return fillTotpActiveTab(req.id, req.tabId);
    case 'PWNED':
      return { count: await pwnedCount(req.password) };
    case 'COPY': {
      // Clear delay is user-configurable from the app's settings page
      // ('jpb_clipboard_clear_ms', 0 = never auto-clear); default 30s.
      const stored = await get<number>('jpb_clipboard_clear_ms');
      const clearMs = typeof stored === 'number' && stored >= 0 ? stored : CLIPBOARD_CLEAR_MS;
      const effectiveMs = req.temporary ? clearMs : 0;
      await copyToClipboard(req.text, effectiveMs);
      // Report the delay actually applied so UI burn notices match reality.
      return { ok: true, clearMs: effectiveMs };
    }
    case 'CREATE_RESOURCE':
      return createResource(req.input);
    case 'STAGE_SAVE':
      return stageSave(senderTabId(sender), { name: req.name, username: req.username, uri: req.uri, password: req.password });
    case 'GET_PENDING_SAVE':
      return getPendingSave(senderTabId(sender));
    case 'COMMIT_SAVE':
      return commitSave(senderTabId(sender));
    case 'DISCARD_SAVE':
      return discardSave(senderTabId(sender));
    default:
      throw new Error(t('bg.unknownRequest', { type: (req as { type: string }).type }));
  }
}

chrome.runtime.onMessage.addListener((req: Req, sender, sendResponse) => {
  handle(req, sender)
    .then((data) => sendResponse({ ok: true, data } as RpcResult<unknown>))
    .catch((e: unknown) =>
      sendResponse({ ok: false, error: e instanceof Error ? e.message : String(e) } as RpcResult<unknown>),
    );
  return true; // keep the message channel open for the async response
});

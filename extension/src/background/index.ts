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
 *  - the DECRYPTED private key lives ONLY in this worker's memory and is dropped
 *    on lock / logout / idle alarm / worker teardown;
 *  - the passphrase is never persisted.
 *
 * Cross-origin note: fetches issued from this worker to hosts in host_permissions
 * are privileged — all response headers (X-GPGAuth-*, Authorization) are readable
 * WITHOUT any server-side CORS exposure, which is why GpgAuth works here even
 * though a plain web page would be blocked.
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

// ---------------------------------------------------------------------------
// storage
// ---------------------------------------------------------------------------
const K = {
  serverUrl: 'server_url',
  privateKey: 'private_key_armored',
  publicKey: 'public_key_armored',
  jwt: 'jwt',
  user: 'user',
  account: 'account',
} as const;

async function get<T>(key: string): Promise<T | undefined> {
  const o = await chrome.storage.local.get(key);
  return o[key] as T | undefined;
}
async function set(items: Record<string, unknown>): Promise<void> {
  await chrome.storage.local.set(items);
}
async function del(keys: string[]): Promise<void> {
  await chrome.storage.local.remove(keys);
}

// ---------------------------------------------------------------------------
// in-memory session (lost on lock / worker teardown — that is the point)
// ---------------------------------------------------------------------------
let unlockedKey: openpgp.PrivateKey | null = null;
let resourceCache: RawResource[] | null = null;
let resourceTypeCache: RawResourceType[] | null = null;
const LOCK_ALARM = 'jpb-lock';
const LOCK_MINUTES = 15;
const CLIPBOARD_CLEAR_MS = 30_000;

/**
 * Post-submit credentials captured by the content script, awaiting an autosave
 * decision. Keyed by tab id; holds PLAINTEXT only in worker memory and only
 * until the user saves/dismisses or it expires. Cleared on lock/logout.
 */
interface PendingSave { name: string; username: string; uri: string; password: string; ts: number }
const pendingSaves = new Map<number, PendingSave>();
const PENDING_SAVE_TTL_MS = 3 * 60_000;

function armLock(): void {
  chrome.alarms.create(LOCK_ALARM, { delayInMinutes: LOCK_MINUTES });
}
function lock(): void {
  unlockedKey = null;
  resourceCache = null;
  resourceTypeCache = null; // drop the type catalogue too (account/server may change)
  pendingSaves.clear(); // never retain captured plaintext past a lock
  chrome.alarms.clear(LOCK_ALARM);
}
chrome.alarms.onAlarm.addListener((a) => {
  if (a.name === LOCK_ALARM) lock();
});

// ---------------------------------------------------------------------------
// HTTP / API (fetch-based; envelope-aware)
// ---------------------------------------------------------------------------
interface Envelope<T> {
  header: { status: string; message: string; code: number };
  body: T | null;
}

async function apiBase(): Promise<string> {
  const url = await get<string>(K.serverUrl);
  if (!url) throw new Error('No server configured. Open Settings and set your JPassbolt server URL.');
  return url.replace(/\/+$/, '') + '/api';
}

async function authHeaders(): Promise<Record<string, string>> {
  const jwt = await get<string>(K.jwt);
  return jwt ? { Authorization: `Bearer ${jwt}` } : {};
}

/** GET/POST/PUT that unwraps the Passbolt envelope and returns body. */
async function apiCall<T>(
  method: 'GET' | 'POST' | 'PUT' | 'DELETE',
  path: string,
  body?: unknown,
): Promise<T> {
  const base = await apiBase();
  const res = await fetch(base + path, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(await authHeaders()),
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  if (res.status === 401) {
    // session expired -> drop credentials, force re-auth
    await del([K.jwt]);
    lock();
    throw new Error('Session expired. Please unlock again.');
  }
  const json = (await res.json().catch(() => null)) as Envelope<T> | null;
  if (!res.ok || !json) {
    throw new Error(json?.header?.message || `Request failed (${res.status}).`);
  }
  return json.body as T;
}

// ---------------------------------------------------------------------------
// GpgAuth (3-stage) — ported from the SPA's auth.ts, fetch + worker edition
// ---------------------------------------------------------------------------
async function gpgAuth(privateKey: openpgp.PrivateKey): Promise<{ jwt: string }> {
  const base = await apiBase();
  const fingerprint = privateKey.getFingerprint();

  // Stage 1: request the encrypted challenge for our keyid.
  const stage1 = await fetch(base + '/auth/login.json', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ data: { gpg_auth: { keyid: fingerprint } } }),
  });
  if (stage1.status === 404) throw new Error('No account on the server matches this key.');
  const encryptedToken = stage1.headers.get('x-gpgauth-user-auth-token');
  if (!encryptedToken) throw new Error('Server did not return a GPGAuth challenge token.');

  // PHP urlencode() semantics: '+' is a space, real '+' arrive as '%2B'.
  const armored = decodeURIComponent(encryptedToken.replace(/\+/g, ' '));
  const message = await openpgp.readMessage({ armoredMessage: armored });
  const { data: nonce } = await openpgp.decrypt({ message, decryptionKeys: privateKey });

  // Stage 2: return the decrypted nonce.
  const stage2 = await fetch(base + '/auth/login.json', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      data: { gpg_auth: { keyid: fingerprint, user_token_result: nonce } },
    }),
  });
  const authHeader = stage2.headers.get('authorization');
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    throw new Error('Authentication failed: no JWT returned.');
  }
  return { jwt: authHeader.substring(7) };
}

// ---------------------------------------------------------------------------
// vault
// ---------------------------------------------------------------------------
interface RawSecret { data: string }
interface RawResource {
  id: string;
  name?: string;
  username?: string;
  uri?: string;
  resource_type_id?: string;
  metadata?: string | null;
}
interface RawResourceType { id: string; slug: string; deleted?: string | null }

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
    name: r.name || '(encrypted item)',
    username: r.username || '',
    uri: r.uri || '',
    resourceTypeId: r.resource_type_id || '',
  };
}

async function listResources(force = false): Promise<VaultItem[]> {
  if (!resourceCache || force) {
    resourceCache = await apiCall<RawResource[]>('GET', '/resources.json');
  }
  armLock();
  return (resourceCache ?? []).map(toItem);
}

/** Live resource-type catalogue (cached); used to resolve a create's type id. */
async function listResourceTypes(): Promise<RawResourceType[]> {
  // Cache only a successful, non-empty fetch. An empty array is truthy, so
  // caching a failed first fetch would pin the seed-UUID fallback for the whole
  // session even after connectivity returns; re-try until we get a real list.
  if (!resourceTypeCache || resourceTypeCache.length === 0) {
    const fetched = await apiCall<RawResourceType[]>('GET', '/resource-types.json').catch(() => null);
    if (fetched && fetched.length) resourceTypeCache = fetched;
    return fetched ?? [];
  }
  return resourceTypeCache;
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
  if (!unlockedKey) throw new Error('Vault is locked.');
  const items = await listResources();
  const item = items.find((i) => i.id === id);
  if (!item) throw new Error('Resource not found.');

  const sec = await apiCall<RawSecret>('GET', `/secrets/resource/${id}.json`);
  const message = await openpgp.readMessage({ armoredMessage: sec.data });
  const { data: clear } = await openpgp.decrypt({ message, decryptionKeys: unlockedKey });
  const secret = parseSecret(typeof clear === 'string' ? clear : await streamToText(clear));
  armLock();
  return { item, secret };
}

async function streamToText(s: unknown): Promise<string> {
  // openpgp may return a WebStream when the input is streamed; coerce to string.
  return await new Response(s as ReadableStream).text();
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
async function ownPublicKeyArmored(): Promise<string> {
  const pub = await get<string>(K.publicKey);
  if (!pub) throw new Error('Your public key is unavailable. Re-import your key in Settings.');
  return pub;
}

/**
 * Encrypt a secret plaintext to the current user's OWN public key, signing with
 * the in-memory private key. Produces exactly one Secret row for the creator —
 * zero-knowledge is preserved (the server only ever sees ciphertext).
 */
async function encryptForSelf(plaintext: string): Promise<string> {
  if (!unlockedKey) throw new Error('Vault is locked.');
  const pub = await openpgp.readKey({ armoredKey: await ownPublicKeyArmored() });
  const message = await openpgp.createMessage({ text: plaintext });
  const armored = await openpgp.encrypt({
    message,
    encryptionKeys: pub,
    signingKeys: unlockedKey, // sign so the secret looks native to official clients
  });
  return armored as string;
}

/**
 * Create a new v4 "password and description" resource. Encrypts+signs the secret
 * for the creator only, POSTs to /resources.json (the creator is granted OWNER
 * server-side), then invalidates the cache so the item appears everywhere.
 */
async function createResource(input: CreateResourceInput): Promise<{ item: VaultItem }> {
  if (!unlockedKey) throw new Error('Vault is locked.');
  const name = input.name.trim();
  if (!name) throw new Error('A name is required.');
  if (!input.password) throw new Error('A password is required.');

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
  resourceCache = null; // force a fresh list on next read
  armLock();
  return { item: toItem(created) };
}

// ---------------------------------------------------------------------------
// autosave — stage submitted credentials, then create on user confirmation
// ---------------------------------------------------------------------------
function stageSave(tabId: number, p: Omit<PendingSave, 'ts'>): { ok: true } {
  // Only stage while unlocked AND when there is a password worth saving.
  if (unlockedKey && p.password) {
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
  let list: RawResource[] = resourceCache ?? [];
  try { await listResources(); list = resourceCache ?? list; } catch { /* offline — best-effort */ }
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
  if (!p) throw new Error('Nothing to save.');
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

async function currentStatus(): Promise<StatusResult> {
  const serverUrl = (await get<string>(K.serverUrl)) ?? '';
  const account = (await get<AccountInfo>(K.account)) ?? null;
  let phase: StatusResult['phase'];
  if (!serverUrl) phase = 'no_server';
  else if (!(await get<string>(K.privateKey))) phase = 'no_account';
  else if (!unlockedKey) phase = 'locked';
  else phase = 'unlocked';
  return { phase, serverUrl, account };
}

/** Validate + persist the armored private key (must be passphrase-protected). */
async function importKey(armoredPrivateKey: string): Promise<StatusResult> {
  let key: openpgp.PrivateKey;
  try {
    key = await openpgp.readPrivateKey({ armoredKey: armoredPrivateKey });
  } catch {
    throw new Error('Invalid OpenPGP private key.');
  }
  if (key.isDecrypted()) {
    throw new Error(
      'This private key is not passphrase-protected. JPassbolt refuses to store an unprotected key.',
    );
  }
  await set({
    [K.privateKey]: armoredPrivateKey,
    [K.publicKey]: key.toPublic().armor(),
  });
  return currentStatus();
}

/**
 * Unlock: decrypt the stored key into memory, then ensure a valid JWT (running
 * GpgAuth if needed). Used for both first login and re-unlock after idle/lock.
 */
async function unlock(passphrase: string): Promise<StatusResult> {
  // Drop any in-memory caches from a previous session/account so a re-import +
  // unlock never serves the prior account's resource list or type catalogue.
  resourceCache = null;
  resourceTypeCache = null;
  pendingSaves.clear();

  const armored = await get<string>(K.privateKey);
  const serverUrl = await get<string>(K.serverUrl);
  if (!serverUrl) throw new Error('No server configured.');
  if (!armored) throw new Error('No private key imported yet.');

  let key: openpgp.PrivateKey;
  try {
    key = await openpgp.readPrivateKey({ armoredKey: armored });
  } catch {
    throw new Error('Stored private key is corrupt. Re-import it in Settings.');
  }
  try {
    unlockedKey = await openpgp.decryptKey({ privateKey: key, passphrase });
  } catch {
    throw new Error('Incorrect passphrase.');
  }

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
    const { jwt } = await gpgAuth(unlockedKey);
    await set({ [K.jwt]: jwt });
  }

  const me = await apiCall<RawUser>('GET', '/users/me.json');
  const account = buildAccount(serverUrl, me, unlockedKey.getFingerprint());
  await set({ [K.user]: me, [K.account]: account });
  armLock();
  return currentStatus();
}

async function logout(): Promise<StatusResult> {
  lock();
  await del([K.privateKey, K.publicKey, K.jwt, K.user, K.account]);
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
  if (!tab?.id) throw new Error('No active tab.');
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
  if (!isValidTotp(secret.totp)) throw new Error('This item has no TOTP configured.');
  const { code } = await generateTotp(secret.totp);
  const target = await targetTabId(tabId);
  const msg: ContentReq = { type: 'DO_FILL_TOTP', code };
  return { filled: await fillAcrossFrames(target, msg, hostOf(item.uri) || undefined) };
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
  await chrome.runtime.sendMessage({ target: 'offscreen', type: 'clipboard-write', text, clearAfterMs });
}

// ---------------------------------------------------------------------------
// message router
// ---------------------------------------------------------------------------
function senderTabId(sender: chrome.runtime.MessageSender): number {
  const id = sender.tab?.id;
  if (id == null) throw new Error('This action requires a tab context.');
  return id;
}

async function handle(req: Req, sender: chrome.runtime.MessageSender): Promise<unknown> {
  switch (req.type) {
    case 'GET_STATUS':
      return currentStatus();
    case 'SET_SERVER':
      await set({ [K.serverUrl]: req.serverUrl.trim() });
      return currentStatus();
    case 'IMPORT_KEY':
      return importKey(req.armoredPrivateKey);
    case 'UNLOCK':
      return unlock(req.passphrase);
    case 'LOCK':
      lock();
      return currentStatus();
    case 'LOGOUT':
      return logout();
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
    case 'COPY':
      await copyToClipboard(req.text, req.temporary ? CLIPBOARD_CLEAR_MS : 0);
      return { ok: true };
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
      throw new Error(`Unknown request: ${(req as { type: string }).type}`);
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

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
const LOCK_ALARM = 'jpb-lock';
const LOCK_MINUTES = 15;
const CLIPBOARD_CLEAR_MS = 30_000;

function armLock(): void {
  chrome.alarms.create(LOCK_ALARM, { delayInMinutes: LOCK_MINUTES });
}
function lock(): void {
  unlockedKey = null;
  resourceCache = null;
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

async function findForUrl(url: string): Promise<VaultItem[]> {
  const target = hostOf(url);
  if (!target) return [];
  const items = await listResources();
  return items.filter((i) => {
    const h = hostOf(i.uri);
    return h && (h === target || target.endsWith('.' + h) || h.endsWith('.' + target));
  });
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
async function fillActiveTab(id: string): Promise<{ filled: boolean }> {
  const { item, secret } = await revealSecret(id);
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id) throw new Error('No active tab.');
  const msg: ContentReq = { type: 'DO_FILL', username: item.username, password: secret.password };
  const res = (await chrome.tabs.sendMessage(tab.id, msg).catch(() => null)) as ContentResult | null;
  return { filled: !!res && 'filled' in res && res.filled };
}

/** Decrypt the resource's TOTP, compute the current code, and fill it on the page. */
async function fillTotpActiveTab(id: string): Promise<{ filled: boolean }> {
  const { secret } = await revealSecret(id);
  if (!isValidTotp(secret.totp)) throw new Error('This item has no TOTP configured.');
  const { code } = await generateTotp(secret.totp);
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id) throw new Error('No active tab.');
  const msg: ContentReq = { type: 'DO_FILL_TOTP', code };
  const res = (await chrome.tabs.sendMessage(tab.id, msg).catch(() => null)) as ContentResult | null;
  return { filled: !!res && 'filled' in res && res.filled };
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
async function handle(req: Req): Promise<unknown> {
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
      return fillActiveTab(req.id);
    case 'FILL_TOTP':
      return fillTotpActiveTab(req.id);
    case 'PWNED':
      return { count: await pwnedCount(req.password) };
    case 'COPY':
      await copyToClipboard(req.text, req.temporary ? CLIPBOARD_CLEAR_MS : 0);
      return { ok: true };
    default:
      throw new Error(`Unknown request: ${(req as { type: string }).type}`);
  }
}

chrome.runtime.onMessage.addListener((req: Req, _sender, sendResponse) => {
  handle(req)
    .then((data) => sendResponse({ ok: true, data } as RpcResult<unknown>))
    .catch((e: unknown) =>
      sendResponse({ ok: false, error: e instanceof Error ? e.message : String(e) } as RpcResult<unknown>),
    );
  return true; // keep the message channel open for the async response
});

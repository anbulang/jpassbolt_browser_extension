// Message protocol between every UI surface (popup / full app page / options /
// autofill content script) and the background service worker. The background is
// the only context that ever holds private-key material; the UI exchanges these
// plain-data messages and never sees the armored private key or passphrase.

import type { TotpConfig } from './totp';
export type { TotpConfig } from './totp';
import { t } from './i18n';
import type { VaultReq, VaultRespMap } from './rpc/vault';
import type { ShareReq, ShareRespMap } from './rpc/share';
import type { GroupsReq, GroupsRespMap } from './rpc/groups';
import type { AuthReq, AuthRespMap } from './rpc/auth';
import type { ImportExportReq, ImportExportRespMap } from './rpc/importexport';

export type VaultPhase = 'no_server' | 'no_account' | 'locked' | 'unlocked';

export interface AccountInfo {
  serverUrl: string;
  username: string;
  fullName: string;
  fingerprint: string;
  userId: string;
  /**
   * True ONLY when written from a successful, server-authoritative sign-in
   * (finalizeSession). The cosmetic pre-unlock greet writers — SETUP_COMMIT and
   * the cold-start backfill — leave it falsy: their serverUrl and
   * identity are unverified guesses safe to DISPLAY but never to drive a network
   * action (e.g. the lost-passphrase recover POST to account.serverUrl).
   */
  verified?: boolean;
}

export interface VaultItem {
  id: string;
  name: string;
  username: string;
  uri: string;
  resourceTypeId: string;
}

/** Decrypted secret, projected into named fields for display / fill. */
export interface SecretFields {
  password: string;
  description?: string;
  totp?: TotpConfig;
}

/**
 * Input for creating a new password resource. The background encrypts (and
 * signs) the secret with the user's OWN key before POSTing — the plaintext
 * password/description never leave this object and are never persisted.
 * Used by both the manual "New password" form and the post-login autosave.
 */
export interface CreateResourceInput {
  name: string;
  username: string;
  uri: string;
  password: string;
  description: string;
}

export interface StatusResult {
  phase: VaultPhase;
  serverUrl: string;
  account: AccountInfo | null;
  /**
   * Present when the server demands an MFA step after UNLOCK: the session is NOT
   * usable yet — the UI must run MFA_VERIFY before treating the vault as open.
   * The pending JWT never leaves background memory.
   */
  mfa?: { required: true; providers: string[] };
}

// ---- authenticated API pass-through (UI -> background -> server) -----------
// The app UI performs plain HTTP through the background so the JWT (and every
// other credential) never reaches the iframe context.
export type HttpMethod = 'GET' | 'POST' | 'PUT' | 'DELETE';

/**
 * Full Passbolt response envelope + HTTP status. Non-2xx responses are returned
 * as-is (NOT thrown) so the UI can inspect header.message / body (e.g. the MFA
 * 403 probe reads body.mfa_providers).
 */
export type ApiEnvelope = {
  status: number;
  header?: {
    id?: string;
    status?: string;
    code?: number;
    message?: string;
    [k: string]: unknown;
  } | null;
  body?: unknown;
};

// ---- session-state broadcast (background -> server tabs + extension pages) -
// Sent to content scripts on the configured SERVER domain so the app-takeover
// bootstrap (content/appBootstrap.ts) can re-evaluate mounting the extension
// iframe, and to extension pages (app iframe) so the shell can fall back to
// the lock screen. HARD SECURITY RULE: the payload may ONLY ever be
//   { state: 'unlocked' | 'locked' | 'logged_out', username?: string }.
// NEVER add private keys, passphrases, JWTs, session tokens, decrypted secrets
// or ANY other credential material — it is a wake-up signal, not a data feed.
export type SessionState = 'unlocked' | 'locked' | 'logged_out';

export interface SessionSnapshot {
  state: SessionState;
  username?: string;
}

/** Background -> content broadcast on every unlock/lock/logout transition. */
export interface SessionChangedMsg extends SessionSnapshot {
  type: 'SESSION_CHANGED';
}

// ---- Requests: UI -> background ------------------------------------------
export type CoreReq =
  | { type: 'GET_STATUS' }
  | { type: 'SET_SERVER'; serverUrl: string }
  | { type: 'UNLOCK'; passphrase: string }
  | { type: 'LOCK' }
  // LOGOUT ends the SESSION only (official semantics): it locks and drops the
  // JWT + cached user, but KEEPS the account private/public key + identity, so
  // the state machine lands on 'locked' (unlock re-enters). REMOVE_ACCOUNT is
  // the destructive "forget this account on this device" action (below).
  | { type: 'LOGOUT' }
  // Remove the account from this device entirely: locks, then deletes the
  // private/public key + JWT + user + account identity + any staged/replaced key
  // slots. Irreversible without the user's own key backup (the server never
  // holds the private key), so callers MUST confirm first.
  | { type: 'REMOVE_ACCOUNT' }
  // Export the account's key material for an offline recovery-kit download. The
  // armored private key is passphrase-protected at rest (same trust level as the
  // official account kit); it goes only to the user's local disk, never the wire.
  | { type: 'EXPORT_ACCOUNT_KEY' }
  // Open the quickaccess popup (from the in-page menu). The background opens the
  // real action popup when it can, else a detached quickaccess window — never a
  // full-page tab.
  | { type: 'OPEN_QUICKACCESS' }
  | { type: 'LIST'; force?: boolean }
  | { type: 'REVEAL'; id: string }
  | { type: 'FIND_FOR_URL'; url: string }
  // tabId lets the detached quickaccess window target the page tab explicitly;
  // omitted, the background falls back to the active tab of the current window.
  | { type: 'FILL'; id: string; tabId?: number }
  | { type: 'FILL_TOTP'; id: string; tabId?: number }
  | { type: 'PWNED'; password: string }
  | { type: 'COPY'; text: string; temporary?: boolean }
  | { type: 'CREATE_RESOURCE'; input: CreateResourceInput }
  // ---- autosave (content script -> background; keyed by sender tab) --------
  // STAGE_SAVE carries the plaintext captured at form submit; it lives ONLY in
  // background memory (cleared on lock) until the user confirms or dismisses.
  | { type: 'STAGE_SAVE'; name: string; username: string; uri: string; password: string }
  | { type: 'GET_PENDING_SAVE' }
  | { type: 'COMMIT_SAVE' }
  | { type: 'DISCARD_SAVE' }
  // Authenticated API pass-through. path must be server-relative ('/...', query
  // included); guest:true sends the request without Authorization (setup flows).
  | { type: 'API_CALL'; method: HttpMethod; path: string; body?: unknown; guest?: boolean };

export interface CoreRespMap {
  GET_STATUS: StatusResult;
  SET_SERVER: StatusResult;
  UNLOCK: StatusResult;
  LOCK: StatusResult;
  LOGOUT: StatusResult;
  REMOVE_ACCOUNT: StatusResult;
  EXPORT_ACCOUNT_KEY: { privateKeyArmored: string; publicKeyArmored: string; username: string };
  OPEN_QUICKACCESS: { ok: true };
  LIST: { items: VaultItem[] };
  REVEAL: { item: VaultItem; secret: SecretFields };
  FIND_FOR_URL: { items: VaultItem[] };
  FILL: { filled: boolean };
  FILL_TOTP: { filled: boolean };
  PWNED: { count: number };
  // clearMs = effective auto-clear delay actually applied (user-configurable
  // jpb_clipboard_clear_ms; 0 when temporary was false or the user disabled
  // clearing), so UI toasts can state the real burn time instead of a constant.
  COPY: { ok: true; clearMs: number };
  CREATE_RESOURCE: { item: VaultItem };
  STAGE_SAVE: { ok: true };
  // The pending-save preview NEVER includes the password (display-only).
  GET_PENDING_SAVE: { pending: { name: string; username: string; uri: string } | null };
  COMMIT_SAVE: { item: VaultItem };
  DISCARD_SAVE: { ok: true };
  API_CALL: ApiEnvelope;
}

// ---- aggregated protocol (core + domain RPC contracts in shared/rpc/*) -----
// Domain packages implement handlers against these; only the foundation package
// may edit the unions (see the migration blueprint's exclusive-ownership rule).
export type Req = CoreReq | VaultReq | ShareReq | GroupsReq | AuthReq | ImportExportReq;

export type RespMap = CoreRespMap &
  VaultRespMap &
  ShareRespMap &
  GroupsRespMap &
  AuthRespMap &
  ImportExportRespMap;

/** Wire envelope returned by the background for every request. */
export type RpcResult<T> = { ok: true; data: T } | { ok: false; error: string };

/**
 * DOM event fired on `window` of EXTENSION pages when an RPC comes back with a
 * vault-locked error while the page presumably believes it is unlocked — i.e.
 * the background lost/locked the session behind the UI's back (MV3 worker
 * teardown with an unreadable storage.session mirror, lock from another
 * surface, …). The app shell listens and re-runs GET_STATUS so it falls back
 * to the lock screen instead of dead-ending on error toasts.
 */
export const SESSION_DESYNC_EVENT = 'jpb:session-desync';

/** UI-side helper: send a typed request and unwrap the result (throws on error). */
export async function rpc<K extends Req['type']>(
  msg: Extract<Req, { type: K }>,
): Promise<RespMap[K]> {
  const res = (await chrome.runtime.sendMessage(msg)) as RpcResult<RespMap[K]> | undefined;
  if (!res) throw new Error(t('bg.noResponse'));
  if (!res.ok) {
    // Both sides render 'bg.vaultLocked' through the same storage-synced locale,
    // so a string compare is stable. Restricted to chrome-extension: pages —
    // never dispatch from a content script, where the host page shares the DOM
    // and could observe the lock-state signal.
    if (
      res.error === t('bg.vaultLocked') &&
      typeof window !== 'undefined' &&
      window.location.protocol === 'chrome-extension:'
    ) {
      try {
        window.dispatchEvent(new CustomEvent(SESSION_DESYNC_EVENT));
      } catch {
        /* best-effort nudge only */
      }
    }
    throw new Error(res.error);
  }
  return res.data;
}

// ---- Background -> content script (autofill) -----------------------------
export type ContentReq =
  | { type: 'DO_FILL'; username: string; password: string }
  | { type: 'DO_FILL_TOTP'; code: string };

export type ContentResult = { filled: boolean };

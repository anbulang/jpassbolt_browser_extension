// Message protocol between every UI surface (popup / full app page / options /
// autofill content script) and the background service worker. The background is
// the only context that ever holds private-key material; the UI exchanges these
// plain-data messages and never sees the armored private key or passphrase.

import type { TotpConfig } from './totp';
export type { TotpConfig } from './totp';
import { t } from './i18n';

export type VaultPhase = 'no_server' | 'no_account' | 'locked' | 'unlocked';

export interface AccountInfo {
  serverUrl: string;
  username: string;
  fullName: string;
  fingerprint: string;
  userId: string;
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
}

// ---- SPA session-state bridge (extension -> web app, ONE-WAY) --------------
// HARD SECURITY RULE for everything that crosses the window.postMessage bridge
// to the JPassbolt web app: the payload may ONLY ever be
//   { state: 'unlocked' | 'locked' | 'logged_out', username?: string }.
// NEVER add private keys, passphrases, JWTs, session tokens, decrypted secrets
// or ANY other credential material to these messages — the receiving end is a
// regular web page. State enum + username, nothing else, ever.
export type BridgeSessionState = 'unlocked' | 'locked' | 'logged_out';

export interface BridgeSessionSnapshot {
  state: BridgeSessionState;
  username?: string;
}

/** Background -> content broadcast on every unlock/lock/logout transition. */
export interface SessionChangedMsg extends BridgeSessionSnapshot {
  type: 'SESSION_CHANGED';
}

// ---- Requests: UI -> background ------------------------------------------
export type Req =
  | { type: 'GET_STATUS' }
  | { type: 'SET_SERVER'; serverUrl: string }
  | { type: 'IMPORT_KEY'; armoredPrivateKey: string }
  | { type: 'UNLOCK'; passphrase: string }
  | { type: 'LOCK' }
  | { type: 'LOGOUT' }
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
  // Session-state query from the bridge content script on the configured web
  // app origin. Response is a BridgeSessionSnapshot — see the hard rule above.
  | { type: 'BRIDGE_GET_SESSION_STATE' };

export interface RespMap {
  GET_STATUS: StatusResult;
  SET_SERVER: StatusResult;
  IMPORT_KEY: StatusResult;
  UNLOCK: StatusResult;
  LOCK: StatusResult;
  LOGOUT: StatusResult;
  OPEN_QUICKACCESS: { ok: true };
  LIST: { items: VaultItem[] };
  REVEAL: { item: VaultItem; secret: SecretFields };
  FIND_FOR_URL: { items: VaultItem[] };
  FILL: { filled: boolean };
  FILL_TOTP: { filled: boolean };
  PWNED: { count: number };
  COPY: { ok: true };
  CREATE_RESOURCE: { item: VaultItem };
  STAGE_SAVE: { ok: true };
  // The pending-save preview NEVER includes the password (display-only).
  GET_PENDING_SAVE: { pending: { name: string; username: string; uri: string } | null };
  COMMIT_SAVE: { item: VaultItem };
  DISCARD_SAVE: { ok: true };
  BRIDGE_GET_SESSION_STATE: BridgeSessionSnapshot;
}

/** Wire envelope returned by the background for every request. */
export type RpcResult<T> = { ok: true; data: T } | { ok: false; error: string };

/** UI-side helper: send a typed request and unwrap the result (throws on error). */
export async function rpc<K extends Req['type']>(
  msg: Extract<Req, { type: K }>,
): Promise<RespMap[K]> {
  const res = (await chrome.runtime.sendMessage(msg)) as RpcResult<RespMap[K]> | undefined;
  if (!res) throw new Error(t('bg.noResponse'));
  if (!res.ok) throw new Error(res.error);
  return res.data;
}

// ---- Background -> content script (autofill) -----------------------------
export type ContentReq =
  | { type: 'DO_FILL'; username: string; password: string }
  | { type: 'DO_FILL_TOTP'; code: string };

export type ContentResult = { filled: boolean };

// Message protocol between every UI surface (popup / full app page / options /
// autofill content script) and the background service worker. The background is
// the only context that ever holds private-key material; the UI exchanges these
// plain-data messages and never sees the armored private key or passphrase.

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
  totp?: string;
}

export interface StatusResult {
  phase: VaultPhase;
  serverUrl: string;
  account: AccountInfo | null;
}

// ---- Requests: UI -> background ------------------------------------------
export type Req =
  | { type: 'GET_STATUS' }
  | { type: 'SET_SERVER'; serverUrl: string }
  | { type: 'IMPORT_KEY'; armoredPrivateKey: string }
  | { type: 'UNLOCK'; passphrase: string }
  | { type: 'LOCK' }
  | { type: 'LOGOUT' }
  | { type: 'LIST'; force?: boolean }
  | { type: 'REVEAL'; id: string }
  | { type: 'FIND_FOR_URL'; url: string }
  | { type: 'FILL'; id: string };

export interface RespMap {
  GET_STATUS: StatusResult;
  SET_SERVER: StatusResult;
  IMPORT_KEY: StatusResult;
  UNLOCK: StatusResult;
  LOCK: StatusResult;
  LOGOUT: StatusResult;
  LIST: { items: VaultItem[] };
  REVEAL: { item: VaultItem; secret: SecretFields };
  FIND_FOR_URL: { items: VaultItem[] };
  FILL: { filled: boolean };
}

/** Wire envelope returned by the background for every request. */
export type RpcResult<T> = { ok: true; data: T } | { ok: false; error: string };

/** UI-side helper: send a typed request and unwrap the result (throws on error). */
export async function rpc<K extends Req['type']>(
  msg: Extract<Req, { type: K }>,
): Promise<RespMap[K]> {
  const res = (await chrome.runtime.sendMessage(msg)) as RpcResult<RespMap[K]> | undefined;
  if (!res) throw new Error('No response from the background service worker.');
  if (!res.ok) throw new Error(res.error);
  return res.data;
}

// ---- Background -> content script (autofill) -----------------------------
export type ContentReq =
  | { type: 'HAS_LOGIN_FORM' }
  | { type: 'DO_FILL'; username: string; password: string };

export type ContentResult = { hasForm: boolean; origin: string } | { filled: boolean };

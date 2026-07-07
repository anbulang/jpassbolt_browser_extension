// Share-domain RPC contract (implemented by background/handlers/share.ts).
// The whole decrypt -> verify-fingerprint -> re-encrypt-per-recipient -> PUT
// orchestration runs in the background; the UI only submits permission deltas.

export interface PermissionChange {
  /** Existing permission row id (absent for new grants). */
  id?: string;
  aro: 'User' | 'Group';
  aro_foreign_key: string;
  /** READ(1) / UPDATE(7) / OWNER(15). */
  type: 1 | 7 | 15;
  delete?: boolean;
  is_new?: boolean;
}

export type ShareReq = {
  type: 'SHARE_APPLY';
  foreignModel: 'resource' | 'folder';
  foreignId: string;
  permissions: PermissionChange[];
};

export interface ShareRespMap {
  SHARE_APPLY: { ok: true };
}

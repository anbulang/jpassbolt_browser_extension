// Groups-domain RPC contract (implemented by background/handlers/groups.ts).
// GROUP_SAVE_REENCRYPT wraps the dry-run -> decrypt -> verify-fingerprint ->
// re-encrypt-for-new-members -> PUT flow entirely inside the background.

export interface GroupUserPatch {
  /** Existing groups_users row id (absent when adding a member). */
  id?: string;
  user_id?: string;
  is_admin?: boolean;
  delete?: boolean;
}

export type GroupsReq = {
  type: 'GROUP_SAVE_REENCRYPT';
  groupId: string;
  payload: { name?: string; groups_users: GroupUserPatch[] };
};

export interface GroupsRespMap {
  /** `group` is the server-returned group body (envelope body verbatim). */
  GROUP_SAVE_REENCRYPT: { group: unknown };
}

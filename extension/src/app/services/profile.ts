/**
 * Thin self-service profile wrappers over the users endpoints, plus a pure
 * avatar URL helper. Keeps "my profile" concerns out of users.ts callers.
 */
import { api } from '../lib/api';
import type { ApiResponse, User } from '../../shared/types';

/** GET /users/me.json — the current authenticated user. */
export async function getMe(): Promise<User> {
  const res = await api.get<ApiResponse<User>>('/users/me.json');
  return res.data.body as User;
}

/**
 * Resolve the current user's real UUID. The backend's PUT /users/{id}.json handler
 * does NOT understand the "me" alias (only GET does), so writes must target the
 * concrete UUID. In the extension there is no localStorage identity cache (the
 * SPA read LS_USER); we always resolve via GET /users/me.json.
 */
async function resolveMyId(): Promise<string> {
  const me = await getMe();
  return me.id;
}

/**
 * Update the current user's own profile names.
 *
 * Implemented as PUT /users/{uuid}.json (NOT /users/me.json): the backend rejects
 * the "me" alias on writes (non-admin -> 403, admin -> 400 "not a valid UUID"), so
 * we resolve the concrete UUID client-side first.
 */
export async function updateOwnProfile(req: {
  first_name?: string;
  last_name?: string;
}): Promise<User> {
  const id = await resolveMyId();
  const res = await api.put<ApiResponse<User>>(`/users/${id}.json`, { profile: req });
  return res.data.body as User;
}

/**
 * Pure helper: resolve a user's avatar URL (off profile.avatar.url), or null
 * when no profile/avatar is present.
 */
export function avatarUrl(
  user: User,
  size: 'small' | 'medium' = 'small'
): string | null {
  const url = user.profile?.avatar?.url;
  if (!url) return null;
  return url[size] ?? null;
}

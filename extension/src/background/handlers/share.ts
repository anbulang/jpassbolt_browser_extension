/**
 * Share-domain handler: SHARE_APPLY per shared/rpc/share.ts.
 *
 * The whole crypto orchestration the retired SPA ran in-page (ShareDialog.tsx
 * :609-757) lives here so plaintext secrets and recipient keys never reach the
 * UI iframe. Flow for a resource share with new grants:
 *
 *   1. POST /share/simulate/resource/{id}.json with the permission deltas —
 *      the backend expands Group AROs to members and EXCLUDES users who
 *      already hold access, so `changes.added` is exactly the set of users
 *      that must receive a re-encrypted secret (keeps the secrets[] payload
 *      consistent with the server's own validation of the final PUT).
 *   2. GET /secrets/resource/{id}.json → decrypt our own ciphertext with the
 *      in-memory session key.
 *   3. Per added user: GET /users/{id}.json → verifyArmoredKeyFingerprint
 *      (server is untrusted on key distribution — never encrypt to an
 *      unverified key) → encrypt the plaintext to THAT user's key only.
 *      Any unresolvable/unverifiable recipient aborts the whole share
 *      (E2EE invariant: a permission without a matching secret would
 *      silently lock that user out).
 *   4. PUT /share/{resource|folder}/{id}.json { permissions, secrets }.
 *      (/share paths use lowercase model names, unlike /move.)
 *
 * Folder shares carry no secrets (folders have no ciphertext) → direct PUT.
 */
import { t } from '../../shared/i18n';
import type { Req } from '../../shared/messages';
import type {
  Secret,
  SecretWrite,
  SharePermissionItem,
  ShareSimulateResult,
  User,
} from '../../shared/types';
import { apiCall } from '../http';
import { decryptMessage, encryptMessage, verifyArmoredKeyFingerprint } from '../crypto';
import { armLock, getUnlockedKey, invalidateResourceCache } from '../state';
import type { HandlerMap } from '../registry';

type ShareApplyReq = Extract<Req, { type: 'SHARE_APPLY' }>;

/**
 * SPA wire fidelity: removal rows go out as bare `{ id, delete: true }` (the
 * RPC's PermissionChange carries the aro fields for typing, but the retired
 * SPA never sent them on deletes); adds/level-changes pass through unchanged.
 */
function toWirePermissions(perms: ShareApplyReq['permissions']): SharePermissionItem[] {
  return perms.map((p) => (p.delete && p.id ? { id: p.id, delete: true } : p));
}

function errText(err: unknown, fallback: string): string {
  if (err instanceof Error && err.message) return err.message;
  if (typeof err === 'string' && err) return err;
  return fallback;
}

/** Encrypt the shared secret to every user the simulate said is gaining access. */
async function buildSecretsForAdded(
  resourceId: string,
  addedUserIds: string[],
): Promise<SecretWrite[]> {
  const existing = await apiCall<Secret>('GET', `/secrets/resource/${resourceId}.json`);
  if (!existing?.data) {
    throw new Error(t('app.components.share.errors.cannotReadSecret'));
  }
  const plaintext = await decryptMessage(existing.data);

  const secrets: SecretWrite[] = [];
  const recipientErrors: string[] = [];
  for (const userId of addedUserIds) {
    try {
      let user: User;
      try {
        user = await apiCall<User>('GET', `/users/${userId}.json`);
      } catch (err) {
        throw new Error(errText(err, t('app.components.share.errors.cannotGetKey', { who: userId })));
      }
      const who = user?.username || userId;
      const armored = user?.gpgkey?.armored_key;
      if (!armored) {
        throw new Error(t('app.components.share.errors.noPublicKey', { who }));
      }
      // Key-substitution defence: cross-check the armored key against the
      // independently reported fingerprint BEFORE encrypting anything to it.
      await verifyArmoredKeyFingerprint(armored, user.gpgkey?.fingerprint, who);
      const data = await encryptMessage(plaintext, [armored]);
      secrets.push({ user_id: userId, resource_id: resourceId, data });
    } catch (err) {
      recipientErrors.push(errText(err, t('app.components.share.errors.cannotGetKey', { who: userId })));
    }
  }
  // All-or-nothing (SPA semantics): one bad recipient key blocks the share.
  if (recipientErrors.length > 0) {
    throw new Error(
      t('app.components.share.errors.missingRecipientKeys', {
        details: recipientErrors.join(' '),
      }),
    );
  }
  return secrets;
}

async function shareApplyHandler(req: ShareApplyReq): Promise<{ ok: true }> {
  const permissions = toWirePermissions(req.permissions);

  if (req.foreignModel === 'folder') {
    // Folders carry no secrets; simulate is resource-only (folders 404).
    await apiCall('PUT', `/share/folder/${req.foreignId}.json`, { permissions, secrets: null });
  } else {
    let secrets: SecretWrite[] | null = null;
    const hasNewGrant = req.permissions.some((p) => !p.delete && (p.is_new || !p.id));
    if (hasNewGrant) {
      const sim = await apiCall<ShareSimulateResult>(
        'POST',
        `/share/simulate/resource/${req.foreignId}.json`,
        { permissions, secrets: null },
      );
      const addedIds = Array.from(new Set((sim?.changes?.added ?? []).map((a) => a.User.id)));
      if (addedIds.length > 0) {
        secrets = await buildSecretsForAdded(req.foreignId, addedIds);
      }
    }
    await apiCall('PUT', `/share/resource/${req.foreignId}.json`, { permissions, secrets });
  }

  // Write path completed: force the next LIST to re-fetch (popup + app).
  invalidateResourceCache();
  if (getUnlockedKey()) armLock();
  return { ok: true };
}

export const shareHandlers: HandlerMap = {
  SHARE_APPLY: shareApplyHandler,
};

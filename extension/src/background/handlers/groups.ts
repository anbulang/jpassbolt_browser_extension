/**
 * Groups-domain handler: GROUP_SAVE_REENCRYPT (shared/rpc/groups.ts).
 *
 * Ported from the SPA's ManageMembersModal.save() (pages/Groups.tsx) into the
 * background so the UI never touches key material. Flow, faithful to the SPA:
 *
 *   1. Only when the change list ADDS members: PUT /groups/{id}/dry-run.json —
 *      the backend answers with `dry-run.SecretsNeeded` (the (resource, user)
 *      pairs that need a new Secret) and `dry-run.Secrets` (the OPERATOR's own
 *      ciphertext per resource, the only thing we can decrypt).
 *   2. Resolve each needed recipient's public key via GET /users/{id}.json and
 *      cross-check it against the server-reported fingerprint
 *      (verifyArmoredKeyFingerprint — key-substitution defence). Refuse the
 *      WHOLE save if any needed recipient has no verifiable key: submitting a
 *      partial secrets[] would silently lock that member out.
 *   3. Decrypt each operator ciphertext once (cached per resource), re-encrypt
 *      the plaintext per (resource, user) pair.
 *   4. PUT /groups/{id}.json with the membership payload + secrets[].
 *
 * Recipient keys are cached per invocation only (SPA semantics) — a module
 * cache could serve a stale key across a key rotation.
 */
import { t } from '../../shared/i18n';
import type { Req } from '../../shared/messages';
import type { GroupsRespMap } from '../../shared/rpc/groups';
import type { Group, GroupDryRunResult, SecretWrite, User } from '../../shared/types';
import { apiCall } from '../http';
import { decryptMessage, encryptMessage, verifyArmoredKeyFingerprint } from '../crypto';
import { armLock, getUnlockedKey, invalidateResourceCache } from '../state';
import type { HandlerMap } from '../registry';

type GroupSaveReq = Extract<Req, { type: 'GROUP_SAVE_REENCRYPT' }>;

/** Best-effort display name for error messages (falls back to the user id). */
function displayName(user: User | null | undefined, fallback: string): string {
  if (!user) return fallback;
  const full = [user.profile?.first_name, user.profile?.last_name].filter(Boolean).join(' ');
  return full || user.username || fallback;
}

/**
 * Resolve + fingerprint-verify the armored public key of one recipient.
 * Returns null when the user has no key OR verification fails — the caller
 * then refuses the whole save (same swallow-to-null contract as the SPA's
 * resolvePublicKey; the aggregate "cannotAddMembers" error names the users).
 */
async function resolveVerifiedKey(
  userId: string,
): Promise<{ armored: string | null; who: string }> {
  try {
    const user = await apiCall<User>('GET', `/users/${userId}.json`);
    const who = displayName(user, userId);
    const gpg = user.gpgkey;
    if (!gpg?.armored_key) return { armored: null, who };
    await verifyArmoredKeyFingerprint(gpg.armored_key, gpg.fingerprint, who);
    return { armored: gpg.armored_key, who };
  } catch {
    return { armored: null, who: userId };
  }
}

async function groupSaveReencrypt(
  req: GroupSaveReq,
): Promise<GroupsRespMap['GROUP_SAVE_REENCRYPT']> {
  const { groupId, payload } = req;
  const changes = payload.groups_users ?? [];
  // Removals / manager-flag flips need no secrets; only additions trigger the
  // dry-run + re-encryption leg (SPA `addingMembers` check).
  const addingMembers = changes.some((c) => !c.delete && !c.id);

  const secrets: SecretWrite[] = [];

  if (addingMembers) {
    if (!getUnlockedKey()) {
      throw new Error(t('app.directory.groups.error.vaultLocked'));
    }

    const dryRun = await apiCall<GroupDryRunResult>('PUT', `/groups/${groupId}/dry-run.json`, {
      groups_users: changes,
    });
    const needed = dryRun['dry-run']?.SecretsNeeded ?? [];
    const operatorSecrets = dryRun['dry-run']?.Secrets ?? [];

    if (needed.length > 0) {
      // Operator's own ciphertext per resource (legacy V1 shape: Secret[0]).
      const operatorByResource = new Map<string, string>();
      for (const entry of operatorSecrets) {
        const inner = entry.Secret?.[0];
        if (inner?.resource_id && inner.data) {
          operatorByResource.set(inner.resource_id, inner.data);
        }
      }

      // Resolve every distinct recipient key up-front so a missing key aborts
      // BEFORE any decryption happens.
      const neededUserIds = Array.from(new Set(needed.map((n) => n.Secret.user_id)));
      const keyByUser = new Map<string, string | null>();
      const nameByUser = new Map<string, string>();
      for (const uid of neededUserIds) {
        const { armored, who } = await resolveVerifiedKey(uid);
        keyByUser.set(uid, armored);
        nameByUser.set(uid, who);
      }
      const missing = neededUserIds.filter((uid) => !keyByUser.get(uid));
      if (missing.length > 0) {
        throw new Error(
          t('app.directory.groups.error.cannotAddMembers', {
            names: missing.map((uid) => nameByUser.get(uid) ?? uid).join(', '),
          }),
        );
      }

      const plaintextByResource = new Map<string, string>();
      for (const item of needed) {
        const { resource_id, user_id } = item.Secret;
        let plaintext = plaintextByResource.get(resource_id);
        if (plaintext === undefined) {
          const cipher = operatorByResource.get(resource_id);
          if (!cipher) {
            // Backend said a secret is needed but supplied no source ciphertext;
            // we cannot safely synthesize one.
            throw new Error(
              t('app.directory.groups.error.missingOperatorSecret', {
                resourceId: resource_id,
              }),
            );
          }
          plaintext = await decryptMessage(cipher);
          plaintextByResource.set(resource_id, plaintext);
        }
        const recipientKey = keyByUser.get(user_id);
        if (!recipientKey) {
          // Validated above; defensive guard.
          throw new Error(t('app.directory.groups.error.recipientKeyMissing'));
        }
        secrets.push({
          resource_id,
          user_id,
          data: await encryptMessage(plaintext, [recipientKey]),
        });
      }
    }
  }

  const group = await apiCall<Group>('PUT', `/groups/${groupId}.json`, {
    ...payload,
    ...(secrets.length > 0 ? { secrets } : {}),
  });

  // Membership changes alter which resources this account can list.
  invalidateResourceCache();
  if (getUnlockedKey()) armLock(); // authenticated activity re-arms the idle lock
  return { group };
}

export const groupsHandlers: HandlerMap = {
  GROUP_SAVE_REENCRYPT: groupSaveReencrypt,
};

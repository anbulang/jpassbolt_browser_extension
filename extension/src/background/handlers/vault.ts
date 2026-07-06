/**
 * Vault-domain handlers: RESOURCE_SAVE and METADATA_DECRYPT_BATCH per
 * shared/rpc/vault.ts. All crypto happens HERE — the app UI only ever ships
 * plaintext form fields in and receives decrypted display fields back.
 *
 * RESOURCE_SAVE type/format resolution:
 *  - `input.resourceTypeSlug` carries the user's type pick (create) / the
 *    resource's current type (update). Legacy fallback when absent:
 *    `secret.description` defined-ness picks password-and-description vs
 *    password-string, and a v5 policy maps to 'v5-default'.
 *  - `input.secret.totp` (REVEAL round-trip from the form) is preserved into
 *    the encoded secret and forces a totp-capable slug — editing a totp
 *    resource must never silently destroy its TOTP.
 *  - UPDATE never changes an existing row's v4/v5 format: an existing v5 row
 *    is always written v5 (FAIL CLOSED if the shared metadata key is not
 *    usable — a transient outage must not downgrade encrypted metadata to
 *    plaintext columns), and an existing v4 row is never silently upgraded to
 *    v5 (the description's trust domain must not widen to the org shared key
 *    as an edit side effect).
 *  - UPDATE re-encrypts the secret for EVERY user with access (official-plugin
 *    semantics): a password rotation must reach all recipients, not only the
 *    editor's own Secret row.
 *  - CREATE consults the org create-format policy via a session-cached fetch;
 *    if the policy cannot be determined at all (fetch failed, no cache) the
 *    save FAILS CLOSED rather than guessing v4.
 */
import { t } from '../../shared/i18n';
import type { Req } from '../../shared/messages';
import type { MetadataDecryptItem, MetadataKeyType } from '../../shared/rpc/vault';
import type { MetadataTypesSettings } from '../../shared/types';
import {
  RESOURCE_TYPE_ID,
  buildResourceMetadataJson,
  decideResourceFormat,
  encodeSecret,
  isV5Resource,
  isV5Slug,
} from '../../shared/vaultFormat';
import { apiCall } from '../http';
import {
  decryptMessage,
  encryptForSelf,
  encryptMessage,
  verifyArmoredKeyFingerprint,
} from '../crypto';
import * as metadataKey from '../metadataKey';
import {
  K,
  armLock,
  get,
  getResourceTypeCache,
  getUnlockedKey,
  invalidateResourceCache,
  registerLockHook,
  setResourceTypeCache,
  type RawResourceType,
} from '../state';
import type { HandlerMap } from '../registry';

type ResourceSaveReq = Extract<Req, { type: 'RESOURCE_SAVE' }>;
type MetadataDecryptBatchReq = Extract<Req, { type: 'METADATA_DECRYPT_BATCH' }>;

// ---------------------------------------------------------------------------
// catalogue lookups
// ---------------------------------------------------------------------------

/**
 * Live resource-type catalogue via the shared state cache (same retry-on-empty
 * semantics as the legacy popup path in index.ts: only a successful, non-empty
 * fetch is cached, so a transient failure never pins the seed-UUID fallback).
 */
async function listResourceTypes(): Promise<RawResourceType[]> {
  const cached = getResourceTypeCache();
  if (!cached || cached.length === 0) {
    const fetched = await apiCall<RawResourceType[]>('GET', '/resource-types.json').catch(
      () => null,
    );
    if (fetched && fetched.length) setResourceTypeCache(fetched);
    return fetched ?? [];
  }
  return cached;
}

// ---------------------------------------------------------------------------
// org create-format policy (session-cached; the format decision must not hinge
// on a single swallowed network error)
// ---------------------------------------------------------------------------

/** Last successfully fetched policy. `undefined` = never fetched this session. */
let typesSettingsCache: MetadataTypesSettings | null | undefined;
registerLockHook(() => {
  typesSettingsCache = undefined;
});

/**
 * Org create-format policy with a session cache. A SUCCESSFUL fetch — including
 * an absent/null policy row, which legitimately means "v4 defaults" — is cached
 * and reported `known`. On a fetch ERROR we fall back to the cached value; with
 * no cache the policy is UNKNOWN and `known` is false — the CREATE path must
 * then fail closed instead of silently writing v4 plaintext columns under what
 * may be a v5 org. The UPDATE path never consults this at all: the existing
 * row's stored format is authoritative.
 */
async function getTypesSettings(): Promise<{
  settings: MetadataTypesSettings | null;
  known: boolean;
}> {
  try {
    const fetched = await apiCall<MetadataTypesSettings | null>(
      'GET',
      '/metadata/types/settings.json',
    );
    typesSettingsCache = fetched ?? null;
    return { settings: typesSettingsCache, known: true };
  } catch {
    if (typesSettingsCache !== undefined) return { settings: typesSettingsCache, known: true };
    return { settings: null, known: false };
  }
}

// ---------------------------------------------------------------------------
// RESOURCE_SAVE helpers
// ---------------------------------------------------------------------------

/** Minimal row shape the update path reads back before deciding the write format. */
interface ExistingResourceRow {
  id: string;
  resource_type_id?: string | null;
  metadata?: string | null;
  metadata_key_type?: MetadataKeyType | null;
}

interface PermissionRow {
  aro?: string;
  aro_foreign_key?: string;
}

interface RecipientUser {
  id?: string;
  username?: string;
  gpgkey?: { armored_key?: string | null; fingerprint?: string | null } | null;
}

/** v4 slugs whose secret shape this handler can round-trip on save. */
const V4_SAVABLE_SLUGS: readonly string[] = [
  'password-string',
  'password-and-description',
  'password-description-totp',
];

/**
 * Resolve a slug to its live catalogue id; seed fallbacks exist only for the
 * three canonical slugs. Anything else unresolved fails closed — writing a
 * guessed resource_type_id would silently rewrite the row's type.
 */
function requireTypeId(types: RawResourceType[], slug: string): string {
  const live = types.find((rt) => rt.slug === slug && !rt.deleted)?.id;
  if (live) return live;
  if (slug === 'password-string') return RESOURCE_TYPE_ID.PASSWORD_STRING;
  if (slug === 'password-and-description') return RESOURCE_TYPE_ID.PASSWORD_AND_DESCRIPTION;
  if (slug === 'v5-default') return RESOURCE_TYPE_ID.V5_DEFAULT;
  throw new Error(t('bg.save.typeUnresolved'));
}

/**
 * All user ids with access to a resource: User-ARO permission rows plus the
 * expanded membership of every Group ARO (mirrors what the server's own
 * all-recipients validation of the final PUT would expect).
 */
async function listUserIdsWithAccess(resourceId: string): Promise<Set<string>> {
  const perms = await apiCall<PermissionRow[]>('GET', `/permissions/resource/${resourceId}.json`);
  const userIds = new Set<string>();
  for (const p of perms ?? []) {
    if (!p.aro_foreign_key) continue;
    if (p.aro === 'User') {
      userIds.add(p.aro_foreign_key);
    } else if (p.aro === 'Group') {
      const group = await apiCall<{ groups_users?: Array<{ user_id?: string }> }>(
        'GET',
        `/groups/${p.aro_foreign_key}.json?contain[groups_users]=1`,
      );
      for (const gu of group?.groups_users ?? []) {
        if (gu.user_id) userIds.add(gu.user_id);
      }
    }
  }
  return userIds;
}

/**
 * UPDATE-mode secrets: re-encrypt the (possibly rotated) plaintext for EVERY
 * user with access, not just the editor — otherwise the other recipients keep
 * (and keep using) the old, possibly leaked ciphertext forever. Our own row
 * uses the locally stored public key (encryptForSelf); every other recipient
 * key comes from the server and is fingerprint-verified BEFORE encrypting
 * (key-substitution defence, same as SHARE_APPLY). All-or-nothing: one
 * unverifiable recipient aborts the save, because a rotation that skips a
 * recipient is not a rotation.
 */
async function buildUpdateSecrets(
  resourceId: string,
  plaintext: string,
): Promise<Array<{ user_id: string; data: string }>> {
  const unlockedKey = getUnlockedKey();
  if (!unlockedKey) throw new Error(t('bg.vaultLocked'));

  const ownId =
    (await get<{ id?: string }>(K.user))?.id ??
    (await get<{ userId?: string }>(K.account))?.userId;

  const userIds = await listUserIdsWithAccess(resourceId);
  // We hold UPDATE/OWNER on this resource, so our own row is always due — keep
  // it even if the ACL read raced a concurrent share change.
  if (ownId) userIds.add(ownId);

  const secrets: Array<{ user_id: string; data: string }> = [];
  const failures: string[] = [];
  for (const uid of userIds) {
    try {
      if (ownId && uid === ownId) {
        secrets.push({ user_id: uid, data: await encryptForSelf(plaintext) });
        continue;
      }
      let user: RecipientUser;
      try {
        user = await apiCall<RecipientUser>('GET', `/users/${uid}.json`);
      } catch {
        throw new Error(t('bg.save.cannotGetKey', { who: uid }));
      }
      const who = user?.username || uid;
      const armored = user?.gpgkey?.armored_key;
      if (!armored) throw new Error(t('bg.save.noPublicKey', { who }));
      await verifyArmoredKeyFingerprint(armored, user?.gpgkey?.fingerprint, who);
      secrets.push({ user_id: uid, data: await encryptMessage(plaintext, [armored], unlockedKey) });
    } catch (err) {
      failures.push(err instanceof Error && err.message ? err.message : String(err));
    }
  }
  if (failures.length > 0) {
    throw new Error(t('bg.save.reencryptFailed', { details: failures.join(' ') }));
  }
  return secrets;
}

// ---------------------------------------------------------------------------
// RESOURCE_SAVE
// ---------------------------------------------------------------------------

async function resourceSaveHandler(
  req: ResourceSaveReq,
): Promise<{ resource: unknown }> {
  if (!getUnlockedKey()) throw new Error(t('bg.vaultLocked'));
  const { mode, resourceId, input } = req;
  const name = input.name.trim();
  if (!name) throw new Error(t('bg.nameRequired'));
  if (!input.secret.password) throw new Error(t('bg.passwordRequired'));
  if (mode === 'update' && !resourceId) {
    throw new Error('RESOURCE_SAVE update requires resourceId.');
  }

  const [policy, keyState, types] = await Promise.all([
    getTypesSettings(),
    metadataKey.ensureLoaded(),
    listResourceTypes(),
  ]);

  // Type signals from the RPC: the explicit slug (preferred), the legacy
  // `secret.description` defined-ness (defined — even '' — means the
  // encrypted-description type), and the REVEAL-round-tripped totp.
  const encDesc = input.secret.description !== undefined;
  const totp = input.secret.totp;
  const requestedSlug = input.resourceTypeSlug;
  const v4FallbackSlug = encDesc ? 'password-and-description' : 'password-string';

  // ---- decide the write format (v4/v5) + the target slug -------------------
  let format: 'v4' | 'v5';
  let targetSlug: string;

  if (mode === 'update') {
    // The EXISTING row's stored format/type is authoritative: an update must
    // never flip v4<->v5 as a side effect of policy/settings/network state.
    const existing = await apiCall<ExistingResourceRow>('GET', `/resources/${resourceId}.json`);
    const existingSlug = existing?.resource_type_id
      ? types.find((rt) => rt.id === existing.resource_type_id)?.slug
      : undefined;
    const existingIsV5 = isV5Resource(existing ?? {}) || isV5Slug(existingSlug ?? '');

    if (existingIsV5) {
      if (existingSlug && !isV5Slug(existingSlug)) {
        // e.g. a v5 standalone-totp row: this form cannot round-trip its secret.
        throw new Error(t('bg.save.unsupportedType', { slug: existingSlug }));
      }
      // FAIL CLOSED: an existing v5 row must stay v5. If the shared metadata
      // key is not usable right now (settings blip, key rotation in flight),
      // abort instead of degrading the encrypted metadata to plaintext columns.
      if (!keyState.available) {
        throw new Error(keyState.error ?? t('bg.save.v5MetadataUnavailable'));
      }
      if (existingSlug === 'v5-default-with-totp' && !totp) {
        throw new Error(t('bg.save.totpWouldBeLost'));
      }
      format = 'v5';
      const picked =
        requestedSlug && isV5Slug(requestedSlug) ? requestedSlug : existingSlug ?? 'v5-default';
      // A totp-typed slug without totp data cannot satisfy its secret schema
      // (only reachable by non-UI callers; a genuine with-totp row threw above).
      targetSlug = totp
        ? 'v5-default-with-totp'
        : picked === 'v5-default-with-totp'
          ? 'v5-default'
          : picked;
    } else {
      if (!existingSlug || !V4_SAVABLE_SLUGS.includes(existingSlug)) {
        // Unknown type id (catalogue outage) or a non-password v4 type
        // (standalone totp, …): writing a guessed shape would corrupt the row.
        throw new Error(
          existingSlug
            ? t('bg.save.unsupportedType', { slug: existingSlug })
            : t('bg.save.typeUnresolved'),
        );
      }
      if (existingSlug === 'password-description-totp' && !totp) {
        throw new Error(t('bg.save.totpWouldBeLost'));
      }
      // v4 stays v4 (SPA semantics): editing a v4 resource never silently
      // upgrades it to v5 — the description's trust domain must not move from
      // the per-recipient secret into the org-wide shared metadata key.
      format = 'v4';
      const picked =
        requestedSlug && V4_SAVABLE_SLUGS.includes(requestedSlug)
          ? requestedSlug
          : v4FallbackSlug;
      // Same schema guard as the v5 branch: no totp data -> no totp-typed slug.
      targetSlug = totp
        ? 'password-description-totp'
        : picked === 'password-description-totp'
          ? v4FallbackSlug
          : picked;
    }
  } else {
    // CREATE: the org policy decides v4 vs v5. FAIL CLOSED when the policy is
    // unknowable (fetch failed AND no session cache) — guessing v4 under a v5
    // org would write name/username/uri/description as server-side plaintext.
    if (!policy.known) throw new Error(t('bg.save.policyUnknown'));
    const selectedSlug = requestedSlug ?? 'v5-default'; // legacy callers: old behavior
    const decision = decideResourceFormat({
      typesSettings: policy.settings,
      selectedSlug,
      metadataKeyAvailable: keyState.available,
      allowPersonalKeys: false, // SPA semantics: v5 is shared_key only today
    });
    if (decision.format === 'v5') {
      format = 'v5';
      // Honor the user's exact v5 pick (the former hardcoded 'v5-default' made
      // every choice collapse). v5-default-with-totp without actual totp data
      // cannot satisfy its secret schema — collapse that one to v5-default.
      targetSlug = totp
        ? 'v5-default-with-totp'
        : selectedSlug === 'v5-default-with-totp'
          ? 'v5-default'
          : selectedSlug;
    } else {
      format = 'v4';
      const picked =
        requestedSlug && V4_SAVABLE_SLUGS.includes(requestedSlug)
          ? requestedSlug
          : v4FallbackSlug;
      targetSlug = totp
        ? 'password-description-totp'
        : picked === 'password-description-totp'
          ? v4FallbackSlug
          : picked;
    }
  }

  const username = input.username?.trim() ?? '';
  const uri = input.uri?.trim() ?? '';

  // SECRET plaintext: per-slug encoding, totp carried through when present.
  const plaintext = encodeSecret(targetSlug, {
    password: input.secret.password,
    description: encDesc ? input.secret.description ?? '' : '',
    ...(totp ? { totp } : {}),
  });

  // CREATE: one Secret row, encrypted+signed for the creator's own key (the
  // server grants OWNER). UPDATE: official-plugin semantics — re-encrypt for
  // EVERY user with access so a rotation actually reaches all recipients.
  const secrets =
    mode === 'update'
      ? await buildUpdateSecrets(resourceId as string, plaintext)
      : [{ data: await encryptForSelf(plaintext) }];

  let body: Record<string, unknown>;
  if (format === 'v5') {
    const resourceTypeId = requireTypeId(types, targetSlug);
    // v5 keeps the FULL description inside the metadata blob. The UI sends it
    // on input.description under a v5 policy (v5 slugs are not
    // encrypted-description types); fall back to the secret copy for safety.
    const description = input.description ?? input.secret.description ?? '';
    const metadataJson = buildResourceMetadataJson({
      resource_type_id: resourceTypeId,
      name,
      username,
      uri,
      description,
    });
    // encryptResourceMetadata verifies the active key's armored public key
    // against its reported fingerprint first (server-substitution defence).
    const triple = await metadataKey.encryptResourceMetadata(metadataJson);
    // v5 payload OMITS the v4 cleartext columns entirely — the backend rejects
    // any non-null v4 field on a v5 payload, so sending '' would fail.
    body = {
      resource_type_id: resourceTypeId,
      metadata: triple.metadata,
      metadata_key_id: triple.metadata_key_id,
      metadata_key_type: triple.metadata_key_type,
      secrets,
    };
  } else {
    body = {
      name,
      username,
      uri,
      // Encrypted-description types keep it in the secret; the column gets ''.
      description: encDesc ? '' : input.description ?? '',
      resource_type_id: requireTypeId(types, targetSlug),
      secrets,
    };
  }
  if (mode === 'create' && input.folderParentId) {
    body.folder_parent_id = input.folderParentId;
  }
  if (input.expired !== undefined) body.expired = input.expired;

  const resource =
    mode === 'create'
      ? await apiCall<unknown>('POST', '/resources.json', body)
      : await apiCall<unknown>('PUT', `/resources/${resourceId}.json`, body);

  invalidateResourceCache(); // popup LIST + app list must both see the write
  armLock();
  return { resource };
}

// ---------------------------------------------------------------------------
// METADATA_DECRYPT_BATCH
// ---------------------------------------------------------------------------

/**
 * Decrypted metadata JSON cache keyed by `${id}:${modified}` — a row whose
 * modified timestamp is unchanged is never re-decrypted across refetches or
 * surfaces (popup and app share it by design). Holds only display-plaintext
 * JSON, wiped on every lock.
 */
const metadataJsonCache = new Map<string, string>();
registerLockHook(() => metadataJsonCache.clear());

function cacheKeyOf(item: MetadataDecryptItem): string {
  return `${item.id}:${item.modified ?? ''}`;
}

async function metadataDecryptBatchHandler(
  req: MetadataDecryptBatchReq,
): Promise<{ results: Record<string, { json?: string; error?: string }> }> {
  if (!getUnlockedKey()) throw new Error(t('bg.vaultLocked'));
  const results: Record<string, { json?: string; error?: string }> = {};

  await Promise.all(
    req.items.map(async (item) => {
      const key = cacheKeyOf(item);
      const cached = metadataJsonCache.get(key);
      if (cached !== undefined) {
        results[item.id] = { json: cached };
        return;
      }
      try {
        const json =
          item.metadataKeyType === 'shared_key'
            ? await metadataKey.decryptResourceMetadata(item.metadata)
            : await decryptMessage(item.metadata); // user_key -> own session key
        metadataJsonCache.set(key, json);
        results[item.id] = { json };
      } catch (err) {
        // One failed row must never sink the batch (e.g. the shared key is not
        // configured yet); the UI keeps its placeholder and retries later.
        results[item.id] = {
          error: err instanceof Error && err.message ? err.message : String(err),
        };
      }
    }),
  );

  armLock();
  return { results };
}

export const vaultHandlers: HandlerMap = {
  RESOURCE_SAVE: resourceSaveHandler,
  METADATA_DECRYPT_BATCH: metadataDecryptBatchHandler,
};

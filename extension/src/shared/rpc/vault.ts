// Vault-domain RPC contract (implemented by background/handlers/vault.ts).
// Types are fixed here by the foundation package — domain packages implement
// against them and never edit this file (see the migration blueprint).

import type { TotpConfig } from '../totp';
// Type-only (erased at build): messages.ts imports VaultReq from here, so a
// value import would close a runtime cycle. `import type` cannot.
import type { VaultItem } from '../messages';

export type TotpCfg = TotpConfig;

/** v5 metadata_key_type discriminator (also reused by background/metadataKey.ts). */
export type MetadataKeyType = 'user_key' | 'shared_key';

/** Plaintext secret collected by the resource form; encrypted ONLY in the background. */
export interface SecretPlain {
  password: string;
  description?: string;
  totp?: TotpCfg;
}

export interface ResourceSaveInput {
  name: string;
  username?: string;
  uri?: string;
  description?: string;
  folderParentId?: string | null;
  expired?: string | null;
  /**
   * Slug of the resource type the user picked in the form (create) / the
   * resource's current type (update). This closes the former RPC-type gap:
   * without it the handler could only guess from `secret.description`
   * defined-ness and hardcode 'v5-default' under a v5 policy — which silently
   * upgraded existing v4 rows to v5 on edit and ignored the user's exact v5
   * slug pick. Optional for legacy callers; the handler still falls back to
   * the defined-ness heuristic (v4) / 'v5-default' (v5) when absent.
   */
  resourceTypeSlug?: string;
  secret: SecretPlain;
}

export interface MetadataDecryptItem {
  id: string;
  /** Armored v5 metadata ciphertext. */
  metadata: string;
  metadataKeyId?: string | null;
  metadataKeyType?: MetadataKeyType | null;
  /** Resource modified timestamp — background cache key component. */
  modified?: string;
}

// ---- quickaccess browse (implemented by background/handlers/quickaccess.ts) --
/**
 * The four server-side filters behind the popup's "Filters" drill-down. Each
 * maps to exactly one GET /resources.json filter, except 'recent' which has no
 * server counterpart (the index is unsorted and unpaginated) and is ordered in
 * the background instead.
 *
 * DO NOT add a "no filter" member that sends `=0`: the backend mirrors PHP's
 * `isset()` quirk, where `filter[is-owned-by-me]=0` applies the filter exactly
 * like `=1`. Not filtering means omitting the parameter, which is what 'recent'
 * does.
 */
export type QuickFilterKind = 'favorite' | 'owned' | 'recent' | 'shared';

/** A browse selection: one of the four filters, or one of the user's groups. */
export type QuickFilter =
  | { kind: QuickFilterKind }
  | { kind: 'group'; groupId: string };

/** Minimal group projection for the popup's Groups drill-down. */
export interface QuickGroup {
  id: string;
  name: string;
}

export type VaultReq =
  | {
      type: 'RESOURCE_SAVE';
      mode: 'create' | 'update';
      resourceId?: string;
      input: ResourceSaveInput;
    }
  | { type: 'METADATA_DECRYPT_BATCH'; items: MetadataDecryptItem[] }
  | { type: 'LIST_FILTERED'; filter: QuickFilter }
  | { type: 'LIST_MY_GROUPS' };

export interface VaultRespMap {
  /** `resource` is the server-returned resource body (envelope body verbatim). */
  RESOURCE_SAVE: { resource: unknown };
  /** Per-id decrypted metadata JSON; a failed item carries `error` instead (batch never throws whole). */
  METADATA_DECRYPT_BATCH: { results: Record<string, { json?: string; error?: string }> };
  /** Already ordered by the background — the server index guarantees no order. */
  LIST_FILTERED: { items: VaultItem[] };
  /** Only groups the current user is a member of, name-sorted. */
  LIST_MY_GROUPS: { groups: QuickGroup[] };
}

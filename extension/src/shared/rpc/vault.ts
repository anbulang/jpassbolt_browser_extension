// Vault-domain RPC contract (implemented by background/handlers/vault.ts).
// Types are fixed here by the foundation package — domain packages implement
// against them and never edit this file (see the migration blueprint).

import type { TotpConfig } from '../totp';

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

export type VaultReq =
  | {
      type: 'RESOURCE_SAVE';
      mode: 'create' | 'update';
      resourceId?: string;
      input: ResourceSaveInput;
    }
  | { type: 'METADATA_DECRYPT_BATCH'; items: MetadataDecryptItem[] };

export interface VaultRespMap {
  /** `resource` is the server-returned resource body (envelope body verbatim). */
  RESOURCE_SAVE: { resource: unknown };
  /** Per-id decrypted metadata JSON; a failed item carries `error` instead (batch never throws whole). */
  METADATA_DECRYPT_BATCH: { results: Record<string, { json?: string; error?: string }> };
}

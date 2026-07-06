/**
 * Pure (crypto-free, DOM-free) resource/secret format helpers, shared by the
 * app UI (form rendering, metadata projection) and the background RESOURCE_SAVE
 * / METADATA_DECRYPT_BATCH handlers. Merged port of the SPA's
 * pages/vault/secretFormat.ts + resourceFormat.ts + resourceMetadata.ts pure
 * parts. Nothing here logs or persists plaintext — callers encrypt/decrypt via
 * the background primitives immediately.
 */
import type { MetadataKeyType, MetadataTypesSettings } from './types';
import type { TotpConfig } from './totp';

// ---------------------------------------------------------------------------
// resource type catalogue constants
// ---------------------------------------------------------------------------

/** Canonical seed ids for the v4 password resource types + the v5 default. */
export const RESOURCE_TYPE_ID = {
  PASSWORD_STRING: '669f8c64-242a-59fb-92fc-81f660975fd3',
  PASSWORD_AND_DESCRIPTION: 'a28a04cd-6f53-518a-967c-9963bf9cec51',
  /**
   * The v5 default ("v5-default") resource type. v5 keeps the same per-recipient
   * encrypted SECRET shape as v4, but moves the resource's name/username/uri/
   * description into an encrypted METADATA blob.
   */
  V5_DEFAULT: 'dd1f723d-0d1e-513f-8218-4055dc0530d0',
} as const;

/** v4 password-shaped resource-type slugs the form offers. */
export const PASSWORD_SLUGS = ['password-string', 'password-and-description'] as const;

/**
 * v5 password-shaped resource-type slugs. Secret side is identical to v4; the
 * difference is the encrypted-metadata envelope. The form surfaces these instead
 * of the v4 slugs ONLY when the org policy selects v5.
 */
export const V5_PASSWORD_SLUGS = [
  'v5-default',
  'v5-password-string',
  'v5-default-with-totp',
] as const;

/** True when a resource-type slug is one of the v5 password-shaped slugs. */
export function isV5Slug(slug: string): boolean {
  return (V5_PASSWORD_SLUGS as readonly string[]).includes(slug);
}

// ---------------------------------------------------------------------------
// secret payload (de)serialization per v4 resource-type slug
// ---------------------------------------------------------------------------

export interface SecretContent {
  password: string;
  /** The encrypted-side description (only used by `password-and-description`). */
  description: string;
  /**
   * TOTP sub-object for totp-capable types (password-description-totp /
   * v5-default-with-totp). When present it MUST be carried into the encoded
   * secret — dropping it on re-encode would irreversibly destroy the TOTP.
   */
  totp?: TotpConfig;
}

/**
 * True when the given resource-type slug keeps the description *inside* the
 * encrypted secret (rather than as cleartext resource metadata).
 */
export function isEncryptedDescriptionType(slug: string | undefined): boolean {
  return slug === 'password-and-description' || slug === 'password-description-totp';
}

/**
 * Build the plaintext that should be encrypted for a secret, given the
 * resource-type slug and the in-app content (SPA-verbatim: v5 slugs are NOT
 * encrypted-description types, so their secret is the raw password string —
 * the description lives in the encrypted metadata blob instead).
 */
export function encodeSecret(slug: string | undefined, content: SecretContent): string {
  if (isEncryptedDescriptionType(slug)) {
    // password-and-description / password-description-totp: JSON secret; the
    // totp sub-object rides along whenever present (round-trip preservation).
    return JSON.stringify({
      password: content.password,
      description: content.description ?? '',
      ...(content.totp ? { totp: content.totp } : {}),
    });
  }
  if (content.totp) {
    // totp-capable non-encrypted-description slugs (v5-default-with-totp): the
    // secret must be an object so the totp survives; the description still
    // lives in the encrypted v5 metadata blob, never here.
    return JSON.stringify({ password: content.password, totp: content.totp });
  }
  // password-string / v5 slugs (and any unknown slug): the password is the secret.
  return content.password;
}

/**
 * Parse a decrypted secret plaintext back into the in-app content model.
 * Tolerates a JSON body even for string types and falls back to treating the
 * whole plaintext as the password.
 */
export function decodeSecret(slug: string | undefined, plaintext: string): SecretContent {
  const trimmed = plaintext.trim();
  if (isEncryptedDescriptionType(slug) || (trimmed.startsWith('{') && trimmed.endsWith('}'))) {
    try {
      const parsed = JSON.parse(trimmed) as { password?: unknown; description?: unknown };
      if (parsed && typeof parsed === 'object' && 'password' in parsed) {
        return {
          password: typeof parsed.password === 'string' ? parsed.password : '',
          description: typeof parsed.description === 'string' ? parsed.description : '',
        };
      }
    } catch {
      /* not JSON after all — fall through to raw string handling */
    }
  }
  return { password: plaintext, description: '' };
}

// ---------------------------------------------------------------------------
// v5 resource metadata cleartext blob (encrypted in the background before send)
// ---------------------------------------------------------------------------

export interface ResourceMetadataArgs {
  resource_type_id: string;
  name: string;
  username: string;
  /** Scalar URI as the v4 UI/form holds it; wrapped into the plural `uris` array. */
  uri: string;
  description: string;
}

/**
 * Build the EXACT v5 PASSBOLT_RESOURCE_METADATA cleartext JSON. KEY DETAIL: v5
 * stores the URI as a PLURAL `uris` array; the form holds a scalar `uri`, so we
 * wrap it as `[uri]` (the resolver maps `uris[0]` back). The four optional v5
 * fields are emitted as explicit `null` so the shape always carries all keys.
 */
export function buildResourceMetadataJson(args: ResourceMetadataArgs): string {
  return JSON.stringify({
    object_type: 'PASSBOLT_RESOURCE_METADATA',
    resource_type_id: args.resource_type_id,
    name: args.name,
    username: args.username,
    uris: [args.uri],
    description: args.description,
    autofill_mappings: null,
    custom_fields: null,
    color: null,
    icon: null,
  });
}

// ---------------------------------------------------------------------------
// v4-vs-v5 write-format decision (SPA resourceFormat.ts, slug-based edition)
// ---------------------------------------------------------------------------

export interface DecideResourceFormatArgs {
  /** Org create-format policy, or null while unknown (=> v4, the safe default). */
  typesSettings: MetadataTypesSettings | null;
  /** Slug of the resource type the write targets. */
  selectedSlug: string;
  /** True when an active shared metadata key exists AND is decrypted in memory. */
  metadataKeyAvailable: boolean;
  /** Whether the org allows personal (user_key) metadata. */
  allowPersonalKeys: boolean;
}

export interface ResourceFormatDecision {
  format: 'v4' | 'v5';
  metadataKeyType?: MetadataKeyType;
}

/**
 * Decide whether to create/update a resource in v4 (cleartext columns) or v5
 * (encrypted metadata) form. Chooses v5 ONLY when the org policy selects v5,
 * v5 creation is allowed, the slug is a v5 slug AND a usable shared metadata
 * key exists — otherwise exactly today's v4 path (SPA semantics preserved:
 * in practice v5 always means 'shared_key').
 */
export function decideResourceFormat(args: DecideResourceFormatArgs): ResourceFormatDecision {
  const { typesSettings, selectedSlug, metadataKeyAvailable, allowPersonalKeys } = args;
  const v5Selected =
    typesSettings != null &&
    typesSettings.default_resource_types === 'v5' &&
    typesSettings.allow_creation_of_v5_resources === true &&
    isV5Slug(selectedSlug) &&
    metadataKeyAvailable;
  if (!v5Selected) return { format: 'v4' };
  const metadataKeyType: MetadataKeyType =
    !metadataKeyAvailable && allowPersonalKeys ? 'user_key' : 'shared_key';
  return { format: 'v5', metadataKeyType };
}

/** True when the org policy actively selects v5 resource creation. */
export function isV5PolicyActive(typesSettings: MetadataTypesSettings | null): boolean {
  return (
    typesSettings?.default_resource_types === 'v5' &&
    typesSettings.allow_creation_of_v5_resources === true
  );
}

// ---------------------------------------------------------------------------
// v5 metadata read-side projection (SPA resourceMetadata.ts pure parts)
// ---------------------------------------------------------------------------

/** Format-transparent display projection (same shape for v4 and v5 rows). */
export interface ResolvedMetadata {
  name: string;
  username: string;
  uri: string;
  description: string;
  resource_type_id: string;
}

/** Minimal structural shape the v5 discriminator needs. */
export interface V5Discriminable {
  metadata?: string | null;
  metadata_key_type?: MetadataKeyType | null;
}

/**
 * True when a resource is a v5 (encrypted-metadata) resource: it carries both a
 * `metadata` blob AND a `metadata_key_type`. v4 resources never have these.
 */
export function isV5Resource(r: V5Discriminable): boolean {
  return !!r.metadata && !!r.metadata_key_type;
}

/**
 * Pure narrowing of a decrypted PASSBOLT_RESOURCE_METADATA blob into the scalar
 * display fields (maps the PLURAL `uris[0]` -> the scalar `uri`). Throws on a
 * blob that is not a PASSBOLT_RESOURCE_METADATA object so the caller can
 * degrade rather than render garbage.
 */
export function parseResourceMetadata(plaintext: string): ResolvedMetadata {
  let parsed: unknown;
  try {
    parsed = JSON.parse(plaintext);
  } catch {
    throw new Error('Resource metadata is not valid JSON.');
  }
  if (!parsed || typeof parsed !== 'object') {
    throw new Error('Resource metadata is not an object.');
  }
  const obj = parsed as Record<string, unknown>;
  if (obj.object_type !== 'PASSBOLT_RESOURCE_METADATA') {
    throw new Error('Resource metadata has an unexpected object_type.');
  }
  const uris = Array.isArray(obj.uris) ? obj.uris : [];
  const firstUri = uris.length > 0 && typeof uris[0] === 'string' ? (uris[0] as string) : '';
  return {
    name: typeof obj.name === 'string' ? obj.name : '',
    username: typeof obj.username === 'string' ? obj.username : '',
    uri: firstUri,
    description: typeof obj.description === 'string' ? obj.description : '',
    resource_type_id: typeof obj.resource_type_id === 'string' ? obj.resource_type_id : '',
  };
}

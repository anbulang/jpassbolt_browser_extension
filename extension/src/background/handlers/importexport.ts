/**
 * Import/export RPC handlers (WP-IMPORTEXPORT) per shared/rpc/importexport.ts.
 *
 * DATA-FLOW INVARIANT: every plaintext password stays inside this worker.
 *  - IMPORT_STAGE parses the file and keeps the entries in an in-memory,
 *    TTL-bound staging area; the UI receives only ImportEntryMeta (no secrets).
 *  - IMPORT_COMMIT encrypts-for-self and POSTs one v4 password-and-description
 *    resource per entry (SPA import semantics preserved verbatim).
 *  - EXPORT_BUILD decrypts every secret here and returns the finished file as
 *    base64 — plaintext only ever leaves as the encrypted KDBX archive, or as
 *    CSV behind the UI's explicit plaintext acknowledgement.
 *
 * The staging area is wiped on lock() and simply vanishes when MV3 tears the
 * worker down (the UI then sees the "import expired" error and re-parses).
 * To keep a mid-import worker death from causing duplicates on retry, the
 * indices already committed are bookmarked durably in chrome.storage.session
 * keyed by a SHA-256 fingerprint of the file bytes — only the fingerprint and
 * plain indices are persisted, never entries or passwords — so re-staging the
 * same file transparently skips the rows that already landed.
 */
import type { HandlerMap } from '../registry';
import type {
  ImportEntryMeta,
  ImportExportReq,
  ImportExportRespMap,
} from '../../shared/rpc/importexport';
import { t } from '../../shared/i18n';
import { apiCall } from '../http';
import { decryptMessage, encryptForSelf } from '../crypto';
import { decryptResourceMetadata } from '../metadataKey';
import { armLock, getUnlockedKey, invalidateResourceCache, registerLockHook, registerSessionResetHook } from '../state';
import { buildCsv, parseCsv, type ImportEntry } from '../importexport/csv';
import { buildKdbx, parseKdbx } from '../importexport/kdbx';

type Req<K extends ImportExportReq['type']> = Extract<ImportExportReq, { type: K }>;

// ---------------------------------------------------------------------------
// staging area (worker memory only; wiped on lock; TTL-bound)
// ---------------------------------------------------------------------------
const STAGE_TTL_MS = 10 * 60 * 1000;

interface StagedImport {
  /** Remaining uncommitted entries, keyed by their original stage index. */
  entries: Map<number, ImportEntry>;
  /** SHA-256 of the raw file bytes — key of the durable committed bookmark. */
  fingerprint: string;
  expires: number;
}

const staging = new Map<string, StagedImport>();
// Wipe the plaintext staging area on BOTH lock and session-reset: the account
// identity can change on UNLOCK without a lock() in between (IMPORT_KEY /
// recovery), and staged plaintext captured under the previous account must
// never be committable into the new account's vault. Mirrors pendingSaves
// (index.ts) and metadataKey — both register both hooks.
registerLockHook(() => staging.clear());
registerSessionResetHook(() => staging.clear());

function sweepExpired(): void {
  const now = Date.now();
  for (const [id, s] of staging) {
    if (s.expires <= now) staging.delete(id);
  }
}

// ---------------------------------------------------------------------------
// committed-index bookmarks (chrome.storage.session; survive MV3 worker death)
//
// If the worker dies mid-import the in-memory stage evaporates, but the rows
// already POSTed exist on the server. Without a durable anchor, re-importing
// the file would recreate every one of them. The bookmark stores ONLY the file
// fingerprint and the committed indices (no entries, no passwords), lives in
// session storage (cleared when the browser closes) and is TTL-bound — there
// is deliberately no explicit "clear on completion": within the TTL, a repeat
// import of the identical file skips the rows that already landed (that IS
// the duplicate protection), and after the TTL behaviour is unchanged. All
// operations are best-effort: a storage failure degrades to the old behaviour.
// ---------------------------------------------------------------------------
const BOOKMARK_KEY = 'jpb_ie_import_bookmarks';
const BOOKMARK_TTL_MS = 30 * 60 * 1000;

interface BookmarkRecord {
  committed: number[];
  expires: number;
}
type BookmarkStore = Record<string, BookmarkRecord>;

async function fingerprintOf(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', bytes as BufferSource);
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('');
}

async function loadBookmarks(): Promise<BookmarkStore> {
  try {
    const o = await chrome.storage.session.get(BOOKMARK_KEY);
    const store = (o?.[BOOKMARK_KEY] ?? {}) as BookmarkStore;
    const now = Date.now();
    for (const [fp, rec] of Object.entries(store)) {
      if (!rec || !Array.isArray(rec.committed) || rec.expires <= now) delete store[fp];
    }
    return store;
  } catch {
    return {};
  }
}

async function saveBookmark(fingerprint: string, committed: number[]): Promise<void> {
  try {
    const store = await loadBookmarks();
    store[fingerprint] = { committed, expires: Date.now() + BOOKMARK_TTL_MS };
    await chrome.storage.session.set({ [BOOKMARK_KEY]: store });
  } catch {
    /* best-effort */
  }
}

// ---------------------------------------------------------------------------
// base64 <-> bytes (worker-side; files can be multi-MB, so chunk the btoa path)
// ---------------------------------------------------------------------------
function b64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

function bytesToB64(bytes: Uint8Array): string {
  let bin = '';
  const CHUNK = 0x8000; // keep String.fromCharCode's argument list bounded
  for (let i = 0; i < bytes.length; i += CHUNK) {
    bin += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return btoa(bin);
}

// ---------------------------------------------------------------------------
// v4 secret codec (SPA secretFormat semantics; import always writes the v4
// password-and-description shape, exactly like the SPA's importEntries)
// ---------------------------------------------------------------------------
const PASSWORD_AND_DESCRIPTION_SEED_ID = 'a28a04cd-6f53-518a-967c-9963bf9cec51';

function isEncryptedDescriptionSlug(slug: string | undefined): boolean {
  return slug === 'password-and-description' || slug === 'password-description-totp';
}

/**
 * Parse a decrypted secret plaintext into {password, description} given the
 * resource-type slug. Tolerates a JSON body even for string types (historical
 * resources store JSON regardless) and falls back to raw-password handling —
 * same tolerance as the SPA's decodeSecret, so exports decode identically.
 */
/**
 * Build an otpauth:// URI from a decrypted TOTP secret object, the wire form
 * both CSV (`totp` column) and KDBX (`otp` field) carry. Without this the seed
 * is silently dropped from an export and the backup loses 2FA.
 */
function totpConfigToUri(totp: Record<string, unknown>, label: string): string | undefined {
  const secret = typeof totp.secret_key === 'string' ? totp.secret_key.trim() : '';
  if (!secret) return undefined;
  const params = new URLSearchParams({ secret });
  if (typeof totp.algorithm === 'string' && totp.algorithm) params.set('algorithm', totp.algorithm);
  if (typeof totp.digits === 'number') params.set('digits', String(totp.digits));
  if (typeof totp.period === 'number') params.set('period', String(totp.period));
  return `otpauth://totp/${encodeURIComponent(label || 'JPassbolt')}?${params.toString()}`;
}

function decodeSecret(
  slug: string | undefined,
  plaintext: string,
  label = '',
): { password: string; description: string; totp?: string } {
  const trimmed = plaintext.trim();
  if (isEncryptedDescriptionSlug(slug) || (trimmed.startsWith('{') && trimmed.endsWith('}'))) {
    try {
      const parsed = JSON.parse(trimmed) as { password?: unknown; description?: unknown; totp?: unknown };
      if (parsed && typeof parsed === 'object' && 'password' in parsed) {
        return {
          password: typeof parsed.password === 'string' ? parsed.password : '',
          description: typeof parsed.description === 'string' ? parsed.description : '',
          // password-description-totp / v5-*-with-totp keep the seed inside the
          // secret JSON — carry it into the export instead of dropping it.
          totp: parsed.totp && typeof parsed.totp === 'object'
            ? totpConfigToUri(parsed.totp as Record<string, unknown>, label)
            : undefined,
        };
      }
    } catch {
      /* not JSON after all — fall through to raw string handling */
    }
  }
  return { password: plaintext, description: '' };
}

interface RawResourceType {
  id: string;
  slug: string;
  deleted?: string | null;
}

async function fetchResourceTypes(): Promise<RawResourceType[]> {
  return (await apiCall<RawResourceType[]>('GET', '/resource-types.json').catch(() => null)) ?? [];
}

/** Live catalogue id for the v4 password-and-description slug (seed fallback). */
async function passwordAndDescriptionTypeId(): Promise<string> {
  const types = await fetchResourceTypes();
  const match = types.find((rt) => rt.slug === 'password-and-description' && !rt.deleted);
  return match?.id ?? PASSWORD_AND_DESCRIPTION_SEED_ID;
}

function requireUnlocked(): void {
  if (!getUnlockedKey()) throw new Error(t('bg.vaultLocked'));
}

// ---------------------------------------------------------------------------
// IMPORT_STAGE
// ---------------------------------------------------------------------------
async function importStage(req: Req<'IMPORT_STAGE'>): Promise<ImportExportRespMap['IMPORT_STAGE']> {
  requireUnlocked();
  sweepExpired();

  const bytes = b64ToBytes(req.dataB64);
  let entries: ImportEntry[];
  if (req.format === 'kdbx') {
    if (!req.kdbxPassword) throw new Error(t('app.vault.ie.errors.kdbxPassRequired'));
    // Slice so the parser sees a tight ArrayBuffer (not a shared/oversized one).
    entries = await parseKdbx(
      bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer,
      req.kdbxPassword,
    );
  } else {
    entries = parseCsv(new TextDecoder('utf-8').decode(bytes));
  }
  if (entries.length === 0) throw new Error(t('app.vault.ie.errors.empty'));

  // Rows a previous, worker-death-interrupted run of this exact file already
  // created (durable bookmark; the parse is deterministic so indices are
  // stable across re-stages of identical bytes). The returned meta stays the
  // FULL list — the UI's positional resume relies on stable positions — but
  // bookmarked rows never enter the staging map, so committing them is an
  // idempotent skip instead of a duplicate POST.
  const fingerprint = await fingerprintOf(bytes);
  const committed = new Set((await loadBookmarks())[fingerprint]?.committed ?? []);

  const importId = crypto.randomUUID();
  const map = new Map<number, ImportEntry>();
  const meta: ImportEntryMeta[] = entries.map((e, index) => {
    if (!committed.has(index)) map.set(index, e);
    return {
      index,
      name: e.name,
      username: e.username || undefined,
      uri: e.uri || undefined,
    };
  });
  staging.set(importId, { entries: map, fingerprint, expires: Date.now() + STAGE_TTL_MS });
  armLock();
  return { importId, entries: meta };
}

// ---------------------------------------------------------------------------
// IMPORT_COMMIT
// ---------------------------------------------------------------------------
async function importCommit(
  req: Req<'IMPORT_COMMIT'>,
): Promise<ImportExportRespMap['IMPORT_COMMIT']> {
  requireUnlocked();
  sweepExpired();

  const staged = staging.get(req.importId);
  if (!staged) throw new Error(t('app.vault.ie.errors.importExpired'));
  staged.expires = Date.now() + STAGE_TTL_MS; // batched commits keep the stage alive

  const indices = req.indices ?? [...staged.entries.keys()];
  const resourceTypeId = await passwordAndDescriptionTypeId();
  const committed = (await loadBookmarks())[staged.fingerprint]?.committed ?? [];

  const result: ImportExportRespMap['IMPORT_COMMIT'] = { created: 0, failed: [] };
  for (const index of indices) {
    const e = staged.entries.get(index);
    if (!e) continue; // already committed (or never staged) — idempotent skip
    try {
      // Fold any TOTP/otpauth into the encrypted description so the data is not
      // lost (the v4 password-and-description type has no dedicated TOTP field).
      const description = e.totp
        ? `${e.description}${e.description ? '\n' : ''}otpauth: ${e.totp}`
        : e.description;
      const plaintext = JSON.stringify({ password: e.password, description });
      const data = await encryptForSelf(plaintext);
      await apiCall('POST', '/resources.json', {
        name: e.name || e.uri || e.username || 'Untitled',
        username: e.username,
        uri: e.uri,
        description: '', // encrypted inside the secret; cleartext column stays empty
        resource_type_id: resourceTypeId,
        secrets: [{ data }],
      });
      result.created += 1;
      // Anchor progress durably per row: if the worker dies mid-batch, a
      // re-stage of the same file skips everything bookmarked here.
      committed.push(index);
      await saveBookmark(staged.fingerprint, committed);
    } catch (err) {
      result.failed.push({ index, error: err instanceof Error ? err.message : String(err) });
    } finally {
      // One-shot semantics (SPA parity): processed entries — success OR failure —
      // leave the staging area; a failed row is reported and skipped, not retried.
      staged.entries.delete(index);
    }
  }
  if (staged.entries.size === 0) staging.delete(req.importId);
  if (result.created > 0) invalidateResourceCache(); // popup LIST must see the imports
  armLock();
  return result;
}

// ---------------------------------------------------------------------------
// IMPORT_DISCARD
// ---------------------------------------------------------------------------
async function importDiscard(
  req: Req<'IMPORT_DISCARD'>,
): Promise<ImportExportRespMap['IMPORT_DISCARD']> {
  staging.delete(req.importId);
  sweepExpired();
  return { ok: true };
}

// ---------------------------------------------------------------------------
// EXPORT_BUILD
// ---------------------------------------------------------------------------
interface RawExportRow {
  id: string;
  name?: string | null;
  username?: string | null;
  uri?: string | null;
  description?: string | null;
  resource_type_id?: string | null;
  metadata?: string | null;
  metadata_key_type?: string | null;
}

/** Cleartext display fields of a row, resolving the v5 encrypted metadata blob. */
async function resolveRowFields(
  r: RawExportRow,
): Promise<{ name: string; username: string; uri: string; description: string }> {
  const armored = typeof r.metadata === 'string' && r.metadata.includes('BEGIN PGP MESSAGE')
    ? r.metadata
    : null;
  if (!armored) {
    return {
      name: r.name || '',
      username: r.username || '',
      uri: r.uri || '',
      description: r.description || '',
    };
  }
  // v5: user_key blobs are encrypted to the user's own key; everything else
  // (shared_key) goes through the shared metadata-key session service.
  const clear =
    r.metadata_key_type === 'user_key'
      ? await decryptMessage(armored)
      : await decryptResourceMetadata(armored);
  const meta = JSON.parse(clear) as {
    name?: unknown;
    username?: unknown;
    uris?: unknown;
    description?: unknown;
  };
  const uris = Array.isArray(meta.uris) ? meta.uris : [];
  return {
    name: typeof meta.name === 'string' ? meta.name : '',
    username: typeof meta.username === 'string' ? meta.username : '',
    uri: typeof uris[0] === 'string' ? uris[0] : '',
    description: typeof meta.description === 'string' ? meta.description : '',
  };
}

async function exportBuild(req: Req<'EXPORT_BUILD'>): Promise<ImportExportRespMap['EXPORT_BUILD']> {
  requireUnlocked();
  if (req.format === 'kdbx' && (req.kdbxPassword ?? '').length < 8) {
    throw new Error(t('app.vault.ie.errors.exportPassWeak'));
  }

  const all = (await apiCall<RawExportRow[]>('GET', '/resources.json')) ?? [];
  const wanted = req.resourceIds ? new Set(req.resourceIds) : null;
  const rows = wanted ? all.filter((r) => wanted.has(r.id)) : all;

  // resource_type_id -> slug BEFORE decoding: an unknown slug would let
  // decodeSecret misread a password-string secret whose literal value happens
  // to be JSON (same corruption guard as the SPA modal).
  const slugById = Object.fromEntries((await fetchResourceTypes()).map((rt) => [rt.id, rt.slug]));

  const entries: ImportEntry[] = [];
  const failed: { name: string; error: string }[] = [];
  for (const r of rows) {
    // Best display name available if a step below throws (v5 rows only carry a
    // cleartext name after resolveRowFields succeeds; fall back to the id).
    let displayName = r.name || r.id;
    try {
      const fields = await resolveRowFields(r);
      displayName = fields.name || displayName;
      const sec = await apiCall<{ data: string }>('GET', `/secrets/resource/${r.id}.json`);
      const plaintext = await decryptMessage(sec.data);
      const content = decodeSecret(slugById[r.resource_type_id ?? ''], plaintext, fields.name);
      entries.push({
        name: fields.name,
        username: fields.username,
        uri: fields.uri,
        password: content.password,
        // password-and-description keeps the description inside the secret; the
        // string types keep it in the cleartext column. Prefer whichever is set.
        description: content.description || fields.description || '',
        // Carry the TOTP seed (otpauth URI) so a 2FA-bearing resource keeps its
        // second factor in the exported CSV/KDBX.
        totp: content.totp,
      });
    } catch (err) {
      // No READ secret / undecryptable metadata / transient fetch failure: skip
      // the row rather than abort the whole export (SPA parity), but report it
      // through the failed channel so the UI can warn about an incomplete
      // backup instead of claiming success.
      failed.push({ name: displayName, error: err instanceof Error ? err.message : String(err) });
    }
  }
  if (entries.length === 0) throw new Error(t('app.vault.ie.errors.nothingExported'));

  const stamp = new Date().toISOString().slice(0, 10);
  let dataB64: string;
  let filename: string;
  let mime: string;
  if (req.format === 'kdbx') {
    const buf = await buildKdbx(entries, req.kdbxPassword ?? '', req.dbName ?? 'JPassbolt Export');
    dataB64 = bytesToB64(new Uint8Array(buf));
    filename = `jpassbolt-export-${stamp}.kdbx`;
    mime = 'application/octet-stream';
  } else {
    dataB64 = bytesToB64(new TextEncoder().encode(buildCsv(entries)));
    filename = `jpassbolt-export-${stamp}.csv`;
    mime = 'text/csv;charset=utf-8';
  }
  armLock();
  return { dataB64, filename, mime, exported: entries.length, failed };
}

// ---------------------------------------------------------------------------
// registry export (name fixed by the foundation package)
// ---------------------------------------------------------------------------
export const importExportHandlers: HandlerMap = {
  IMPORT_STAGE: (req) => importStage(req as Req<'IMPORT_STAGE'>),
  IMPORT_COMMIT: (req) => importCommit(req as Req<'IMPORT_COMMIT'>),
  IMPORT_DISCARD: (req) => importDiscard(req as Req<'IMPORT_DISCARD'>),
  EXPORT_BUILD: (req) => exportBuild(req as Req<'EXPORT_BUILD'>),
};

/**
 * Import/export RPC handlers (WP-IMPORTEXPORT) per shared/rpc/importexport.ts.
 *
 * DATA-FLOW INVARIANT: every plaintext password stays inside this worker.
 *  - IMPORT_STAGE parses the file and keeps the entries in an in-memory,
 *    TTL-bound staging area; the UI receives only ImportEntryMeta (no secrets).
 *  - IMPORT_COMMIT encrypts-for-self and POSTs one v4 password-and-description
 *    resource per entry, re-creating the source's folder hierarchy under a
 *    single `import-{date}` reference folder (official Passbolt import parity).
 *  - EXPORT_BUILD decrypts every secret here and returns the finished file as
 *    base64 — plaintext only ever leaves as the encrypted KDBX archive (there
 *    is no plaintext CSV export path: it was removed so a decrypted vault can
 *    never be written to disk in the clear).
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
import { parseCsv, type ImportEntry } from '../importexport/csv';
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
  /**
   * `import-yyyymmdd-HHmmss` reference-root folder NAME, latched once at
   * IMPORT_STAGE time (local time — never re-derived per commit, so batched
   * commits and a worker-death resume all land in one folder and two imports
   * of the same file on the same day never collide). Persisted to the bookmark
   * so a resume reuses the identical name (and therefore the identical id).
   */
  rootName: string;
  /**
   * `import-…` reference-root folder id, created in Phase A of the first
   * IMPORT_COMMIT. Persisted to the bookmark so a batched commit (many
   * IMPORT_COMMIT calls) and a worker-death resume both reuse the same root
   * instead of spawning a fresh one per batch.
   */
  importRootId?: string;
  /** pathKey (JSON of the segment array) -> folder id, built up-front in Phase A. */
  folderCache: Map<string, string>;
  /** Latched once the server rejects folder creation: import flat to vault root. */
  foldersDisabled?: boolean;
  /**
   * Phase-A idempotency latch: the folder tree is built ONCE per stage (over
   * every staged entry, not just the first batch's indices). Later batches skip
   * straight to Phase B. A worker-death resume starts false again but the
   * pre-populated folderCache/importRootId make the rebuild a no-op.
   */
  treeBuilt?: boolean;
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
  /**
   * Durable folder state (no secrets): the latched reference-root NAME, its id
   * and the pathKey -> folder id map. On a worker-death resume these let the
   * resumed import reuse the exact same root name/id and the folders the
   * interrupted run already created instead of building a duplicate tree.
   */
  rootName?: string;
  importRootId?: string;
  folders?: Record<string, string>;
  /**
   * Durable "root create was attempted and failed → import ran flat" decision.
   * Without it, a worker-death resume after a transient root-POST failure would
   * re-attempt the root and, on success, split one import across two layouts
   * (early rows flat at vault root, later rows under a fresh tree).
   */
  foldersDisabled?: boolean;
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

async function saveBookmark(
  fingerprint: string,
  data: {
    committed: number[];
    rootName?: string;
    importRootId?: string;
    folders?: Record<string, string>;
    foldersDisabled?: boolean;
  },
): Promise<void> {
  try {
    const store = await loadBookmarks();
    store[fingerprint] = { ...data, expires: Date.now() + BOOKMARK_TTL_MS };
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
// import helpers
// ---------------------------------------------------------------------------
/**
 * Reference-root folder name `import-yyyymmdd-HHmmss` in LOCAL time. Local
 * (not toISOString/UTC) on purpose: an evening import in +08:00 must not be
 * dated a day earlier, and the seconds precision keeps two imports on the same
 * day from colliding into one same-named folder the server would never merge.
 */
function importRootName(): string {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, '0');
  return `import-${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
}

/** JSON of a segment array — the cache/dedup key for a folder path prefix. */
function pathKey(segments: string[]): string {
  return JSON.stringify(segments);
}

/**
 * Run `worker` over `items` with at most `limit` in flight at once. Used to
 * overlap network/PGP latency during import (folder creation per depth layer,
 * resource POSTs per batch) while keeping the plain Spring MVC backend — which
 * has no request throttling — from being flooded and from racing on
 * folders_relation writes. Ordering within a run is not guaranteed.
 */
async function runPool<T>(
  items: T[],
  limit: number,
  worker: (item: T) => Promise<void>,
): Promise<void> {
  let cursor = 0;
  const runner = async (): Promise<void> => {
    while (cursor < items.length) {
      const idx = cursor++;
      await worker(items[idx]);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, runner));
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
  const bookmark = (await loadBookmarks())[fingerprint];
  const committed = new Set(bookmark?.committed ?? []);

  const importId = crypto.randomUUID();
  const map = new Map<number, ImportEntry>();
  const meta: ImportEntryMeta[] = entries.map((e, index) => {
    if (!committed.has(index)) map.set(index, e);
    return {
      index,
      name: e.name,
      username: e.username || undefined,
      uri: e.uri || undefined,
      folderPath: e.folderPath,
    };
  });
  // Latch the reference-root name NOW (local time), not at commit time: a
  // worker-death resume reuses the bookmarked name so it hits the same folder;
  // a fresh import gets a fresh HH:mm:ss-stamped name that will not collide.
  const rootName = bookmark?.rootName ?? importRootName();
  staging.set(importId, {
    entries: map,
    fingerprint,
    expires: Date.now() + STAGE_TTL_MS,
    rootName,
    // Resume the folder tree the interrupted run had already built (durable
    // bookmark), so re-committing does not create a duplicate hierarchy.
    importRootId: bookmark?.importRootId,
    folderCache: new Map(Object.entries(bookmark?.folders ?? {})),
    // Honor a prior "folders disabled" decision so a resume stays consistently
    // flat instead of re-attempting the root and splitting the import.
    foldersDisabled: bookmark?.foldersDisabled,
  });
  armLock();
  return { importId, entries: meta, rootFolderName: rootName };
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

  // Keep the durable bookmark in step with everything built so far (committed
  // rows + the reference root name/id + the subfolder map). Best-effort; a
  // storage failure only weakens the resume, never the import itself.
  const persist = () =>
    saveBookmark(staged.fingerprint, {
      committed,
      rootName: staged.rootName,
      importRootId: staged.importRootId,
      folders: Object.fromEntries(staged.folderCache),
      foldersDisabled: staged.foldersDisabled,
    });

  // -------------------------------------------------------------------------
  // Phase A — build the WHOLE folder tree up front, once per stage.
  //
  // Runs over EVERY still-staged entry (not just this batch's indices): later
  // batches must find their folders already built. Guarded by `treeBuilt` so it
  // executes on the first IMPORT_COMMIT only; a worker-death resume re-enters
  // with treeBuilt=false but the bookmark-restored folderCache/importRootId make
  // every create below a cached no-op. Root-create failure latches
  // foldersDisabled and degrades the ENTIRE import flat to the vault root
  // (unchanged degrade semantics), just decided once instead of per row.
  // -------------------------------------------------------------------------
  if (!staged.treeBuilt) {
    let rootId: string | undefined;
    if (staged.foldersDisabled) {
      rootId = undefined;
    } else if (staged.importRootId) {
      rootId = staged.importRootId; // resumed from bookmark
    } else {
      try {
        const folder = await apiCall<{ id: string }>('POST', '/folders.json', {
          name: staged.rootName,
        });
        staged.importRootId = folder.id;
        rootId = folder.id;
        // Persist the root id BEFORE any child POST, so a worker death mid-tree
        // resumes onto the same root instead of creating a duplicate one.
        await persist();
      } catch (err) {
        staged.foldersDisabled = true;
        console.warn('[import] could not create the import folder; importing to vault root', err);
      }
    }

    // Only build subfolders when the root exists (otherwise everything is flat).
    if (rootId) {
      // Collect the dedup'd prefix closure of every staged path, grouped by
      // depth. Building depth by depth means a layer's parents are guaranteed
      // already created, so siblings within a layer are independent and safe to
      // POST concurrently.
      const allPaths = new Map<string, string[]>();
      for (const e of staged.entries.values()) {
        const fp = e.folderPath;
        if (!fp || !fp.length) continue;
        for (let d = 1; d <= fp.length; d++) {
          const prefix = fp.slice(0, d);
          allPaths.set(pathKey(prefix), prefix);
        }
      }
      const byDepth = new Map<number, string[][]>();
      for (const p of allPaths.values()) {
        const layer = byDepth.get(p.length) ?? [];
        layer.push(p);
        byDepth.set(p.length, layer);
      }
      const maxDepth = byDepth.size ? Math.max(...byDepth.keys()) : 0;
      for (let depth = 1; depth <= maxDepth; depth++) {
        const layer = byDepth.get(depth) ?? [];
        await runPool(layer, 4, async (p) => {
          const key = pathKey(p);
          if (staged.folderCache.has(key)) return; // already built (cache / resume)
          // Parent = the length-1 prefix. If it failed to build (not cached),
          // skip this node; its descendants will fall back to the deepest
          // ancestor that DID build (resolveFolder walks the prefix chain).
          const parentId = depth === 1 ? rootId : staged.folderCache.get(pathKey(p.slice(0, depth - 1)));
          if (!parentId) return;
          try {
            const folder = await apiCall<{ id: string }>('POST', '/folders.json', {
              name: p[depth - 1],
              folder_parent_id: parentId,
            });
            staged.folderCache.set(key, folder.id);
          } catch (err) {
            // Record nothing durable: a missing cache entry IS the "failed"
            // marker, and descendants degrade to the deepest built ancestor.
            console.warn('[import] failed to create folder', p, err);
          }
        });
        // Persist after each layer completes: shrinks the "worker died with
        // folders created but not yet bookmarked → duplicate tree on re-import"
        // window from the whole tree down to a single unpersisted layer.
        await persist();
      }
    }

    staged.treeBuilt = true;
    await persist(); // final durable write (idempotent after per-layer persists)
  }

  // Deepest already-built folder id for a row's path: walk the prefix chain and
  // stop at the first gap. undefined only when folders are disabled entirely
  // (row lands at the vault root); otherwise at worst the reference root.
  const resolveFolder = (fp?: string[]): string | undefined => {
    if (!staged.importRootId) return undefined;
    let best = staged.importRootId;
    if (fp) {
      for (let d = 1; d <= fp.length; d++) {
        const id = staged.folderCache.get(pathKey(fp.slice(0, d)));
        if (!id) break;
        best = id;
      }
    }
    return best;
  };

  // -------------------------------------------------------------------------
  // Phase B — encrypt-for-self + POST each resource in this batch, concurrently.
  // The tree already exists, so a row only looks its folder up (no awaits that
  // build state), letting PGP CPU overlap other rows' network. Per-row persist
  // is kept so a worker death mid-batch still yields zero duplicates on re-stage.
  // -------------------------------------------------------------------------
  const result: ImportExportRespMap['IMPORT_COMMIT'] = { created: 0, failed: [] };
  await runPool(indices, 4, async (index) => {
    const e = staged.entries.get(index);
    if (!e) return; // already committed (or never staged) — idempotent skip
    try {
      const folderParentId = resolveFolder(e.folderPath);
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
        ...(folderParentId ? { folder_parent_id: folderParentId } : {}),
      });
      result.created += 1;
      // Anchor progress durably per row: if the worker dies mid-batch, a
      // re-stage of the same file skips everything bookmarked here.
      committed.push(index);
      await persist();
    } catch (err) {
      result.failed.push({ index, error: err instanceof Error ? err.message : String(err) });
    } finally {
      // One-shot semantics (SPA parity): processed entries — success OR failure —
      // leave the staging area; a failed row is reported and skipped, not retried.
      staged.entries.delete(index);
    }
  });
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

interface RawFolder {
  id: string;
  name?: string | null;
  folder_parent_id?: string | null;
  children_resources?: { id: string }[] | null;
}

/**
 * Resolve the folder graph for export. Resource DTOs carry no folder field, so
 * membership is read from each folder's children_resources (the per-user
 * folders_relation) via contain[children_resources]. Best-effort: if folders
 * are unavailable the maps come back empty and the export is simply flat.
 */
async function loadFolderTopology(): Promise<{
  parentOf: Map<string, string | null>;
  nameOf: Map<string, string>;
  resourceFolder: Map<string, string>;
}> {
  const parentOf = new Map<string, string | null>();
  const nameOf = new Map<string, string>();
  const resourceFolder = new Map<string, string>();
  try {
    // URLSearchParams, not a hand-built string: `[`/`]` are gen-delims and are
    // not legal in a URL query. Browsers send them verbatim, and Tomcat rejects
    // the request with a bare 400 before Spring sees it — which the catch below
    // would silently swallow, leaving the topology empty and every export flat.
    const sp = new URLSearchParams({ 'contain[children_resources]': '1' });
    const folders = (await apiCall<RawFolder[]>('GET', `/folders.json?${sp}`)) ?? [];
    for (const f of folders) {
      parentOf.set(f.id, f.folder_parent_id ?? null);
      nameOf.set(f.id, f.name ?? '');
      for (const child of f.children_resources ?? []) resourceFolder.set(child.id, f.id);
    }
  } catch {
    /* folders unavailable: flat export */
  }
  return { parentOf, nameOf, resourceFolder };
}

/** Path segments (top → leaf) for a folder, walking parentOf with cycle guard. */
function folderPathOf(
  folderId: string | undefined,
  parentOf: Map<string, string | null>,
  nameOf: Map<string, string>,
): string[] | undefined {
  if (!folderId) return undefined;
  const segments: string[] = [];
  const seen = new Set<string>();
  let cur: string | null | undefined = folderId;
  while (cur && nameOf.has(cur) && !seen.has(cur)) {
    seen.add(cur);
    const name = nameOf.get(cur) ?? '';
    if (name) segments.unshift(name);
    cur = parentOf.get(cur) ?? null;
  }
  return segments.length ? segments : undefined;
}

/** Selected folders plus their entire subtree (BFS over the child adjacency). */
function subtreeClosure(roots: string[], parentOf: Map<string, string | null>): Set<string> {
  const childrenOf = new Map<string, string[]>();
  for (const [id, parent] of parentOf) {
    if (!parent) continue;
    const siblings = childrenOf.get(parent) ?? [];
    siblings.push(id);
    childrenOf.set(parent, siblings);
  }
  const closure = new Set<string>();
  const queue = [...roots];
  while (queue.length) {
    const id = queue.shift()!;
    if (closure.has(id)) continue;
    closure.add(id);
    for (const child of childrenOf.get(id) ?? []) queue.push(child);
  }
  return closure;
}

async function exportBuild(req: Req<'EXPORT_BUILD'>): Promise<ImportExportRespMap['EXPORT_BUILD']> {
  requireUnlocked();
  // KDBX-only, enforced HERE (not just in the UI): a caller that hand-crafts the
  // RPC must not be able to obtain a plaintext dump of the decrypted vault.
  if ((req.format as string) !== 'kdbx') {
    throw new Error(t('app.vault.ie.errors.exportFormatUnsupported'));
  }
  if ((req.kdbxPassword ?? '').length < 8) {
    throw new Error(t('app.vault.ie.errors.exportPassWeak'));
  }

  const all = (await apiCall<RawExportRow[]>('GET', '/resources.json')) ?? [];
  const wanted = req.resourceIds ? new Set(req.resourceIds) : null;

  const { parentOf, nameOf, resourceFolder } = await loadFolderTopology();
  // A folder-scoped export keeps only rows whose owning folder is in the
  // selected subtree, still intersected with the base visible id set.
  const folderScope =
    req.folderIds && req.folderIds.length ? subtreeClosure(req.folderIds, parentOf) : null;

  const rows = all.filter((r) => {
    if (wanted && !wanted.has(r.id)) return false;
    if (folderScope && !folderScope.has(resourceFolder.get(r.id) ?? '')) return false;
    return true;
  });

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
        // second factor in the exported KDBX.
        totp: content.totp,
        // Rebuild the folder hierarchy in the export so KDBX groups mirror the
        // vault tree (undefined for a root-level resource).
        folderPath: folderPathOf(resourceFolder.get(r.id), parentOf, nameOf),
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
  const buf = await buildKdbx(entries, req.kdbxPassword ?? '', req.dbName ?? 'JPassbolt Export');
  const dataB64 = bytesToB64(new Uint8Array(buf));
  armLock();
  return {
    dataB64,
    filename: `jpassbolt-export-${stamp}.kdbx`,
    mime: 'application/octet-stream',
    exported: entries.length,
    failed,
  };
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

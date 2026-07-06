/**
 * KDBX (KeePass / KeePassXC) import/export codec — background edition of the
 * SPA's services/importExport.ts KDBX half.
 *
 * KDBX4 key derivation is Argon2, which kdbxweb does not ship: a pure-wasm
 * implementation (hash-wasm) is injected once. The wasm instantiation requires
 * the `wasm-unsafe-eval` extension-pages CSP granted by the manifest.
 *
 * MV3 SERVICE-WORKER CAVEAT: kdbxweb serializes its inner XML with the global
 * DOMParser/XMLSerializer when present and falls back to requiring
 * '@xmldom/xmldom' otherwise. Workers have no DOM globals, so the bundled
 * xmldom fallback (installed as kdbxweb's own dependency) is what actually
 * runs here — do not "optimize" it out of the bundle.
 *
 * SECURITY: the KDBX archive is encrypted with a SEPARATE user-chosen
 * passphrase (never the account passphrase) — that is what keeps export
 * zero-knowledge-safe: plaintext passwords never touch disk in the clear.
 */
import * as kdbxweb from 'kdbxweb';
import { argon2d, argon2id } from 'hash-wasm';
import type { ImportEntry } from './csv';

let argon2Wired = false;

/** Inject a pure-wasm Argon2 so kdbxweb can read/write KDBX4 in this worker. */
function wireArgon2(): void {
  if (argon2Wired) return;
  kdbxweb.CryptoEngine.setArgon2Impl(
    async (password, salt, memory, iterations, length, parallelism, type) => {
      // kdbxweb passes memory in KiB (matching the KDBX header), which is exactly
      // hash-wasm's memorySize unit. KDBX only uses Argon2d (0) and Argon2id (2).
      const fn = type === 0 ? argon2d : argon2id;
      const hash = (await fn({
        password: new Uint8Array(password),
        salt: new Uint8Array(salt),
        parallelism,
        iterations,
        memorySize: memory,
        hashLength: length,
        outputType: 'binary',
      })) as Uint8Array;
      return hash.buffer as ArrayBuffer;
    },
  );
  argon2Wired = true;
}

/** Parse a KDBX (KeePass/KeePassXC) database into entries. Needs its passphrase. */
export async function parseKdbx(buf: ArrayBuffer, kdbxPassword: string): Promise<ImportEntry[]> {
  wireArgon2();
  const credentials = new kdbxweb.Credentials(kdbxweb.ProtectedValue.fromString(kdbxPassword));
  const db = await kdbxweb.Kdbx.load(buf, credentials);
  const entries: ImportEntry[] = [];

  const fieldText = (v: unknown): string => {
    if (v == null) return '';
    if (v instanceof kdbxweb.ProtectedValue) return v.getText();
    return String(v);
  };

  const walk = (group: kdbxweb.KdbxGroup): void => {
    for (const e of group.entries) {
      const f = e.fields;
      const entry: ImportEntry = {
        name: fieldText(f.get('Title')),
        username: fieldText(f.get('UserName')),
        uri: fieldText(f.get('URL')),
        password: fieldText(f.get('Password')),
        description: fieldText(f.get('Notes')),
        totp: fieldText(f.get('otp')) || undefined,
      };
      if (entry.password || entry.name || entry.username) {
        if (!entry.name) entry.name = entry.uri || entry.username || 'Untitled';
        entries.push(entry);
      }
    }
    for (const sub of group.groups) {
      // Skip the KeePass Recycle Bin so deleted entries are not re-imported.
      if (db.meta.recycleBinUuid && sub.uuid.equals(db.meta.recycleBinUuid)) continue;
      walk(sub);
    }
  };
  walk(db.getDefaultGroup());
  return entries;
}

/** Build an encrypted KDBX4 (KeePass/KeePassXC-openable) from entries. */
export async function buildKdbx(
  entries: ImportEntry[],
  kdbxPassword: string,
  dbName = 'JPassbolt Export',
): Promise<ArrayBuffer> {
  wireArgon2();
  const credentials = new kdbxweb.Credentials(kdbxweb.ProtectedValue.fromString(kdbxPassword));
  const db = kdbxweb.Kdbx.create(credentials, dbName);
  const group = db.getDefaultGroup();
  for (const e of entries) {
    const entry = db.createEntry(group);
    entry.fields.set('Title', e.name);
    entry.fields.set('UserName', e.username);
    entry.fields.set('URL', e.uri);
    entry.fields.set('Password', kdbxweb.ProtectedValue.fromString(e.password));
    entry.fields.set('Notes', e.description);
    if (e.totp) entry.fields.set('otp', kdbxweb.ProtectedValue.fromString(e.totp));
  }
  return db.save();
}

/**
 * CSV import/export codec + the normalized ImportEntry model (background
 * edition of the SPA's services/importExport.ts CSV half).
 *
 * SECURITY: runs ONLY in the background service worker. Parsed entries carry
 * plaintext passwords — they live in the handler's in-memory staging area and
 * are never sent to the UI (which only ever sees ImportEntryMeta).
 */
import Papa from 'papaparse';
import { t } from '../../shared/i18n';

/** A single normalized credential, the lingua franca between every format. */
export interface ImportEntry {
  name: string;
  username: string;
  uri: string;
  password: string;
  description: string;
  /** otpauth:// URI or raw TOTP seed if the source carried one (best-effort). */
  totp?: string;
  /**
   * Folder hierarchy as path SEGMENTS (top → leaf), e.g. ['Bank', 'Cards'].
   * A segment array (rather than a joined string) sidesteps the ambiguity of a
   * folder name that itself contains the '/' separator. undefined = vault root.
   */
  folderPath?: string[];
}

/** Case-insensitive column aliases across KeePass / LastPass / Bitwarden /
 *  Chrome / 1Password / Passbolt / Dashlane CSV exports. */
const COLS: Record<keyof ImportEntry, string[]> = {
  name: ['name', 'title', 'account', 'item name'],
  username: ['username', 'user name', 'login name', 'login_username', 'login', 'user', 'email', 'e-mail'],
  uri: ['uri', 'url', 'urls', 'web site', 'website', 'login_uri', 'web address'],
  password: ['password', 'login_password', 'secret', 'pass'],
  description: ['description', 'notes', 'note', 'comments', 'comment', 'extra'],
  totp: ['totp', 'otpauth', 'one-time password', 'otp', 'login_totp', 'otp secret', 'otpauth url'],
  // Passbolt exports `folder_parent_path` (a leading-slash path); KeePass/KDBX
  // CSV exports carry `Group` (e.g. 'Database/Bank'); LastPass uses `grouping`
  // (backslash-separated). NOT `category`: many exporters (1Password, generic)
  // use it for item TYPE ('Login', 'Secure Note'), which would build bogus
  // type-named folders — a folder column must be an explicit folder column.
  folderPath: ['group', 'grouping', 'folder', 'folder_parent_path'],
};

/**
 * Split a raw folder-path cell ('/Bank/Cards', 'Database/Bank', 'Work\\Servers',
 * …) into trimmed, non-empty segments. Both '/' (Passbolt/KeePass) and '\\'
 * (LastPass `grouping`, Windows paths) are accepted as separators; leading
 * separators and blank segments (double separators) are dropped; an empty cell
 * yields undefined.
 */
function splitFolderPath(raw: string): string[] | undefined {
  const segments = raw
    .replace(/^[\\/]+/, '')
    .split(/[\\/]/)
    .map((s) => s.trim())
    .filter((s) => s !== '');
  return segments.length ? segments : undefined;
}

function pick(row: Record<string, string>, aliases: string[]): string {
  // Iterate ALIASES in preference order (not the CSV's column order): a file with
  // both `username` and `email` columns must yield `username` (alias[0]) rather
  // than whichever column happens to appear first. Build a case-insensitive map
  // of the row's columns once, then probe aliases highest-priority first.
  const byLower: Record<string, string> = {};
  for (const key of Object.keys(row)) {
    const lk = key.trim().toLowerCase();
    // First occurrence wins for a given normalized header (stable, deterministic).
    if (!(lk in byLower)) byLower[lk] = row[key];
  }
  for (const alias of aliases) {
    const v = byLower[alias];
    if (v != null && String(v).trim() !== '') return String(v).trim();
  }
  return '';
}

/** Parse a CSV string into entries. Throws if no recognizable rows are found. */
export function parseCsv(text: string): ImportEntry[] {
  const parsed = Papa.parse<Record<string, string>>(text, {
    header: true,
    skipEmptyLines: true,
  });
  const rows = parsed.data ?? [];
  const entries: ImportEntry[] = [];
  for (const row of rows) {
    const entry: ImportEntry = {
      name: pick(row, COLS.name),
      username: pick(row, COLS.username),
      uri: pick(row, COLS.uri),
      password: pick(row, COLS.password),
      description: pick(row, COLS.description),
      totp: pick(row, COLS.totp) || undefined,
      folderPath: splitFolderPath(pick(row, COLS.folderPath)),
    };
    // Keep a row only if it has SOMETHING worth importing (a password or a name).
    if (entry.password || entry.name || entry.username) {
      if (!entry.name) entry.name = entry.uri || entry.username || 'Untitled';
      entries.push(entry);
    }
  }
  if (entries.length === 0) {
    throw new Error(t('app.vault.ie.errors.empty'));
  }
  return entries;
}

// NOTE: there is deliberately no buildCsv counterpart — plaintext CSV export was
// removed so a decrypted vault can never be written to disk unencrypted. Export
// is KDBX-only (see handlers/importexport.ts EXPORT_BUILD), which encrypts the
// whole archive with a user-chosen passphrase and keeps export zero-knowledge-safe.

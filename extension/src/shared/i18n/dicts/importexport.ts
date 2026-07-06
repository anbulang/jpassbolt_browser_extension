/**
 * importexport domain dictionary — SPA vault-namespace `ie.*` keys flattened to
 * `app.vault.ie.*` (WP-IMPORTEXPORT). Extension-only additions: the staging /
 * building phase labels, the generic export-done line and the
 * staged-import-expired error (MV3 worker teardown drops the in-memory stage,
 * so the UI must ask for a re-parse).
 * `app.vault.ie.button` is the vault-toolbar entry label consumed by WP-VAULT.
 */
import type { Dict } from '../types';

export const en: Dict = {
  'app.vault.ie.title': 'Import / Export passwords',
  'app.vault.ie.button': 'Import/Export',
  'app.vault.ie.cancel': 'Cancel',
  'app.vault.ie.tabs.import': 'Import',
  'app.vault.ie.tabs.export': 'Export',
  'app.vault.ie.import.lead':
    'Import from a CSV (KeePass / LastPass / Bitwarden / Chrome / 1Password, …) or a KDBX (KeePass / KeePassXC) file. Files are parsed entirely inside the extension; passwords are encrypted locally before upload.',
  'app.vault.ie.import.choose': 'Choose a .csv or .kdbx file',
  'app.vault.ie.import.kdbxPassLabel': 'KDBX file password',
  'app.vault.ie.import.run': 'Start import',
  'app.vault.ie.import.parsing': 'Parsing file…',
  'app.vault.ie.import.success': 'Imported {{count}} credential(s).',
  'app.vault.ie.import.failedCount': '({{count}} failed and skipped)',
  'app.vault.ie.export.lead':
    'Export {{count}} credential(s) from your vault. Exporting decrypts every password locally.',
  'app.vault.ie.export.kdbxTitle': 'KDBX (encrypted, recommended)',
  'app.vault.ie.export.kdbxDesc':
    'Opens in KeePass / KeePassXC; the whole file is encrypted with a password you set.',
  'app.vault.ie.export.csvTitle': 'CSV (plaintext)',
  'app.vault.ie.export.csvDesc':
    'Universal plaintext table any manager can read — but NOT encrypted.',
  'app.vault.ie.export.passLabel': 'Set a KDBX file protection password',
  'app.vault.ie.export.passPlaceholder': 'At least 8 characters',
  'app.vault.ie.export.passConfirmPlaceholder': 'Re-enter to confirm',
  'app.vault.ie.export.kdbxHint':
    'Remember this password: it is required to open the exported .kdbx and cannot be recovered.',
  'app.vault.ie.export.csvWarning':
    'I understand the CSV export contains plaintext passwords, and anyone who can read the file can see all my passwords.',
  'app.vault.ie.export.run': 'Export',
  'app.vault.ie.export.working': 'Decrypting and building the export file…',
  'app.vault.ie.export.done': 'Export file generated — check your downloads.',
  'app.vault.ie.export.failedCount':
    '({{count}} entry(ies) could not be read or decrypted and are MISSING from the file)',
  'app.vault.ie.errors.kdbxPassRequired': "Enter the KDBX file's password.",
  'app.vault.ie.errors.empty': 'No importable credentials found in the file.',
  'app.vault.ie.errors.importExpired':
    'The staged import has expired. Please parse the file again.',
  'app.vault.ie.errors.exportPassWeak': 'The protection password must be at least 8 characters.',
  'app.vault.ie.errors.exportPassMismatch': 'The two passwords do not match.',
  'app.vault.ie.errors.csvAckRequired': 'Please confirm you understand CSV export is plaintext.',
  'app.vault.ie.errors.nothingExported': 'There is nothing to export.',
};

export const zh: Dict = {
  'app.vault.ie.title': '导入 / 导出密码',
  'app.vault.ie.button': '导入/导出',
  'app.vault.ie.cancel': '取消',
  'app.vault.ie.tabs.import': '导入',
  'app.vault.ie.tabs.export': '导出',
  'app.vault.ie.import.lead':
    '从 CSV（KeePass / LastPass / Bitwarden / Chrome / 1Password 等）或 KDBX（KeePass / KeePassXC）文件导入。文件仅在扩展内部解析，密码在本地加密后才上传。',
  'app.vault.ie.import.choose': '选择 .csv 或 .kdbx 文件',
  'app.vault.ie.import.kdbxPassLabel': 'KDBX 文件密码',
  'app.vault.ie.import.run': '开始导入',
  'app.vault.ie.import.parsing': '正在解析文件…',
  'app.vault.ie.import.success': '成功导入 {{count}} 条凭据。',
  'app.vault.ie.import.failedCount': '（{{count}} 条失败已跳过）',
  'app.vault.ie.export.lead': '将保险库内 {{count}} 条凭据导出。导出会在本地解密所有密码。',
  'app.vault.ie.export.kdbxTitle': 'KDBX（加密，推荐）',
  'app.vault.ie.export.kdbxDesc': 'KeePass / KeePassXC 可打开，用你设置的密码加密整个文件。',
  'app.vault.ie.export.csvTitle': 'CSV（明文）',
  'app.vault.ie.export.csvDesc': '通用明文表格，任何密码管理器可读——但不加密。',
  'app.vault.ie.export.passLabel': '设置 KDBX 文件保护密码',
  'app.vault.ie.export.passPlaceholder': '至少 8 位',
  'app.vault.ie.export.passConfirmPlaceholder': '再次输入以确认',
  'app.vault.ie.export.kdbxHint': '请牢记此密码：打开导出的 .kdbx 文件时需要它，且无法找回。',
  'app.vault.ie.export.csvWarning':
    '我了解 CSV 导出文件包含明文密码，任何能读取该文件的人都能看到我的全部密码。',
  'app.vault.ie.export.run': '导出',
  'app.vault.ie.export.working': '正在解密并构建导出文件…',
  'app.vault.ie.export.done': '导出文件已生成，请查看浏览器下载。',
  'app.vault.ie.export.failedCount': '（{{count}} 条无法读取或解密，未包含在导出文件中）',
  'app.vault.ie.errors.kdbxPassRequired': '请输入 KDBX 文件的密码。',
  'app.vault.ie.errors.empty': '文件中没有可导入的凭据。',
  'app.vault.ie.errors.importExpired': '导入暂存已过期，请重新解析文件。',
  'app.vault.ie.errors.exportPassWeak': '保护密码至少 8 位。',
  'app.vault.ie.errors.exportPassMismatch': '两次输入的密码不一致。',
  'app.vault.ie.errors.csvAckRequired': '请先勾选确认，知悉 CSV 为明文导出。',
  'app.vault.ie.errors.nothingExported': '没有可导出的凭据。',
};

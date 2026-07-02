/**
 * Tiny runtime i18n layer for the JPassbolt browser extension.
 *
 * WHY NOT chrome.i18n: chrome.i18n is bound to the *browser UI* locale and
 * cannot be toggled at runtime to follow the user's JPassbolt account choice.
 * This module instead keeps two in-memory dictionaries (zh default, en) and a
 * single locale switch persisted in chrome.storage.local under `jpb_locale`.
 *
 * Imported by every UI surface (popup / app / options), the autofill content
 * scripts, the background service worker and shared/messages helpers. `t()` is
 * synchronous: the active locale is read from a module-level cache that is
 * primed once at startup via `primeLocale()` (or lazily set by `setLocale`),
 * so a render never has to await storage.
 *
 * Default locale is Chinese ('zh'); English ('en') is the fallback dictionary.
 */

export type Locale = 'zh' | 'en';

const STORAGE_KEY = 'jpb_locale';
const DEFAULT_LOCALE: Locale = 'zh';

// Module-level synchronous cache of the active locale. Defaults to Chinese so
// the very first render (before primeLocale resolves) is already Chinese.
let current: Locale = DEFAULT_LOCALE;
let primed = false;

/** Narrow an arbitrary stored value to a known Locale (fallback to default). */
function coerce(value: unknown): Locale {
  return value === 'en' || value === 'zh' ? value : DEFAULT_LOCALE;
}

/**
 * Prime the synchronous locale cache from chrome.storage.local once at startup.
 * Safe to call from any context (popup/app/options/content/background); if
 * chrome.storage is unavailable it leaves the default in place. Idempotent.
 */
export async function primeLocale(): Promise<Locale> {
  if (primed) return current;
  try {
    const o = await chrome.storage?.local?.get(STORAGE_KEY);
    if (o && o[STORAGE_KEY] != null) current = coerce(o[STORAGE_KEY]);
  } catch {
    /* storage unavailable — keep the default */
  }
  primed = true;
  return current;
}

// Kick off priming as a side effect of import so `t()` becomes correct shortly
// after load even if a caller forgets to await primeLocale(). The default
// (zh) is already correct for the synchronous window before this resolves.
void primeLocale();

// Keep the cache in sync if another context (e.g. the options page) changes the
// locale while this context is alive.
try {
  chrome.storage?.onChanged?.addListener((changes, area) => {
    if (area === 'local' && changes[STORAGE_KEY]) {
      current = coerce(changes[STORAGE_KEY].newValue);
    }
  });
} catch {
  /* not available in this context */
}

/** Current active locale (synchronous; defaults to 'zh' until primed). */
export function getLocale(): Locale {
  return current;
}

/** Persist and apply a new locale. Updates the cache immediately. */
export async function setLocale(locale: Locale): Promise<void> {
  current = coerce(locale);
  primed = true;
  try {
    await chrome.storage?.local?.set({ [STORAGE_KEY]: current });
  } catch {
    /* storage unavailable — the in-memory switch still applies for this context */
  }
}

// ---------------------------------------------------------------------------
// Dictionaries. Keys are dot-namespaced; `en` is the fallback dictionary.
// Interpolation uses {{var}} placeholders resolved from the `vars` argument.
// ---------------------------------------------------------------------------
type Dict = Record<string, string>;

const en: Dict = {
  // brand / common
  'app.name': 'JPassbolt',
  'common.continue': 'Continue',
  'common.cancel': 'Cancel',
  'common.refresh': 'Refresh',
  'common.new': 'New',
  'common.save': 'Save',
  'common.dash': '—',

  // header / chrome
  'header.settings': 'Settings',
  'header.lockVault': 'Lock vault',
  'header.openSeparateWindow': 'Open in a separate window',

  // flow / spinners
  'flow.loading': 'Loading…',
  'flow.loadingVault': 'Loading vault…',

  // server form
  'server.title': 'Connect to your server',
  'server.intro': 'Enter the URL of your JPassbolt server.',
  'server.label': 'Server URL',
  'server.placeholder': 'https://passbolt.example.com',
  'server.saving': 'Saving…',

  // web-app origin (SPA session-state bridge)
  'appOrigin.title': 'Web application address',
  'appOrigin.intro': 'Origin of the JPassbolt web app that may receive session-state notifications (unlocked / locked / signed out — never keys or secrets). Leave empty to disable the bridge.',
  'appOrigin.label': 'Web app origin',
  'appOrigin.placeholder': 'https://app.example.com',
  'appOrigin.invalid': 'Enter a valid URL (e.g. https://app.example.com).',

  // key import form
  'key.title': 'Import your private key',
  'key.intro':
    'Paste your passphrase-protected OpenPGP private key. It is stored only in the extension and never leaves your browser.',
  'key.label': 'Armored private key',
  'key.placeholder': '-----BEGIN PGP PRIVATE KEY BLOCK-----',
  'key.fileLoaded': 'Key file loaded: {name}',
  'key.clearFile': 'Remove',
  'key.importing': 'Importing…',
  'key.import': 'Import key',

  // unlock form
  'unlock.title': 'Unlock your vault',
  'unlock.signedInAs': 'Signed in as {{username}}',
  'unlock.enterPassphrase': 'Enter your passphrase to unlock.',
  'unlock.passphrase': 'Passphrase',
  'unlock.unlocking': 'Unlocking…',
  'unlock.unlock': 'Unlock',
  'unlock.useDifferentAccount': 'Use a different account',

  // quickaccess / vault list
  'vault.searchPlaceholder': 'Search vault…',
  'vault.searchShort': 'Search…',
  'vault.forThisSite': 'For this site',
  'vault.allPasswords': 'All passwords',
  'vault.noMatching': 'No matching passwords.',
  'vault.noneYet': 'No passwords yet.',
  'vault.openVault': 'Open vault',
  'vault.selectHint': 'Select a password to view its details, or create a new one.',
  'vault.fillThisLogin': 'Fill this login',
  'vault.copyPassword': 'Copy password',
  'vault.fillLogin': 'Fill login',

  // quickaccess flashes
  'flash.originalPageClosed': 'The original page is no longer open.',
  'flash.filledLogin': 'Filled the login form.',
  'flash.noLoginForm': 'No login form found on this page.',
  'flash.passwordCopied30s': 'Password copied · clears in 30s.',

  // detail view
  'detail.username': 'Username',
  'detail.password': 'Password',
  'detail.passwordLocked': '•••••••• (locked)',
  'detail.description': 'Description',
  'detail.reveal': 'Reveal',
  'detail.decrypting': 'Decrypting…',
  'detail.show': 'Show',
  'detail.hide': 'Hide',
  'detail.copyPassword': 'Copy password',
  'detail.fillActiveTab': 'Fill active tab',
  'detail.breachCheck': 'Breach check',
  'detail.checking': 'Checking…',
  'detail.copied30s': 'Copied · clears in 30s',
  'detail.filledPage': 'Filled the page',
  'detail.noLoginFormPage': 'No login form on that page',
  'detail.noOpenPage': 'No open web page to fill — open the site first.',
  'detail.codeCopied30s': 'Code copied · clears in 30s',
  'detail.filledCode': 'Filled the code',
  'detail.noCodeField': 'No code field on that page',

  // breach results (shared by detail / generator / create form)
  'breach.unavailable': 'Breach check unavailable.',
  'breach.notFound': 'Not found in known breaches.',
  'breach.foundConsiderChanging':
    'Found in {{count}} known breaches — consider changing it.',
  'breach.foundChooseAnother': 'Found in {{count}} known breaches — choose another.',

  // TOTP view
  'totp.label': 'Verification code (TOTP)',
  'totp.secondsUntilRefresh': 'Seconds until refresh',
  'totp.copyCode': 'Copy code',
  'totp.fillCodeOnPage': 'Fill code on page',

  // password strength (official six tiers)
  'strength.notAvailable': 'N/A',
  'strength.veryWeak': 'Very weak',
  'strength.weak': 'Weak',
  'strength.fair': 'Fair',
  'strength.strong': 'Strong',
  'strength.veryStrong': 'Very strong',

  // password generator
  'gen.title': 'Password generator',
  'gen.password': 'Password',
  'gen.passphrase': 'Passphrase',
  'gen.regenerate': 'Regenerate',
  'gen.copy': 'Copy',
  'gen.bits': '~{{bits}} bits',
  'gen.checkBreaches': 'Check breaches',
  'gen.length': 'Length: {{n}}',
  'gen.words': 'Words: {{n}}',
  'gen.separator': 'Separator',
  'gen.noLookAlikes': 'No look-alikes',
  'gen.case.lower': 'lower',
  'gen.case.capitalize': 'Capitalize',
  'gen.case.upper': 'UPPER',
  'gen.useThis': 'Use this',

  // create-resource form
  'create.title': 'New password',
  'create.name': 'Name *',
  'create.namePlaceholder': 'e.g. GitHub',
  'create.username': 'Username',
  'create.usernamePlaceholder': 'you@example.com',
  'create.website': 'Website',
  'create.websitePlaceholder': 'https://example.com',
  'create.passwordRequired': 'Password *',
  'create.passwordPlaceholder': 'Enter or generate',
  'create.generator': 'Generator',
  'create.descriptionPlaceholder': 'Encrypted with the secret',
  'create.saving': 'Saving…',
  'create.savePassword': 'Save password',

  // options page
  'options.session': 'Session',
  'options.status': 'Status',
  'options.lockVault': 'Lock vault',
  'options.removeAccount': 'Remove account',
  'options.about': 'About',
  'options.aboutBody':
    "JPassbolt browser extension — an Aegis-styled, Passbolt-compatible E2EE client. Your private key and all decryption run only inside the extension's background service worker; web pages never see your key or passphrase. The vault auto-locks after 15 minutes of inactivity.",
  'options.language': 'Language',
  'options.languageIntro': 'Choose the display language for the extension.',
  'options.lang.zh': '中文',
  'options.lang.en': 'English',

  // options flashes
  'options.flash.vaultLocked': 'Vault locked.',
  'options.flash.accountRemoved': 'Account removed from this browser.',
  'options.flash.serverSaved': 'Server saved.',
  'options.flash.appOriginSaved': 'Web app address saved.',
  'options.flash.keyImported': 'Key imported.',
  'options.flash.languageChanged': 'Language updated.',

  // vault phases (status display)
  'phase.no_server': 'no_server',
  'phase.no_account': 'no_account',
  'phase.locked': 'locked',
  'phase.unlocked': 'unlocked',

  // in-form autofill UI (content script)
  'inform.suggestedLoginsCount': 'Suggested logins ({{count}})',
  'inform.noSavedLogins': 'No saved logins for this site.',
  'inform.generatePassword': 'Generate password',
  'inform.browseAllPasswords': 'Browse all passwords',
  'inform.saveThisPassword': 'Save this password?',
  'inform.notNow': 'Not now',
  'inform.save': 'Save',
  'inform.saving': 'Saving…',
  'inform.retry': 'Retry',

  // background errors / messages
  'bg.noResponse': 'No response from the background service worker.',
  'bg.noServerConfigured':
    'No server configured. Open Settings and set your JPassbolt server URL.',
  'bg.sessionExpired': 'Session expired. Please unlock again.',
  'bg.noAccountMatchesKey': 'No account on the server matches this key.',
  'bg.noChallengeToken': 'Server did not return a GPGAuth challenge token.',
  'bg.authFailedNoJwt': 'Authentication failed: no JWT returned.',
  'bg.encryptedItem': '(encrypted item)',
  'bg.vaultLocked': 'Vault is locked.',
  'bg.resourceNotFound': 'Resource not found.',
  'bg.publicKeyUnavailable':
    'Your public key is unavailable. Re-import your key in Settings.',
  'bg.nameRequired': 'A name is required.',
  'bg.passwordRequired': 'A password is required.',
  'bg.nothingToSave': 'Nothing to save.',
  'bg.invalidPrivateKey': 'Invalid OpenPGP private key.',
  'bg.keyNotProtected':
    'This private key is not passphrase-protected. JPassbolt refuses to store an unprotected key.',
  'bg.noServerConfiguredShort': 'No server configured.',
  'bg.noPrivateKeyImported': 'No private key imported yet.',
  'bg.storedKeyCorrupt': 'Stored private key is corrupt. Re-import it in Settings.',
  'bg.incorrectPassphrase': 'Incorrect passphrase.',
  'bg.noTotpConfigured': 'This item has no TOTP configured.',
  'bg.noActiveTab': 'No active tab.',
  'bg.requiresTabContext': 'This action requires a tab context.',
  'bg.unknownRequest': 'Unknown request: {{type}}',
  'bg.requestFailed': 'Request failed ({{status}}).',
  'bg.bridgeNotAllowed': 'Session-state bridge is not enabled for this origin.',
};

const zh: Dict = {
  // brand / common
  'app.name': 'JPassbolt',
  'common.continue': '继续',
  'common.cancel': '取消',
  'common.refresh': '刷新',
  'common.new': '新建',
  'common.save': '保存',
  'common.dash': '—',

  // header / chrome
  'header.settings': '设置',
  'header.lockVault': '锁定密码库',
  'header.openSeparateWindow': '在独立窗口中打开',

  // flow / spinners
  'flow.loading': '加载中…',
  'flow.loadingVault': '正在加载密码库…',

  // server form
  'server.title': '连接到你的服务器',
  'server.intro': '输入你的 JPassbolt 服务器地址。',
  'server.label': '服务器地址',
  'server.placeholder': 'https://passbolt.example.com',
  'server.saving': '正在保存…',

  // web-app origin (SPA session-state bridge)
  'appOrigin.title': 'Web 应用地址',
  'appOrigin.intro': '允许接收会话状态通知（已解锁 / 已锁定 / 已退出——绝不包含密钥或机密）的 JPassbolt 网页应用来源。留空则关闭该桥。',
  'appOrigin.label': 'Web 应用来源',
  'appOrigin.placeholder': 'https://app.example.com',
  'appOrigin.invalid': '请输入有效的 URL（如 https://app.example.com）。',

  // key import form
  'key.title': '导入你的私钥',
  'key.intro':
    '粘贴受口令保护的 OpenPGP 私钥。它仅保存在扩展内部，绝不会离开你的浏览器。',
  'key.label': '装甲格式私钥',
  'key.placeholder': '-----BEGIN PGP PRIVATE KEY BLOCK-----',
  'key.fileLoaded': '已加载密钥文件：{name}',
  'key.clearFile': '移除',
  'key.importing': '正在导入…',
  'key.import': '导入私钥',

  // unlock form
  'unlock.title': '解锁你的密码库',
  'unlock.signedInAs': '已登录为 {{username}}',
  'unlock.enterPassphrase': '输入口令以解锁。',
  'unlock.passphrase': '口令',
  'unlock.unlocking': '正在解锁…',
  'unlock.unlock': '解锁',
  'unlock.useDifferentAccount': '使用其他账户',

  // quickaccess / vault list
  'vault.searchPlaceholder': '搜索密码库…',
  'vault.searchShort': '搜索…',
  'vault.forThisSite': '当前网站',
  'vault.allPasswords': '全部密码',
  'vault.noMatching': '没有匹配的密码。',
  'vault.noneYet': '还没有任何密码。',
  'vault.openVault': '打开密码库',
  'vault.selectHint': '选择一个密码查看详情，或新建一个。',
  'vault.fillThisLogin': '填充此登录',
  'vault.copyPassword': '复制密码',
  'vault.fillLogin': '填充登录',

  // quickaccess flashes
  'flash.originalPageClosed': '原页面已经关闭。',
  'flash.filledLogin': '已填充登录表单。',
  'flash.noLoginForm': '此页面未找到登录表单。',
  'flash.passwordCopied30s': '密码已复制 · 30 秒后清除。',

  // detail view
  'detail.username': '用户名',
  'detail.password': '密码',
  'detail.passwordLocked': '••••••••（已锁定）',
  'detail.description': '描述',
  'detail.reveal': '显示密码',
  'detail.decrypting': '正在解密…',
  'detail.show': '显示',
  'detail.hide': '隐藏',
  'detail.copyPassword': '复制密码',
  'detail.fillActiveTab': '填充当前标签页',
  'detail.breachCheck': '泄露检测',
  'detail.checking': '检测中…',
  'detail.copied30s': '已复制 · 30 秒后清除',
  'detail.filledPage': '已填充页面',
  'detail.noLoginFormPage': '该页面没有登录表单',
  'detail.noOpenPage': '没有可填充的网页 — 请先打开目标网站。',
  'detail.codeCopied30s': '验证码已复制 · 30 秒后清除',
  'detail.filledCode': '已填充验证码',
  'detail.noCodeField': '该页面没有验证码输入框',

  // breach results
  'breach.unavailable': '泄露检测暂不可用。',
  'breach.notFound': '未在已知泄露库中发现。',
  'breach.foundConsiderChanging': '在 {{count}} 次已知泄露中发现 — 建议更换。',
  'breach.foundChooseAnother': '在 {{count}} 次已知泄露中发现 — 请换一个。',

  // TOTP view
  'totp.label': '验证码（TOTP）',
  'totp.secondsUntilRefresh': '距离刷新的秒数',
  'totp.copyCode': '复制验证码',
  'totp.fillCodeOnPage': '在页面填充验证码',

  // password strength
  'strength.notAvailable': '不适用',
  'strength.veryWeak': '非常弱',
  'strength.weak': '弱',
  'strength.fair': '一般',
  'strength.strong': '强',
  'strength.veryStrong': '非常强',

  // password generator
  'gen.title': '密码生成器',
  'gen.password': '密码',
  'gen.passphrase': '口令短语',
  'gen.regenerate': '重新生成',
  'gen.copy': '复制',
  'gen.bits': '约 {{bits}} 位熵',
  'gen.checkBreaches': '检测泄露',
  'gen.length': '长度：{{n}}',
  'gen.words': '单词数：{{n}}',
  'gen.separator': '分隔符',
  'gen.noLookAlikes': '排除易混淆字符',
  'gen.case.lower': '小写',
  'gen.case.capitalize': '首字母大写',
  'gen.case.upper': '大写',
  'gen.useThis': '使用此密码',

  // create-resource form
  'create.title': '新建密码',
  'create.name': '名称 *',
  'create.namePlaceholder': '例如：GitHub',
  'create.username': '用户名',
  'create.usernamePlaceholder': 'you@example.com',
  'create.website': '网站',
  'create.websitePlaceholder': 'https://example.com',
  'create.passwordRequired': '密码 *',
  'create.passwordPlaceholder': '输入或生成',
  'create.generator': '生成器',
  'create.descriptionPlaceholder': '随密文一起加密',
  'create.saving': '正在保存…',
  'create.savePassword': '保存密码',

  // options page
  'options.session': '会话',
  'options.status': '状态',
  'options.lockVault': '锁定密码库',
  'options.removeAccount': '移除账户',
  'options.about': '关于',
  'options.aboutBody':
    'JPassbolt 浏览器扩展 — 一个 Aegis 风格、与 Passbolt 兼容的端到端加密客户端。你的私钥及所有解密操作仅在扩展的后台 service worker 中进行；网页永远看不到你的私钥或口令。密码库在 15 分钟无操作后会自动锁定。',
  'options.language': '语言',
  'options.languageIntro': '选择扩展的显示语言。',
  'options.lang.zh': '中文',
  'options.lang.en': 'English',

  // options flashes
  'options.flash.vaultLocked': '密码库已锁定。',
  'options.flash.accountRemoved': '已从此浏览器移除账户。',
  'options.flash.serverSaved': '服务器已保存。',
  'options.flash.appOriginSaved': 'Web 应用地址已保存。',
  'options.flash.keyImported': '私钥已导入。',
  'options.flash.languageChanged': '语言已更新。',

  // vault phases (status display)
  'phase.no_server': '未配置服务器',
  'phase.no_account': '未导入账户',
  'phase.locked': '已锁定',
  'phase.unlocked': '已解锁',

  // in-form autofill UI (content script)
  'inform.suggestedLoginsCount': '建议的登录（{{count}}）',
  'inform.noSavedLogins': '此网站没有已保存的登录。',
  'inform.generatePassword': '生成密码',
  'inform.browseAllPasswords': '浏览全部密码',
  'inform.saveThisPassword': '保存此密码？',
  'inform.notNow': '暂不',
  'inform.save': '保存',
  'inform.saving': '正在保存…',
  'inform.retry': '重试',

  // background errors / messages
  'bg.noResponse': '后台 service worker 无响应。',
  'bg.noServerConfigured': '尚未配置服务器。请打开设置并填入你的 JPassbolt 服务器地址。',
  'bg.sessionExpired': '会话已过期，请重新解锁。',
  'bg.noAccountMatchesKey': '服务器上没有账户与此密钥匹配。',
  'bg.noChallengeToken': '服务器未返回 GPGAuth 质询令牌。',
  'bg.authFailedNoJwt': '认证失败：未返回 JWT。',
  'bg.encryptedItem': '(加密条目)',
  'bg.vaultLocked': '密码库已锁定。',
  'bg.resourceNotFound': '未找到该资源。',
  'bg.publicKeyUnavailable': '你的公钥不可用。请在设置中重新导入私钥。',
  'bg.nameRequired': '名称为必填项。',
  'bg.passwordRequired': '密码为必填项。',
  'bg.nothingToSave': '没有可保存的内容。',
  'bg.invalidPrivateKey': '无效的 OpenPGP 私钥。',
  'bg.keyNotProtected': '该私钥未受口令保护。JPassbolt 拒绝保存未受保护的私钥。',
  'bg.noServerConfiguredShort': '尚未配置服务器。',
  'bg.noPrivateKeyImported': '尚未导入私钥。',
  'bg.storedKeyCorrupt': '已存储的私钥已损坏。请在设置中重新导入。',
  'bg.incorrectPassphrase': '口令不正确。',
  'bg.noTotpConfigured': '该条目未配置 TOTP。',
  'bg.noActiveTab': '没有活动标签页。',
  'bg.requiresTabContext': '此操作需要标签页上下文。',
  'bg.unknownRequest': '未知请求：{{type}}',
  'bg.requestFailed': '请求失败（{{status}}）。',
  'bg.bridgeNotAllowed': '会话状态桥未对该来源启用。',
};

const DICTS: Record<Locale, Dict> = { zh, en };

/**
 * Translate `key` for the active locale. Interpolates `{{var}}` placeholders
 * from `vars`. Resolution order: active dict -> English dict -> the key itself.
 */
export function t(key: string, vars?: Record<string, string | number>): string {
  const dict = DICTS[current];
  let template = dict[key];
  if (template == null) template = en[key];
  if (template == null) return key;
  if (!vars) return template;
  return template.replace(/\{\{(\w+)\}\}/g, (_m, name: string) =>
    name in vars ? String(vars[name]) : `{{${name}}}`,
  );
}

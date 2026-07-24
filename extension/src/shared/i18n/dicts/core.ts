/**
 * Core dictionary — the original 513-line extension dictionary, moved here
 * verbatim from the old shared/i18n.ts. Owns every key the popup / options /
 * content scripts / background already use (namespaces: app.name, common.*,
 * header.*, flow.*, server.*, key.*, unlock.*, vault.*, flash.*, detail.*,
 * breach.*, totp.*, strength.*, gen.*, create.*, options.*, phase.*, inform.*,
 * bg.*). New app-shell / domain-page keys live in the sibling dicts.
 *
 * The `Dict` shape and the zh-default / en-fallback resolution live in
 * ../index.ts; this file only exports the two flat maps.
 */
import type { Dict } from '../types';

export const en: Dict = {
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
  'header.signOut': 'Sign out',
  'header.openSeparateWindow': 'Open in a separate window',

  // quickaccess browse (official popup layout: Suggested / Browse / drill-downs)
  'qa.suggested': 'Suggested',
  'qa.noSuggestions': 'No passwords found for the current page. You can use the search.',
  'qa.browse': 'Browse',
  'qa.filters': 'Filters',
  'qa.groups': 'Groups',
  'qa.createNew': 'Create new',
  'qa.back': 'Back',
  'qa.close': 'Close',
  'qa.filter.favorites': 'Favorites',
  'qa.filter.owned': 'Items I own',
  'qa.filter.recent': 'Recently modified',
  'qa.filter.shared': 'Shared with me',
  'qa.emptyList': 'No passwords in this list.',
  'qa.emptyGroup': 'No passwords are shared with this group.',
  'qa.noGroups': 'You are not a member of any group.',
  'qa.loadingGroups': 'Loading groups…',

  // flow / spinners
  'flow.loading': 'Loading…',
  'flow.loadingVault': 'Loading vault…',

  // server form
  'server.title': 'Connect to your server',
  'server.intro': 'Enter the URL of your JPassbolt server.',
  'server.label': 'Server URL',
  'server.placeholder': 'https://passbolt.example.com',
  'server.saving': 'Saving…',

  // no-account onboarding card (replaces the retired arbitrary key-import form)
  'noaccount.title': 'This device has no account yet',
  'noaccount.body':
    'Open the invitation or recovery link from your email to finish setting up this device. No email yet?',
  'noaccount.sendRecovery': 'Send a recovery email',

  // unlock form
  'unlock.title': 'Unlock your vault',
  'unlock.enterPassphrase': 'Enter your passphrase to unlock.',
  'unlock.passphrase': 'Passphrase',
  'unlock.signingIn': 'Signing in…',
  'unlock.signIn': 'Sign in',
  'unlock.lostPassphrase': 'Help, I lost my passphrase.',
  'unlock.recoverSent': 'Recovery email sent — check your mailbox.',
  'unlock.switchAccount': 'Sign in with another account? Send a recovery email.',

  // anti-phishing security token badge (shown inside every passphrase field)
  'securityToken.badgeAria':
    'Your security token — check it before typing your passphrase. If it does not match the one you set, this page may be a phishing fake.',

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
  'options.signOut': 'Sign out',
  'options.removeAccount': 'Remove account from this device',
  'options.removeAccountHint':
    'Signing out only ends this session — your key stays on this device. Removing the account deletes its private key from this browser: without your own recovery kit backup, the data it protects can never be decrypted again. The server does NOT store your private key.',
  'options.removeAccountConfirm':
    'Remove this account from this device?\n\nIts private key will be deleted from this browser. Make sure you have already saved your private-key recovery kit — the server does NOT keep a copy, so without that backup the account’s data can never be decrypted again.',
  'options.about': 'About',
  'options.aboutBody':
    "JPassbolt browser extension — an Aegis-styled, Passbolt-compatible E2EE client. Your private key and all decryption run only inside the extension's background service worker; web pages never see your key or passphrase. The vault auto-locks after 15 minutes of inactivity.",
  'options.language': 'Language',
  'options.languageIntro': 'Choose the display language for the extension.',
  'options.lang.zh': '中文',
  'options.lang.en': 'English',

  // options flashes
  'options.flash.vaultLocked': 'Vault locked.',
  'options.flash.loggedOut': 'Signed out. Your key stays on this device.',
  'options.flash.accountRemoved': 'Account removed from this browser.',
  'options.flash.serverSaved': 'Server saved.',
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
  'inform.unlockRequired': 'The vault is locked. Unlock it to fill this credential.',
  'inform.unlock': 'Unlock JPassbolt',

  // background errors / messages
  'bg.noResponse': 'No response from the background service worker.',
  'bg.noServerConfigured':
    'No server configured. Open Settings and set your JPassbolt server URL.',
  'bg.sessionExpired': 'Session expired. Please unlock again.',
  'bg.noAccountMatchesKey': 'No account on the server matches this key.',
  'bg.noChallengeToken': 'Server did not return a GPGAuth challenge token.',
  // Local renderings of known X-GPGAuth-Debug messages — the server's own text
  // is never shown (see gpgAuthError in background/http.ts).
  'bg.gpgAuthMissingKeyId': 'Login failed: no key fingerprint was sent to the server.',
  'bg.gpgAuthServerKeyProblem':
    "The server rejected the login because of a problem with its own GPG key. This is a server-side misconfiguration — contact the administrator.",
  'bg.gpgAuthRejected':
    'The server rejected the login request. Check that this key belongs to an account on this server.',
  'bg.badChallengeFormat':
    'The server sent a malformed login challenge. Nothing was sent back — this server may be compromised.',
  'bg.serverKeyMismatch':
    "The server's key has changed and could not be verified. Login was stopped to protect you — this server may have been tampered with. Re-open your invitation or recovery email link to re-establish trust.",
  'bg.serverKeyPinFailed': 'Could not fetch or verify the server key.',
  'bg.authFailedNoJwt': 'Authentication failed: no JWT returned.',
  'bg.encryptedItem': '(encrypted item)',
  'bg.vaultLocked': 'Vault is locked.',
  'bg.resourceNotFound': 'Resource not found.',
  'bg.invalidGroupId': 'Invalid group id.',
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
  'bg.accountExists':
    'This device is already linked to an account; replacing it requires an explicit confirmation.',
  'bg.storedKeyCorrupt': 'Stored private key is corrupt. Re-import it in Settings.',
  'bg.incorrectPassphrase': 'Incorrect passphrase.',
  'bg.newPassphraseRequired': 'A new passphrase is required.',
  'bg.passphraseChangeFailed':
    'The re-protected key could not be verified. Your passphrase was NOT changed.',
  'bg.noTotpConfigured': 'This item has no TOTP configured.',
  'bg.noActiveTab': 'No active tab.',
  'bg.requiresTabContext': 'This action requires a tab context.',
  'bg.unknownRequest': 'Unknown request: {{type}}',
  'bg.requestFailed': 'Request failed ({{status}}).',
  'bg.clipboardWriteFailed': 'Could not write to the clipboard.',
  'bg.save.policyUnknown':
    'Could not determine the organization resource-format policy (v4/v5). The save was aborted to avoid writing the wrong format — please try again.',
  'bg.save.v5MetadataUnavailable':
    'This item stores its metadata encrypted (v5), but the shared metadata key is unavailable right now. The save was aborted to prevent a plaintext downgrade — please try again.',
  'bg.save.unsupportedType': 'Items of type “{{slug}}” cannot be edited with this form yet.',
  'bg.save.typeUnresolved':
    'Could not resolve the resource type from the server catalogue. The save was aborted.',
  'bg.save.totpWouldBeLost':
    'Saving would delete this item’s TOTP configuration, so it was aborted. Re-open the item and try again.',
  'bg.save.reencryptFailed':
    'Could not re-encrypt the secret for every user with access, so nothing was saved: {{details}}',
  'bg.save.noPublicKey': 'No public key is available for {{who}}.',
  'bg.save.cannotGetKey': 'Could not fetch the public key of {{who}}.',
};

export const zh: Dict = {
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
  'header.signOut': '退出登录',
  'header.openSeparateWindow': '在独立窗口中打开',

  // quickaccess browse (official popup layout: Suggested / Browse / drill-downs)
  'qa.suggested': '当前页面建议',
  'qa.noSuggestions': '未找到与当前页面匹配的密码，可以使用搜索。',
  'qa.browse': '浏览',
  'qa.filters': '筛选',
  'qa.groups': '群组',
  'qa.createNew': '新建密码',
  'qa.back': '返回',
  'qa.close': '关闭',
  'qa.filter.favorites': '收藏',
  'qa.filter.owned': '我拥有的',
  'qa.filter.recent': '最近修改',
  'qa.filter.shared': '共享给我的',
  'qa.emptyList': '此列表中没有密码。',
  'qa.emptyGroup': '没有密码共享给该群组。',
  'qa.noGroups': '你还不属于任何群组。',
  'qa.loadingGroups': '正在加载群组…',

  // flow / spinners
  'flow.loading': '加载中…',
  'flow.loadingVault': '正在加载密码库…',

  // server form
  'server.title': '连接到你的服务器',
  'server.intro': '输入你的 JPassbolt 服务器地址。',
  'server.label': '服务器地址',
  'server.placeholder': 'https://passbolt.example.com',
  'server.saving': '正在保存…',


  // no-account onboarding card (replaces the retired arbitrary key-import form)
  'noaccount.title': '本设备尚未配置账号',
  'noaccount.body': '请打开邮件中的邀请或恢复链接完成配置；没有收到邮件？',
  'noaccount.sendRecovery': '发送恢复邮件',

  // unlock form
  'unlock.title': '解锁你的密码库',
  'unlock.enterPassphrase': '输入口令以解锁。',
  'unlock.passphrase': '口令',
  'unlock.signingIn': '正在登录…',
  'unlock.signIn': '登录',
  'unlock.lostPassphrase': '忘记口令？发送恢复邮件',
  'unlock.recoverSent': '恢复邮件已发送，请查收邮箱。',
  'unlock.switchAccount': '用其他账户登录？发送恢复邮件',

  // anti-phishing security token badge (shown inside every passphrase field)
  'securityToken.badgeAria':
    '你的安全令牌 — 输入主口令前请先核对。若与你设置的不一致，此页面可能是钓鱼仿冒。',

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
  'options.signOut': '退出登录',
  'options.removeAccount': '从此设备移除账号',
  'options.removeAccountHint':
    '「退出登录」只结束本次会话，私钥仍留在本设备。「从此设备移除账号」会删除本浏览器中的私钥：若没有自己保存的私钥恢复包备份，该账号的数据将永远无法再解密。服务器不保存你的私钥。',
  'options.removeAccountConfirm':
    '确定要从此设备移除账号吗？\n\n本浏览器中的私钥将被删除。移除前请确认已备份私钥恢复包——服务器不保存你的私钥，没有备份就再也无法解密该账号的数据。',
  'options.about': '关于',
  'options.aboutBody':
    'JPassbolt 浏览器扩展 — 一个 Aegis 风格、与 Passbolt 兼容的端到端加密客户端。你的私钥及所有解密操作仅在扩展的后台 service worker 中进行；网页永远看不到你的私钥或口令。密码库在 15 分钟无操作后会自动锁定。',
  'options.language': '语言',
  'options.languageIntro': '选择扩展的显示语言。',
  'options.lang.zh': '中文',
  'options.lang.en': 'English',

  // options flashes
  'options.flash.vaultLocked': '密码库已锁定。',
  'options.flash.loggedOut': '已退出登录，私钥仍保留在本设备。',
  'options.flash.accountRemoved': '已从此浏览器移除账户。',
  'options.flash.serverSaved': '服务器已保存。',
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
  'inform.unlockRequired': '密码库已锁定，解锁后才能填充此凭据。',
  'inform.unlock': '解锁 JPassbolt',

  // background errors / messages
  'bg.noResponse': '后台 service worker 无响应。',
  'bg.noServerConfigured': '尚未配置服务器。请打开设置并填入你的 JPassbolt 服务器地址。',
  'bg.sessionExpired': '会话已过期，请重新解锁。',
  'bg.noAccountMatchesKey': '服务器上没有账户与此密钥匹配。',
  'bg.noChallengeToken': '服务器未返回 GPGAuth 质询令牌。',
  // 已知 X-GPGAuth-Debug 消息的本地化呈现——服务端原文永不展示
  // （见 background/http.ts 的 gpgAuthError）。
  'bg.gpgAuthMissingKeyId': '登录失败：未向服务器发送密钥指纹。',
  'bg.gpgAuthServerKeyProblem': '服务器因自身 GPG 密钥问题拒绝了登录。这是服务端配置错误，请联系管理员。',
  'bg.gpgAuthRejected': '服务器拒绝了登录请求。请确认此密钥对应该服务器上的某个账户。',
  'bg.badChallengeFormat': '服务器下发的登录质询格式非法，已中止且未回传任何内容——该服务器可能已被入侵。',
  'bg.serverKeyMismatch':
    '服务器密钥已变更且无法验证。为保护你，登录已中止——该服务器可能被篡改。请重新打开邮件里的邀请/恢复链接以重新建立信任。',
  'bg.serverKeyPinFailed': '无法获取或验证服务器密钥。',
  'bg.authFailedNoJwt': '认证失败：未返回 JWT。',
  'bg.encryptedItem': '(加密条目)',
  'bg.vaultLocked': '密码库已锁定。',
  'bg.resourceNotFound': '未找到该资源。',
  'bg.invalidGroupId': '无效的群组 ID。',
  'bg.publicKeyUnavailable': '你的公钥不可用。请在设置中重新导入私钥。',
  'bg.nameRequired': '名称为必填项。',
  'bg.passwordRequired': '密码为必填项。',
  'bg.nothingToSave': '没有可保存的内容。',
  'bg.invalidPrivateKey': '无效的 OpenPGP 私钥。',
  'bg.keyNotProtected': '该私钥未受口令保护。JPassbolt 拒绝保存未受保护的私钥。',
  'bg.noServerConfiguredShort': '尚未配置服务器。',
  'bg.noPrivateKeyImported': '尚未导入私钥。',
  'bg.accountExists': '此设备已绑定账号，替换需显式确认。',
  'bg.storedKeyCorrupt': '已存储的私钥已损坏。请在设置中重新导入。',
  'bg.incorrectPassphrase': '口令不正确。',
  'bg.newPassphraseRequired': '请输入新口令。',
  'bg.passphraseChangeFailed': '重新加密后的密钥未通过校验，口令未被更改。',
  'bg.noTotpConfigured': '该条目未配置 TOTP。',
  'bg.noActiveTab': '没有活动标签页。',
  'bg.requiresTabContext': '此操作需要标签页上下文。',
  'bg.unknownRequest': '未知请求：{{type}}',
  'bg.requestFailed': '请求失败（{{status}}）。',
  'bg.clipboardWriteFailed': '无法写入剪贴板。',
  'bg.save.policyUnknown':
    '无法确认组织的资源格式策略（v4/v5），为避免以错误格式写入，本次保存已中止——请重试。',
  'bg.save.v5MetadataUnavailable':
    '该条目的元数据以 v5 加密存储，但共享元数据密钥当前不可用。为防止降级为明文，本次保存已中止——请重试。',
  'bg.save.unsupportedType': '暂不支持在此表单中编辑「{{slug}}」类型的条目。',
  'bg.save.typeUnresolved': '无法从服务器目录解析资源类型，本次保存已中止。',
  'bg.save.totpWouldBeLost': '本次保存会删除该条目的 TOTP 配置，已中止。请重新打开该条目后再试。',
  'bg.save.reencryptFailed': '无法为所有有权用户重新加密密钥，本次未保存任何内容：{{details}}',
  'bg.save.noPublicKey': '{{who}} 没有可用的公钥。',
  'bg.save.cannotGetKey': '无法获取 {{who}} 的公钥。',
};

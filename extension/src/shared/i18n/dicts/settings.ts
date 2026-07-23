/**
 * settings domain dictionary — the "My profile" workspace (WP-SETTINGS-CORE).
 *
 * Sections mirror official Passbolt's My Profile menu: Profile / Keys inspector
 * / Passphrase / Security token / Theme / Multi Factor Authentication, plus an
 * admin-only organization group. Deliberately excluded subtrees:
 *   - metadata.*    → dicts/metadata.ts (WP-METADATA-ADMIN)
 *   - orgPolicies.* → dicts/administration.ts (WP-SETTINGS-ADMIN)
 *   - common.*      → app.common.actions.* in dicts/appcommon.ts
 *
 * `appearance.*` keys survive the AppearanceCard that once owned them: the
 * language row moved to the Profile section and the theme/idle/clipboard rows to
 * the Theme section, but the row labels are unchanged and still shared.
 *
 * The i18next <Trans> uriStep key is split into uriStepBefore/uriStepAfter
 * around the literal <code>otpauth://</code> the component renders itself.
 */
import type { Dict } from '../types';

export const en: Dict = {
  // 应用页脚法务链接(条款/隐私)。放在 settings dict 内(common.ts 不存在),
  // 键前缀仍用 app.common.footer.* 以贴合语义;i18n 字典是扁平合并的。
  'app.common.footer.terms': 'Terms of service',
  'app.common.footer.privacy': 'Privacy policy',
  'app.settings.nav.heading': 'Settings',
  'app.settings.backToVault': 'Back to vault',
  'app.settings.nav.groups.account': 'My account',
  'app.settings.nav.groups.organization': 'Organization',
  'app.settings.nav.profile': 'Profile',
  'app.settings.nav.keys': 'Keys inspector',
  'app.settings.nav.passphrase': 'Passphrase',
  'app.settings.nav.securityToken': 'Security token',
  'app.settings.nav.theme': 'Theme',
  'app.settings.nav.mfa': 'Multi factor authentication',
  'app.settings.nav.orgEmail': 'Email notifications',
  'app.settings.nav.orgPassword': 'Password policy',
  'app.settings.nav.orgSmtp': 'Email server (SMTP)',
  'app.settings.nav.orgSelfReg': 'Self registration',
  'app.settings.nav.orgLocale': 'Organization language',
  'app.settings.nav.orgMfa': 'Organization MFA',
  'app.settings.nav.orgMetadata': 'Encrypted metadata',
  'app.settings.nav.orgServer': 'Server info',
  'app.settings.loadingAccount': 'Loading your account...',
  'app.settings.errors.orgMfaForbiddenView':
    'You do not have permission to view organization MFA settings.',
  'app.settings.errors.orgMfaForbiddenChange':
    'You do not have permission to change organization MFA settings.',

  // --- Profile section ---
  'app.settings.profile.title': 'Profile',
  'app.settings.profile.subtitle':
    'Manage your identity, display name and interface language.',
  'app.settings.profile.card.title': 'Identity',
  'app.settings.profile.i18n.title': 'Internationalisation',
  'app.settings.profile.nameRequired': 'Please enter your full name.',
  'app.settings.profile.nameTooLong': 'The name is too long (max 255 characters per part).',
  'app.settings.profile.updated': 'Profile updated.',
  'app.settings.profile.avatarUnsupported': 'Changing your avatar is not yet supported.',
  'app.settings.profile.name': 'Full name',
  'app.settings.profile.username': 'Username',
  'app.settings.profile.usernameHint': 'Used to sign in; cannot be changed',
  'app.settings.profile.save': 'Save changes',
  'app.settings.profile.roleFallback': 'user',

  // --- shared appearance rows (Profile: language · Theme: theme/idle/burn) ---
  'app.settings.appearance.language.label': 'Interface language',
  'app.settings.appearance.language.hint': 'Switch the display language of the whole interface.',
  'app.settings.appearance.language.zh': '中文',
  'app.settings.appearance.language.en': 'English',
  'app.settings.appearance.theme.label': 'Theme',
  'app.settings.appearance.theme.hint': 'Choose a light or dark appearance.',
  'app.settings.appearance.theme.light': 'Light',
  'app.settings.appearance.theme.dark': 'Dark',
  'app.settings.appearance.idle.label': 'Auto-lock',
  'app.settings.appearance.idle.hint':
    'Automatically lock the vault after a period of inactivity.',
  'app.settings.appearance.idle.m5': '5 minutes',
  'app.settings.appearance.idle.m15': '15 minutes',
  'app.settings.appearance.idle.m30': '30 minutes',
  'app.settings.appearance.idle.h1': '1 hour',
  'app.settings.appearance.idle.never': 'Never',
  'app.settings.appearance.burn.label': 'Clipboard clear delay',
  'app.settings.appearance.burn.hint':
    'After copying a password, best-effort clear the clipboard once this time elapses.',
  'app.settings.appearance.burn.seconds': '{{count}} seconds',
  'app.settings.appearance.burn.never': 'Never',

  // --- Theme section ---
  'app.settings.theme.title': 'Theme',
  'app.settings.theme.subtitle':
    'Appearance and local security behavior. These preferences are saved on this device only.',
  'app.settings.theme.card.title': 'Appearance',
  'app.settings.theme.local.title': 'This device',

  // --- Keys inspector section ---
  'app.settings.keys.title': 'Keys inspector',
  'app.settings.keys.subtitle':
    'The OpenPGP key this device uses to encrypt and decrypt your vault.',
  'app.settings.keys.algorithm': 'Algorithm',
  'app.settings.keys.userIds': 'User IDs',
  'app.settings.keys.fingerprintUnavailable':
    'No key fingerprint is available on this device.',
  'app.settings.keys.publicKey.title': 'Public key',
  'app.settings.keys.publicKey.intro':
    'Share this block freely: it lets others encrypt data for you and verify your signatures. It contains no secret material.',
  'app.settings.keys.publicKey.show': 'Show public key',
  'app.settings.keys.publicKey.hide': 'Hide public key',
  'app.settings.keys.publicKey.copy': 'Copy public key',
  'app.settings.keys.publicKey.download': 'Download public key',
  'app.settings.keys.publicKey.unavailable':
    'The public key is unavailable on this device.',
  'app.settings.keys.privateKeyNote':
    'Your private key is never shown or exported here. It stays passphrase-protected in this browser, and the server never holds a copy — back it up with the recovery kit from the setup flow.',

  // --- Passphrase section ---
  'app.settings.passphrase.title': 'Passphrase',
  'app.settings.passphrase.subtitle':
    'Change the passphrase that protects your private key on this device.',
  'app.settings.passphrase.card.title': 'Change passphrase',
  'app.settings.passphrase.warning':
    'This passphrase protects your private key on THIS device only — the server never stores it and cannot reset it. If you lose it, no one can recover your data. Back up your recovery kit before changing it.',
  'app.settings.passphrase.current': 'Current passphrase',
  'app.settings.passphrase.new': 'New passphrase',
  'app.settings.passphrase.confirm': 'Confirm new passphrase',
  'app.settings.passphrase.strength': 'Strength',
  'app.settings.passphrase.mismatch': 'The two passphrases do not match.',
  'app.settings.passphrase.submit': 'Change passphrase',
  'app.settings.passphrase.saving': 'Re-encrypting key...',
  'app.settings.passphrase.changed': 'Passphrase changed. Unlock again with the new one.',
  'app.settings.passphrase.failed': 'Failed to change the passphrase.',
  'app.settings.passphrase.relockNote':
    'Your key is re-encrypted locally; no request is sent. The vault locks right after, so you can confirm the new passphrase works.',

  // --- Security token section ---
  'app.settings.securityToken.title': 'Security token',
  'app.settings.securityToken.subtitle':
    'A personal marker shown whenever JPassbolt asks for your passphrase.',
  'app.settings.securityToken.card.title': 'Anti-phishing marker',
  'app.settings.securityToken.intro':
    'Pick three characters and a colour. Every genuine passphrase prompt shows them; a look-alike page cannot, because the token never leaves this device and is never sent to the server.',
  'app.settings.securityToken.code': 'Token characters',
  'app.settings.securityToken.codeHint': 'Exactly 3 letters or digits.',
  'app.settings.securityToken.color': 'Token colour',
  'app.settings.securityToken.colorHint': 'Pick a colour you will recognise at a glance.',
  'app.settings.securityToken.preview': 'Preview',
  'app.settings.securityToken.previewHint': 'This is how the token appears next to a passphrase field.',
  'app.settings.securityToken.invalidCode': 'The token must be exactly 3 letters or digits.',
  'app.settings.securityToken.saved': 'Security token saved.',
  'app.settings.securityToken.saveFailed': 'Failed to save the security token.',

  // --- MFA section (per-user TOTP) ---
  'app.settings.security.title': 'Multi factor authentication',
  'app.settings.security.subtitle':
    'Add a verification layer to the sign-in path. MFA is checked on the server and does not affect end-to-end encryption.',
  'app.settings.security.rateLimited': 'Too many attempts. Please try again later.',
  'app.settings.security.orgDisabled':
    'Two-factor authentication is not yet enabled at the organization level. Ask an admin to turn on "Organization-wide TOTP" in the Organization > Organization MFA section first, then come back here to set it up.',
  'app.settings.security.card.title': 'Authenticator app (TOTP)',
  'app.settings.security.card.enabled': 'Enabled',
  'app.settings.security.card.notConfigured': 'Not configured',
  'app.settings.security.card.intro':
    'At sign-in, use a one-time code from an authenticator app (Google Authenticator, Authy, 1Password, etc.) as a second factor.',
  'app.settings.security.card.checking': 'Checking MFA status...',
  'app.settings.security.card.enabledOn': 'Enabled, set up on {{date}}.',
  'app.settings.security.card.enabledPlain': 'Enabled.',
  'app.settings.security.card.disableButton': 'Turn off two-factor',
  'app.settings.security.card.setupButton': 'Set up two-factor',
  'app.settings.security.card.preparing': 'Preparing...',
  'app.settings.security.setup.noProvisioningUri':
    'The server did not return a provisioning URI.',
  'app.settings.security.setup.invalidCode':
    'Enter the 6-digit code generated by your authenticator app.',
  'app.settings.security.setup.enabled': 'Two-factor authentication enabled.',
  'app.settings.security.setup.scanStep':
    'Scan the QR code with Google Authenticator, 1Password or Authy.',
  'app.settings.security.setup.manualKeyStep': 'Or enter the key manually:',
  'app.settings.security.setup.uriStepBefore': 'Or paste the full ',
  'app.settings.security.setup.uriStepAfter': ' URI:',
  'app.settings.security.setup.codeStep': 'Enter the 6-digit code to finish setup.',
  'app.settings.security.setup.verifyEnable': 'Verify & enable',
  'app.settings.security.setup.verifying': 'Verifying...',
  'app.settings.security.disabled.done': 'Two-factor authentication turned off.',
  'app.settings.security.confirmDisable.title': 'Turn off two-factor?',
  'app.settings.security.confirmDisable.message':
    'After this, signing in will no longer require a one-time code. You can re-enable it any time.',
  'app.settings.security.confirmDisable.confirmLabel': 'Turn off',
  'app.settings.security.qr.unavailable':
    "Can't generate a QR code — paste the key below into your authenticator manually.",
  'app.settings.security.qr.ariaLabel': 'TOTP setup QR code',

  // --- OpenPGP key card (shared by the Keys inspector) ---
  'app.settings.account.gpg.title': 'OpenPGP key fingerprint',
  'app.settings.account.gpg.intro':
    'This OpenPGP key does all encryption and decryption locally. You can share the fingerprint with others to verify your identity; your private key and passphrase never leave this device and are never visible to the server.',
  'app.settings.account.gpg.copyFingerprint': 'Copy fingerprint',
  'app.settings.account.gpg.keyId': 'Key ID',
  'app.settings.account.gpg.keyBits': 'Key length',
  'app.settings.account.gpg.bitsValue': '{{bits}} bits',

  // --- Organization: server info + org MFA ---
  'app.settings.server.subtitle': 'Read-only configuration reported by the JPassbolt server.',
  'app.settings.account.server.title': 'Server info',
  'app.settings.account.server.readonly': 'Read-only info returned by the JPassbolt API.',
  'app.settings.account.server.loading': 'Loading server info...',
  'app.settings.account.server.empty': 'The server did not return any configuration info.',
  'app.settings.orgMfa.subtitle':
    'Which second-factor providers users of this organization may enable.',
  'app.settings.account.orgMfa.title': 'Organization two-factor (admin)',
  'app.settings.account.orgMfa.totpOn': 'TOTP on',
  'app.settings.account.orgMfa.totpOff': 'TOTP off',
  'app.settings.account.orgMfa.wholeOrgTotp': 'Organization-wide TOTP',
  'app.settings.account.orgMfa.hintOn': 'Every user in this organization may enable TOTP.',
  'app.settings.account.orgMfa.hintOff': 'TOTP is currently disabled organization-wide.',
  'app.settings.account.orgMfa.toggleAria': 'Toggle organization-wide TOTP',
  'app.settings.account.orgMfa.loading': 'Loading organization MFA...',
  'app.settings.account.orgMfa.enabledToast': 'Organization TOTP enabled.',
  'app.settings.account.orgMfa.disabledToast': 'Organization TOTP disabled.',
};

export const zh: Dict = {
  // 应用页脚法务链接(条款/隐私)。
  'app.common.footer.terms': '使用条款',
  'app.common.footer.privacy': '隐私政策',
  'app.settings.nav.heading': '设置',
  'app.settings.backToVault': '返回密码库',
  'app.settings.nav.groups.account': '我的账户',
  'app.settings.nav.groups.organization': '组织设置',
  'app.settings.nav.profile': '个人资料',
  'app.settings.nav.keys': '密钥检视',
  'app.settings.nav.passphrase': '口令',
  'app.settings.nav.securityToken': '安全令牌',
  'app.settings.nav.theme': '主题',
  'app.settings.nav.mfa': '两步验证',
  'app.settings.nav.orgEmail': '邮件通知',
  'app.settings.nav.orgPassword': '密码策略',
  'app.settings.nav.orgSmtp': '邮件服务器（SMTP）',
  'app.settings.nav.orgSelfReg': '自助注册',
  'app.settings.nav.orgLocale': '组织语言',
  'app.settings.nav.orgMfa': '组织两步验证',
  'app.settings.nav.orgMetadata': '加密元数据',
  'app.settings.nav.orgServer': '服务器信息',
  'app.settings.loadingAccount': '正在加载你的账户...',
  'app.settings.errors.orgMfaForbiddenView': '你没有权限查看组织 MFA 设置。',
  'app.settings.errors.orgMfaForbiddenChange': '你没有权限修改组织 MFA 设置。',

  // --- 个人资料 ---
  'app.settings.profile.title': '个人资料',
  'app.settings.profile.subtitle': '管理你的身份信息、显示名称与界面语言。',
  'app.settings.profile.card.title': '身份',
  'app.settings.profile.i18n.title': '语言与地区',
  'app.settings.profile.nameRequired': '请填写姓名。',
  'app.settings.profile.nameTooLong': '姓名过长（姓、名各不超过 255 个字符）。',
  'app.settings.profile.updated': '资料已更新。',
  'app.settings.profile.avatarUnsupported': '头像更换暂未支持。',
  'app.settings.profile.name': '姓名',
  'app.settings.profile.username': '用户名',
  'app.settings.profile.usernameHint': '用于登录，不可更改',
  'app.settings.profile.save': '保存更改',
  'app.settings.profile.roleFallback': 'user',

  // --- 共用的外观行（个人资料：语言；主题：主题/自动锁定/剪贴板） ---
  'app.settings.appearance.language.label': '界面语言',
  'app.settings.appearance.language.hint': '切换整个界面的显示语言。',
  'app.settings.appearance.language.zh': '中文',
  'app.settings.appearance.language.en': 'English',
  'app.settings.appearance.theme.label': '主题',
  'app.settings.appearance.theme.hint': '选择浅色或深色外观。',
  'app.settings.appearance.theme.light': '浅色',
  'app.settings.appearance.theme.dark': '深色',
  'app.settings.appearance.idle.label': '自动锁定',
  'app.settings.appearance.idle.hint': '在无操作一段时间后自动锁定保险库。',
  'app.settings.appearance.idle.m5': '5 分钟',
  'app.settings.appearance.idle.m15': '15 分钟',
  'app.settings.appearance.idle.m30': '30 分钟',
  'app.settings.appearance.idle.h1': '1 小时',
  'app.settings.appearance.idle.never': '从不',
  'app.settings.appearance.burn.label': '剪贴板清除延迟',
  'app.settings.appearance.burn.hint': '复制密码后，经过这段时间尽力清除剪贴板。',
  'app.settings.appearance.burn.seconds': '{{count}} 秒',
  'app.settings.appearance.burn.never': '从不',

  // --- 主题 ---
  'app.settings.theme.title': '主题',
  'app.settings.theme.subtitle': '界面外观与本地安全行为。这些偏好仅保存在本设备。',
  'app.settings.theme.card.title': '外观',
  'app.settings.theme.local.title': '本设备',

  // --- 密钥检视 ---
  'app.settings.keys.title': '密钥检视',
  'app.settings.keys.subtitle': '本设备用于加解密保险库的 OpenPGP 密钥。',
  'app.settings.keys.algorithm': '算法',
  'app.settings.keys.userIds': '用户标识',
  'app.settings.keys.fingerprintUnavailable': '本设备上没有可用的密钥指纹。',
  'app.settings.keys.publicKey.title': '公钥',
  'app.settings.keys.publicKey.intro':
    '公钥可自由分发：他人用它为你加密数据、校验你的签名。其中不含任何秘密材料。',
  'app.settings.keys.publicKey.show': '显示公钥',
  'app.settings.keys.publicKey.hide': '隐藏公钥',
  'app.settings.keys.publicKey.copy': '复制公钥',
  'app.settings.keys.publicKey.download': '下载公钥',
  'app.settings.keys.publicKey.unavailable': '本设备上没有可用的公钥。',
  'app.settings.keys.privateKeyNote':
    '此处永不显示、永不导出你的私钥。私钥以口令保护的形式留在本浏览器，服务器不持有任何副本 —— 请用注册流程提供的恢复套件做好备份。',

  // --- 口令 ---
  'app.settings.passphrase.title': '口令',
  'app.settings.passphrase.subtitle': '更改本设备上保护私钥的口令。',
  'app.settings.passphrase.card.title': '更改口令',
  'app.settings.passphrase.warning':
    '此口令只保护「本设备」上的私钥 —— 服务器既不保存也无法重置。一旦遗忘，任何人都无法恢复你的数据。更改前请先备份恢复套件。',
  'app.settings.passphrase.current': '当前口令',
  'app.settings.passphrase.new': '新口令',
  'app.settings.passphrase.confirm': '确认新口令',
  'app.settings.passphrase.strength': '强度',
  'app.settings.passphrase.mismatch': '两次输入的口令不一致。',
  'app.settings.passphrase.submit': '更改口令',
  'app.settings.passphrase.saving': '正在重新加密密钥...',
  'app.settings.passphrase.changed': '口令已更改，请用新口令重新解锁。',
  'app.settings.passphrase.failed': '更改口令失败。',
  'app.settings.passphrase.relockNote':
    '密钥在本地重新加密，不会发送任何请求。操作完成后保险库会立即锁定，便于你确认新口令可用。',

  // --- 安全令牌 ---
  'app.settings.securityToken.title': '安全令牌',
  'app.settings.securityToken.subtitle': '每次 JPassbolt 向你索要口令时展示的个人标记。',
  'app.settings.securityToken.card.title': '防钓鱼标记',
  'app.settings.securityToken.intro':
    '选定三个字符和一种颜色。所有真实的口令输入框都会展示它们；仿冒页面无法做到 —— 令牌永不离开本设备，也永不发送至服务器。',
  'app.settings.securityToken.code': '令牌字符',
  'app.settings.securityToken.codeHint': '必须为 3 个字母或数字。',
  'app.settings.securityToken.color': '令牌颜色',
  'app.settings.securityToken.colorHint': '选一个你一眼就能认出的颜色。',
  'app.settings.securityToken.preview': '预览',
  'app.settings.securityToken.previewHint': '令牌在口令输入框旁的实际显示效果。',
  'app.settings.securityToken.invalidCode': '令牌必须恰好为 3 个字母或数字。',
  'app.settings.securityToken.saved': '安全令牌已保存。',
  'app.settings.securityToken.saveFailed': '保存安全令牌失败。',

  // --- 两步验证（个人 TOTP） ---
  'app.settings.security.title': '两步验证',
  'app.settings.security.subtitle':
    '为登录链路增加一层验证。MFA 校验在服务器完成，不影响端到端加密。',
  'app.settings.security.rateLimited': '尝试次数过多，请稍后再试。',
  'app.settings.security.orgDisabled':
    '两步验证尚未在组织层启用。请管理员先在「组织设置 › 组织两步验证」中开启「全组织 TOTP」，再回到此处设置。',
  'app.settings.security.card.title': '身份验证器 App (TOTP)',
  'app.settings.security.card.enabled': '已启用',
  'app.settings.security.card.notConfigured': '未配置',
  'app.settings.security.card.intro':
    '登录时使用身份验证器 App（Google Authenticator、Authy、1Password 等）生成的一次性验证码作为第二重身份验证。',
  'app.settings.security.card.checking': '正在检查 MFA 状态...',
  'app.settings.security.card.enabledOn': '已启用，绑定于 {{date}}。',
  'app.settings.security.card.enabledPlain': '已启用。',
  'app.settings.security.card.disableButton': '关闭两步验证',
  'app.settings.security.card.setupButton': '设置两步验证',
  'app.settings.security.card.preparing': '准备中...',
  'app.settings.security.setup.noProvisioningUri': '服务器未返回绑定地址（provisioning URI）。',
  'app.settings.security.setup.invalidCode': '请输入身份验证器 App 生成的 6 位验证码。',
  'app.settings.security.setup.enabled': '两步验证已启用。',
  'app.settings.security.setup.scanStep':
    '用 Google Authenticator、1Password 或 Authy 扫描二维码。',
  'app.settings.security.setup.manualKeyStep': '或手动输入密钥：',
  'app.settings.security.setup.uriStepBefore': '或粘贴完整的 ',
  'app.settings.security.setup.uriStepAfter': ' URI：',
  'app.settings.security.setup.codeStep': '输入 6 位验证码完成绑定。',
  'app.settings.security.setup.verifyEnable': '验证并启用',
  'app.settings.security.setup.verifying': '验证中...',
  'app.settings.security.disabled.done': '两步验证已关闭。',
  'app.settings.security.confirmDisable.title': '关闭两步验证？',
  'app.settings.security.confirmDisable.message':
    '关闭后登录将不再需要一次性验证码。你可以随时重新启用。',
  'app.settings.security.confirmDisable.confirmLabel': '关闭',
  'app.settings.security.qr.unavailable':
    '无法生成二维码 —— 请将下方密钥手动粘贴到你的身份验证器。',
  'app.settings.security.qr.ariaLabel': 'TOTP 绑定二维码',

  // --- OpenPGP 密钥卡（密钥检视复用） ---
  'app.settings.account.gpg.title': 'OpenPGP 密钥指纹',
  'app.settings.account.gpg.intro':
    '此 OpenPGP 密钥在本地完成全部加解密。可向他人公开指纹以核验身份；私钥与 passphrase 永不离开本设备、服务器永不可见。',
  'app.settings.account.gpg.copyFingerprint': '复制指纹',
  'app.settings.account.gpg.keyId': 'Key ID',
  'app.settings.account.gpg.keyBits': '密钥长度',
  'app.settings.account.gpg.bitsValue': '{{bits}} 位',

  // --- 组织：服务器信息 + 组织 MFA ---
  'app.settings.server.subtitle': '由 JPassbolt 服务器返回的只读配置。',
  'app.settings.account.server.title': '服务器信息',
  'app.settings.account.server.readonly': '由 JPassbolt API 返回的只读信息。',
  'app.settings.account.server.loading': '正在加载服务器信息...',
  'app.settings.account.server.empty': '服务器未返回任何配置信息。',
  'app.settings.orgMfa.subtitle': '本组织的用户可以启用哪些第二因素验证方式。',
  'app.settings.account.orgMfa.title': '组织两步验证（管理员）',
  'app.settings.account.orgMfa.totpOn': 'TOTP 已开启',
  'app.settings.account.orgMfa.totpOff': 'TOTP 已关闭',
  'app.settings.account.orgMfa.wholeOrgTotp': '全组织 TOTP',
  'app.settings.account.orgMfa.hintOn': '本组织内所有用户均可启用 TOTP。',
  'app.settings.account.orgMfa.hintOff': '当前已在全组织范围内关闭 TOTP。',
  'app.settings.account.orgMfa.toggleAria': '切换全组织 TOTP',
  'app.settings.account.orgMfa.loading': '正在加载组织 MFA...',
  'app.settings.account.orgMfa.enabledToast': '已开启全组织 TOTP。',
  'app.settings.account.orgMfa.disabledToast': '已关闭全组织 TOTP。',
};

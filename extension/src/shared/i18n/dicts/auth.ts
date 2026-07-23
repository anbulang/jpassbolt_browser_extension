/**
 * auth domain dictionary — WP-AUTH-SETUP. Flattened from the SPA's
 * locales/<lng>/auth.json (`app.auth.*`) plus the `mfa` section of
 * components.json (`app.components.mfa.*`, consumed by MfaChallenge which is
 * mounted from the shared Flow for popup AND app). The `app.auth.bg.*` keys are
 * background-only strings for the MFA/setup handlers (no SPA source: the SPA
 * kept MFA state in the page, the extension keeps it in the worker).
 *
 * Dropped from the SPA source on purpose: the `login.*` section (the extension
 * Flow/UnlockForm replaces the SPA login page) and `extPrompt.*` (we ARE the
 * extension).
 */
import type { Dict } from '../types';

export const en: Dict = {
  'app.auth.brand': 'JPassbolt',

  // Shown under the .asc key-backup textareas (setup import / recovery verify),
  // which now display the armored key in plain text.
  'app.auth.plaintextBackupNote':
    'The key is shown in plain text — mind your surroundings.',

  // ---- security token picker (setup passphrase step / recovery verify step) -
  'app.auth.securityToken.label': 'Your security token',
  'app.auth.securityToken.hint':
    'Pick three characters and a colour you will recognise instantly. From now on JPassbolt shows this mark every time it asks for your passphrase — a fake page cannot know it.',
  'app.auth.securityToken.codeAria': 'Security token characters',
  'app.auth.securityToken.colorAria': 'Security token colour',
  'app.auth.securityToken.invalid': 'The token must be exactly 3 letters or digits.',
  'app.auth.securityToken.saveFailed':
    'Your security token could not be saved on this device — everything else is set up. You can choose it again in Settings → Security token.',

  // ---- existing-account replace gate (setup / recovery complete mode) -------
  'app.auth.gate.loading': 'Checking this device…',
  'app.auth.gate.title': 'This device is already linked to an account',
  'app.auth.gate.subtitle':
    'Finishing this setup or recovery link will bind this browser to a different account.',
  'app.auth.gate.boundIdentity': 'Linked account',
  'app.auth.gate.unknownAccount': 'Unknown account',
  'app.auth.gate.usernameLabel': 'Username',
  'app.auth.gate.serverLabel': 'Server',
  'app.auth.gate.fingerprintLabel': 'Key fingerprint',
  'app.auth.gate.warning':
    'Continuing REPLACES this account and deletes its private key from this device. Without a backup, that account’s data can never be decrypted again — the server does not store private keys.',
  'app.auth.gate.kitTitle': 'Back up this device’s private key first',
  'app.auth.gate.kitDesc':
    'Exports the private key already stored on THIS device for the account above — nothing is downloaded from the server. Save it before this recovery overwrites it.',
  'app.auth.gate.kitSaved': 'Backup downloaded — keep it somewhere safe and offline',
  'app.auth.gate.download': 'Download',
  'app.auth.gate.downloading': 'Exporting…',
  'app.auth.gate.exportFailed': 'Could not export the key backup. Please try again.',
  'app.auth.gate.ack':
    'I understand the risk and have backed up the private key of the account shown above.',
  'app.auth.gate.continue': 'I understand the risk — continue',
  'app.auth.gate.back': 'Back',

  // ---- setup flow ----------------------------------------------------------
  'app.auth.setup.steps.invite': 'Invite',
  'app.auth.setup.steps.key': 'Key',
  'app.auth.setup.steps.passphrase': 'Passphrase',
  'app.auth.setup.steps.done': 'Done',
  'app.auth.setup.newMemberFallback': 'New member',
  'app.auth.setup.invite.title': "You've been invited to JPassbolt",
  'app.auth.setup.invite.subtitle':
    'Once you accept, your end-to-end encryption key pair will be generated on this device. The private key never leaves this browser.',
  'app.auth.setup.invite.nameLabel': 'Name',
  'app.auth.setup.invite.usernameLabel': 'Username',
  'app.auth.setup.invite.roleLabel': 'Role',
  'app.auth.setup.invite.serverLabel': 'Server',
  'app.auth.setup.invite.validating': 'Verifying invitation…',
  'app.auth.setup.invite.accept': 'Accept invitation and start',
  'app.auth.setup.invite.note': 'After you accept, your key pair will be generated on this device',
  'app.auth.setup.key.title': 'Create your encryption identity',
  'app.auth.setup.key.subtitle':
    'Your private key only ever exists on this device; the server stores only the public key.',
  'app.auth.setup.key.genTitle': 'Generate a new key pair',
  'app.auth.setup.key.genBadge': 'Recommended',
  'app.auth.setup.key.genDesc':
    'Create a brand-new OpenPGP key (RSA-3072) on this device in just a few seconds.',
  'app.auth.setup.key.importTitle': 'Import an existing key',
  'app.auth.setup.key.importDesc':
    'Already have a passphrase-protected OpenPGP private key? Paste the .asc contents to keep using it.',
  'app.auth.setup.key.pasteLabel': 'Paste or choose your .asc private key',
  'app.auth.setup.key.keyPlaceholder': '-----BEGIN PGP PRIVATE KEY BLOCK-----',
  'app.auth.setup.key.chooseFile': 'Choose .asc file',
  'app.auth.setup.key.prev': 'Back',
  'app.auth.setup.key.next': 'Next',
  'app.auth.setup.passphrase.title': 'Set a passphrase',
  'app.auth.setup.passphrase.subtitle':
    'Used to unlock your private key on this device. It never leaves the device and cannot be recovered.',
  'app.auth.setup.passphrase.label': 'Passphrase',
  'app.auth.setup.passphrase.strength': 'Strength',
  'app.auth.setup.passphrase.confirmLabel': 'Re-enter',
  'app.auth.setup.passphrase.mismatch': "The two entries don't match",
  'app.auth.setup.passphrase.reqLength': 'At least 8 characters',
  'app.auth.setup.passphrase.reqMixed': 'Mix of upper- and lowercase letters and digits',
  'app.auth.setup.passphrase.reqSymbol': 'A symbol makes it stronger',
  'app.auth.setup.passphrase.warning':
    'JPassbolt cannot reset your passphrase. Be sure to remember it, or save the recovery kit in the next step.',
  'app.auth.setup.passphrase.prev': 'Back',
  'app.auth.setup.passphrase.processing': 'Processing…',
  'app.auth.setup.passphrase.generateKey': 'Generate key',
  'app.auth.setup.passphrase.next': 'Next',
  'app.auth.setup.passphrase.pwnedWarning':
    'This passphrase appeared in {{count}} known data breaches — consider choosing another. You can still continue.',
  'app.auth.setup.done.title': 'Your identity is ready',
  'app.auth.setup.done.subtitle':
    'Your key has been generated and encrypted locally. Click to enter the vault and activate your account.',
  'app.auth.setup.done.fingerprintLabel': 'Your public key fingerprint',
  'app.auth.setup.done.kitTitle': 'Download recovery kit',
  'app.auth.setup.done.kitDesc':
    'Use it to regain access if you lose your device · keep it offline',
  'app.auth.setup.done.kitDownload': 'Download',
  'app.auth.setup.done.activating': 'Activating…',
  'app.auth.setup.done.enterVault': 'Enter vault',
  'app.auth.setup.done.note': 'Your private key and passphrase never left this device',
  'app.auth.setup.done.activated':
    'Your account is active and this device is signed in — open your vault to continue',
  'app.auth.setup.errors.missingLink':
    'Invalid link: missing user_id or token. Please use the complete invitation link from your email.',
  'app.auth.setup.errors.inviteInvalid':
    'The invitation link is invalid or has expired. Please ask your administrator to re-invite you.',
  'app.auth.setup.errors.genFailed': 'Key generation failed. Please try again.',
  'app.auth.setup.errors.missingKey': 'Please paste your OpenPGP private key (.asc) first.',
  'app.auth.setup.errors.activateFailed':
    'Activation failed. Please try again or contact your administrator.',
  'app.auth.setup.errors.noServer':
    'No server is configured in the extension. Open the invitation link on your JPassbolt server, or set the server URL in the extension options first.',

  // ---- recovery flow --------------------------------------------------------
  'app.auth.recovery.brand': 'Account recovery',
  'app.auth.recovery.backToLogin': 'Back to sign in',
  'app.auth.recovery.steps.account': 'Account',
  'app.auth.recovery.steps.verify': 'Verify',
  'app.auth.recovery.steps.reset': 'Reset',
  'app.auth.recovery.steps.done': 'Done',
  'app.auth.recovery.accountFallback': 'your account',
  'app.auth.recovery.request.title': 'Recover your account',
  'app.auth.recovery.request.subtitle':
    'Lost your device or forgot how to sign in? Verify your identity, then regain vault access using your saved key backup.',
  'app.auth.recovery.request.linkLabel': 'Recovery link',
  'app.auth.recovery.request.linkPending': 'Pending verification',
  'app.auth.recovery.request.validating': 'Verifying recovery link…',
  'app.auth.recovery.request.validateAndContinue': 'Verify link and continue',
  'app.auth.recovery.request.noteNoExpose':
    'Recovery never exposes your private key or passphrase',
  'app.auth.recovery.request.sentTitle': 'Check your email',
  'app.auth.recovery.request.sentDesc':
    "If that email matches an account, we've sent a message with a recovery link.",
  'app.auth.recovery.request.sentHint':
    'Open the recovery link from the email to continue (the link contains a one-time recovery token).',
  'app.auth.recovery.request.emailLabel': 'Account email',
  'app.auth.recovery.request.emailPlaceholder': 'you@acme.io',
  'app.auth.recovery.request.sending': 'Sending…',
  'app.auth.recovery.request.continue': 'Continue',
  'app.auth.recovery.request.noteNoExposeOld':
    'Recovery never exposes your old private key or passphrase',
  'app.auth.recovery.verify.title': 'Verify your identity',
  'app.auth.recovery.verify.subtitlePrefix':
    'Import the key backup you previously exported and enter its passphrase. The server will confirm the key belongs to',
  'app.auth.recovery.verify.subtitleAccountFallback': 'your account',
  'app.auth.recovery.verify.subtitleSuffix': '.',
  'app.auth.recovery.verify.methodBackupTitle': 'Import key backup',
  'app.auth.recovery.verify.methodBackupBadge': 'Supported',
  'app.auth.recovery.verify.methodBackupDesc':
    'Upload the passphrase-protected private key backup (.asc) you exported earlier.',
  'app.auth.recovery.verify.methodCodeTitle': 'Recovery code',
  'app.auth.recovery.verify.methodCodeDesc':
    'Use the one-time recovery code saved at registration (not supported in this version).',
  'app.auth.recovery.verify.methodAdminTitle': 'Administrator assistance',
  'app.auth.recovery.verify.methodAdminDesc':
    'Have an organization administrator approve rebuilding your access (not supported in this version).',
  'app.auth.recovery.verify.unsupportedBadge': 'Not supported',
  'app.auth.recovery.verify.unsupportedTitle': 'Not supported',
  'app.auth.recovery.verify.pasteLabel': 'Paste or choose your .asc key backup',
  'app.auth.recovery.verify.chooseBackup': 'Choose .asc backup',
  'app.auth.recovery.verify.keyPlaceholder': '-----BEGIN PGP PRIVATE KEY BLOCK-----',
  'app.auth.recovery.verify.passphraseLabel': 'Passphrase for this backup',
  'app.auth.recovery.verify.backToLogin': 'Back to sign in',
  'app.auth.recovery.verify.verifyingKey': 'Verifying key…',
  'app.auth.recovery.verify.next': 'Next',
  'app.auth.recovery.reset.title': 'Confirm and restore access',
  'app.auth.recovery.reset.subtitle':
    'Your key backup has been imported into the extension. After you submit, the server will verify the fingerprint matches and restore your access.',
  'app.auth.recovery.reset.fingerprintLabel': 'Public key fingerprint to verify',
  'app.auth.recovery.reset.accountLabel': 'Account',
  'app.auth.recovery.reset.usernameLabel': 'Username',
  'app.auth.recovery.reset.warning':
    'The server only accepts a key whose fingerprint matches the existing key on file for this account; otherwise it is rejected.',
  'app.auth.recovery.reset.prev': 'Back',
  'app.auth.recovery.reset.recovering': 'Recovering…',
  'app.auth.recovery.reset.recover': 'Recover account',
  'app.auth.recovery.done.title': 'Account recovered',
  'app.auth.recovery.done.subtitle':
    "Your key has been re-verified and you've regained access to your vault.",
  'app.auth.recovery.done.identityLabel': 'Identity verification',
  'app.auth.recovery.done.identityValue': 'Passed',
  'app.auth.recovery.done.fingerprintLabel': 'Key fingerprint',
  'app.auth.recovery.done.fingerprintValue': 'Matched',
  'app.auth.recovery.done.vaultLabel': 'Vault',
  'app.auth.recovery.done.vaultValue': 'Unlocked',
  'app.auth.recovery.done.mfaPending': 'Two-step verification pending',
  'app.auth.recovery.done.enterVault': 'Enter vault',
  'app.auth.recovery.done.note': 'Your private key and passphrase never left this device',
  'app.auth.recovery.errors.sendFailed':
    'Could not send the recovery email. Please try again later or contact your administrator.',
  'app.auth.recovery.errors.linkInvalid':
    'The recovery link is invalid or has expired. Please start account recovery again.',
  'app.auth.recovery.errors.missingBackup':
    'Please paste the OpenPGP private key backup (.asc) you exported earlier.',
  'app.auth.recovery.errors.recoverFailed':
    'Account recovery failed. Please confirm the key belongs to this account and try again.',

  // ---- keygen animation ------------------------------------------------------
  'app.auth.keygen.strengthLabels.weak': 'Very weak',
  'app.auth.keygen.strengthLabels.fair': 'Weak',
  'app.auth.keygen.strengthLabels.good': 'Good',
  'app.auth.keygen.strengthLabels.strong': 'Strong',
  'app.auth.keygen.logs.entropy': 'Gathering entropy…',
  'app.auth.keygen.logs.generating': 'Generating RSA key pair…',
  'app.auth.keygen.logs.deriving': 'Deriving public key fingerprint…',
  'app.auth.keygen.logs.encrypting': 'Encrypting private key with passphrase…',
  'app.auth.keygen.logs.done': 'Done',

  // ---- login-time MFA challenge (SPA components.json `mfa` section) ----------
  'app.components.mfa.title': 'Two-step verification',
  'app.components.mfa.verified': 'Verified',
  'app.components.mfa.entering': 'Entering your vault…',
  'app.components.mfa.prompt': 'Enter the 6-digit code from your authenticator',
  'app.components.mfa.verifyingChallenge': 'Verifying challenge response…',
  'app.components.mfa.openAuthenticator':
    'Open your authenticator app to get the one-time code',
  'app.components.mfa.backToLogin': 'Back to login',
  'app.components.mfa.errors.tooManyAttempts': 'Too many attempts. Please try again later.',
  'app.components.mfa.errors.invalidCode': 'Invalid code. Please try again.',

  // ---- background-only (worker-held MFA/setup state) -------------------------
  'app.auth.bg.mfaNoPending':
    'No two-step verification is pending. Please unlock again.',
  'app.auth.bg.mfaSessionRejected':
    'The server rejected the session after verification. Please unlock again.',
};

export const zh: Dict = {
  'app.auth.brand': 'JPassbolt',

  // 显示在 .asc 密钥备份文本框下方(设置导入 / 恢复验证),这两处现以明文显示 armored 密钥。
  'app.auth.plaintextBackupNote': '内容将以明文显示,请注意周围环境。',

  // ---- security token picker (setup passphrase step / recovery verify step) -
  'app.auth.securityToken.label': '你的安全令牌',
  'app.auth.securityToken.hint':
    '挑三个字符和一个你一眼就能认出的颜色。此后 JPassbolt 每次向你索要口令时都会展示这个标记 —— 仿冒页面无从得知它。',
  'app.auth.securityToken.codeAria': '安全令牌字符',
  'app.auth.securityToken.colorAria': '安全令牌颜色',
  'app.auth.securityToken.invalid': '令牌必须恰好为 3 个字母或数字。',
  'app.auth.securityToken.saveFailed':
    '安全令牌未能保存到此设备 —— 其余设置均已完成。你可以稍后在「设置 → 安全令牌」中重新选择。',

  // ---- existing-account replace gate (setup / recovery complete mode) -------
  'app.auth.gate.loading': '正在检查此设备…',
  'app.auth.gate.title': '此设备已绑定另一个账号',
  'app.auth.gate.subtitle': '完成这个设置或恢复链接，会把本浏览器改绑到另一个账号。',
  'app.auth.gate.boundIdentity': '当前绑定身份',
  'app.auth.gate.unknownAccount': '未知账号',
  'app.auth.gate.usernameLabel': '用户名',
  'app.auth.gate.serverLabel': '服务器',
  'app.auth.gate.fingerprintLabel': '密钥指纹',
  'app.auth.gate.warning':
    '继续将替换此账号并删除其本机私钥；若无备份，该账号数据将永久无法解密（服务器不保存私钥）。',
  'app.auth.gate.kitTitle': '先备份本设备的私钥',
  'app.auth.gate.kitDesc':
    '导出的是本设备上已保存的上述账号私钥 —— 不会从服务器下载任何东西。请在本次恢复覆盖它之前先保存。',
  'app.auth.gate.kitSaved': '备份已下载 — 请离线妥善保存',
  'app.auth.gate.download': '下载备份',
  'app.auth.gate.downloading': '正在导出…',
  'app.auth.gate.exportFailed': '导出密钥备份失败，请重试。',
  'app.auth.gate.ack': '我已了解风险，并已备份上述账号的私钥。',
  'app.auth.gate.continue': '我已了解风险，继续',
  'app.auth.gate.back': '返回',

  // ---- setup flow ----------------------------------------------------------
  'app.auth.setup.steps.invite': '邀请',
  'app.auth.setup.steps.key': '密钥',
  'app.auth.setup.steps.passphrase': '口令',
  'app.auth.setup.steps.done': '完成',
  'app.auth.setup.newMemberFallback': '新成员',
  'app.auth.setup.invite.title': '你被邀请加入 JPassbolt',
  'app.auth.setup.invite.subtitle':
    '接受邀请后，将在本设备生成你的端到端加密密钥对。私钥永不离开此浏览器。',
  'app.auth.setup.invite.nameLabel': '姓名',
  'app.auth.setup.invite.usernameLabel': '用户名',
  'app.auth.setup.invite.roleLabel': '角色',
  'app.auth.setup.invite.serverLabel': '服务器',
  'app.auth.setup.invite.validating': '正在校验邀请…',
  'app.auth.setup.invite.accept': '接受邀请并开始',
  'app.auth.setup.invite.note': '接受后将在本设备生成你的密钥对',
  'app.auth.setup.key.title': '创建你的加密身份',
  'app.auth.setup.key.subtitle': '你的私钥永远只存在于本设备，服务器只保存公钥。',
  'app.auth.setup.key.genTitle': '生成新密钥对',
  'app.auth.setup.key.genBadge': '推荐',
  'app.auth.setup.key.genDesc': '在本设备创建全新的 OpenPGP 密钥（RSA-3072），几秒即可完成。',
  'app.auth.setup.key.importTitle': '导入已有密钥',
  'app.auth.setup.key.importDesc':
    '已有受 passphrase 保护的 OpenPGP 私钥？粘贴 .asc 内容继续使用。',
  'app.auth.setup.key.pasteLabel': '粘贴或选择 .asc 私钥',
  'app.auth.setup.key.keyPlaceholder': '-----BEGIN PGP PRIVATE KEY BLOCK-----',
  'app.auth.setup.key.chooseFile': '选择 .asc 文件',
  'app.auth.setup.key.prev': '上一步',
  'app.auth.setup.key.next': '下一步',
  'app.auth.setup.passphrase.title': '设置 passphrase',
  'app.auth.setup.passphrase.subtitle':
    '用于在本设备解锁私钥。它本身永不离开设备，也无法被找回。',
  'app.auth.setup.passphrase.label': 'passphrase',
  'app.auth.setup.passphrase.strength': '强度',
  'app.auth.setup.passphrase.confirmLabel': '再次输入',
  'app.auth.setup.passphrase.mismatch': '两次输入不一致',
  'app.auth.setup.passphrase.reqLength': '至少 8 个字符',
  'app.auth.setup.passphrase.reqMixed': '含大小写字母与数字',
  'app.auth.setup.passphrase.reqSymbol': '含符号更佳',
  'app.auth.setup.passphrase.warning':
    'JPassbolt 无法重置 passphrase。请务必牢记，或在下一步保存恢复套件。',
  'app.auth.setup.passphrase.prev': '上一步',
  'app.auth.setup.passphrase.processing': '处理中…',
  'app.auth.setup.passphrase.generateKey': '生成密钥',
  'app.auth.setup.passphrase.next': '下一步',
  'app.auth.setup.passphrase.pwnedWarning':
    '此口令曾在 {{count}} 次已知数据泄露中出现，建议更换。你仍可继续。',
  'app.auth.setup.done.title': '身份已就绪',
  'app.auth.setup.done.subtitle':
    '你的密钥已生成并在本地加密。点击进入保险库以激活账户。',
  'app.auth.setup.done.fingerprintLabel': '你的公钥指纹',
  'app.auth.setup.done.kitTitle': '下载恢复套件',
  'app.auth.setup.done.kitDesc': '丢失设备时用于找回访问权 · 请离线保存',
  'app.auth.setup.done.kitDownload': '下载',
  'app.auth.setup.done.activating': '正在激活…',
  'app.auth.setup.done.enterVault': '进入保险库',
  'app.auth.setup.done.note': '私钥与 passphrase 从未离开此设备',
  'app.auth.setup.done.activated': '账户已激活，本设备已登录 — 点击进入你的保险库',
  'app.auth.setup.errors.missingLink':
    '链接无效：缺少 user_id 或 token。请使用邮件中的完整邀请链接。',
  'app.auth.setup.errors.inviteInvalid': '邀请链接无效或已过期，请联系管理员重新邀请。',
  'app.auth.setup.errors.genFailed': '密钥生成失败，请重试。',
  'app.auth.setup.errors.missingKey': '请先粘贴你的 OpenPGP 私钥（.asc）。',
  'app.auth.setup.errors.activateFailed': '激活失败，请重试或联系管理员。',
  'app.auth.setup.errors.noServer':
    '扩展尚未配置服务器。请在 JPassbolt 服务器页面打开邀请链接，或先在扩展选项中填写服务器地址。',

  // ---- recovery flow --------------------------------------------------------
  'app.auth.recovery.brand': '账户恢复',
  'app.auth.recovery.backToLogin': '返回登录',
  'app.auth.recovery.steps.account': '账户',
  'app.auth.recovery.steps.verify': '验证',
  'app.auth.recovery.steps.reset': '重设',
  'app.auth.recovery.steps.done': '完成',
  'app.auth.recovery.accountFallback': '账户',
  'app.auth.recovery.request.title': '找回你的账户',
  'app.auth.recovery.request.subtitle':
    '丢失了设备或忘记如何登录？验证身份后，用你保存的密钥备份重新获得保险库访问权。',
  'app.auth.recovery.request.linkLabel': '恢复链接',
  'app.auth.recovery.request.linkPending': '待校验',
  'app.auth.recovery.request.validating': '正在校验恢复链接…',
  'app.auth.recovery.request.validateAndContinue': '校验链接并继续',
  'app.auth.recovery.request.noteNoExpose': '恢复不会暴露你的私钥或 passphrase',
  'app.auth.recovery.request.sentTitle': '请查收邮件',
  'app.auth.recovery.request.sentDesc':
    '若该邮箱对应一个账户，我们已发送一封含恢复链接的邮件。',
  'app.auth.recovery.request.sentHint':
    '请从邮件中打开恢复链接以继续（链接含一次性恢复令牌）。',
  'app.auth.recovery.request.emailLabel': '账户邮箱',
  'app.auth.recovery.request.emailPlaceholder': 'you@acme.io',
  'app.auth.recovery.request.sending': '正在发送…',
  'app.auth.recovery.request.continue': '继续',
  'app.auth.recovery.request.noteNoExposeOld': '恢复不会暴露你旧的私钥或 passphrase',
  'app.auth.recovery.verify.title': '验证身份',
  'app.auth.recovery.verify.subtitlePrefix':
    '导入你之前导出的密钥备份并输入其 passphrase。服务器将校验该密钥确属',
  'app.auth.recovery.verify.subtitleAccountFallback': '你的账户',
  'app.auth.recovery.verify.subtitleSuffix': '。',
  'app.auth.recovery.verify.methodBackupTitle': '导入密钥备份',
  'app.auth.recovery.verify.methodBackupBadge': '支持',
  'app.auth.recovery.verify.methodBackupDesc':
    '上传你之前导出的受 passphrase 保护的私钥备份（.asc）。',
  'app.auth.recovery.verify.methodCodeTitle': '恢复码',
  'app.auth.recovery.verify.methodCodeDesc':
    '使用注册时保存的一次性恢复码（当前版本暂未支持）。',
  'app.auth.recovery.verify.methodAdminTitle': '管理员协助',
  'app.auth.recovery.verify.methodAdminDesc':
    '由组织管理员审批为你重建访问权（当前版本暂未支持）。',
  'app.auth.recovery.verify.unsupportedBadge': '暂未支持',
  'app.auth.recovery.verify.unsupportedTitle': '暂未支持',
  'app.auth.recovery.verify.pasteLabel': '粘贴或选择 .asc 私钥备份',
  'app.auth.recovery.verify.chooseBackup': '选择 .asc 备份',
  'app.auth.recovery.verify.keyPlaceholder': '-----BEGIN PGP PRIVATE KEY BLOCK-----',
  'app.auth.recovery.verify.passphraseLabel': '该备份的 passphrase',
  'app.auth.recovery.verify.backToLogin': '返回登录',
  'app.auth.recovery.verify.verifyingKey': '校验密钥…',
  'app.auth.recovery.verify.next': '下一步',
  'app.auth.recovery.reset.title': '确认并恢复访问权',
  'app.auth.recovery.reset.subtitle':
    '你的密钥备份已导入扩展。提交后服务器将校验指纹一致并恢复你的访问权。',
  'app.auth.recovery.reset.fingerprintLabel': '待校验的公钥指纹',
  'app.auth.recovery.reset.accountLabel': '账户',
  'app.auth.recovery.reset.usernameLabel': '用户名',
  'app.auth.recovery.reset.warning':
    '服务器仅接受与此账户既有密钥指纹一致的密钥；若不一致将被拒绝。',
  'app.auth.recovery.reset.prev': '上一步',
  'app.auth.recovery.reset.recovering': '正在恢复…',
  'app.auth.recovery.reset.recover': '恢复账户',
  'app.auth.recovery.done.title': '账户已恢复',
  'app.auth.recovery.done.subtitle': '你的密钥已重新验证，你重新获得了对保险库的访问权。',
  'app.auth.recovery.done.identityLabel': '身份验证',
  'app.auth.recovery.done.identityValue': '已通过',
  'app.auth.recovery.done.fingerprintLabel': '密钥指纹',
  'app.auth.recovery.done.fingerprintValue': '已匹配',
  'app.auth.recovery.done.vaultLabel': '保险库',
  'app.auth.recovery.done.vaultValue': '已解锁',
  'app.auth.recovery.done.mfaPending': '待两步验证',
  'app.auth.recovery.done.enterVault': '进入保险库',
  'app.auth.recovery.done.note': '私钥与 passphrase 从未离开此设备',
  'app.auth.recovery.errors.sendFailed': '无法发送恢复邮件，请稍后重试或联系管理员。',
  'app.auth.recovery.errors.linkInvalid': '恢复链接无效或已过期，请重新发起账户恢复。',
  'app.auth.recovery.errors.missingBackup':
    '请先粘贴你之前导出的 OpenPGP 私钥备份（.asc）。',
  'app.auth.recovery.errors.recoverFailed': '账户恢复失败，请检查私钥是否属于此账户后重试。',

  // ---- keygen animation ------------------------------------------------------
  'app.auth.keygen.strengthLabels.weak': '很弱',
  'app.auth.keygen.strengthLabels.fair': '偏弱',
  'app.auth.keygen.strengthLabels.good': '不错',
  'app.auth.keygen.strengthLabels.strong': '很强',
  'app.auth.keygen.logs.entropy': '采集熵源…',
  'app.auth.keygen.logs.generating': '生成 RSA 密钥对…',
  'app.auth.keygen.logs.deriving': '派生公钥指纹…',
  'app.auth.keygen.logs.encrypting': '用 passphrase 加密私钥…',
  'app.auth.keygen.logs.done': '完成',

  // ---- login-time MFA challenge ----------------------------------------------
  'app.components.mfa.title': '两步验证',
  'app.components.mfa.verified': '验证通过',
  'app.components.mfa.entering': '正在进入保险库…',
  'app.components.mfa.prompt': '输入身份验证器上的 6 位验证码',
  'app.components.mfa.verifyingChallenge': '校验挑战响应…',
  'app.components.mfa.openAuthenticator': '打开身份验证器 App 获取动态验证码',
  'app.components.mfa.backToLogin': '返回登录',
  'app.components.mfa.errors.tooManyAttempts': '尝试过于频繁，请稍后再试',
  'app.components.mfa.errors.invalidCode': '验证码错误，请重试',

  // ---- background-only --------------------------------------------------------
  'app.auth.bg.mfaNoPending': '当前没有待完成的两步验证，请重新解锁。',
  'app.auth.bg.mfaSessionRejected': '验证后服务器拒绝了该会话，请重新解锁。',
};

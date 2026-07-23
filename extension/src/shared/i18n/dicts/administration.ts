/**
 * administration domain dictionary (WP-SETTINGS-ADMIN).
 *
 * Sources, flattened per the migration convention:
 *   - SPA locales/<lng>/administration.json  -> app.administration.<key>
 *   - SPA locales/<lng>/settings.json orgPolicies.* -> app.administration.orgPolicies.*
 *     (agreed split: WP-SETTINGS-CORE owns the rest of the settings ns; the
 *     OrgPolicies strings live under the administration prefix instead).
 *     The section shell's own title/subtitle are gone: each card is now a
 *     standalone section of the settings page and supplies its own heading.
 *   - orgPolicies.password.bool.* replaces the SPA's cross-ns settings
 *     `metadata.bool.*` lookup so this domain stays self-contained.
 */
import type { Dict } from '../types';

export const en: Dict = {
  // --- Email notifications + password policy (each is its own settings section) ---
  'app.administration.orgPolicies.emails.title': 'Email notifications',
  'app.administration.orgPolicies.emails.subtitle':
    'Control which transactional emails the server sends and how much content they include. Changes are saved instantly.',
  'app.administration.orgPolicies.emails.loading': 'Loading email notification settings…',
  'app.administration.orgPolicies.emails.saved': 'Email notification settings saved.',
  'app.administration.orgPolicies.emails.saveFailed': 'Failed to save email notification settings.',
  'app.administration.orgPolicies.emails.groups.content': 'Email content',
  'app.administration.orgPolicies.emails.groups.password': 'Password events',
  'app.administration.orgPolicies.emails.groups.comment': 'Comment events',
  'app.administration.orgPolicies.emails.groups.folder': 'Folder events',
  'app.administration.orgPolicies.emails.groups.group': 'Group events',
  'app.administration.orgPolicies.emails.groups.user': 'User & admin events',
  'app.administration.orgPolicies.emails.toggles.show_comment': 'Include comment content in emails',
  'app.administration.orgPolicies.emails.toggles.show_description': 'Include the description in emails',
  'app.administration.orgPolicies.emails.toggles.show_secret': 'Include the secret in emails',
  'app.administration.orgPolicies.emails.toggles.show_uri': 'Include the URI in emails',
  'app.administration.orgPolicies.emails.toggles.show_username': 'Include the username in emails',
  'app.administration.orgPolicies.emails.toggles.send_password_create': 'Notify when a password is created',
  'app.administration.orgPolicies.emails.toggles.send_password_update': 'Notify when a password is updated',
  'app.administration.orgPolicies.emails.toggles.send_password_delete': 'Notify when a password is deleted',
  'app.administration.orgPolicies.emails.toggles.send_password_share': 'Notify when a password is shared',
  'app.administration.orgPolicies.emails.toggles.send_comment_add': 'Notify when a comment is added',
  'app.administration.orgPolicies.emails.toggles.send_comment_update': 'Notify when a comment is updated',
  'app.administration.orgPolicies.emails.toggles.send_comment_delete': 'Notify when a comment is deleted',
  'app.administration.orgPolicies.emails.toggles.send_folder_create': 'Notify when a folder is created',
  'app.administration.orgPolicies.emails.toggles.send_folder_update': 'Notify when a folder is updated',
  'app.administration.orgPolicies.emails.toggles.send_folder_delete': 'Notify when a folder is deleted',
  'app.administration.orgPolicies.emails.toggles.send_folder_share': 'Notify when a folder is shared',
  'app.administration.orgPolicies.emails.toggles.send_group_delete': 'Notify when a group is deleted',
  'app.administration.orgPolicies.emails.toggles.send_group_user_add': 'Notify when a member is added to a group',
  'app.administration.orgPolicies.emails.toggles.send_group_user_delete': 'Notify when a member is removed from a group',
  'app.administration.orgPolicies.emails.toggles.send_group_user_update': 'Notify when a group member changes',
  'app.administration.orgPolicies.emails.toggles.send_group_manager_update': 'Notify when a group manager changes',
  'app.administration.orgPolicies.emails.toggles.send_user_create': 'Notify when a user is created',
  'app.administration.orgPolicies.emails.toggles.send_user_recover': 'Notify when a user starts account recovery',
  'app.administration.orgPolicies.emails.toggles.send_admin_user_setup_completed': 'Notify admins when a user completes setup',
  'app.administration.orgPolicies.emails.toggles.send_admin_user_recover_complete': 'Notify admins when a user completes recovery',

  'app.administration.orgPolicies.password.title': 'Password policy',
  'app.administration.orgPolicies.password.subtitle':
    'Organization-wide password and passphrase generation policy. Read-only in the community edition.',
  'app.administration.orgPolicies.password.readonly': 'Read-only policy returned by the JPassbolt API.',
  'app.administration.orgPolicies.password.loading': 'Loading password policy…',
  'app.administration.orgPolicies.password.loadFailed': 'Failed to load password policy.',
  'app.administration.orgPolicies.password.defaultGenerator': 'Default generator',
  'app.administration.orgPolicies.password.generator.password': 'Random password',
  'app.administration.orgPolicies.password.generator.passphrase': 'Passphrase',
  'app.administration.orgPolicies.password.passwordLength': 'Password length',
  'app.administration.orgPolicies.password.lengthValue': '{{count}} characters',
  'app.administration.orgPolicies.password.passphraseWords': 'Passphrase words',
  'app.administration.orgPolicies.password.wordsValue': '{{count}} words',
  'app.administration.orgPolicies.password.dictionaryCheck': 'External dictionary / breach check',
  'app.administration.orgPolicies.password.source': 'Policy source',
  'app.administration.orgPolicies.password.bool.yes': 'Yes',
  'app.administration.orgPolicies.password.bool.no': 'No',

  // --- SMTP ---
  'app.administration.smtp.title': 'Email server (SMTP)',
  'app.administration.smtp.subtitle':
    'Configure the outgoing mail server used to send invitations, recovery links and notifications.',
  'app.administration.smtp.loading': 'Loading SMTP settings…',
  'app.administration.smtp.source.db': 'Saved in database',
  'app.administration.smtp.source.env': 'From environment',
  'app.administration.smtp.source.undefined': 'Not configured',
  'app.administration.smtp.envNote':
    'These values come from the server environment. Saving here stores a database override that takes precedence.',
  'app.administration.smtp.fields.senderName': 'Sender name',
  'app.administration.smtp.fields.senderNameHint': 'The display name recipients see (e.g. "JPassbolt").',
  'app.administration.smtp.fields.senderEmail': 'Sender email',
  'app.administration.smtp.fields.senderEmailHint': 'The "from" address for all outgoing mail.',
  'app.administration.smtp.fields.host': 'SMTP host',
  'app.administration.smtp.fields.port': 'Port',
  'app.administration.smtp.fields.tls': 'Use TLS',
  'app.administration.smtp.fields.tlsHint': 'Encrypt the connection to the mail server.',
  'app.administration.smtp.fields.username': 'Username',
  'app.administration.smtp.fields.password': 'Password',
  'app.administration.smtp.fields.client': 'Client (HELO/EHLO)',
  'app.administration.smtp.fields.clientHint':
    'Optional. The hostname this server announces to the SMTP server.',
  'app.administration.smtp.save': 'Save settings',
  'app.administration.smtp.saved': 'SMTP settings saved.',
  'app.administration.smtp.invalidPort': 'Enter a valid port number (1–65535).',
  'app.administration.smtp.test.title': 'Send a test email',
  'app.administration.smtp.test.subtitle':
    "Send a test message through the settings above — you don't need to save first.",
  'app.administration.smtp.test.recipient': 'Send test email to',
  'app.administration.smtp.test.recipientPlaceholder': 'you@example.com',
  'app.administration.smtp.test.send': 'Send test email',
  'app.administration.smtp.test.sending': 'Sending…',
  'app.administration.smtp.test.success': 'Test email sent. See the server trace below.',
  'app.administration.smtp.test.needRecipient': 'Enter a recipient address first.',
  'app.administration.smtp.test.traceTitle': 'SMTP trace',

  // --- Self registration ---
  'app.administration.selfReg.title': 'Self registration',
  'app.administration.selfReg.subtitle':
    'Let people create their own account when their email matches an allowed domain. When off, only administrators can invite users.',
  'app.administration.selfReg.loading': 'Loading self-registration settings…',
  'app.administration.selfReg.enable': 'Allow self registration',
  'app.administration.selfReg.enableHint':
    'When on, a visitor whose email domain is on the list can sign up without an invitation.',
  'app.administration.selfReg.domains': 'Allowed email domains',
  'app.administration.selfReg.domainsHint':
    'One domain per line (e.g. example.com). A leading @ is optional; invalid entries are dropped.',
  'app.administration.selfReg.domainsPlaceholder': 'example.com\nyour-company.org',
  'app.administration.selfReg.noDomains': 'Add at least one valid domain, or turn self registration off.',
  'app.administration.selfReg.savedEnabled': 'Self registration is on.',
  'app.administration.selfReg.savedDisabled': 'Self registration is off.',

  // --- Organization language ---
  'app.administration.orgLocale.title': 'Organization language',
  'app.administration.orgLocale.subtitle':
    'The default language for the organization. Used for emails and as the fallback UI language for users who have not picked their own.',
  'app.administration.orgLocale.loading': 'Loading organization language…',
  'app.administration.orgLocale.label': 'Default language',
  'app.administration.orgLocale.hint': 'Users can still override this in their own account settings.',
  'app.administration.orgLocale.saved': 'Organization language saved.',
};

export const zh: Dict = {
  // --- 邮件通知 + 密码策略（各自成为一个设置分节） ---
  'app.administration.orgPolicies.emails.title': '邮件通知',
  'app.administration.orgPolicies.emails.subtitle':
    '控制服务器发送哪些事务性邮件，以及邮件中显示多少内容。更改将即时保存。',
  'app.administration.orgPolicies.emails.loading': '正在加载邮件通知设置……',
  'app.administration.orgPolicies.emails.saved': '邮件通知设置已保存。',
  'app.administration.orgPolicies.emails.saveFailed': '保存邮件通知设置失败。',
  'app.administration.orgPolicies.emails.groups.content': '邮件内容',
  'app.administration.orgPolicies.emails.groups.password': '密码事件',
  'app.administration.orgPolicies.emails.groups.comment': '评论事件',
  'app.administration.orgPolicies.emails.groups.folder': '文件夹事件',
  'app.administration.orgPolicies.emails.groups.group': '群组事件',
  'app.administration.orgPolicies.emails.groups.user': '用户与管理员事件',
  'app.administration.orgPolicies.emails.toggles.show_comment': '在邮件中包含评论内容',
  'app.administration.orgPolicies.emails.toggles.show_description': '在邮件中包含描述',
  'app.administration.orgPolicies.emails.toggles.show_secret': '在邮件中包含密码明文',
  'app.administration.orgPolicies.emails.toggles.show_uri': '在邮件中包含网址',
  'app.administration.orgPolicies.emails.toggles.show_username': '在邮件中包含用户名',
  'app.administration.orgPolicies.emails.toggles.send_password_create': '创建密码时通知',
  'app.administration.orgPolicies.emails.toggles.send_password_update': '更新密码时通知',
  'app.administration.orgPolicies.emails.toggles.send_password_delete': '删除密码时通知',
  'app.administration.orgPolicies.emails.toggles.send_password_share': '共享密码时通知',
  'app.administration.orgPolicies.emails.toggles.send_comment_add': '新增评论时通知',
  'app.administration.orgPolicies.emails.toggles.send_comment_update': '更新评论时通知',
  'app.administration.orgPolicies.emails.toggles.send_comment_delete': '删除评论时通知',
  'app.administration.orgPolicies.emails.toggles.send_folder_create': '创建文件夹时通知',
  'app.administration.orgPolicies.emails.toggles.send_folder_update': '更新文件夹时通知',
  'app.administration.orgPolicies.emails.toggles.send_folder_delete': '删除文件夹时通知',
  'app.administration.orgPolicies.emails.toggles.send_folder_share': '共享文件夹时通知',
  'app.administration.orgPolicies.emails.toggles.send_group_delete': '删除群组时通知',
  'app.administration.orgPolicies.emails.toggles.send_group_user_add': '群组新增成员时通知',
  'app.administration.orgPolicies.emails.toggles.send_group_user_delete': '群组移除成员时通知',
  'app.administration.orgPolicies.emails.toggles.send_group_user_update': '群组成员变更时通知',
  'app.administration.orgPolicies.emails.toggles.send_group_manager_update': '群组管理员变更时通知',
  'app.administration.orgPolicies.emails.toggles.send_user_create': '新建用户时通知',
  'app.administration.orgPolicies.emails.toggles.send_user_recover': '用户发起账户恢复时通知',
  'app.administration.orgPolicies.emails.toggles.send_admin_user_setup_completed': '用户完成注册时通知管理员',
  'app.administration.orgPolicies.emails.toggles.send_admin_user_recover_complete': '用户完成恢复时通知管理员',

  'app.administration.orgPolicies.password.title': '密码策略',
  'app.administration.orgPolicies.password.subtitle': '全组织的密码与口令生成策略。社区版为只读，无法在此修改。',
  'app.administration.orgPolicies.password.readonly': '由 JPassbolt API 返回的只读策略。',
  'app.administration.orgPolicies.password.loading': '正在加载密码策略……',
  'app.administration.orgPolicies.password.loadFailed': '加载密码策略失败。',
  'app.administration.orgPolicies.password.defaultGenerator': '默认生成器',
  'app.administration.orgPolicies.password.generator.password': '随机密码',
  'app.administration.orgPolicies.password.generator.passphrase': '口令短语',
  'app.administration.orgPolicies.password.passwordLength': '密码长度',
  'app.administration.orgPolicies.password.lengthValue': '{{count}} 个字符',
  'app.administration.orgPolicies.password.passphraseWords': '口令单词数',
  'app.administration.orgPolicies.password.wordsValue': '{{count}} 个单词',
  'app.administration.orgPolicies.password.dictionaryCheck': '外部词典 / 泄露检测',
  'app.administration.orgPolicies.password.source': '策略来源',
  'app.administration.orgPolicies.password.bool.yes': '是',
  'app.administration.orgPolicies.password.bool.no': '否',

  // --- SMTP ---
  'app.administration.smtp.title': '邮件服务器（SMTP）',
  'app.administration.smtp.subtitle': '配置用于发送邀请、恢复链接和通知的外发邮件服务器。',
  'app.administration.smtp.loading': '正在加载 SMTP 设置…',
  'app.administration.smtp.source.db': '已保存到数据库',
  'app.administration.smtp.source.env': '来自环境变量',
  'app.administration.smtp.source.undefined': '尚未配置',
  'app.administration.smtp.envNote': '这些值来自服务器环境变量。在此保存会写入数据库覆盖项，并优先生效。',
  'app.administration.smtp.fields.senderName': '发件人名称',
  'app.administration.smtp.fields.senderNameHint': '收件人看到的显示名称（如 “JPassbolt”）。',
  'app.administration.smtp.fields.senderEmail': '发件人邮箱',
  'app.administration.smtp.fields.senderEmailHint': '所有外发邮件的 “发件人” 地址。',
  'app.administration.smtp.fields.host': 'SMTP 主机',
  'app.administration.smtp.fields.port': '端口',
  'app.administration.smtp.fields.tls': '使用 TLS',
  'app.administration.smtp.fields.tlsHint': '对与邮件服务器的连接加密。',
  'app.administration.smtp.fields.username': '用户名',
  'app.administration.smtp.fields.password': '密码',
  'app.administration.smtp.fields.client': '客户端（HELO/EHLO）',
  'app.administration.smtp.fields.clientHint': '可选。本服务器向 SMTP 服务器声明的主机名。',
  'app.administration.smtp.save': '保存设置',
  'app.administration.smtp.saved': 'SMTP 设置已保存。',
  'app.administration.smtp.invalidPort': '请输入有效的端口号（1–65535）。',
  'app.administration.smtp.test.title': '发送测试邮件',
  'app.administration.smtp.test.subtitle': '用上面的设置发送一封测试邮件——无需先保存。',
  'app.administration.smtp.test.recipient': '测试邮件收件人',
  'app.administration.smtp.test.recipientPlaceholder': 'you@example.com',
  'app.administration.smtp.test.send': '发送测试邮件',
  'app.administration.smtp.test.sending': '发送中…',
  'app.administration.smtp.test.success': '测试邮件已发送，请查看下方服务器追踪。',
  'app.administration.smtp.test.needRecipient': '请先填写收件人地址。',
  'app.administration.smtp.test.traceTitle': 'SMTP 追踪',

  // --- 自助注册 ---
  'app.administration.selfReg.title': '自助注册',
  'app.administration.selfReg.subtitle':
    '当访客邮箱匹配允许的域名时，允许其自行创建账户。关闭后，只有管理员能邀请用户。',
  'app.administration.selfReg.loading': '正在加载自助注册设置…',
  'app.administration.selfReg.enable': '允许自助注册',
  'app.administration.selfReg.enableHint': '开启后，邮箱域名在列表中的访客无需邀请即可注册。',
  'app.administration.selfReg.domains': '允许的邮箱域名',
  'app.administration.selfReg.domainsHint': '每行一个域名（如 example.com）。开头的 @ 可省略；无效条目会被忽略。',
  'app.administration.selfReg.domainsPlaceholder': 'example.com\nyour-company.org',
  'app.administration.selfReg.noDomains': '请至少添加一个有效域名，或关闭自助注册。',
  'app.administration.selfReg.savedEnabled': '自助注册已开启。',
  'app.administration.selfReg.savedDisabled': '自助注册已关闭。',

  // --- 组织语言 ---
  'app.administration.orgLocale.title': '组织语言',
  'app.administration.orgLocale.subtitle':
    '组织的默认语言，用于邮件通知，也是未自行选择语言用户的界面回退语言。',
  'app.administration.orgLocale.loading': '正在加载组织语言…',
  'app.administration.orgLocale.label': '默认语言',
  'app.administration.orgLocale.hint': '用户仍可在自己的账户设置中覆盖此项。',
  'app.administration.orgLocale.saved': '组织语言已保存。',
};

/**
 * metadata domain dictionary — owned and filled by WP-METADATA-ADMIN.
 * Flattened from the SPA settings namespace's `metadata.*` subtree per the
 * blueprint convention: locales/<lng>/settings.json `metadata.a.b` →
 * `app.settings.metadata.a.b`. See ../index.ts for how these merge.
 */
import type { Dict } from '../types';

export const en: Dict = {
  'app.settings.metadata.verifyingAccess': 'Verifying permissions…',
  'app.settings.metadata.title': 'Encrypted metadata',
  'app.settings.metadata.subtitle':
    'Organization policy and keys used to encrypt (v5) resource metadata.',
  'app.settings.metadata.loading': 'Loading encrypted metadata settings…',
  'app.settings.metadata.loadFailed': 'Failed to load encrypted metadata settings.',
  'app.settings.metadata.bool.yes': 'Yes',
  'app.settings.metadata.bool.no': 'No',
  'app.settings.metadata.entities.resources': 'Resources',
  'app.settings.metadata.entities.folders': 'Folders',
  'app.settings.metadata.entities.tags': 'Tags',
  'app.settings.metadata.entities.comments': 'Comments',
  'app.settings.metadata.v5Create.resources': 'Allow creating v5 resources',
  'app.settings.metadata.v5Create.folders': 'Allow creating v5 folders',
  'app.settings.metadata.v5Create.tags': 'Allow creating v5 tags',
  'app.settings.metadata.v5Create.comments': 'Allow creating v5 comments',
  'app.settings.metadata.v4Create.resources': 'Allow creating v4 resources',
  'app.settings.metadata.v4Create.folders': 'Allow creating v4 folders',
  'app.settings.metadata.v4Create.tags': 'Allow creating v4 tags',
  'app.settings.metadata.v4Create.comments': 'Allow creating v4 comments',
  'app.settings.metadata.migration.upgrade': 'Allow v4 → v5 upgrade',
  'app.settings.metadata.migration.downgrade': 'Allow v5 → v4 downgrade',
  'app.settings.metadata.typesPolicy.title': 'Metadata format policy',
  'app.settings.metadata.typesPolicy.subtitle':
    'Control the format used for new items, and whether v4/v5 creation and migration are allowed organization-wide.',
  'app.settings.metadata.typesPolicy.noActiveKeyWarn':
    'There is currently no active organization metadata key. Enabling any v5 option requires an active metadata key — until one is created, the server will reject these changes.',
  'app.settings.metadata.typesPolicy.defaultFormats': 'Default formats',
  'app.settings.metadata.typesPolicy.groupV5Create': 'v5 creation',
  'app.settings.metadata.typesPolicy.groupV4Create': 'v4 creation',
  'app.settings.metadata.typesPolicy.groupMigration': 'Migration',
  'app.settings.metadata.typesPolicy.needsActiveKey': '(requires an active metadata key)',
  'app.settings.metadata.typesPolicy.blockedNoKey':
    'Enabling v5 requires an active organization metadata key. Please create a metadata key first.',
  'app.settings.metadata.typesPolicy.updated': 'Metadata format policy updated.',
  'app.settings.metadata.typesPolicy.updateFailed': 'Failed to update metadata format policy.',
  'app.settings.metadata.typesPolicy.savePolicy': 'Save policy',
  'app.settings.metadata.typesPolicy.saving': 'Saving…',
  'app.settings.metadata.keysSettings.title': 'Metadata key settings',
  'app.settings.metadata.keysSettings.subtitle':
    'Manage how the metadata key is used and shared across the organization.',
  'app.settings.metadata.keysSettings.allowPersonalKeys': 'Allow use of personal keys',
  'app.settings.metadata.keysSettings.allowPersonalKeysHelp':
    "Allow metadata of personal items to be encrypted with the user's own GPG key (user_key).",
  'app.settings.metadata.keysSettings.zeroKnowledge': 'Zero-knowledge key sharing',
  'app.settings.metadata.keysSettings.zeroKnowledgeHelp':
    'Share the metadata key while the server never holds the private part of it.',
  'app.settings.metadata.keysSettings.updated': 'Metadata key settings updated.',
  'app.settings.metadata.keysSettings.updateFailed': 'Failed to update metadata key settings.',
  'app.settings.metadata.keysSettings.saveSettings': 'Save settings',
  'app.settings.metadata.keysSettings.saving': 'Saving…',
  'app.settings.metadata.orgKeys.title': 'Organization metadata keys',
  'app.settings.metadata.orgKeys.subtitle':
    "Shared keys used to encrypt resource metadata. Distribution shows how many users hold an encrypted copy of each key's private part. Creating and rotating keys is not supported here yet.",
  'app.settings.metadata.orgKeys.emptyTitle': 'No metadata keys',
  'app.settings.metadata.orgKeys.emptyDescription':
    'No organization metadata key has been created yet. Until one exists, v5 encrypted metadata stays disabled.',
  'app.settings.metadata.orgKeys.thFingerprint': 'Fingerprint',
  'app.settings.metadata.orgKeys.thStatus': 'Status',
  'app.settings.metadata.orgKeys.thCreated': 'Created',
  'app.settings.metadata.orgKeys.thDistribution': 'Distribution',
  'app.settings.metadata.orgKeys.statusDeleted': 'Deleted',
  'app.settings.metadata.orgKeys.statusExpired': 'Expired',
  'app.settings.metadata.orgKeys.statusActive': 'Active',
  'app.settings.metadata.orgKeys.distWithTotal': '{{distributed}} / {{total}} users',
  'app.settings.metadata.orgKeys.distNoTotal': '{{distributed}} users',
};

export const zh: Dict = {
  'app.settings.metadata.verifyingAccess': '正在校验权限……',
  'app.settings.metadata.title': '加密元数据',
  'app.settings.metadata.subtitle': '用于加密（v5）资源元数据的组织策略与密钥。',
  'app.settings.metadata.loading': '正在加载加密元数据设置……',
  'app.settings.metadata.loadFailed': '加载加密元数据设置失败。',
  'app.settings.metadata.bool.yes': '是',
  'app.settings.metadata.bool.no': '否',
  'app.settings.metadata.entities.resources': '资源',
  'app.settings.metadata.entities.folders': '文件夹',
  'app.settings.metadata.entities.tags': '标签',
  'app.settings.metadata.entities.comments': '评论',
  'app.settings.metadata.v5Create.resources': '允许创建 v5 资源',
  'app.settings.metadata.v5Create.folders': '允许创建 v5 文件夹',
  'app.settings.metadata.v5Create.tags': '允许创建 v5 标签',
  'app.settings.metadata.v5Create.comments': '允许创建 v5 评论',
  'app.settings.metadata.v4Create.resources': '允许创建 v4 资源',
  'app.settings.metadata.v4Create.folders': '允许创建 v4 文件夹',
  'app.settings.metadata.v4Create.tags': '允许创建 v4 标签',
  'app.settings.metadata.v4Create.comments': '允许创建 v4 评论',
  'app.settings.metadata.migration.upgrade': '允许 v4 → v5 升级',
  'app.settings.metadata.migration.downgrade': '允许 v5 → v4 降级',
  'app.settings.metadata.typesPolicy.title': '元数据格式策略',
  'app.settings.metadata.typesPolicy.subtitle':
    '控制新建项目使用的格式，以及是否允许在组织范围内创建和迁移 v4/v5。',
  'app.settings.metadata.typesPolicy.noActiveKeyWarn':
    '目前尚无处于激活状态的组织元数据密钥。启用任何 v5 选项都需要一个激活的元数据密钥——在创建之前，服务器将拒绝相关更改。',
  'app.settings.metadata.typesPolicy.defaultFormats': '默认格式',
  'app.settings.metadata.typesPolicy.groupV5Create': 'v5 创建',
  'app.settings.metadata.typesPolicy.groupV4Create': 'v4 创建',
  'app.settings.metadata.typesPolicy.groupMigration': '迁移',
  'app.settings.metadata.typesPolicy.needsActiveKey': '（需要一个激活的元数据密钥）',
  'app.settings.metadata.typesPolicy.blockedNoKey':
    '启用 v5 需要一个处于激活状态的组织元数据密钥，请先创建元数据密钥。',
  'app.settings.metadata.typesPolicy.updated': '元数据格式策略已更新。',
  'app.settings.metadata.typesPolicy.updateFailed': '更新元数据格式策略失败。',
  'app.settings.metadata.typesPolicy.savePolicy': '保存策略',
  'app.settings.metadata.typesPolicy.saving': '正在保存……',
  'app.settings.metadata.keysSettings.title': '元数据密钥设置',
  'app.settings.metadata.keysSettings.subtitle': '管理元数据密钥在组织范围内的使用与共享方式。',
  'app.settings.metadata.keysSettings.allowPersonalKeys': '允许使用个人密钥',
  'app.settings.metadata.keysSettings.allowPersonalKeysHelp':
    '允许个人项目的元数据使用用户自己的 GPG 密钥（user_key）加密。',
  'app.settings.metadata.keysSettings.zeroKnowledge': '零知识密钥共享',
  'app.settings.metadata.keysSettings.zeroKnowledgeHelp':
    '在服务器始终不持有元数据密钥私钥部分的前提下共享该密钥。',
  'app.settings.metadata.keysSettings.updated': '元数据密钥设置已更新。',
  'app.settings.metadata.keysSettings.updateFailed': '更新元数据密钥设置失败。',
  'app.settings.metadata.keysSettings.saveSettings': '保存设置',
  'app.settings.metadata.keysSettings.saving': '正在保存……',
  'app.settings.metadata.orgKeys.title': '组织元数据密钥',
  'app.settings.metadata.orgKeys.subtitle':
    '用于加密资源元数据的共享密钥。分发情况显示有多少用户持有每个密钥私钥部分的加密副本。此处暂不支持创建和轮换密钥。',
  'app.settings.metadata.orgKeys.emptyTitle': '暂无元数据密钥',
  'app.settings.metadata.orgKeys.emptyDescription':
    '尚未创建任何组织元数据密钥。在创建之前，v5 加密元数据将保持禁用。',
  'app.settings.metadata.orgKeys.thFingerprint': '指纹',
  'app.settings.metadata.orgKeys.thStatus': '状态',
  'app.settings.metadata.orgKeys.thCreated': '创建时间',
  'app.settings.metadata.orgKeys.thDistribution': '分发情况',
  'app.settings.metadata.orgKeys.statusDeleted': '已删除',
  'app.settings.metadata.orgKeys.statusExpired': '已过期',
  'app.settings.metadata.orgKeys.statusActive': '激活',
  'app.settings.metadata.orgKeys.distWithTotal': '{{distributed}} / {{total}} 位用户',
  'app.settings.metadata.orgKeys.distNoTotal': '{{distributed}} 位用户',
};

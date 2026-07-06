/**
 * groups domain dictionary — SPA `directory` namespace (groups subtree) flattened
 * to `app.directory.groups.*` per the migration key convention. Shared with the
 * background: the GROUP_SAVE_REENCRYPT handler throws the `error.*` messages, so
 * they live here rather than in core's `bg.*` block.
 *
 * Deliberately dropped vs the SPA: the granular `progress.*` step strings — the
 * re-encryption pipeline is now a single background RPC with no streaming
 * progress, so the modal shows one static banner (`manageModal.reencryptHintBg`).
 */
import type { Dict } from '../types';

export const en: Dict = {
  'app.directory.groups.unknownUser': 'Unknown user',
  'app.directory.groups.loadingGroups': 'Loading groups…',
  'app.directory.groups.emptyList.title': 'No groups yet',
  'app.directory.groups.emptyList.descAdmin':
    'Create a group to share passwords with a set of users at once.',
  'app.directory.groups.emptyList.descMember': "You aren't a member of any group yet.",
  'app.directory.groups.newGroup': 'New group',
  'app.directory.groups.list.heading': 'Groups · {{count}}',
  'app.directory.groups.list.new': 'New',
  'app.directory.groups.list.memberCount': '{{count}} members',
  'app.directory.groups.list.members': 'Members',
  'app.directory.groups.list.managerTitle': 'You manage this group',
  'app.directory.groups.selectPrompt.title': 'Select a group',
  'app.directory.groups.selectPrompt.desc': 'Pick a group on the left to view its members.',
  'app.directory.groups.detail.memberCount': '{{count}} members',
  'app.directory.groups.detail.youAreManager': 'You manage this group',
  'app.directory.groups.detail.manageTitle': 'Add or remove members',
  'app.directory.groups.detail.members': 'Members',
  'app.directory.groups.detail.renameTitle': 'Rename group',
  'app.directory.groups.detail.renameAria': 'Rename group',
  'app.directory.groups.detail.deleteTitle': 'Delete group',
  'app.directory.groups.detail.deleteAria': 'Delete group',
  'app.directory.groups.detail.loadingMembers': 'Loading members…',
  'app.directory.groups.detail.emptyTitle': 'No members',
  'app.directory.groups.detail.emptyDescManage': 'Add users to this group to start sharing.',
  'app.directory.groups.detail.emptyDescMember': 'This group has no members yet.',
  'app.directory.groups.detail.membersHeading': 'Members',
  'app.directory.groups.detail.managerBadge': 'Manager',
  'app.directory.groups.createModal.title': 'New group',
  'app.directory.groups.createModal.creating': 'Creating…',
  'app.directory.groups.createModal.create': 'Create group',
  'app.directory.groups.createModal.nameLabel': 'Group name',
  'app.directory.groups.createModal.namePlaceholder': 'e.g. Engineering team',
  'app.directory.groups.createModal.hint':
    "You'll be the group's first manager. You can add more members from the group detail view.",
  'app.directory.groups.renameModal.title': 'Rename group',
  'app.directory.groups.renameModal.saving': 'Saving…',
  'app.directory.groups.renameModal.nameLabel': 'Group name',
  'app.directory.groups.manageModal.title': 'Manage members · {{name}}',
  'app.directory.groups.manageModal.saving': 'Saving…',
  'app.directory.groups.manageModal.saveChanges': 'Save changes',
  'app.directory.groups.manageModal.reencrypting':
    'Re-encrypting group secrets for new members…',
  'app.directory.groups.manageModal.reencryptHintBg':
    'Secrets are re-encrypted inside the extension · Private keys never leave this device',
  'app.directory.groups.manageModal.addMember': 'Add member',
  'app.directory.groups.manageModal.searchPlaceholder': 'Search users by name or username',
  'app.directory.groups.manageModal.searching': 'Searching…',
  'app.directory.groups.manageModal.added': 'Added',
  'app.directory.groups.manageModal.noKeyTitle': "This user hasn't finished account setup yet",
  'app.directory.groups.manageModal.noKey': 'No key',
  'app.directory.groups.manageModal.managerLabelTitle': 'Managers can edit members',
  'app.directory.groups.manageModal.manager': 'Manager',
  'app.directory.groups.manageModal.removeTitle': 'Remove member',
  'app.directory.groups.manageModal.removeAria': 'Remove {{name}}',
  'app.directory.groups.manageModal.membersCount': 'Members ({{count}})',
  'app.directory.groups.manageModal.new': 'New',
  'app.directory.groups.manageModal.pendingRemovals':
    '{{count}} member(s) will be removed when you save.',
  'app.directory.groups.manageModal.footnote':
    'New members automatically receive a re-encrypted copy of every secret this group can access. Keep your vault unlocked while saving.',
  'app.directory.groups.deleteDialog.title': 'Delete "{{name}}"?',
  'app.directory.groups.deleteDialog.confirm': 'Delete group',
  'app.directory.groups.deleteDialog.checking':
    'Checking whether this group can be safely deleted…',
  'app.directory.groups.deleteDialog.blockedIntro':
    "This group can't be deleted because it is the sole owner of the following passwords. Transfer ownership first, then try again:",
  'app.directory.groups.deleteDialog.warning':
    'Deleting this group removes it for all members and revokes the shared-password access it granted. This cannot be undone.',
  'app.directory.groups.toast.created': 'Group created.',
  'app.directory.groups.toast.renamed': 'Group renamed.',
  'app.directory.groups.toast.membersUpdated': 'Members updated.',
  'app.directory.groups.toast.deleted': 'Group deleted.',
  'app.directory.groups.form.nameRequired': 'Please enter a group name.',
  'app.directory.groups.error.vaultLocked':
    'Your vault is locked. Unlock with your passphrase before adding members — new members need their secrets re-encrypted.',
  'app.directory.groups.error.cannotAddMembers':
    'Cannot add {{names}}: no verified public key is available, so their secrets cannot be encrypted. They must finish account setup first. No changes were made.',
  'app.directory.groups.error.missingOperatorSecret':
    'The server did not provide your own secret for resource {{resourceId}}, so it cannot be re-encrypted for the new member. No changes were made.',
  'app.directory.groups.error.recipientKeyMissing':
    'A recipient key went missing during encryption. No changes were made.',
};

export const zh: Dict = {
  'app.directory.groups.unknownUser': '未知用户',
  'app.directory.groups.loadingGroups': '正在加载群组…',
  'app.directory.groups.emptyList.title': '还没有任何群组',
  'app.directory.groups.emptyList.descAdmin': '创建一个群组，即可一次性把密码共享给一组用户。',
  'app.directory.groups.emptyList.descMember': '你还不是任何群组的成员。',
  'app.directory.groups.newGroup': '新建群组',
  'app.directory.groups.list.heading': '群组 · {{count}}',
  'app.directory.groups.list.new': '新建',
  'app.directory.groups.list.memberCount': '{{count}} 名成员',
  'app.directory.groups.list.members': '成员',
  'app.directory.groups.list.managerTitle': '你是群管理员',
  'app.directory.groups.selectPrompt.title': '选择一个群组',
  'app.directory.groups.selectPrompt.desc': '在左侧挑选一个群组以查看其成员。',
  'app.directory.groups.detail.memberCount': '{{count}} 名成员',
  'app.directory.groups.detail.youAreManager': '你是群管理员',
  'app.directory.groups.detail.manageTitle': '添加或移除成员',
  'app.directory.groups.detail.members': '成员',
  'app.directory.groups.detail.renameTitle': '重命名群组',
  'app.directory.groups.detail.renameAria': '重命名群组',
  'app.directory.groups.detail.deleteTitle': '删除群组',
  'app.directory.groups.detail.deleteAria': '删除群组',
  'app.directory.groups.detail.loadingMembers': '正在加载成员…',
  'app.directory.groups.detail.emptyTitle': '暂无成员',
  'app.directory.groups.detail.emptyDescManage': '为该群组添加用户即可开始共享。',
  'app.directory.groups.detail.emptyDescMember': '该群组还没有任何成员。',
  'app.directory.groups.detail.membersHeading': '成员',
  'app.directory.groups.detail.managerBadge': '群管理员',
  'app.directory.groups.createModal.title': '新建群组',
  'app.directory.groups.createModal.creating': '正在创建…',
  'app.directory.groups.createModal.create': '创建群组',
  'app.directory.groups.createModal.nameLabel': '群组名称',
  'app.directory.groups.createModal.namePlaceholder': '例如：工程团队',
  'app.directory.groups.createModal.hint':
    '你将作为该群组的首位管理员。可在群组详情中继续添加更多成员。',
  'app.directory.groups.renameModal.title': '重命名群组',
  'app.directory.groups.renameModal.saving': '正在保存…',
  'app.directory.groups.renameModal.nameLabel': '群组名称',
  'app.directory.groups.manageModal.title': '管理成员 · {{name}}',
  'app.directory.groups.manageModal.saving': '正在保存…',
  'app.directory.groups.manageModal.saveChanges': '保存更改',
  'app.directory.groups.manageModal.reencrypting': '正在为新成员重新加密群密文…',
  'app.directory.groups.manageModal.reencryptHintBg':
    '密文在扩展内部重新加密 · 私钥永不离开本机',
  'app.directory.groups.manageModal.addMember': '添加成员',
  'app.directory.groups.manageModal.searchPlaceholder': '按姓名或用户名搜索用户',
  'app.directory.groups.manageModal.searching': '正在搜索…',
  'app.directory.groups.manageModal.added': '已添加',
  'app.directory.groups.manageModal.noKeyTitle': '该用户尚未完成账户设置',
  'app.directory.groups.manageModal.noKey': '无密钥',
  'app.directory.groups.manageModal.managerLabelTitle': '群管理员可编辑成员',
  'app.directory.groups.manageModal.manager': '管理员',
  'app.directory.groups.manageModal.removeTitle': '移除成员',
  'app.directory.groups.manageModal.removeAria': '移除 {{name}}',
  'app.directory.groups.manageModal.membersCount': '成员（{{count}}）',
  'app.directory.groups.manageModal.new': '新增',
  'app.directory.groups.manageModal.pendingRemovals': '保存后将移除 {{count}} 名成员。',
  'app.directory.groups.manageModal.footnote':
    '新成员会自动收到该群组可访问的每一份密文的重新加密副本。保存期间请保持密钥库解锁状态。',
  'app.directory.groups.deleteDialog.title': '删除「{{name}}」？',
  'app.directory.groups.deleteDialog.confirm': '删除群组',
  'app.directory.groups.deleteDialog.checking': '正在检查该群组能否安全删除…',
  'app.directory.groups.deleteDialog.blockedIntro':
    '无法删除该群组，因为它是以下密码的唯一所有者。请先转移所有权后再试：',
  'app.directory.groups.deleteDialog.warning':
    '删除该群组会对所有成员移除它，并撤销它所授予的共享密码访问权。此操作不可撤销。',
  'app.directory.groups.toast.created': '群组已创建。',
  'app.directory.groups.toast.renamed': '群组已重命名。',
  'app.directory.groups.toast.membersUpdated': '成员已更新。',
  'app.directory.groups.toast.deleted': '群组已删除。',
  'app.directory.groups.form.nameRequired': '请输入群组名称。',
  'app.directory.groups.error.vaultLocked':
    '你的密钥库已锁定。添加成员前请先用口令解锁——新成员需要为其重新加密密文。',
  'app.directory.groups.error.cannotAddMembers':
    '无法添加 {{names}}：没有可验证的公钥，因此无法为其加密密文。他们必须先完成账户设置。未做任何更改。',
  'app.directory.groups.error.missingOperatorSecret':
    '服务器未提供你在资源 {{resourceId}} 上的密文，因此无法为新成员重新加密。未做任何更改。',
  'app.directory.groups.error.recipientKeyMissing':
    '加密过程中某个接收者的密钥丢失。未做任何更改。',
};

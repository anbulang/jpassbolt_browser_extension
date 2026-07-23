/**
 * share domain dictionary — flattened from the SPA `components` namespace's
 * `share.*` subtree (locales/<lng>/components.json) per the `app.<ns>.a.b`
 * convention, so every key is `app.components.share.*`. Consumed by
 * app/components/share/ShareDialog.tsx and (for the recipient-key error texts)
 * by background/handlers/share.ts.
 */
import type { Dict } from '../types';

export const en: Dict = {
  'app.components.share.title': 'Share resource',
  'app.components.share.titleNamed': 'Share "{{name}}"',
  'app.components.share.titleFolder': 'Share folder',
  'app.components.share.titleFolderNamed': 'Share folder "{{name}}"',
  // Mirrors PermissionService.shareFolder: sharing a folder only writes the
  // Folder ACO + folders_relations — it does NOT cascade to the credentials
  // inside it, so a new recipient receives an EMPTY folder at their root.
  'app.components.share.folderNote':
    'Folders hold no secret — only access rights change. Sharing a folder does not share the credentials inside it.',
  'app.components.share.accessorCount': '{{count}} people with access',
  'app.components.share.simulate': 'Simulate',
  'app.components.share.simulating': 'Simulating…',
  'app.components.share.simulateTooltip': 'Preview who would gain or lose access',
  'app.components.share.encryptingAndSharing': 'Encrypting and sharing…',
  'app.components.share.encryptAndShare': 'Encrypt and share',
  'app.components.share.searchPlaceholder': 'Search by name, username, or group…',
  'app.components.share.searching': 'Searching…',
  'app.components.share.noMatches': 'No matches.',
  'app.components.share.user': 'User',
  'app.components.share.group': 'Group',
  'app.components.share.memberCount': '{{count}} members',
  'app.components.share.whoHasAccess': 'Who has access',
  'app.components.share.loadingAccessList': 'Loading the current access list…',
  'app.components.share.noAccessYet':
    'Nobody has access yet. Search above to share with people or groups.',
  'app.components.share.undo': 'Undo',
  'app.components.share.removeAro': 'Remove {{name}}',
  'app.components.share.removeAccess': 'Remove access',
  'app.components.share.permission.read': 'Read-only',
  'app.components.share.permission.update': 'Can edit',
  'app.components.share.permission.owner': 'Owner',
  'app.components.share.chip.added': 'Added',
  'app.components.share.chip.removed': 'Removed',
  'app.components.share.reencrypt.head':
    'The secret will be re-encrypted for these new recipients',
  'app.components.share.reencrypt.sub':
    "{{count}} added · each secret is wrapped individually with the recipient's own public key; your private key and passphrase always stay local and never leave your device.",
  'app.components.share.simulation.title': 'Simulation result',
  'app.components.share.simulation.gainAccess': 'Gain access:',
  'app.components.share.simulation.loseAccess': 'Lose access:',
  'app.components.share.simulation.none': 'None',
  'app.components.share.toast.sharedNamed': '"{{name}}" shared successfully.',
  'app.components.share.toast.sharedUpdated': 'Sharing updated successfully.',
  'app.components.share.toast.applyFailed': 'Could not apply this share.',
  'app.components.share.errors.noChanges': 'There are no changes to apply.',
  'app.components.share.errors.noPublicKey':
    'No public key found for {{who}}; access cannot be granted yet.',
  'app.components.share.errors.cannotGetKey': 'Could not retrieve the key for {{who}}.',
  'app.components.share.errors.missingRecipientKeys':
    "Can't share — missing recipient keys: {{details}}",
  'app.components.share.errors.cannotReadSecret':
    "Could not read this resource's existing secret.",
};

export const zh: Dict = {
  'app.components.share.title': '共享资源',
  'app.components.share.titleNamed': '共享「{{name}}」',
  'app.components.share.titleFolder': '共享文件夹',
  'app.components.share.titleFolderNamed': '共享文件夹「{{name}}」',
  'app.components.share.folderNote':
    '文件夹不含密文，仅变更访问权限。共享文件夹不会同时共享其中的凭据。',
  'app.components.share.accessorCount': '{{count}} 个访问者',
  'app.components.share.simulate': '模拟',
  'app.components.share.simulating': '模拟中…',
  'app.components.share.simulateTooltip': '预览谁将获得或失去访问权限',
  'app.components.share.encryptingAndSharing': '加密并共享中…',
  'app.components.share.encryptAndShare': '加密并共享',
  'app.components.share.searchPlaceholder': '按姓名、用户名或群组搜索…',
  'app.components.share.searching': '搜索中…',
  'app.components.share.noMatches': '没有匹配项。',
  'app.components.share.user': '用户',
  'app.components.share.group': '群组',
  'app.components.share.memberCount': '{{count}} 名成员',
  'app.components.share.whoHasAccess': '谁有访问权限',
  'app.components.share.loadingAccessList': '正在加载当前访问列表…',
  'app.components.share.noAccessYet': '目前还没有人拥有访问权限。在上方搜索以与成员或群组共享。',
  'app.components.share.undo': '撤销',
  'app.components.share.removeAro': '移除 {{name}}',
  'app.components.share.removeAccess': '移除访问权限',
  'app.components.share.permission.read': '只读',
  'app.components.share.permission.update': '可编辑',
  'app.components.share.permission.owner': '拥有者',
  'app.components.share.chip.added': '新增',
  'app.components.share.chip.removed': '移除',
  'app.components.share.reencrypt.head': '将为这些新收件人重新加密密文',
  'app.components.share.reencrypt.sub':
    '新增 {{count}} 个对象 · 每份密文都使用收件人自己的公钥单独封装，你的私钥与 passphrase 始终留在本地，永不离开设备。',
  'app.components.share.simulation.title': '模拟结果',
  'app.components.share.simulation.gainAccess': '获得访问：',
  'app.components.share.simulation.loseAccess': '失去访问：',
  'app.components.share.simulation.none': '无',
  'app.components.share.toast.sharedNamed': '「{{name}}」已成功共享。',
  'app.components.share.toast.sharedUpdated': '共享已成功更新。',
  'app.components.share.toast.applyFailed': '无法应用此次共享。',
  'app.components.share.errors.noChanges': '没有可应用的变更。',
  'app.components.share.errors.noPublicKey': '未找到 {{who}} 的公钥，暂时无法授予其访问权限。',
  'app.components.share.errors.cannotGetKey': '无法获取 {{who}} 的密钥。',
  'app.components.share.errors.missingRecipientKeys': '无法共享 — 缺少收件人密钥：{{details}}',
  'app.components.share.errors.cannotReadSecret': '无法读取该资源现有的密文。',
};

/**
 * MoveDialog — the standalone "移动到…" modal, extracted from the SPA Vault
 * page's inline move Modal. Folder change is deliberately separate from edit:
 * the resource row carries no folder, so relocation goes through
 * PUT /move/Resource (folders_relations), never the resource update.
 */
import { useEffect, useState } from 'react';
import type { Folder, Resource } from '../../../shared/types';
import { Modal } from '../../components/Modal';
import { listFolders, moveResource } from '../../services/folders';
import { useToast } from '../../lib/toast';
import { tf } from '../../lib/i18n';
import { describeApiError } from '../../lib/errors';

interface MoveDialogProps {
  /** The resource being moved; null = closed. */
  resource: Resource | null;
  /** The resource's current folder (preselected), null = root. */
  currentFolderId: string | null;
  /** Cached folder list used to seed the picker instantly. */
  folders: Folder[];
  onClose: () => void;
  /** Awaited after a successful move BEFORE the dialog closes (refetch). */
  onMoved: () => Promise<void> | void;
}

export function MoveDialog({
  resource,
  currentFolderId,
  folders,
  onClose,
  onMoved,
}: MoveDialogProps) {
  const toast = useToast();
  const [target, setTarget] = useState<string>('');
  const [busy, setBusy] = useState(false);
  const [options, setOptions] = useState<Folder[]>(folders);

  // (Re)seed on open: preselect the current folder, seed options from the
  // cached list, then replace with a live /folders.json read so a folder just
  // created in the sidebar is a valid move target. Failures keep the seed.
  useEffect(() => {
    if (!resource) return;
    setTarget(currentFolderId ?? '');
    setOptions(folders);
    let cancelled = false;
    (async () => {
      try {
        const fresh = await listFolders();
        if (!cancelled) setOptions(fresh);
      } catch {
        // keep the seeded cached list
      }
    })();
    return () => {
      cancelled = true;
    };
    // `folders`/`currentFolderId` are re-read synchronously on each open; the
    // effect keys on the opened resource only.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resource?.id]);

  const confirm = async () => {
    if (!resource) return;
    const dest = target || null;
    if (dest === (currentFolderId ?? null)) {
      onClose();
      return;
    }
    setBusy(true);
    try {
      await moveResource(resource.id, dest);
      toast.success(tf('app.vault.toast.moved', '已移动凭据'));
      // Close only after BOTH the move and the refetch finish, so a reopened
      // dialog never shows a stale busy state (SPA fix preserved).
      await onMoved();
      onClose();
    } catch (err) {
      toast.error(describeApiError(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      open={!!resource}
      title={
        resource
          ? tf('app.vault.move.title', '移动「{{name}}」', { name: resource.name })
          : tf('app.vault.move.titleFallback', '移动凭据')
      }
      onClose={() => {
        if (!busy) onClose();
      }}
      maxWidth={420}
      footer={
        <>
          <span style={{ flex: 1 }} />
          <button className="btn" onClick={onClose} disabled={busy}>
            {tf('app.common.actions.cancel', '取消')}
          </button>
          <button className="btn primary" onClick={() => void confirm()} disabled={busy}>
            {busy ? tf('app.vault.move.moving', '移动中…') : tf('app.vault.move.move', '移动')}
          </button>
        </>
      }
    >
      <div className="form-group" style={{ marginBottom: 0 }}>
        <label className="form-label">{tf('app.vault.move.targetFolder', '目标文件夹')}</label>
        <select
          className="form-control"
          value={target}
          onChange={(e) => setTarget(e.target.value)}
          disabled={busy}
        >
          <option value="">{tf('app.vault.move.noFolder', '无文件夹（根目录）')}</option>
          {options.map((f) => (
            <option key={f.id} value={f.id}>
              {f.name}
            </option>
          ))}
        </select>
      </div>
    </Modal>
  );
}

export default MoveDialog;

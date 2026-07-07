/**
 * Confirmation modal built on Modal (ported from the SPA ConfirmDialog.tsx).
 * Title + message + confirm/cancel buttons, optional danger styling and an
 * `extra` slot. Presentational only.
 */
import type { ReactNode } from 'react';
import { Modal } from './Modal';
import { tf } from '../lib/i18n';

interface ConfirmDialogProps {
  open: boolean;
  title: string;
  message: ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  /** Renders the confirm button in danger styling (destructive actions). */
  danger?: boolean;
  /** Disables the buttons while an async action runs. */
  loading?: boolean;
  /** Optional extra content below the message (e.g. a "delete contents" checkbox). */
  extra?: ReactNode;
  onConfirm: () => void;
  onCancel: () => void;
}

export function ConfirmDialog({
  open,
  title,
  message,
  confirmLabel,
  cancelLabel,
  danger = false,
  loading = false,
  extra,
  onConfirm,
  onCancel,
}: ConfirmDialogProps) {
  return (
    <Modal
      open={open}
      title={title}
      onClose={onCancel}
      maxWidth={440}
      footer={
        <>
          <span style={{ flex: 1 }} />
          <button type="button" className="btn" onClick={onCancel} disabled={loading}>
            {cancelLabel ?? tf('app.common.actions.cancel', '取消')}
          </button>
          <button
            type="button"
            className={danger ? 'btn danger' : 'btn primary'}
            onClick={onConfirm}
            disabled={loading}
          >
            {loading
              ? tf('app.components.confirmDialog.processing', '处理中…')
              : (confirmLabel ?? tf('app.common.actions.confirm', '确认'))}
          </button>
        </>
      }
    >
      <div style={{ color: 'var(--text-2)', fontSize: 14, lineHeight: 1.6 }}>{message}</div>
      {extra ? <div style={{ marginTop: 16 }}>{extra}</div> : null}
    </Modal>
  );
}

export default ConfirmDialog;

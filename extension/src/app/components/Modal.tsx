/**
 * Reusable centered modal on the Aegis scrim/dialog kit (ui/aegis.css). Ported
 * from the SPA Modal.tsx with the same props contract (title/footer/maxWidth/
 * closeOnBackdrop) plus optional `icon`/`subtitle` slots for the Aegis
 * dialog-head layout. Presentational only — owners pass `open`/`onClose`.
 */
import { useEffect, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';
import { tf } from '../lib/i18n';

interface ModalProps {
  open: boolean;
  title?: ReactNode;
  /** Secondary line under the title (dialog-head p slot). */
  subtitle?: ReactNode;
  /** Leading icon (lucide element) rendered in the tinted dh-ico square. */
  icon?: ReactNode;
  onClose: () => void;
  children: ReactNode;
  /** Optional footer slot, typically action buttons. */
  footer?: ReactNode;
  /** Max width of the panel in px. */
  maxWidth?: number;
  /** When false, clicking the backdrop will not close the modal. */
  closeOnBackdrop?: boolean;
}

export function Modal({
  open,
  title,
  subtitle,
  icon,
  onClose,
  children,
  footer,
  maxWidth = 520,
  closeOnBackdrop = true,
}: ModalProps) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open) return null;

  return createPortal(
    <div
      className="scrim"
      onMouseDown={(e) => {
        if (closeOnBackdrop && e.target === e.currentTarget) onClose();
      }}
    >
      <div className="dialog" style={{ maxWidth }} role="dialog" aria-modal="true">
        <div className="dialog-head">
          {icon ? <div className="dh-ico">{icon}</div> : null}
          <div style={{ flex: 1, minWidth: 0 }}>
            <h2>{title}</h2>
            {subtitle ? <p>{subtitle}</p> : null}
          </div>
          <button
            type="button"
            className="iconbtn x"
            onClick={onClose}
            aria-label={tf('app.common.actions.close', '关闭')}
          >
            <X />
          </button>
        </div>
        <div className="dialog-body">{children}</div>
        {footer ? <div className="dialog-foot">{footer}</div> : null}
      </div>
    </div>,
    document.body,
  );
}

export default Modal;

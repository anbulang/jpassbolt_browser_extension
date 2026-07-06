/**
 * Transient toast notifications (SPA Toast.tsx + toastContext.ts merged into
 * one file). Wrap the app once in <ToastProvider>; pages call
 * `useToast().success('…')` etc. Styles live in ui/aegis.css (.toast-*).
 */
import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { createPortal } from 'react-dom';
import { AlertCircle, CheckCircle2, Info, X } from 'lucide-react';
import { tf } from './i18n';

export type ToastVariant = 'success' | 'error' | 'info';

export interface ToastContextValue {
  show: (message: string, variant?: ToastVariant, duration?: number) => void;
  success: (message: string, duration?: number) => void;
  error: (message: string, duration?: number) => void;
  info: (message: string, duration?: number) => void;
}

const ToastContext = createContext<ToastContextValue | null>(null);

export function useToast(): ToastContextValue {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error('useToast must be used within <ToastProvider>');
  return ctx;
}

interface ToastItem {
  id: number;
  message: string;
  variant: ToastVariant;
}

const ICONS: Record<ToastVariant, ReactNode> = {
  success: <CheckCircle2 size={18} className="toast-icon-success" />,
  error: <AlertCircle size={18} className="toast-icon-error" />,
  info: <Info size={18} className="toast-icon-info" />,
};

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const idRef = useRef(0);

  const dismiss = useCallback((id: number) => {
    setToasts((prev) => prev.filter((item) => item.id !== id));
  }, []);

  const show = useCallback(
    (message: string, variant: ToastVariant = 'info', duration = 4000) => {
      const id = ++idRef.current;
      setToasts((prev) => [...prev, { id, message, variant }]);
      if (duration > 0) window.setTimeout(() => dismiss(id), duration);
    },
    [dismiss],
  );

  const value = useMemo<ToastContextValue>(
    () => ({
      show,
      success: (m, d) => show(m, 'success', d),
      error: (m, d) => show(m, 'error', d),
      info: (m, d) => show(m, 'info', d),
    }),
    [show],
  );

  return (
    <ToastContext.Provider value={value}>
      {children}
      {toasts.length > 0 &&
        createPortal(
          <div className="toast-container">
            {toasts.map((item) => (
              <div key={item.id} className={`toast toast-${item.variant}`} role="status">
                {ICONS[item.variant]}
                <span className="toast-message">{item.message}</span>
                <button
                  type="button"
                  className="toast-close"
                  onClick={() => dismiss(item.id)}
                  aria-label={tf('app.components.toast.dismiss', '关闭')}
                >
                  <X size={14} />
                </button>
              </div>
            ))}
          </div>,
          document.body,
        )}
    </ToastContext.Provider>
  );
}

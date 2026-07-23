/**
 * Presentation primitives shared by every settings section and org card.
 *
 * They live in their own module (rather than in the page or in a section file)
 * so a card never has to import from the page that renders it — the old
 * index -> tab -> index and section -> card -> section import cycles are gone.
 *
 * Two error banners on purpose:
 *   - ErrorBanner      the page-level .warnbox (icon + text, full width);
 *   - CardErrorBanner  the inline, softer box the org cards embed in a .scard.
 */
import type { ReactNode } from 'react';
import { AlertTriangle } from 'lucide-react';

/** Page-level warning box, rendered above a section's cards. */
export function ErrorBanner({ children }: { children: ReactNode }) {
  return (
    <div className="warnbox">
      <AlertTriangle size={18} />
      <span>{children}</span>
    </div>
  );
}

/** Inline loading row used inside the cards (SPA FullSpinner equivalent). */
export function CardSpinner({ label }: { label?: string }) {
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 8,
        color: 'var(--text-3)',
        fontSize: 13,
      }}
    >
      <span className="spin-ring" />
      {label ? <span>{label}</span> : null}
    </div>
  );
}

/** Inline error banner used inside the cards (SPA ErrorBanner equivalent). */
export function CardErrorBanner({ children }: { children: ReactNode }) {
  return (
    <div
      role="alert"
      style={{
        padding: '10px 12px',
        background: 'var(--red-soft)',
        color: 'var(--red-text)',
        border: '1px solid color-mix(in oklch, var(--red) 35%, transparent)',
        borderRadius: 9,
        fontSize: 13,
        lineHeight: 1.5,
      }}
    >
      {children}
    </div>
  );
}

/** Section heading (title + subtitle) shared by every settings section. */
export function SectionHeader({ title, subtitle }: { title: string; subtitle?: string }) {
  return (
    <>
      <h2 className="stitle">{title}</h2>
      {subtitle ? <div className="ssub">{subtitle}</div> : null}
    </>
  );
}

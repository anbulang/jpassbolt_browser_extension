/**
 * Centered empty state (ported from the SPA EmptyState.tsx, restyled onto the
 * Aegis `.empty` kit): icon + title + subtitle + optional action.
 */
import type { ComponentType, ReactNode } from 'react';
import type { LucideProps } from 'lucide-react';

interface EmptyStateProps {
  /** A lucide-react icon component, e.g. `Lock`. */
  icon?: ComponentType<LucideProps>;
  title: string;
  description?: ReactNode;
  /** Optional CTA rendered below the copy (e.g. a <button className="btn primary">). */
  action?: ReactNode;
}

export function EmptyState({ icon: Icon, title, description, action }: EmptyStateProps) {
  return (
    <div className="empty">
      {Icon ? (
        <div className="ico">
          <Icon />
        </div>
      ) : null}
      <h3>{title}</h3>
      {description ? <p>{description}</p> : null}
      {action}
    </div>
  );
}

export default EmptyState;

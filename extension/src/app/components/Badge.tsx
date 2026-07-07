/**
 * Small pill label (ported from the SPA Badge.tsx). Used for roles, statuses,
 * permission levels, user/group type and member counts.
 */
import type { ReactNode } from 'react';
import { tf } from '../lib/i18n';

export type BadgeVariant = 'default' | 'primary' | 'success' | 'danger' | 'muted';

interface BadgeProps {
  children: ReactNode;
  variant?: BadgeVariant;
  /** Optional leading icon (lucide element). */
  icon?: ReactNode;
  title?: string;
}

export function Badge({ children, variant = 'default', icon, title }: BadgeProps) {
  return (
    <span className={`badge badge-${variant}`} title={title}>
      {icon}
      {children}
    </span>
  );
}

/** Maps a Passbolt permission level (1 / 7 / 15) to a labelled Badge. */
export function PermissionBadge({ type }: { type: number }) {
  const map: Record<number, { label: string; variant: BadgeVariant }> = {
    1: { label: tf('app.components.permission.read', '可读'), variant: 'muted' },
    7: { label: tf('app.components.permission.canUpdate', '可编辑'), variant: 'primary' },
    15: { label: tf('app.components.permission.owner', '所有者'), variant: 'success' },
  };
  const entry = map[type] ?? {
    label: tf('app.components.permission.level', '权限 {{type}}', { type }),
    variant: 'default' as BadgeVariant,
  };
  return <Badge variant={entry.variant}>{entry.label}</Badge>;
}

export default Badge;

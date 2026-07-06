/**
 * Circular avatar (ported from the SPA Avatar.tsx). Renders the image when
 * `src` is present, otherwise initials on a tinted background.
 */
import { tf } from '../lib/i18n';

interface AvatarProps {
  /** Already-resolved image URL (e.g. profile.avatar.url.small). Falls back to initials. */
  src?: string | null;
  firstName?: string | null;
  lastName?: string | null;
  /** Fallback label used to derive initials when no names are given (e.g. username). */
  name?: string | null;
  /** Diameter in px. */
  size?: number;
}

function initialsFrom(first?: string | null, last?: string | null, name?: string | null): string {
  const f = (first || '').trim();
  const l = (last || '').trim();
  if (f || l) {
    return `${f.charAt(0)}${l.charAt(0)}`.toUpperCase() || '?';
  }
  const n = (name || '').trim();
  if (n) {
    const parts = n.split(/[\s@._-]+/).filter(Boolean);
    if (parts.length >= 2) return `${parts[0].charAt(0)}${parts[1].charAt(0)}`.toUpperCase();
    return n.slice(0, 2).toUpperCase();
  }
  return '?';
}

/** A stable accent-family color derived from a seed string (SPA Layout colorOf). */
export function avatarColorOf(seed: string): string {
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) >>> 0;
  const hue = h % 360;
  return `oklch(0.55 0.15 ${hue})`;
}

export function Avatar({ src, firstName, lastName, name, size = 36 }: AvatarProps) {
  const initials = initialsFrom(firstName, lastName, name);
  const fontSize = Math.max(10, Math.round(size * 0.4));
  const alt =
    [firstName, lastName].filter(Boolean).join(' ') ||
    name ||
    tf('app.components.avatar.alt', '头像');

  return (
    <span className="avatar" style={{ width: size, height: size, fontSize }} title={alt}>
      {src ? <img src={src} alt={alt} /> : initials}
    </span>
  );
}

export default Avatar;

/**
 * Circular avatar (ported from the SPA Avatar.tsx). Renders the image when
 * `src` is present, otherwise initials on a tinted background.
 */
import { tf } from '../lib/i18n';
import { joinName, initialsFromNames } from '../../shared/names';

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

/** A stable accent-family color derived from a seed string (SPA Layout colorOf). */
export function avatarColorOf(seed: string): string {
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) >>> 0;
  const hue = h % 360;
  return `oklch(0.55 0.15 ${hue})`;
}

export function Avatar({ src, firstName, lastName, name, size = 36 }: AvatarProps) {
  const initials = initialsFromNames(firstName, lastName, name);
  const fontSize = Math.max(10, Math.round(size * 0.4));
  const alt =
    joinName(firstName, lastName) || name || tf('app.components.avatar.alt', '头像');

  return (
    <span className="avatar" style={{ width: size, height: size, fontSize }} title={alt}>
      {src ? <img src={src} alt={alt} /> : initials}
    </span>
  );
}

export default Avatar;

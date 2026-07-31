import type { ComponentProps } from 'react';
import iconUrl from '../icons/icon-128.png';

type BrandMarkProps = Omit<ComponentProps<'img'>, 'src'>;

/**
 * The canonical JPassbolt brand mark. Keep workflow icons (vault, key, MFA,
 * lock, etc.) semantic; use this component only where the product itself is
 * being identified.
 */
export function BrandMark({ alt = '', draggable = false, ...props }: BrandMarkProps) {
  return <img src={iconUrl} alt={alt} draggable={draggable} {...props} />;
}

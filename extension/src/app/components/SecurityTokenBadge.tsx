/**
 * SecurityTokenBadge — the anti-phishing security token (white-paper SP-27),
 * rendered INSIDE every surface that asks for the passphrase. A look-alike page
 * cannot know the three characters + colour the user chose, so a passphrase
 * prompt that shows the wrong (or a default) token is recognisable as a fake.
 *
 * Focus inversion: while the associated field has focus the badge swaps its
 * fore/background colours. This is the interaction the white-paper mandates to
 * defeat a "transparent input overlay" — an attacker's invisible field laid over
 * the real one steals the keystrokes but cannot mirror the colour flip on the
 * genuine badge underneath, so the flip visibly fails.
 *
 * Display-only, zero-knowledge: it reads ONLY the token config
 * (getSecurityToken — device-local, non-sensitive, same trust level as the theme
 * switch) and renders the code/colour as a React text node + a controlled inline
 * style. It never reads the passphrase or private key, and never uses innerHTML.
 * The colour is re-validated against the #rrggbb whitelist before it reaches the
 * style object, so a corrupt stored value can never become injected CSS.
 */
import { useEffect, useState, type CSSProperties } from 'react';
import {
  DEFAULT_SECURITY_TOKEN,
  getSecurityToken,
  isValidTokenColor,
  tokenTextColor,
  type SecurityToken,
} from '../../shared/securityToken';
import { t } from '../../shared/i18n';

export function SecurityTokenBadge({
  focused = false,
  token: controlled,
  className,
  style,
}: {
  /** True while the associated passphrase field has focus (drives the colour flip). */
  focused?: boolean;
  /**
   * Show THIS token instead of the stored one. For the setup/recovery flows,
   * where the user is picking their mark next to these badges but the choice is
   * only written to storage after the account is committed — an uncontrolled
   * badge would keep showing the old/default mark and contradict the picker
   * sitting right below it. Omit everywhere else: the badge then reads the
   * stored token itself, which is what every post-setup surface wants.
   */
  token?: SecurityToken;
  className?: string;
  /** Positioning left to the caller (flex child vs. absolutely-anchored inside an input). */
  style?: CSSProperties;
}) {
  const [stored, setStored] = useState<SecurityToken>(DEFAULT_SECURITY_TOKEN);
  useEffect(() => {
    // Skip the read entirely when controlled — the caller owns the value.
    if (controlled) return;
    let cancelled = false;
    void getSecurityToken().then((tk) => {
      if (!cancelled) setStored(tk);
    });
    return () => {
      cancelled = true;
    };
  }, [controlled]);

  const token = controlled ?? stored;

  // getSecurityToken() already coerces to a valid #rrggbb, but re-validate here so
  // the value written into an inline style can never be attacker-controlled CSS
  // (defence in depth — the badge renders on trust-boundary surfaces). A
  // controlled token is unvalidated caller state, so this matters more, not less.
  const bg = isValidTokenColor(token.color) ? token.color : DEFAULT_SECURITY_TOKEN.color;
  const fg = tokenTextColor(bg);
  const colors: CSSProperties = focused
    ? { background: fg, color: bg }
    : { background: bg, color: fg };

  return (
    <span
      className={'jpb-sectoken-badge' + (className ? ' ' + className : '')}
      style={{ ...colors, ...style }}
      aria-label={t('securityToken.badgeAria')}
      title={t('securityToken.badgeAria')}
    >
      {token.code.toUpperCase()}
    </span>
  );
}

export default SecurityTokenBadge;

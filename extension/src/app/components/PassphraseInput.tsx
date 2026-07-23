/**
 * PassphraseInput — the single passphrase field used by every surface that asks
 * for the master passphrase (unlock / setup / recovery / change-passphrase).
 *
 * It bundles the three things those surfaces always want together, so they no
 * longer hand-assemble them (and drift):
 *   1. the aegis `.pf-input` shell (Lock glyph + input + optional show/hide eye);
 *   2. the anti-phishing SecurityTokenBadge anchored INSIDE the field, flipping
 *      colours on focus (white-paper SP-27);
 *   3. a focus ring TINTED to the security token's colour — the field's border +
 *      focus glow adopt the user's mark colour, so a look-alike page (which does
 *      not know the mark) cannot reproduce the coloured focus state either.
 *
 * Token source (mirrors SecurityTokenBadge): a controlled `token` prop wins — the
 * setup/recovery flows pass the value being PICKED, which is not yet in storage;
 * everywhere else the field reads the stored mark itself. The colour is
 * re-validated against the #rrggbb whitelist before it reaches an inline style,
 * so a corrupt stored value can never become injected CSS.
 *
 * Display-only, zero-knowledge: nothing here decrypts or transmits — it renders
 * the token config and forwards keystrokes to the caller's onChange. Safe in the
 * app iframe.
 */
import { useEffect, useState, type CSSProperties } from 'react';
import { Eye, EyeOff, Lock } from 'lucide-react';
import {
  DEFAULT_SECURITY_TOKEN,
  getSecurityToken,
  isValidTokenColor,
  type SecurityToken,
} from '../../shared/securityToken';
import { t } from '../../shared/i18n';
import SecurityTokenBadge from './SecurityTokenBadge';

export function PassphraseInput({
  value,
  onChange,
  token: controlled,
  err = false,
  autoFocus,
  autoComplete,
  placeholder,
  disabled = false,
  onFocus,
  onBlur,
  showToggle = true,
  compact = false,
}: {
  value: string;
  /** Called with the new string value on every keystroke. */
  onChange: (value: string) => void;
  /**
   * Show/tint with THIS token instead of the stored one. The setup/recovery
   * flows pass the mark being picked (not yet persisted); omit it everywhere
   * else and the field reads the stored mark itself.
   */
  token?: SecurityToken;
  /** Red error state — kept ABOVE the token tint (see .pf-input.err in aegis.css). */
  err?: boolean;
  autoFocus?: boolean;
  autoComplete?: string;
  placeholder?: string;
  disabled?: boolean;
  /** Forwarded after the internal focus tracking runs. */
  onFocus?: () => void;
  onBlur?: () => void;
  /** Render the show/hide eye (default true). */
  showToggle?: boolean;
  /** Tighter height for the 380px popup. */
  compact?: boolean;
}) {
  const [focused, setFocused] = useState(false);
  const [show, setShow] = useState(false);

  // Effective token: controlled wins, else read storage once (getSecurityToken
  // never rejects — a missing/corrupt entry yields the default). Resolving it
  // here (rather than letting the badge read storage on its own) keeps the
  // field's tint and the badge showing the SAME mark from one source.
  const [stored, setStored] = useState<SecurityToken>(DEFAULT_SECURITY_TOKEN);
  useEffect(() => {
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

  // Re-validate before the colour reaches an inline style — defence in depth on a
  // passphrase-collecting surface. `--sectoken-soft` is the mark colour at ~20%
  // alpha (8-digit #rrggbbaa), used for the focus glow.
  const tint = isValidTokenColor(token.color) ? token.color : DEFAULT_SECURITY_TOKEN.color;
  const cssVars = {
    ['--sectoken-c']: tint,
    ['--sectoken-soft']: tint + '33',
  } as CSSProperties;

  const cls =
    'pf-input tokenized' + (err ? ' err' : '') + (compact ? ' pf-compact' : '');

  return (
    <div className={cls} style={cssVars}>
      <Lock size={17} />
      <input
        type={show ? 'text' : 'password'}
        value={value}
        autoFocus={autoFocus}
        autoComplete={autoComplete}
        placeholder={placeholder}
        disabled={disabled}
        onChange={(e) => onChange(e.target.value)}
        onFocus={() => {
          setFocused(true);
          onFocus?.();
        }}
        onBlur={() => {
          setFocused(false);
          onBlur?.();
        }}
      />
      {/* Anti-phishing token — controlled by the field's own focus state so it
          flips colours in step with the border tint. */}
      <SecurityTokenBadge focused={focused} token={token} />
      {showToggle && (
        <button
          type="button"
          className="pf-eye"
          onClick={() => setShow((s) => !s)}
          disabled={disabled}
          aria-label={show ? t('detail.hide') : t('detail.show')}
        >
          {show ? <EyeOff size={17} /> : <Eye size={17} />}
        </button>
      )}
    </div>
  );
}

export default PassphraseInput;

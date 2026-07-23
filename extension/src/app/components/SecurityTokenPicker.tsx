/* eslint-disable react-refresh/only-export-components */
/**
 * SecurityTokenPicker — "pick your anti-phishing marker", shared by the setup
 * and recovery guest flows.
 *
 * CONTROLLED and side-effect free by design: it never reads or writes storage.
 * The parent owns the value and decides when it is SEEDED (getSecurityToken at
 * mount) and when it is PERSISTED (persistSecurityToken, only after
 * SETUP_COMMIT). That split is not a style preference — see the ordering proof
 * in flowHelpers.persistSecurityToken; a picker that saved on change would
 * silently rewrite the mark of the account already on this browser.
 *
 * Display-only, zero-knowledge (shared/securityToken.ts): the token has no
 * cryptographic role, never leaves the device and is never sent to the server.
 * Nothing here reads the passphrase or key material, so it is safe in the app
 * iframe.
 *
 * Zero new design language: it reuses the settings page's sectoken-* controls
 * from ui/aegis.css verbatim (.sinput/.sectoken-input, .sectoken-swatches/
 * .sectoken-swatch/.on, .sectoken-preview/.stp-dots/.sectoken-chip) plus the
 * flow card's own .pf-label/.pf-err; only flow-card layout glue was appended.
 */
import { type JSX } from 'react';
import { AlertTriangle, Check, Lock, ShieldQuestion } from 'lucide-react';
import { t } from '../../shared/i18n';
import {
  DEFAULT_SECURITY_TOKEN,
  isValidTokenColor,
  tokenTextColor,
  type SecurityToken,
} from '../../shared/securityToken';

/**
 * The official styleguide's swatch row, near enough. It lives here rather than
 * in shared/securityToken.ts (which owns storage + validation, not
 * presentation) and is the single source of truth for every surface that lets
 * the user PICK a token: the flows via this component, the settings page via
 * the constant. Two copies could drift into offering different palettes, so a
 * mark chosen on one surface would be unreproducible on the other.
 */
export const SECURITY_TOKEN_SWATCHES: readonly string[] = [
  '#3b82f6',
  '#8b5cf6',
  '#ec4899',
  '#ef4444',
  '#f59e0b',
  '#10b981',
  '#14b8a6',
  '#64748b',
];

/** Keep the field itself clean while typing; validity is reported separately. */
export function sanitizeTokenCode(raw: string): string {
  return raw.replace(/[^A-Za-z0-9]/g, '').slice(0, 3);
}

export function SecurityTokenPicker({
  code,
  color,
  onChange,
  disabled = false,
  invalid = false,
}: {
  code: string;
  color: string;
  /** Fires on every keystroke / swatch click with the whole token. */
  onChange: (next: SecurityToken) => void;
  disabled?: boolean;
  /** Parent-derived (isValidTokenCode); drives aria-invalid + the inline hint. */
  invalid?: boolean;
}): JSX.Element {
  // The colour reaches an inline style, so re-validate it against the #rrggbb
  // whitelist even though it can only come from SECURITY_TOKEN_SWATCHES or the
  // already-coerced stored token. Same defence in depth as SecurityTokenBadge:
  // this renders on a passphrase-collecting surface, where a corrupt stored
  // value must never be able to become injected CSS.
  const bg = isValidTokenColor(color) ? color : DEFAULT_SECURITY_TOKEN.color;
  const fg = tokenTextColor(bg);

  return (
    <div className="sectoken-pick">
      <div className="pf-label">
        <ShieldQuestion size={15} /> {t('app.auth.securityToken.label')}
      </div>
      <div className="sectoken-pick-hint">{t('app.auth.securityToken.hint')}</div>

      <div className="sectoken-pick-row">
        <input
          className="sinput sectoken-input"
          value={code}
          maxLength={3}
          onChange={(e) => onChange({ code: sanitizeTokenCode(e.target.value), color })}
          disabled={disabled}
          aria-label={t('app.auth.securityToken.codeAria')}
          aria-invalid={invalid}
        />
        <div
          className="sectoken-swatches"
          role="group"
          aria-label={t('app.auth.securityToken.colorAria')}
        >
          {SECURITY_TOKEN_SWATCHES.map((swatch) => (
            <button
              key={swatch}
              type="button"
              className={`sectoken-swatch${swatch === color ? ' on' : ''}`}
              style={{ background: swatch }}
              onClick={() => onChange({ code, color: swatch })}
              disabled={disabled}
              aria-label={swatch}
              aria-pressed={swatch === color}
              title={swatch}
            >
              {swatch === color && <Check size={14} color={tokenTextColor(swatch)} />}
            </button>
          ))}
        </div>
      </div>

      {/* Preview of the mark as it will appear next to EVERY future passphrase
          field — the point being that a look-alike page cannot reproduce it. */}
      <div className="sectoken-preview">
        <Lock size={16} />
        <span className="stp-dots">••••••••••••</span>
        <span className="sectoken-chip" style={{ background: bg, color: fg }}>
          {invalid ? '???' : code.toUpperCase()}
        </span>
      </div>

      {invalid && (
        <div className="pf-err">
          <AlertTriangle size={13} /> {t('app.auth.securityToken.invalid')}
        </div>
      )}
    </div>
  );
}

export default SecurityTokenPicker;

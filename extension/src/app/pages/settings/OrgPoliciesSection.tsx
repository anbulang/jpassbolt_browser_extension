/**
 * Organization policies section (admin only) — ported from the SPA
 * Settings.tsx OrgPoliciesSection. WP-SETTINGS-CORE mounts this behind its own
 * `{isAdmin && …}` gate, so a non-admin browser never instantiates the cards
 * and therefore never fires their admin-only GET requests.
 *
 * Also hosts the two tiny presentation helpers (CardSpinner / ErrorBanner)
 * the five cards share; they import them from here. The resulting
 * section->card->section import cycle is safe: both helpers are hoisted
 * function declarations only referenced at render time.
 */
import type { ReactNode } from 'react';
import { tf } from '../../lib/i18n';
import EmailNotificationsCard from './orgcards/EmailNotificationsCard';
import PasswordPolicyCard from './orgcards/PasswordPolicyCard';
import SmtpSettingsCard from './orgcards/SmtpSettingsCard';
import SelfRegistrationCard from './orgcards/SelfRegistrationCard';
import OrgLocaleCard from './orgcards/OrgLocaleCard';

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
export function ErrorBanner({ children }: { children: ReactNode }) {
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

export function OrgPoliciesSection() {
  return (
    <>
      <h2 className="stitle" style={{ marginTop: '8px' }}>
        {tf('app.administration.orgPolicies.title', '组织策略（管理员）')}
      </h2>
      <div className="ssub">
        {tf(
          'app.administration.orgPolicies.subtitle',
          '面向全组织的邮件通知与密码生成策略。这些设置仅管理员可见。',
        )}
      </div>

      <EmailNotificationsCard />
      <PasswordPolicyCard />
      <SmtpSettingsCard />
      <SelfRegistrationCard />
      <OrgLocaleCard />
    </>
  );
}

export default OrgPoliciesSection;

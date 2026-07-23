/**
 * My Profile workspace — the account hub, rebuilt on official Passbolt's
 * information architecture: a back bar (← vault), a GROUPED left section menu,
 * and the selected section on the right.
 *
 * Sections are selected via the ?section= search param inside the hash route
 * (#/profile?section=keys) so deep links and refreshes land on the right one.
 * The legacy ?tab=profile|security|account values are still understood and
 * mapped onto their nearest section, so old links keep working.
 *
 * Two groups:
 *   "My account"  profile · keys · passphrase · security token · theme · MFA
 *   "Organization" (admins only) — email · password policy · SMTP ·
 *                 self-registration · locale · org MFA · encrypted metadata ·
 *                 server info
 *
 * Deliberately NOT offered: official's "Mobile setup" and "Desktop app setup"
 * sections. Both exist only to pair an official Passbolt app that has no
 * JPassbolt counterpart; a QR code that pairs with nothing is a broken promise,
 * not a feature.
 *
 * Admin gating: role comes from GET /users/me.json over the API_CALL
 * pass-through (network truth, never a cached blob). The org section group is
 * not merely hidden for non-admins — it never mounts, so its admin-only GET
 * requests are never issued.
 */
import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type ComponentType,
  type ReactNode,
} from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import {
  ArrowLeft,
  Fingerprint,
  Globe,
  KeyRound,
  KeySquare,
  Mail,
  Moon,
  Server,
  ShieldCheck,
  ShieldQuestion,
  UserCog,
  UserPlus,
  type LucideProps,
} from 'lucide-react';
import { Spinner } from '../../../ui/components';
import { t } from '../../../shared/i18n';
import { describeApiError } from '../../lib/errors';
import { getMe } from '../../services/profile';
import type { User } from '../../../shared/types';
import { EncryptedMetadataPanel } from '../metadata';
import { ErrorBanner, SectionHeader } from './cardKit';
import { ProfileTab } from './ProfileTab';
import { KeysTab } from './KeysTab';
import { PassphraseTab } from './PassphraseTab';
import { SecurityTokenTab } from './SecurityTokenTab';
import { ThemeTab } from './ThemeTab';
import { SecurityTab } from './SecurityTab';
import EmailNotificationsCard from './orgcards/EmailNotificationsCard';
import PasswordPolicyCard from './orgcards/PasswordPolicyCard';
import SmtpSettingsCard from './orgcards/SmtpSettingsCard';
import SelfRegistrationCard from './orgcards/SelfRegistrationCard';
import OrgLocaleCard from './orgcards/OrgLocaleCard';
import OrgMfaCard from './orgcards/OrgMfaCard';
import ServerInfoCard from './orgcards/ServerInfoCard';

// ---------------------------------------------------------------------------
// Section registry
// ---------------------------------------------------------------------------
type SectionId =
  // "My account"
  | 'profile'
  | 'keys'
  | 'passphrase'
  | 'security-token'
  | 'theme'
  | 'mfa'
  // "Organization" (admin)
  | 'org-email'
  | 'org-password'
  | 'org-smtp'
  | 'org-selfreg'
  | 'org-locale'
  | 'org-mfa'
  | 'org-metadata'
  | 'org-server';

interface SectionDef {
  id: SectionId;
  labelKey: string;
  icon: ComponentType<LucideProps>;
}

const ACCOUNT_SECTIONS: SectionDef[] = [
  { id: 'profile', labelKey: 'app.settings.nav.profile', icon: UserCog },
  { id: 'keys', labelKey: 'app.settings.nav.keys', icon: Fingerprint },
  { id: 'passphrase', labelKey: 'app.settings.nav.passphrase', icon: KeyRound },
  { id: 'security-token', labelKey: 'app.settings.nav.securityToken', icon: ShieldQuestion },
  { id: 'theme', labelKey: 'app.settings.nav.theme', icon: Moon },
  { id: 'mfa', labelKey: 'app.settings.nav.mfa', icon: ShieldCheck },
];

const ORG_SECTIONS: SectionDef[] = [
  { id: 'org-email', labelKey: 'app.settings.nav.orgEmail', icon: Mail },
  { id: 'org-password', labelKey: 'app.settings.nav.orgPassword', icon: KeySquare },
  { id: 'org-smtp', labelKey: 'app.settings.nav.orgSmtp', icon: Server },
  { id: 'org-selfreg', labelKey: 'app.settings.nav.orgSelfReg', icon: UserPlus },
  { id: 'org-locale', labelKey: 'app.settings.nav.orgLocale', icon: Globe },
  { id: 'org-mfa', labelKey: 'app.settings.nav.orgMfa', icon: ShieldCheck },
  { id: 'org-metadata', labelKey: 'app.settings.nav.orgMetadata', icon: KeyRound },
  { id: 'org-server', labelKey: 'app.settings.nav.orgServer', icon: Server },
];

const ACCOUNT_IDS = new Set<string>(ACCOUNT_SECTIONS.map((s) => s.id));
const ORG_IDS = new Set<string>(ORG_SECTIONS.map((s) => s.id));

const DEFAULT_SECTION: SectionId = 'profile';

/** Legacy ?tab= values from the three-tab era, mapped onto their new section. */
const LEGACY_TAB_TO_SECTION: Record<string, SectionId> = {
  profile: 'profile',
  security: 'mfa',
  account: 'keys',
};

/**
 * Resolve the section to render. An org section requested by a non-admin (stale
 * link, revoked role) falls back to the default rather than rendering a panel
 * whose requests the server would reject.
 */
function resolveSection(raw: string | null, legacyTab: string | null, isAdmin: boolean): SectionId {
  const candidate = raw ?? (legacyTab ? LEGACY_TAB_TO_SECTION[legacyTab] : undefined);
  if (!candidate) return DEFAULT_SECTION;
  if (ACCOUNT_IDS.has(candidate)) return candidate as SectionId;
  if (ORG_IDS.has(candidate)) return isAdmin ? (candidate as SectionId) : DEFAULT_SECTION;
  return DEFAULT_SECTION;
}

// ---------------------------------------------------------------------------
// Admin section bodies. Each org card renders its own .scard, so the section
// supplies the heading the card lacks.
// ---------------------------------------------------------------------------
function OrgSection({
  titleKey,
  subtitleKey,
  children,
}: {
  titleKey: string;
  subtitleKey?: string;
  children: ReactNode;
}) {
  return (
    <>
      <SectionHeader title={t(titleKey)} subtitle={subtitleKey ? t(subtitleKey) : undefined} />
      {children}
    </>
  );
}

export default function SettingsPage() {
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();

  const [me, setMe] = useState<User | null>(null);
  const [meLoading, setMeLoading] = useState(true);
  const [meError, setMeError] = useState<string | null>(null);

  // t() reads a module-level locale cache; when the language card switches the
  // language, re-render this whole page tree off the storage change signal
  // (shared/i18n's own listener updates the cache in the same event).
  const [, setLocaleTick] = useState(0);
  useEffect(() => {
    const onChanged = (
      changes: Record<string, chrome.storage.StorageChange>,
      area: string,
    ) => {
      if (area === 'local' && changes['jpb_locale']) setLocaleTick((v) => v + 1);
    };
    chrome.storage?.onChanged?.addListener(onChanged);
    return () => chrome.storage?.onChanged?.removeListener(onChanged);
  }, []);

  const loadMe = useCallback(async () => {
    setMeLoading(true);
    setMeError(null);
    try {
      setMe(await getMe());
    } catch (err: unknown) {
      setMeError(describeApiError(err));
    } finally {
      setMeLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadMe();
  }, [loadMe]);

  const isAdmin = me?.role?.name === 'admin';

  const section = resolveSection(params.get('section'), params.get('tab'), isAdmin);
  const setSection = (next: SectionId) =>
    setParams(next === DEFAULT_SECTION ? {} : { section: next }, { replace: true });

  const groups = useMemo(
    () =>
      [
        { labelKey: 'app.settings.nav.groups.account', items: ACCOUNT_SECTIONS },
        ...(isAdmin
          ? [{ labelKey: 'app.settings.nav.groups.organization', items: ORG_SECTIONS }]
          : []),
      ] as const,
    [isAdmin],
  );

  return (
    <div className="profile-workspace">
      {/* Back bar — official's "← <workspace>" affordance. */}
      <div className="backbar">
        <button type="button" className="backbtn" onClick={() => navigate('/')}>
          <ArrowLeft size={17} /> {t('app.settings.backToVault')}
        </button>
      </div>

      <div className="slayout">
        {/* Left grouped section menu */}
        <nav className="snav" aria-label={t('app.settings.nav.heading')}>
          {groups.map(({ labelKey, items }) => (
            <div key={labelKey}>
              <div className="snav-label">{t(labelKey)}</div>
              {items.map(({ id, labelKey: itemKey, icon: Icon }) => (
                <button
                  key={id}
                  type="button"
                  className={`snav-item${section === id ? ' on' : ''}`}
                  aria-current={section === id ? 'page' : undefined}
                  onClick={() => setSection(id)}
                >
                  <Icon /> {t(itemKey)}
                </button>
              ))}
            </div>
          ))}
        </nav>

        {/* Right content */}
        <div className="scontent">
          <div className="scontent-inner">
            {meLoading ? (
              <Spinner label={t('app.settings.loadingAccount')} />
            ) : meError ? (
              <ErrorBanner>{meError}</ErrorBanner>
            ) : me ? (
              <SectionBody section={section} me={me} onProfileSaved={loadMe} />
            ) : null}
          </div>
        </div>
      </div>
    </div>
  );
}

function SectionBody({
  section,
  me,
  onProfileSaved,
}: {
  section: SectionId;
  me: User;
  onProfileSaved: () => void | Promise<void>;
}) {
  switch (section) {
    // ---- My account -------------------------------------------------------
    case 'profile':
      return <ProfileTab me={me} onSaved={onProfileSaved} />;
    case 'keys':
      return <KeysTab me={me} />;
    case 'passphrase':
      return <PassphraseTab />;
    case 'security-token':
      return <SecurityTokenTab />;
    case 'theme':
      return <ThemeTab />;
    case 'mfa':
      return <SecurityTab />;

    // ---- Organization (only reachable when resolveSection saw isAdmin) -----
    case 'org-email':
      return (
        <OrgSection
          titleKey="app.administration.orgPolicies.emails.title"
          subtitleKey="app.administration.orgPolicies.emails.subtitle"
        >
          <EmailNotificationsCard />
        </OrgSection>
      );
    case 'org-password':
      return (
        <OrgSection
          titleKey="app.administration.orgPolicies.password.title"
          subtitleKey="app.administration.orgPolicies.password.subtitle"
        >
          <PasswordPolicyCard />
        </OrgSection>
      );
    case 'org-smtp':
      return (
        <OrgSection
          titleKey="app.administration.smtp.title"
          subtitleKey="app.administration.smtp.subtitle"
        >
          <SmtpSettingsCard />
        </OrgSection>
      );
    case 'org-selfreg':
      return (
        <OrgSection
          titleKey="app.administration.selfReg.title"
          subtitleKey="app.administration.selfReg.subtitle"
        >
          <SelfRegistrationCard />
        </OrgSection>
      );
    case 'org-locale':
      return (
        <OrgSection
          titleKey="app.administration.orgLocale.title"
          subtitleKey="app.administration.orgLocale.subtitle"
        >
          <OrgLocaleCard />
        </OrgSection>
      );
    case 'org-mfa':
      return (
        <OrgSection
          titleKey="app.settings.account.orgMfa.title"
          subtitleKey="app.settings.orgMfa.subtitle"
        >
          <OrgMfaCard />
        </OrgSection>
      );
    case 'org-metadata':
      return <EncryptedMetadataPanel />;
    case 'org-server':
      return (
        <OrgSection
          titleKey="app.settings.account.server.title"
          subtitleKey="app.settings.server.subtitle"
        >
          <ServerInfoCard />
        </OrgSection>
      );
  }
}

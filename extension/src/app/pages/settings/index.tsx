/**
 * Settings — self-service account hub (ported from SPA pages/Settings.tsx).
 *
 * Three sections, selected via the ?tab= search param inside the hash route
 * (#/settings?tab=profile|security|account) so deep links and refreshes land on
 * the right tab:
 *
 *   1. profile  — identity form + appearance/language/local-security card.
 *   2. security — per-user TOTP MFA with a client-side QR (see qr.ts).
 *   3. account  — GPG key card (KEY_INFO RPC), read-only server settings,
 *                 admin org MFA toggle + org policies section, sign out.
 *
 * Admin gating: role comes from GET /users/me.json over the API_CALL
 * pass-through (network truth, never a cached blob).
 */
import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { useSearchParams } from 'react-router-dom';
import { AlertTriangle, Server, ShieldCheck, User as UserIcon } from 'lucide-react';
import { Spinner } from '../../../ui/components';
import { t } from '../../../shared/i18n';
import { describeApiError } from '../../lib/errors';
import { getMe } from '../../services/profile';
import type { User } from '../../../shared/types';
import { AppearanceCard, ProfileTab } from './ProfileTab';
import { SecurityTab } from './SecurityTab';
import { AccountTab } from './AccountTab';

/** Red warning box shared by every tab (SPA ErrorBanner on the .warnbox kit). */
export function ErrorBanner({ children }: { children: ReactNode }) {
  return (
    <div className="warnbox">
      <AlertTriangle size={18} />
      <span>{children}</span>
    </div>
  );
}

type Tab = 'profile' | 'security' | 'account';

const TABS: { id: Tab; labelKey: string; icon: typeof UserIcon }[] = [
  { id: 'profile', labelKey: 'app.settings.tabs.profile', icon: UserIcon },
  { id: 'security', labelKey: 'app.settings.tabs.security', icon: ShieldCheck },
  { id: 'account', labelKey: 'app.settings.tabs.account', icon: Server },
];

export default function SettingsPage() {
  const [params, setParams] = useSearchParams();
  const rawTab = params.get('tab');
  const tab: Tab = rawTab === 'security' || rawTab === 'account' ? rawTab : 'profile';
  const setTab = (next: Tab) =>
    setParams(next === 'profile' ? {} : { tab: next }, { replace: true });

  const [me, setMe] = useState<User | null>(null);
  const [meLoading, setMeLoading] = useState(true);
  const [meError, setMeError] = useState<string | null>(null);

  // t() reads a module-level locale cache; when the AppearanceCard switches the
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

  return (
    <div className="slayout">
      {/* Left settings nav */}
      <div className="snav">
        <div className="snav-label">{t('app.settings.nav.heading')}</div>
        {TABS.map(({ id, labelKey, icon: Icon }) => (
          <button
            key={id}
            type="button"
            className={`snav-item${tab === id ? ' on' : ''}`}
            onClick={() => setTab(id)}
          >
            <Icon /> {t(labelKey)}
          </button>
        ))}
      </div>

      {/* Right content */}
      <div className="scontent">
        <div className="scontent-inner">
          {meLoading ? (
            <Spinner label={t('app.settings.loadingAccount')} />
          ) : meError ? (
            <ErrorBanner>{meError}</ErrorBanner>
          ) : (
            <>
              {tab === 'profile' && me && (
                <>
                  <ProfileTab me={me} onSaved={loadMe} />
                  <AppearanceCard />
                </>
              )}
              {tab === 'security' && <SecurityTab />}
              {tab === 'account' && me && <AccountTab me={me} isAdmin={isAdmin} />}
            </>
          )}
        </div>
      </div>
    </div>
  );
}

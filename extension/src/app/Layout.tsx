/**
 * App shell (Aegis) — ported from the SPA components/Layout.tsx: a 60px icon
 * nav rail (logo + primary nav + theme toggle + avatar menu) and a main column
 * with a top bar (page title + immediate-lock button) hosting the router
 * Outlet.
 *
 * Differences from the SPA version, by design:
 *   - No LockPill/idle countdown: the background service worker owns the idle
 *     lock (state.ts armLock alarm); authenticated API_CALL activity re-arms it.
 *   - Admin rail entry resolves from the NETWORK role via the API_CALL
 *     pass-through (GET /users/me.json) — never from any cached blob.
 *   - Theme is a chrome.storage.local switch (jpb_theme) applied to
 *     <html data-theme>, shared with any future options-page toggle.
 */
import { useEffect, useMemo, useState, type ComponentType } from 'react';
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import {
  KeyRound,
  Lock,
  LogOut,
  Moon,
  Settings,
  SlidersHorizontal,
  Sun,
  User,
  Users,
  Vault,
  type LucideProps,
} from 'lucide-react';
import { rpc, type StatusResult } from '../shared/messages';
import { api } from './lib/api';
import { tf } from './lib/i18n';
import { avatarColorOf } from './components/Avatar';
import type { ApiResponse as ApiBody, User as ApiUser } from '../shared/types';

const THEME_KEY = 'jpb_theme';

interface NavItem {
  label: () => string;
  path: string;
  icon: ComponentType<LucideProps>;
}

/** Primary navigation, icon-only in the Aegis rail (tooltips carry the label). */
const NAV_ITEMS: NavItem[] = [
  { label: () => tf('app.common.nav.vault', '密码库'), path: '/', icon: Vault },
  { label: () => tf('app.common.nav.users', '用户'), path: '/users', icon: User },
  { label: () => tf('app.common.nav.groups', '组'), path: '/groups', icon: Users },
  { label: () => tf('app.common.nav.settings', '设置'), path: '/settings', icon: Settings },
];

/**
 * Admin-only rail entry for the encrypted-metadata config panel. Appended only
 * once the network role check confirms admin; the page itself also self-gates.
 */
const ADMIN_NAV_ITEM: NavItem = {
  label: () => tf('app.common.nav.encryptedMetadata', '加密元数据'),
  path: '/settings/encrypted-metadata',
  icon: KeyRound,
};

/** Route → topbar title, matching the Aegis design crumbs. */
function titleFor(pathname: string): string {
  const all = [...NAV_ITEMS, ADMIN_NAV_ITEM];
  const hit =
    all.find((n) => n.path === pathname) ??
    // longest non-root prefix match (e.g. /settings/encrypted-metadata handled
    // above; unknown /settings?tab=… style subpaths fall back to their section)
    all
      .filter((n) => n.path !== '/' && pathname.startsWith(n.path))
      .sort((a, b) => b.path.length - a.path.length)[0];
  return hit ? hit.label() : NAV_ITEMS[0].label();
}

function initialsOf(account: StatusResult['account']): string {
  const full = (account?.fullName ?? '').trim();
  if (full) {
    const parts = full.split(/\s+/).filter(Boolean);
    if (parts.length >= 2) return `${parts[0].charAt(0)}${parts[1].charAt(0)}`.toUpperCase();
  }
  const n = (full || account?.username || '').trim();
  if (!n) return 'U';
  const parts = n.split(/[\s@._-]+/).filter(Boolean);
  if (parts.length >= 2) return `${parts[0].charAt(0)}${parts[1].charAt(0)}`.toUpperCase();
  return n.slice(0, 2).toUpperCase();
}

export function AppLayout({
  status,
  onStatus,
}: {
  status: StatusResult;
  onStatus: (s: StatusResult) => void;
}) {
  const navigate = useNavigate();
  const location = useLocation();
  const [avMenu, setAvMenu] = useState(false);

  const account = status.account;
  const displayName = account?.fullName || account?.username || 'Account';
  const initials = initialsOf(account);
  const avatarColor = avatarColorOf(account?.username ?? displayName);

  // ---- theme (html[data-theme], persisted in chrome.storage.local) ---------
  const [theme, setTheme] = useState<'light' | 'dark'>(
    document.documentElement.dataset.theme === 'dark' ? 'dark' : 'light',
  );
  useEffect(() => {
    void chrome.storage?.local?.get(THEME_KEY).then((o) => {
      const stored = o?.[THEME_KEY] === 'dark' ? 'dark' : 'light';
      document.documentElement.dataset.theme = stored;
      setTheme(stored);
    });
  }, []);
  const toggleTheme = () => {
    const next = theme === 'dark' ? 'light' : 'dark';
    document.documentElement.dataset.theme = next;
    setTheme(next);
    void chrome.storage?.local?.set({ [THEME_KEY]: next });
  };

  // ---- admin rail entry from the network role ------------------------------
  const [isAdmin, setIsAdmin] = useState(false);
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await api.get<ApiBody<ApiUser>>('/users/me.json');
        if (!cancelled) setIsAdmin(res.data.body?.role?.name === 'admin');
      } catch {
        if (!cancelled) setIsAdmin(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const navItems = useMemo(
    () => (isAdmin ? [...NAV_ITEMS, ADMIN_NAV_ITEM] : NAV_ITEMS),
    [isAdmin],
  );

  const lock = async () => onStatus(await rpc({ type: 'LOCK' }));
  const logout = async () => onStatus(await rpc({ type: 'LOGOUT' }));

  return (
    <div className="app">
      <div className="rail">
        <div className="rail-logo" title="JPassbolt">
          <Vault />
        </div>
        {navItems.map(({ label, path, icon: Icon }) => (
          <NavLink
            key={path}
            to={path}
            end={path === '/'}
            title={label()}
            className={({ isActive }) => `rail-btn${isActive ? ' active' : ''}`}
          >
            <Icon />
          </NavLink>
        ))}
        <div className="rail-spacer" />
        <button
          className="rail-btn"
          title={
            theme === 'dark'
              ? tf('app.common.nav.toLight', '切换到浅色')
              : tf('app.common.nav.toDark', '切换到深色')
          }
          onClick={toggleTheme}
          type="button"
        >
          {theme === 'dark' ? <Sun /> : <Moon />}
        </button>
        <div style={{ position: 'relative' }}>
          <button
            className="rail-avatar"
            style={{ background: avatarColor }}
            title={displayName}
            onClick={() => setAvMenu((v) => !v)}
            type="button"
          >
            {initials}
          </button>
          {avMenu && (
            <div className="menu avatar-menu" onMouseLeave={() => setAvMenu(false)}>
              <button
                type="button"
                onClick={() => {
                  setAvMenu(false);
                  navigate('/settings');
                }}
              >
                <User /> {tf('app.common.nav.profile', '个人资料')}
              </button>
              <button
                type="button"
                onClick={() => {
                  setAvMenu(false);
                  void chrome.runtime.openOptionsPage();
                }}
              >
                <SlidersHorizontal /> {tf('app.common.nav.extensionOptions', '扩展选项')}
              </button>
              <button
                type="button"
                onClick={() => {
                  setAvMenu(false);
                  void lock();
                }}
              >
                <Lock /> {tf('app.common.nav.lockVault', '锁定密码库')}
              </button>
              <div className="sep" />
              <button type="button" className="danger" onClick={() => void logout()}>
                <LogOut /> {tf('app.common.nav.logout', '退出登录')}
              </button>
            </div>
          )}
        </div>
      </div>

      <div className="main">
        <div className="topbar">
          <h1>{titleFor(location.pathname)}</h1>
          <div className="topbar-spacer" />
          <button
            className="tb-btn tb-lock"
            title={tf('app.shell.lock.now', '立即锁定')}
            onClick={() => void lock()}
            type="button"
          >
            <Lock />
          </button>
        </div>

        <div className="main-scroll">
          <Outlet />
        </div>
      </div>
    </div>
  );
}

export default AppLayout;

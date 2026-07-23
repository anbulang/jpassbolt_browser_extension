/**
 * App shell (Aegis) — a 60px icon nav rail (logo + primary nav + theme toggle)
 * and a main column whose top bar carries the page title, the immediate-lock
 * button and the account menu, hosting the router Outlet.
 *
 * Differences from the SPA version, by design:
 *   - No LockPill/idle countdown: the background service worker owns the idle
 *     lock (state.ts armLock alarm); authenticated API_CALL activity re-arms it.
 *   - Theme is a chrome.storage.local switch (jpb_theme) applied to
 *     <html data-theme>, shared with any future options-page toggle.
 *
 * Identity: GET /users/me.json over the API_CALL pass-through is the ONE source
 * of truth for both the admin check and what the account menu shows (avatar,
 * full name, email) — never a cached blob. The StatusResult account is used
 * only as a pre-fetch placeholder so the top bar never renders nameless. The
 * account entry lives in the top bar (official Passbolt's position) instead of
 * at the foot of the rail, so the user's name and email are always on screen.
 */
import { useEffect, useRef, useState, type ComponentType } from 'react';
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import {
  ChevronDown,
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
import { joinName } from '../shared/names';
import { Avatar } from './components/Avatar';
import { avatarUrl } from './services/profile';
import { getServerSettings } from './services/settings';
import type { ApiResponse as ApiBody, User as ApiUser } from '../shared/types';

const THEME_KEY = 'jpb_theme';

/**
 * 只放行 http/https 的法务链接 URL,其余(javascript:/data: 等伪协议或解析失败)
 * 一律返回空串,由页脚的 (terms || privacy) 门控自动隐藏。防止被攻陷的管理员在
 * organization_settings 里把 terms.url 设成 javascript: 伪协议造成 iframe 内 XSS。
 */
function safeHttpUrl(raw: unknown): string {
  if (typeof raw !== 'string') return '';
  const s = raw.trim();
  if (!s) return '';
  try {
    const u = new URL(s, window.location.origin);
    return u.protocol === 'http:' || u.protocol === 'https:' ? u.href : '';
  } catch {
    return '';
  }
}

interface NavItem {
  label: () => string;
  path: string;
  icon: ComponentType<LucideProps>;
  /** Extra pathnames that should also light this entry up (legacy aliases). */
  alsoMatch?: string[];
}

/** Primary navigation, icon-only in the Aegis rail (tooltips carry the label). */
const NAV_ITEMS: NavItem[] = [
  { label: () => tf('app.common.nav.vault', '密码库'), path: '/', icon: Vault },
  { label: () => tf('app.common.nav.users', '用户'), path: '/users', icon: User },
  { label: () => tf('app.common.nav.groups', '组'), path: '/groups', icon: Users },
  {
    label: () => tf('app.common.nav.settings', '设置'),
    path: '/profile',
    icon: Settings,
    // '/settings' is the legacy alias of the same page (see routes.tsx).
    alsoMatch: ['/settings'],
  },
];

/**
 * Routes that carry a topbar title but no rail entry. The encrypted-metadata
 * panel is now a section of the settings page's admin group; its standalone
 * route stays reachable (old links, direct navigation) but no longer competes
 * for a rail slot.
 */
const TITLE_ONLY_ROUTES: { label: () => string; path: string }[] = [
  {
    label: () => tf('app.common.nav.encryptedMetadata', '加密元数据'),
    path: '/settings/encrypted-metadata',
  },
];

/** Route → topbar title, matching the Aegis design crumbs. */
function titleFor(pathname: string): string {
  const all = [
    ...NAV_ITEMS.flatMap((n) => [
      { label: n.label, path: n.path },
      ...(n.alsoMatch ?? []).map((path) => ({ label: n.label, path })),
    ]),
    ...TITLE_ONLY_ROUTES,
  ];
  const hit =
    all.find((n) => n.path === pathname) ??
    // longest non-root prefix match (e.g. unknown /settings/... subpaths fall
    // back to their section)
    all
      .filter((n) => n.path !== '/' && pathname.startsWith(n.path))
      .sort((a, b) => b.path.length - a.path.length)[0];
  return hit ? hit.label() : NAV_ITEMS[0].label();
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

  // Dismiss the account menu on outside click / Escape — the same idiom the
  // folder row menus use (pages/vault/FolderTree.tsx). Deliberately NOT
  // onMouseLeave: the menu is absolutely positioned below the trigger, so the
  // pointer leaves the wrapper's box on the way down and the menu would vanish
  // before any item could be clicked.
  const userMenuRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (!avMenu) return;
    const onDocDown = (e: MouseEvent) => {
      if (userMenuRef.current && !userMenuRef.current.contains(e.target as Node)) {
        setAvMenu(false);
      }
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setAvMenu(false);
    };
    document.addEventListener('mousedown', onDocDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDocDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [avMenu]);

  // ---- identity from the network (also drives the admin check) -------------
  const [me, setMe] = useState<ApiUser | null>(null);
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await api.get<ApiBody<ApiUser>>('/users/me.json');
        if (!cancelled) setMe(res.data.body ?? null);
      } catch {
        if (!cancelled) setMe(null);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // ---- legal links (footer) from GET /settings.json --------------------------
  // 后端下发 passbolt.legal.terms.url / privacy_policy.url;未配置为空串。
  // 仅当对应 URL 非空才渲染页脚法务链接,两个都空则整块不显示。
  const [legal, setLegal] = useState<{ terms: string; privacy: string }>({ terms: '', privacy: '' });
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const settings = await getServerSettings();
        const legalNode = (settings.passbolt as { legal?: unknown } | undefined)?.legal as
          | { terms?: { url?: unknown }; privacy_policy?: { url?: unknown } }
          | undefined;
        const terms = safeHttpUrl(legalNode?.terms?.url);
        const privacy = safeHttpUrl(legalNode?.privacy_policy?.url);
        if (!cancelled) setLegal({ terms, privacy });
      } catch {
        if (!cancelled) setLegal({ terms: '', privacy: '' });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // Placeholder identity until /users/me.json lands, so the bar never flickers
  // through a nameless state.
  const account = status.account;
  const firstName = me?.profile?.first_name ?? null;
  const lastName = me?.profile?.last_name ?? null;
  const username = me?.username ?? account?.username ?? '';
  const displayName =
    joinName(firstName, lastName) ||
    account?.fullName ||
    username ||
    tf('app.common.nav.account', '账户');
  const avatarSrc = me ? avatarUrl(me, 'small') : null;

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

  const lock = async () => onStatus(await rpc({ type: 'LOCK' }));
  const logout = async () => onStatus(await rpc({ type: 'LOGOUT' }));

  return (
    <div className="app">
      <div className="rail">
        <div className="rail-logo" title="JPassbolt">
          <Vault />
        </div>
        {NAV_ITEMS.map(({ label, path, icon: Icon, alsoMatch }) => (
          <NavLink
            key={path}
            to={path}
            end={path === '/'}
            title={label()}
            className={({ isActive }) =>
              `rail-btn${isActive || alsoMatch?.includes(location.pathname) ? ' active' : ''}`
            }
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

          {/* Account entry: always-visible name + email, menu on click. */}
          <div className="topbar-user-wrap" ref={userMenuRef}>
            <button
              className={`topbar-user${avMenu ? ' open' : ''}`}
              onClick={() => setAvMenu((v) => !v)}
              aria-haspopup="menu"
              aria-expanded={avMenu}
              type="button"
            >
              <Avatar
                src={avatarSrc}
                firstName={firstName}
                lastName={lastName}
                name={username || displayName}
                size={28}
              />
              <span className="tu-text">
                <span className="tu-name">{displayName}</span>
                {username && <span className="tu-mail">{username}</span>}
              </span>
              <ChevronDown className="tu-caret" />
            </button>

            {avMenu && (
              <div className="menu user-menu" role="menu">
                {/* Non-interactive identity header, mirroring official's menu. */}
                <div className="menu-identity">
                  <Avatar
                    src={avatarSrc}
                    firstName={firstName}
                    lastName={lastName}
                    name={username || displayName}
                    size={38}
                  />
                  <div className="mi-text">
                    <div className="mi-name">{displayName}</div>
                    {username && <div className="mi-mail">{username}</div>}
                  </div>
                </div>
                <div className="sep" />
                <button
                  type="button"
                  role="menuitem"
                  onClick={() => {
                    setAvMenu(false);
                    navigate('/profile');
                  }}
                >
                  <User /> {tf('app.common.nav.profile', '个人资料')}
                </button>
                <button
                  type="button"
                  role="menuitem"
                  onClick={() => {
                    setAvMenu(false);
                    void chrome.runtime.openOptionsPage();
                  }}
                >
                  <SlidersHorizontal /> {tf('app.common.nav.extensionOptions', '扩展选项')}
                </button>
                <button
                  type="button"
                  role="menuitem"
                  onClick={() => {
                    setAvMenu(false);
                    void lock();
                  }}
                >
                  <Lock /> {tf('app.common.nav.lockVault', '锁定密码库')}
                </button>
                <div className="sep" />
                <button
                  type="button"
                  role="menuitem"
                  className="danger"
                  onClick={() => void logout()}
                >
                  <LogOut /> {tf('app.common.nav.logout', '退出登录')}
                </button>
              </div>
            )}
          </div>
        </div>

        <div className="main-scroll">
          <Outlet />
        </div>

        {/* 应用页脚:法务链接(条款/隐私)。仅在服务端配置了对应 URL 时渲染。
            样式用内联/复用现有变量,不改 aegis.css / jpb.css(归 P1)。 */}
        {(legal.terms || legal.privacy) && (
          <footer
            style={{
              display: 'flex',
              gap: 16,
              justifyContent: 'center',
              alignItems: 'center',
              padding: '10px 16px',
              fontSize: 12,
              color: 'var(--text-3)',
              borderTop: '1px solid var(--border)',
            }}
          >
            {legal.terms && (
              <a
                href={legal.terms}
                target="_blank"
                rel="noopener noreferrer"
                style={{ color: 'var(--text-3)' }}
              >
                {tf('app.common.footer.terms', '使用条款')}
              </a>
            )}
            {legal.privacy && (
              <a
                href={legal.privacy}
                target="_blank"
                rel="noopener noreferrer"
                style={{ color: 'var(--text-3)' }}
              >
                {tf('app.common.footer.privacy', '隐私政策')}
              </a>
            )}
          </footer>
        )}
      </div>
    </div>
  );
}

export default AppLayout;

/**
 * Theme section — the appearance half of the old AppearanceCard, plus the two
 * device-local security timers that have nowhere better to live.
 *
 * Split rationale (official parity): Passbolt's My Profile keeps the language
 * picker under "Profile" (Internationalisation) and gives "Theme" its own
 * section. The language card therefore stays in ProfileTab; theme moves here,
 * together with the auto-lock and clipboard-clear preferences — both are
 * this-device-only switches with no server counterpart, exactly like the theme.
 *
 * Storage-key contract with the BACKGROUND (UI writes, background reads):
 * minutes for the idle-lock alarm (0 = never re-arm → never idle-lock),
 * milliseconds for the copy auto-clear (0 = never clear). Defaults mirror the
 * background's built-ins (state.ts LOCK_MINUTES = 30, index.ts
 * CLIPBOARD_CLEAR_MS = 30_000).
 */
import { useEffect, useState } from 'react';
import { Moon, Timer } from 'lucide-react';
import { t } from '../../../shared/i18n';
import { setUserTheme } from '../../services/accountSettings';
import { SectionHeader } from './cardKit';

const LOCK_MINUTES_KEY = 'jpb_lock_minutes';
const CLIPBOARD_CLEAR_MS_KEY = 'jpb_clipboard_clear_ms';
const THEME_KEY = 'jpb_theme';

const LOCK_OPTIONS = [5, 15, 30, 60, 0] as const; // minutes
const BURN_OPTIONS = [0, 15, 30, 60] as const; // seconds shown; stored as ms

function lockLabel(minutes: number): string {
  switch (minutes) {
    case 5:
      return t('app.settings.appearance.idle.m5');
    case 15:
      return t('app.settings.appearance.idle.m15');
    case 30:
      return t('app.settings.appearance.idle.m30');
    case 60:
      return t('app.settings.appearance.idle.h1');
    default:
      return t('app.settings.appearance.idle.never');
  }
}

export function ThemeTab() {
  // Theme — same jpb_theme mechanism as the AppLayout rail toggle.
  const [theme, setTheme] = useState<'light' | 'dark'>(
    document.documentElement.dataset.theme === 'dark' ? 'dark' : 'light',
  );
  useEffect(() => {
    void chrome.storage?.local?.get(THEME_KEY).then((o) => {
      setTheme(o?.[THEME_KEY] === 'dark' ? 'dark' : 'light');
    });
  }, []);
  const onTheme = (next: 'light' | 'dark') => {
    setTheme(next);
    document.documentElement.dataset.theme = next;
    void chrome.storage?.local?.set({ [THEME_KEY]: next });
    setUserTheme(next).catch(() => {
      /* a failed backend sync must never block the toggle */
    });
  };

  // Auto-lock minutes + clipboard clear delay (background-owned timers).
  const [lockMinutes, setLockMinutes] = useState<number>(30);
  const [burnMs, setBurnMs] = useState<number>(30_000);
  useEffect(() => {
    void chrome.storage?.local?.get([LOCK_MINUTES_KEY, CLIPBOARD_CLEAR_MS_KEY]).then((o) => {
      if (typeof o?.[LOCK_MINUTES_KEY] === 'number') setLockMinutes(o[LOCK_MINUTES_KEY]);
      if (typeof o?.[CLIPBOARD_CLEAR_MS_KEY] === 'number') setBurnMs(o[CLIPBOARD_CLEAR_MS_KEY]);
    });
  }, []);
  const onLockMinutes = (minutes: number) => {
    setLockMinutes(minutes);
    void chrome.storage?.local?.set({ [LOCK_MINUTES_KEY]: minutes });
  };
  const onBurnMs = (ms: number) => {
    setBurnMs(ms);
    void chrome.storage?.local?.set({ [CLIPBOARD_CLEAR_MS_KEY]: ms });
  };

  return (
    <span style={{ display: 'contents' }}>
      <SectionHeader
        title={t('app.settings.theme.title')}
        subtitle={t('app.settings.theme.subtitle')}
      />

      <div className="scard">
        <div className="scard-h">
          <Moon />
          <h3>{t('app.settings.theme.card.title')}</h3>
        </div>
        <div className="srow">
          <div className="sk">
            <div className="label">{t('app.settings.appearance.theme.label')}</div>
            <div className="hint">{t('app.settings.appearance.theme.hint')}</div>
          </div>
          <div className="sv">
            <select
              className="sinput"
              value={theme}
              onChange={(e) => onTheme(e.target.value as 'light' | 'dark')}
              aria-label={t('app.settings.appearance.theme.label')}
            >
              <option value="light">{t('app.settings.appearance.theme.light')}</option>
              <option value="dark">{t('app.settings.appearance.theme.dark')}</option>
            </select>
          </div>
        </div>
      </div>

      <div className="scard">
        <div className="scard-h">
          <Timer />
          <h3>{t('app.settings.theme.local.title')}</h3>
        </div>

        {/* Auto-lock (background idle alarm) */}
        <div className="srow">
          <div className="sk">
            <div className="label">{t('app.settings.appearance.idle.label')}</div>
            <div className="hint">{t('app.settings.appearance.idle.hint')}</div>
          </div>
          <div className="sv">
            <select
              className="sinput"
              value={lockMinutes}
              onChange={(e) => onLockMinutes(Number(e.target.value))}
              aria-label={t('app.settings.appearance.idle.label')}
            >
              {LOCK_OPTIONS.map((minutes) => (
                <option key={minutes} value={minutes}>
                  {lockLabel(minutes)}
                </option>
              ))}
            </select>
          </div>
        </div>

        {/* Clipboard clear delay (background offscreen copy) */}
        <div className="srow">
          <div className="sk">
            <div className="label">{t('app.settings.appearance.burn.label')}</div>
            <div className="hint">{t('app.settings.appearance.burn.hint')}</div>
          </div>
          <div className="sv">
            <select
              className="sinput"
              value={burnMs}
              onChange={(e) => onBurnMs(Number(e.target.value))}
              aria-label={t('app.settings.appearance.burn.label')}
            >
              {BURN_OPTIONS.map((secs) => (
                <option key={secs} value={secs * 1000}>
                  {secs === 0
                    ? t('app.settings.appearance.burn.never')
                    : t('app.settings.appearance.burn.seconds', { count: secs })}
                </option>
              ))}
            </select>
          </div>
        </div>
      </div>
    </span>
  );
}

export default ThemeTab;

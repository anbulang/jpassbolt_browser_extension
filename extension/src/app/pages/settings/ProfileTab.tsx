/**
 * Profile tab (SPA Settings.tsx ProfileTab + AppearanceCard).
 *
 * ProfileTab: avatar + first/last name form (PUT /users/{uuid}.json — the
 * backend rejects the "me" alias on writes) + read-only username & role. Avatar
 * upload is intentionally omitted (no backend write endpoint exists).
 *
 * AppearanceCard: local preferences, adapted to the extension architecture —
 *   - language: shared/i18n setLocale (jpb_locale) + best-effort backend sync;
 *   - theme:    the extension's existing jpb_theme storage switch (same
 *               mechanism as app/Layout.tsx) + best-effort backend sync;
 *   - auto-lock / clipboard clear: written to the agreed chrome.storage.local
 *     keys below for the BACKGROUND to consume (the background owns both
 *     timers; this card only writes UI + key convention).
 * The SPA's density/reveal-duration prefs are dropped as a deliberate
 * simplification: density has no extension equivalent, and the vault panel's
 * reveal auto-relock is a fixed 30 s (SecretPanel REVEAL_SECS) instead of the
 * SPA's configurable prefs.revealSecs.
 */
import { useEffect, useState, type FormEvent } from 'react';
import { t, getLocale, setLocale, type Locale } from '../../../shared/i18n';
import { describeApiError } from '../../lib/errors';
import { useToast } from '../../lib/toast';
import { Avatar } from '../../components/Avatar';
import { Badge } from '../../components/Badge';
import { avatarUrl, updateOwnProfile } from '../../services/profile';
import { setUserLocale, setUserTheme } from '../../services/accountSettings';
import type { User } from '../../../shared/types';
import { ErrorBanner } from './index';

// ---------------------------------------------------------------------------
// Storage-key contract with the background (UI writes, background reads).
// Values: minutes for the idle-lock alarm (0 = never re-arm → never idle-lock),
// milliseconds for the copy auto-clear (0 = never clear). Defaults mirror the
// background's current built-ins (state.ts LOCK_MINUTES = 30, index.ts
// CLIPBOARD_CLEAR_MS = 30_000).
// ---------------------------------------------------------------------------
const LOCK_MINUTES_KEY = 'jpb_lock_minutes';
const CLIPBOARD_CLEAR_MS_KEY = 'jpb_clipboard_clear_ms';
const THEME_KEY = 'jpb_theme';

const LOCK_OPTIONS = [5, 15, 30, 60, 0] as const; // minutes
const BURN_OPTIONS = [0, 15, 30, 60] as const; // seconds shown; stored as ms

// ===========================================================================
// Profile form
// ===========================================================================
export function ProfileTab({
  me,
  onSaved,
}: {
  me: User;
  onSaved: () => void | Promise<void>;
}) {
  const toast = useToast();
  const [firstName, setFirstName] = useState(me.profile?.first_name ?? '');
  const [lastName, setLastName] = useState(me.profile?.last_name ?? '');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const dirty =
    firstName !== (me.profile?.first_name ?? '') ||
    lastName !== (me.profile?.last_name ?? '');

  const avatarSrc = avatarUrl(me, 'medium');

  const handleSave = async (e: FormEvent) => {
    e.preventDefault();
    if (!firstName.trim() || !lastName.trim()) {
      setError(t('app.settings.profile.nameRequired'));
      return;
    }
    setSaving(true);
    setError(null);
    try {
      await updateOwnProfile({
        first_name: firstName.trim(),
        last_name: lastName.trim(),
      });
      toast.success(t('app.settings.profile.updated'));
      await onSaved();
    } catch (err: unknown) {
      const msg = describeApiError(err);
      setError(msg);
      toast.error(msg);
    } finally {
      setSaving(false);
    }
  };

  return (
    <form onSubmit={handleSave} style={{ display: 'contents' }}>
      <h2 className="stitle">{t('app.settings.profile.title')}</h2>
      <div className="ssub">{t('app.settings.profile.subtitle')}</div>

      {error && (
        <div style={{ marginBottom: 18 }}>
          <ErrorBanner>{error}</ErrorBanner>
        </div>
      )}

      {/* Identity card */}
      <div className="scard">
        <div className="srow">
          <Avatar
            src={avatarSrc}
            firstName={me.profile?.first_name}
            lastName={me.profile?.last_name}
            name={me.username}
            size={56}
          />
          <div className="sk">
            <div className="label">
              {[me.profile?.first_name, me.profile?.last_name].filter(Boolean).join(' ') ||
                me.username}
            </div>
            <div className="hint">{t('app.settings.profile.avatarUnsupported')}</div>
          </div>
          <div className="sv">
            <Badge variant={me.role?.name === 'admin' ? 'primary' : 'default'}>
              {me.role?.name ?? t('app.settings.profile.roleFallback')}
            </Badge>
          </div>
        </div>

        <div className="srow">
          <div className="sk">
            <div className="label">{t('app.settings.profile.firstName')}</div>
          </div>
          <div className="sv">
            <input
              id="settings-first-name"
              className="sinput sans"
              value={firstName}
              onChange={(e) => setFirstName(e.target.value)}
              disabled={saving}
              autoComplete="given-name"
            />
          </div>
        </div>

        <div className="srow">
          <div className="sk">
            <div className="label">{t('app.settings.profile.lastName')}</div>
          </div>
          <div className="sv">
            <input
              id="settings-last-name"
              className="sinput sans"
              value={lastName}
              onChange={(e) => setLastName(e.target.value)}
              disabled={saving}
              autoComplete="family-name"
            />
          </div>
        </div>

        <div className="srow">
          <div className="sk">
            <div className="label">{t('app.settings.profile.username')}</div>
            <div className="hint">{t('app.settings.profile.usernameHint')}</div>
          </div>
          <div className="sv">
            <input
              className="sinput"
              value={me.username}
              readOnly
              disabled
              style={{ color: 'var(--text-3)' }}
            />
          </div>
        </div>
      </div>

      <div style={{ display: 'flex', gap: 12 }}>
        <button type="submit" className="btn primary" disabled={saving || !dirty}>
          {saving ? t('app.common.actions.saving') : t('app.settings.profile.save')}
        </button>
      </div>
    </form>
  );
}

// ===========================================================================
// Appearance & language card
// ===========================================================================
export function AppearanceCard() {
  // Language — instant local switch; backend sync is best-effort by contract.
  const [locale, setLocaleState] = useState<Locale>(getLocale());
  const onLocale = (value: Locale) => {
    setLocaleState(value);
    void setLocale(value);
    setUserLocale(value).catch(() => {
      /* a failed backend sync must never block the toggle */
    });
  };

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
      /* best-effort, like the locale sync */
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

  const lockLabel = (minutes: number): string => {
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
  };

  return (
    <span style={{ display: 'contents' }}>
      <h2 className="stitle">{t('app.settings.appearance.title')}</h2>
      <div className="ssub">{t('app.settings.appearance.subtitle')}</div>

      <div className="scard">
        {/* Language */}
        <div className="srow">
          <div className="sk">
            <div className="label">{t('app.settings.appearance.language.label')}</div>
            <div className="hint">{t('app.settings.appearance.language.hint')}</div>
          </div>
          <div className="sv">
            <select
              className="sinput"
              value={locale}
              onChange={(e) => onLocale(e.target.value as Locale)}
              aria-label={t('app.settings.appearance.language.label')}
            >
              <option value="zh">{t('app.settings.appearance.language.zh')}</option>
              <option value="en">{t('app.settings.appearance.language.en')}</option>
            </select>
          </div>
        </div>

        {/* Theme */}
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

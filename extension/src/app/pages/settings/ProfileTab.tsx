/**
 * Profile section — identity form + the Internationalisation (language) card,
 * mirroring official Passbolt's My Profile > Profile screen.
 *
 * ProfileTab: avatar + first/last name form (PUT /users/{uuid}.json — the
 * backend rejects the "me" alias on writes) + read-only username & role. Avatar
 * upload is intentionally omitted (no backend write endpoint exists).
 *
 * LanguageCard: shared/i18n setLocale (jpb_locale) + a best-effort backend sync.
 * The theme switch and the two device-local timers that used to share this file
 * as `AppearanceCard` now live in ThemeTab.tsx — official keeps language under
 * Profile and gives Theme its own section.
 */
import { useState, type FormEvent } from 'react';
import { Languages, UserCog } from 'lucide-react';
import { t, getLocale, setLocale, type Locale } from '../../../shared/i18n';
import { describeApiError } from '../../lib/errors';
import { useToast } from '../../lib/toast';
import { Avatar } from '../../components/Avatar';
import { Badge } from '../../components/Badge';
import { avatarUrl, updateOwnProfile } from '../../services/profile';
import { setUserLocale } from '../../services/accountSettings';
import { splitFullName, joinName } from '../../../shared/names';
import type { User } from '../../../shared/types';
import { ErrorBanner, SectionHeader } from './cardKit';

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
  // 单个「姓名」字段:回填时用 joinName 拼,提交时用 splitFullName 拆。
  const initialName = joinName(me.profile?.first_name, me.profile?.last_name);
  const [name, setName] = useState(initialName);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const dirty = name.trim() !== initialName;

  const avatarSrc = avatarUrl(me, 'medium');

  const handleSave = async (e: FormEvent) => {
    e.preventDefault();
    const profile = splitFullName(name);
    if (!profile.first_name || !profile.last_name) {
      setError(t('app.settings.profile.nameRequired'));
      return;
    }
    if (profile.first_name.length > 255 || profile.last_name.length > 255) {
      setError(t('app.settings.profile.nameTooLong'));
      return;
    }
    setSaving(true);
    setError(null);
    try {
      await updateOwnProfile(profile);
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
      <SectionHeader
        title={t('app.settings.profile.title')}
        subtitle={t('app.settings.profile.subtitle')}
      />

      {error && (
        <div style={{ marginBottom: 18 }}>
          <ErrorBanner>{error}</ErrorBanner>
        </div>
      )}

      {/* Identity card */}
      <div className="scard">
        <div className="scard-h">
          <UserCog />
          <h3>{t('app.settings.profile.card.title')}</h3>
        </div>

        <div className="srow">
          <Avatar
            src={avatarSrc}
            firstName={me.profile?.first_name}
            lastName={me.profile?.last_name}
            name={me.username}
            size={56}
          />
          <div className="sk">
            <div className="label">{initialName || me.username}</div>
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
            <div className="label">{t('app.settings.profile.name')}</div>
          </div>
          <div className="sv">
            <input
              id="settings-name"
              className="sinput sans"
              value={name}
              onChange={(e) => setName(e.target.value)}
              disabled={saving}
              autoComplete="name"
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

      <div style={{ display: 'flex', gap: 12, marginBottom: 18 }}>
        <button type="submit" className="btn primary" disabled={saving || !dirty}>
          {saving ? t('app.common.actions.saving') : t('app.settings.profile.save')}
        </button>
      </div>

      <LanguageCard />
    </form>
  );
}

// ===========================================================================
// Internationalisation (language) card — official parity: lives under Profile.
// ===========================================================================
export function LanguageCard() {
  // Instant local switch; the backend sync is best-effort by contract.
  const [locale, setLocaleState] = useState<Locale>(getLocale());
  const onLocale = (value: Locale) => {
    setLocaleState(value);
    void setLocale(value);
    setUserLocale(value).catch(() => {
      /* a failed backend sync must never block the toggle */
    });
  };

  return (
    <div className="scard">
      <div className="scard-h">
        <Languages />
        <h3>{t('app.settings.profile.i18n.title')}</h3>
      </div>
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
    </div>
  );
}

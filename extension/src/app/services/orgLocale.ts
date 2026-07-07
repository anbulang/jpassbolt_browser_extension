/**
 * Organization default locale transport — admin org-policies surface.
 *
 * Pure transport, mirrors selfRegistration.ts. The current value and the
 * selectable options both come from GET /settings.json (app.locale +
 * passbolt.plugins.locale.options); the write goes to the admin-gated
 * POST /locale/settings.json (backend OrganizationLocaleController), which
 * persists organization_settings(property='locale') — the very row the
 * settings index reads back.
 */
import { api } from '../lib/api';
import type { ApiResponse, ServerSettings } from '../../shared/types';

export interface LocaleOption {
  locale: string;
  label: string;
}

/** The saved organization_settings row, as rendered by the backend. */
export interface OrgLocaleSetting {
  id?: string;
  property?: string;
  value: string;
  created_by?: string;
  modified_by?: string;
}

/**
 * Fallback when the settings index carries no locale options (older backend):
 * the same list SettingsService/AccountLocaleService accept.
 */
export const FALLBACK_LOCALE_OPTIONS: LocaleOption[] = [
  { locale: 'de-DE', label: 'Deutsch' },
  { locale: 'en-UK', label: 'English' },
  { locale: 'es-ES', label: 'Español' },
  { locale: 'fr-FR', label: 'Français' },
  { locale: 'it-IT', label: 'Italiano (beta)' },
  { locale: 'ja-JP', label: '日本語' },
  { locale: 'ko-KR', label: '한국어 (beta)' },
  { locale: 'lt-LT', label: 'Lietuvių' },
  { locale: 'nl-NL', label: 'Nederlands' },
  { locale: 'pl-PL', label: 'Polski' },
  { locale: 'pt-BR', label: 'Português Brasil (beta)' },
  { locale: 'ro-RO', label: 'Română (beta)' },
  { locale: 'ru-RU', label: 'Pусский (beta)' },
  { locale: 'sv-SE', label: 'Svenska' },
  { locale: 'sl-SI', label: 'Slovenščina' },
  { locale: 'uk-UA', label: 'Українська' },
  { locale: 'cs-CZ', label: 'Čeština (beta)' },
  { locale: 'zh-CN', label: '中文' },
];

/** passbolt.plugins.locale.options from a GET /settings.json body. */
export function extractLocaleOptions(settings: ServerSettings): LocaleOption[] {
  const plugins = (settings.passbolt as Record<string, unknown> | undefined)?.plugins;
  const locale = (plugins as Record<string, unknown> | undefined)?.locale;
  const options = (locale as Record<string, unknown> | undefined)?.options;
  if (!Array.isArray(options)) return FALLBACK_LOCALE_OPTIONS;
  const parsed = options.filter(
    (o): o is LocaleOption =>
      !!o && typeof o === 'object'
      && typeof (o as LocaleOption).locale === 'string'
      && typeof (o as LocaleOption).label === 'string',
  );
  return parsed.length > 0 ? parsed : FALLBACK_LOCALE_OPTIONS;
}

/** app.locale from a GET /settings.json body (the current org default). */
export function extractOrgLocale(settings: ServerSettings): string | null {
  const app = settings.app as Record<string, unknown> | undefined;
  return typeof app?.locale === 'string' ? app.locale : null;
}

/** POST /locale/settings.json — set the organization default locale (admin only). */
export async function setOrganizationLocale(value: string): Promise<OrgLocaleSetting> {
  const res = await api.post<ApiResponse<OrgLocaleSetting>>('/locale/settings.json', { value });
  return (res.data.body ?? { value }) as OrgLocaleSetting;
}

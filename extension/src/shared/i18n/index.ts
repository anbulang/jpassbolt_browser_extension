/**
 * Runtime i18n layer for the JPassbolt browser extension (split edition).
 *
 * WHY NOT chrome.i18n: chrome.i18n is bound to the *browser UI* locale and
 * cannot be toggled at runtime to follow the user's JPassbolt account choice.
 * This module instead keeps two in-memory dictionaries (zh default, en) and a
 * single locale switch persisted in chrome.storage.local under `jpb_locale`.
 *
 * The dictionaries are assembled from dicts/*.ts: `core` owns the original
 * popup / options / content keys; `appcommon` the flattened SPA common / shell
 * / components namespaces; the remaining files are per-domain and filled by
 * their work packages. Later spreads win on key collision (documented, benign).
 *
 * Imported by every UI surface (popup / app / options), the autofill content
 * scripts, the background service worker and shared/messages helpers. `t()` is
 * synchronous: the active locale is read from a module-level cache primed once
 * at startup via `primeLocale()` (or lazily set by `setLocale`), so a render
 * never has to await storage. Default locale is Chinese; English is fallback.
 */
import type { Dict } from './types';
import * as core from './dicts/core';
import * as appcommon from './dicts/appcommon';
import * as vault from './dicts/vault';
import * as share from './dicts/share';
import * as users from './dicts/users';
import * as groups from './dicts/groups';
import * as settings from './dicts/settings';
import * as administration from './dicts/administration';
import * as metadata from './dicts/metadata';
import * as importexport from './dicts/importexport';
import * as auth from './dicts/auth';

export type Locale = 'zh' | 'en';
export type { Dict } from './types';

const STORAGE_KEY = 'jpb_locale';
const DEFAULT_LOCALE: Locale = 'zh';

// Module-level synchronous cache of the active locale. Defaults to Chinese so
// the very first render (before primeLocale resolves) is already Chinese.
let current: Locale = DEFAULT_LOCALE;
let primed = false;

/** Narrow an arbitrary stored value to a known Locale (fallback to default). */
function coerce(value: unknown): Locale {
  return value === 'en' || value === 'zh' ? value : DEFAULT_LOCALE;
}

/**
 * Prime the synchronous locale cache from chrome.storage.local once at startup.
 * Safe to call from any context (popup/app/options/content/background); if
 * chrome.storage is unavailable it leaves the default in place. Idempotent.
 */
export async function primeLocale(): Promise<Locale> {
  if (primed) return current;
  try {
    const o = await chrome.storage?.local?.get(STORAGE_KEY);
    if (o && o[STORAGE_KEY] != null) current = coerce(o[STORAGE_KEY]);
  } catch {
    /* storage unavailable — keep the default */
  }
  primed = true;
  return current;
}

// Kick off priming as a side effect of import so `t()` becomes correct shortly
// after load even if a caller forgets to await primeLocale(). The default
// (zh) is already correct for the synchronous window before this resolves.
void primeLocale();

// Keep the cache in sync if another context (e.g. the options page) changes the
// locale while this context is alive.
try {
  chrome.storage?.onChanged?.addListener((changes, area) => {
    if (area === 'local' && changes[STORAGE_KEY]) {
      current = coerce(changes[STORAGE_KEY].newValue);
    }
  });
} catch {
  /* not available in this context */
}

/** Current active locale (synchronous; defaults to 'zh' until primed). */
export function getLocale(): Locale {
  return current;
}

/** Persist and apply a new locale. Updates the cache immediately. */
export async function setLocale(locale: Locale): Promise<void> {
  current = coerce(locale);
  primed = true;
  try {
    await chrome.storage?.local?.set({ [STORAGE_KEY]: current });
  } catch {
    /* storage unavailable — the in-memory switch still applies for this context */
  }
}

// ---------------------------------------------------------------------------
// Dictionaries. Assembled from every dicts/*.ts module. Order matters only for
// duplicate keys: later modules win. core first (widest existing surface),
// then appcommon (shell), then the domain dicts.
// ---------------------------------------------------------------------------
const en: Dict = {
  ...core.en,
  ...appcommon.en,
  ...vault.en,
  ...share.en,
  ...users.en,
  ...groups.en,
  ...settings.en,
  ...administration.en,
  ...metadata.en,
  ...importexport.en,
  ...auth.en,
};

const zh: Dict = {
  ...core.zh,
  ...appcommon.zh,
  ...vault.zh,
  ...share.zh,
  ...users.zh,
  ...groups.zh,
  ...settings.zh,
  ...administration.zh,
  ...metadata.zh,
  ...importexport.zh,
  ...auth.zh,
};

const DICTS: Record<Locale, Dict> = { zh, en };

/**
 * Translate `key` for the active locale. Interpolates `{{var}}` placeholders
 * from `vars`. Resolution order: active dict -> English dict -> the key itself.
 */
export function t(key: string, vars?: Record<string, string | number>): string {
  const dict = DICTS[current];
  let template = dict[key];
  if (template == null) template = en[key];
  if (template == null) return key;
  if (!vars) return template;
  return template.replace(/\{\{(\w+)\}\}/g, (_m, name: string) =>
    name in vars ? String(vars[name]) : `{{${name}}}`,
  );
}

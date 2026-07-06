/**
 * `t()` with an inline fallback, for app-shell strings whose dictionary keys
 * (app.common.* / app.components.* — flattened from the SPA namespaces) are
 * filled by the i18n foundation step AFTER this shell lands. Until a key
 * exists, the fallback literal renders instead of the raw key; once the
 * dictionaries are populated, the dict entry (and locale switching) wins.
 */
import { t } from '../../shared/i18n';

export function tf(
  key: string,
  fallback: string,
  vars?: Record<string, string | number>,
): string {
  const resolved = t(key, vars);
  if (resolved !== key) return resolved;
  if (!vars) return fallback;
  return fallback.replace(/\{\{(\w+)\}\}/g, (m, name: string) =>
    name in vars ? String(vars[name]) : m,
  );
}

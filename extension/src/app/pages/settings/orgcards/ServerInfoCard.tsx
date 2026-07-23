/**
 * Server info card — read-only GET /settings.json, flattened to key/value rows.
 * Extracted verbatim from the retired AccountTab's ServerSettingsCard (minus
 * the org-MFA half, which now lives in its own section: OrgMfaCard).
 *
 * Readable by any authenticated user, so it needs no admin gate of its own; it
 * is filed under the admin section group purely because that is where an
 * operator looks for it.
 */
import { useEffect, useMemo, useState } from 'react';
import { Server } from 'lucide-react';
import { t } from '../../../../shared/i18n';
import { describeApiError } from '../../../lib/errors';
import { Spinner } from '../../../../ui/components';
import { getServerSettings } from '../../../services/settings';
import type { ServerSettings } from '../../../../shared/types';
import { ErrorBanner } from '../cardKit';

/** Flatten a (possibly nested) ServerSettings map into displayable key/value rows. */
function flattenSettings(
  obj: Record<string, unknown>,
  prefix = '',
): { key: string; value: string }[] {
  const rows: { key: string; value: string }[] = [];
  for (const [k, v] of Object.entries(obj)) {
    const key = prefix ? `${prefix}.${k}` : k;
    if (v == null) {
      rows.push({ key, value: '—' });
    } else if (Array.isArray(v)) {
      rows.push({ key, value: v.map((x) => stringifyScalar(x)).join(', ') || '[]' });
    } else if (typeof v === 'object') {
      rows.push(...flattenSettings(v as Record<string, unknown>, key));
    } else {
      rows.push({ key, value: stringifyScalar(v) });
    }
  }
  return rows;
}

function stringifyScalar(v: unknown): string {
  if (v == null) return '—';
  if (typeof v === 'object') {
    try {
      return JSON.stringify(v);
    } catch {
      return String(v);
    }
  }
  return String(v);
}

export function ServerInfoCard() {
  const [settings, setSettings] = useState<ServerSettings | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError(null);
      try {
        const s = await getServerSettings();
        if (!cancelled) setSettings(s);
      } catch (err: unknown) {
        if (!cancelled) setError(describeApiError(err));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const rows = useMemo(() => (settings ? flattenSettings(settings) : []), [settings]);

  return (
    <div className="scard">
      <div className="scard-h">
        <Server />
        <h3>{t('app.settings.account.server.title')}</h3>
      </div>

      <div style={{ padding: '15px 18px' }}>
        <div className="hint" style={{ marginBottom: rows.length ? 14 : 0 }}>
          {t('app.settings.account.server.readonly')}
        </div>

        {loading ? (
          <Spinner label={t('app.settings.account.server.loading')} />
        ) : error ? (
          <ErrorBanner>{error}</ErrorBanner>
        ) : rows.length === 0 ? (
          <div style={{ color: 'var(--text-3)', fontSize: '13.5px' }}>
            {t('app.settings.account.server.empty')}
          </div>
        ) : (
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
            <tbody>
              {rows.map(({ key, value }) => (
                <tr key={key} style={{ borderBottom: '1px solid var(--border)' }}>
                  <td
                    style={{
                      padding: '8px 12px 8px 0',
                      color: 'var(--text-2)',
                      whiteSpace: 'nowrap',
                      verticalAlign: 'top',
                      fontFamily: 'var(--mono)',
                    }}
                  >
                    {key}
                  </td>
                  <td
                    style={{
                      padding: '8px 0',
                      color: 'var(--text)',
                      wordBreak: 'break-word',
                      fontFamily: 'var(--mono)',
                    }}
                  >
                    {value}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}

export default ServerInfoCard;

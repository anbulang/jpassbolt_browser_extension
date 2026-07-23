/**
 * Encrypted-metadata admin page (WP-METADATA-ADMIN) — ported from the SPA
 * pages/EncryptedMetadataSettings.tsx. The only legitimately v5-labelled
 * surface in the app (everywhere else the v4/v5 format stays transparent).
 *
 * Self-gates on the NETWORK truth (GET /users/me.json role), never on any
 * cached blob, and fails CLOSED (treated as non-admin → redirect to `/` per
 * the migration blueprint; the server enforces admin on the POST endpoints
 * regardless). Pure API_CALL transport — no background handler, no crypto:
 * the page only reads/writes settings and lists key METADATA (fingerprints,
 * created, distribution counts).
 *
 * Types-settings writes deliberately do NOT notify the background: the
 * RESOURCE_SAVE handler re-fetches /metadata/types/settings.json on every
 * save, so the v4/v5 create decision always sees the fresh policy.
 *
 * Two entry points share one body:
 *   - MetadataPage (default)        the standalone /settings/encrypted-metadata
 *                                   route, with its own role gate + page chrome;
 *   - EncryptedMetadataPanel        the bare panel embedded as a section of the
 *                                   settings page's admin group, which supplies
 *                                   the chrome and has already gated on isAdmin.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Navigate } from 'react-router-dom';
import { getMe } from '../../services/profile';
import { listUsers } from '../../services/users';
import {
  getMetadataKeysSettings,
  getMetadataTypesSettings,
  listMetadataKeys,
} from '../../services/metadata';
import type {
  MetadataKey,
  MetadataKeysSettings,
  MetadataTypesSettings,
} from '../../../shared/types';
import { describeApiError } from '../../lib/errors';
import { tf } from '../../lib/i18n';
import {
  ErrorBanner,
  KeysSettingsSection,
  OrgKeysSection,
  TypesPolicySection,
} from './sections';

const M = 'app.settings.metadata';

type GateState = 'loading' | 'admin' | 'denied';

export default function MetadataPage() {
  const [gate, setGate] = useState<GateState>('loading');

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const me = await getMe();
        if (!cancelled) setGate(me.role?.name === 'admin' ? 'admin' : 'denied');
      } catch {
        // Fail closed (treat as non-admin) rather than leaking the page.
        if (!cancelled) setGate('denied');
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  if (gate === 'loading') {
    return (
      <div className="page">
        <div className="empty">
          <span className="spin-ring" style={{ width: 22, height: 22 }} />
          <p>{tf(`${M}.verifyingAccess`, '正在校验权限……')}</p>
        </div>
      </div>
    );
  }

  if (gate === 'denied') {
    return <Navigate to="/" replace />;
  }

  return (
    <div className="page">
      <div className="scontent" style={{ flex: 1 }}>
        <div className="scontent-inner" style={{ maxWidth: '720px' }}>
          <EncryptedMetadataPanel />
        </div>
      </div>
    </div>
  );
}

// ===========================================================================
// Admin panel — loads all three data sources, renders the three sections.
// Exported bare (no page/scontent chrome) so the settings page can host it as
// one of its admin sections; the caller is responsible for the admin gate.
// ===========================================================================
export function EncryptedMetadataPanel() {
  const [typesSettings, setTypesSettings] = useState<MetadataTypesSettings | null>(null);
  const [keysSettings, setKeysSettings] = useState<MetadataKeysSettings | null>(null);
  const [keys, setKeys] = useState<MetadataKey[]>([]);
  const [userCount, setUserCount] = useState<number | null>(null);

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [types, keysCfg, keyList] = await Promise.all([
        getMetadataTypesSettings(),
        getMetadataKeysSettings(),
        listMetadataKeys({ containPrivateKeys: true }),
      ]);
      setTypesSettings(types);
      setKeysSettings(keysCfg);
      setKeys(keyList);
      // User count is best-effort: it only feeds the distribution display.
      try {
        const users = await listUsers();
        setUserCount(users.length);
      } catch {
        setUserCount(null);
      }
    } catch (err: unknown) {
      setError(describeApiError(err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  /** An active metadata key exists when a row is neither expired nor deleted. */
  const hasActiveKey = useMemo(
    () => keys.some((k) => k.expired === null && k.deleted === null),
    [keys],
  );

  return (
    <>
      <h2 className="stitle">{tf(`${M}.title`, '加密元数据')}</h2>
      <p className="ssub">{tf(`${M}.subtitle`, '用于加密（v5）资源元数据的组织策略与密钥。')}</p>

      {loading ? (
        <div className="empty">
          <span className="spin-ring" style={{ width: 22, height: 22 }} />
          <p>{tf(`${M}.loading`, '正在加载加密元数据设置……')}</p>
        </div>
      ) : error ? (
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            gap: '14px',
            alignItems: 'flex-start',
          }}
        >
          <ErrorBanner>{error}</ErrorBanner>
          <button type="button" className="btn" onClick={() => void load()}>
            {tf('app.common.actions.retry', '重试')}
          </button>
        </div>
      ) : (
        <>
          {typesSettings && (
            <TypesPolicySection
              settings={typesSettings}
              hasActiveKey={hasActiveKey}
              onSaved={setTypesSettings}
            />
          )}
          {keysSettings && (
            <KeysSettingsSection settings={keysSettings} onSaved={setKeysSettings} />
          )}
          <OrgKeysSection keys={keys} userCount={userCount} />
        </>
      )}
    </>
  );
}

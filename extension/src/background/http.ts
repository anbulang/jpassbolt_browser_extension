/**
 * Background HTTP layer: Passbolt envelope handling, JWT attachment and the
 * 3-stage GpgAuth. Cross-origin note: fetches issued from the service worker to
 * hosts in host_permissions are privileged — all response headers (X-GPGAuth-*,
 * Authorization) are readable WITHOUT any server-side CORS exposure.
 *
 * Two call shapes coexist:
 *  - apiCall<T>()  — legacy: unwraps the envelope, returns body, THROWS on error
 *    (used by the pre-existing background paths and internal handlers);
 *  - apiCallRaw()  — full-envelope pass-through for the app UI's API_CALL RPC:
 *    non-2xx is RETURNED, not thrown, so the UI can read header.message /
 *    body.mfa_providers itself.
 */
import * as openpgp from 'openpgp';
import { t } from '../shared/i18n';
import type { ApiEnvelope, HttpMethod } from '../shared/messages';
import { K, del, get, lock } from './state';

interface Envelope<T> {
  header: { status: string; message: string; code: number };
  body: T | null;
}

export async function apiBase(): Promise<string> {
  const url = await get<string>(K.serverUrl);
  if (!url) throw new Error(t('bg.noServerConfigured'));
  return url.replace(/\/+$/, '') + '/api';
}

export async function authHeaders(): Promise<Record<string, string>> {
  const jwt = await get<string>(K.jwt);
  return jwt ? { Authorization: `Bearer ${jwt}` } : {};
}

/** GET/POST/PUT that unwraps the Passbolt envelope and returns body. */
export async function apiCall<T>(
  method: HttpMethod,
  path: string,
  body?: unknown,
): Promise<T> {
  const base = await apiBase();
  const res = await fetch(base + path, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(await authHeaders()),
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  if (res.status === 401) {
    // session expired -> drop credentials, force re-auth
    await del([K.jwt]);
    lock();
    throw new Error(t('bg.sessionExpired'));
  }
  const json = (await res.json().catch(() => null)) as Envelope<T> | null;
  if (!res.ok || !json) {
    throw new Error(json?.header?.message || t('bg.requestFailed', { status: res.status }));
  }
  return json.body as T;
}

/**
 * Full-envelope API call for the app UI pass-through (API_CALL RPC).
 *
 * Dead-session handling mirrors the retired SPA's axios interceptor: the
 * backend answers an EXPIRED token with 401, but an invalid/unverifiable token
 * is silently dropped by JwtAuthenticationFilter -> the request proceeds
 * anonymously -> Spring Security answers with a BARE 403 (no Passbolt `header`
 * envelope). Real authorization failures come from controllers WITH an
 * envelope, and the MFA-required 403 carries body.mfa_providers — so a bare,
 * non-MFA 403 reliably means "not authenticated". Both cases drop the JWT and
 * lock (which broadcasts), but the envelope is still RETURNED so the app's
 * routing layer can fall back to the lock screen on its own terms.
 */
export async function apiCallRaw(
  method: HttpMethod,
  path: string,
  body?: unknown,
  opts?: { guest?: boolean },
): Promise<ApiEnvelope> {
  const base = await apiBase();
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (!opts?.guest) Object.assign(headers, await authHeaders());
  const res = await fetch(base + path, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const json = (await res.json().catch(() => null)) as Record<string, unknown> | null;
  const hasEnvelope = !!(json && typeof json === 'object' && 'header' in json);
  const envelope: ApiEnvelope = {
    status: res.status,
    header: hasEnvelope ? (json.header as ApiEnvelope['header']) : null,
    // Non-envelope JSON (security-filter errors) is surfaced verbatim as body.
    body: hasEnvelope ? (json as { body?: unknown }).body : json ?? undefined,
  };

  if (!opts?.guest) {
    const bodyObj =
      envelope.body && typeof envelope.body === 'object'
        ? (envelope.body as Record<string, unknown>)
        : null;
    const isMfaRequired =
      Array.isArray(bodyObj?.mfa_providers) && (bodyObj.mfa_providers as unknown[]).length > 0;
    const deadSession =
      res.status === 401 || (res.status === 403 && !hasEnvelope && !isMfaRequired);
    if (deadSession) {
      // Non-destructive: only the JWT and the in-memory key are dropped; the
      // stored (passphrase-protected) key survives, so recovery = re-unlock.
      await del([K.jwt]);
      lock();
    }
  }
  return envelope;
}

// ---------------------------------------------------------------------------
// GpgAuth (3-stage) — ported from the SPA's auth.ts, fetch + worker edition
// ---------------------------------------------------------------------------
export async function gpgAuth(privateKey: openpgp.PrivateKey): Promise<{ jwt: string }> {
  const base = await apiBase();
  const fingerprint = privateKey.getFingerprint();

  // Stage 1: request the encrypted challenge for our keyid.
  const stage1 = await fetch(base + '/auth/login.json', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ data: { gpg_auth: { keyid: fingerprint } } }),
  });
  if (stage1.status === 404) throw new Error(t('bg.noAccountMatchesKey'));
  const encryptedToken = stage1.headers.get('x-gpgauth-user-auth-token');
  if (!encryptedToken) throw new Error(t('bg.noChallengeToken'));

  // PHP urlencode() semantics: '+' is a space, real '+' arrive as '%2B'.
  const armored = decodeURIComponent(encryptedToken.replace(/\+/g, ' '));
  const message = await openpgp.readMessage({ armoredMessage: armored });
  const { data: nonce } = await openpgp.decrypt({ message, decryptionKeys: privateKey });

  // Stage 2: return the decrypted nonce.
  const stage2 = await fetch(base + '/auth/login.json', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      data: { gpg_auth: { keyid: fingerprint, user_token_result: nonce } },
    }),
  });
  const authHeader = stage2.headers.get('authorization');
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    throw new Error(t('bg.authFailedNoJwt'));
  }
  return { jwt: authHeader.substring(7) };
}

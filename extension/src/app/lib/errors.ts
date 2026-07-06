/**
 * Centralized, localized API-error description (ported from the SPA's
 * i18n/errors.ts, adapted to the API_CALL envelope shape from app/lib/api.ts).
 *
 * Distinguishes the failure CLASS the user cares about:
 *   - rpc/background failure (no `.response`) → "can't reach server"
 *   - 401, or a bare 403 with no Passbolt envelope (anonymous request denied
 *     by Spring Security) and no mfa_providers → "session expired"
 *   - 403 WITH an envelope → the backend's own message, else "no permission"
 *   - 5xx → "server problem"
 *   - otherwise → backend header.message, else a generic fallback
 *
 * The background independently tears down a dead session on the same
 * 401/bare-403 signal (http.ts apiCallRaw); this helper is purely for what
 * the UI SHOWS.
 */
import { tf } from './i18n';

interface ErrorLike {
  response?: { status?: number; data?: unknown };
  message?: string;
}

export function describeApiError(err: unknown): string {
  const e = (err ?? {}) as ErrorLike;
  const res = e.response;

  // No response shape at all → the request never produced a server envelope
  // (background unreachable, network failure, fetch threw).
  if (!res) {
    return tf('app.common.errors.network', '无法连接服务器，请检查网络或服务器状态。');
  }

  const status = res.status ?? 0;
  const data = res.data as
    | { header?: { message?: string } | null; body?: unknown }
    | undefined;
  // api.ts maps a bare (non-envelope) error body to header: undefined.
  const hasEnvelope = data?.header != null;
  const backendMsg = data?.header?.message;
  const body = data?.body as { mfa_providers?: unknown[] } | null | undefined;
  const mfaRequired = Array.isArray(body?.mfa_providers) && body.mfa_providers.length > 0;

  if (status === 401 || (status === 403 && !hasEnvelope && !mfaRequired)) {
    return tf('app.common.errors.sessionExpired', '会话已过期，请重新解锁。');
  }
  if (status === 403) return backendMsg || tf('app.common.errors.forbidden', '没有权限执行此操作。');
  if (status === 404) return backendMsg || tf('app.common.errors.notFound', '未找到请求的内容。');
  if (status >= 500) return tf('app.common.errors.server', '服务器出现问题，请稍后重试。');
  return backendMsg || e.message || tf('app.common.errors.unknown', '发生未知错误。');
}

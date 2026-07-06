/**
 * Axios-shaped HTTP shim over the API_CALL background pass-through, so the 19
 * SPA service files port near-verbatim (`api.get(...).then(r => r.data.body)`,
 * try/catch on thrown errors). The JWT never reaches this iframe context: the
 * background attaches it (or omits it for guest requests) and returns the full
 * Passbolt envelope.
 *
 * Differences from axios kept deliberately small:
 *   - `data` is always the envelope `{ header, body }` (the background parses
 *     JSON; a bare non-envelope error body arrives as `{ header: undefined,
 *     body: <raw> }`).
 *   - non-2xx throws ApiError with the axios-like `.response.{status,data}`
 *     shape that describeApiError() and the SPA catch blocks read.
 *   - a guest request is marked the SPA way: `headers: { Authorization:
 *     undefined }` (setup/recovery flows).
 */
import { rpc, type ApiEnvelope, type HttpMethod } from '../../shared/messages';

/** Envelope-shaped response payload: what `.data` (and error `.data`) carry. */
export interface EnvelopeData {
  header?: ApiEnvelope['header'];
  body?: unknown;
}

export interface RequestConfig {
  /**
   * Query params appended to the path; null/undefined entries are dropped. An
   * array value is appended once per element under the same key (axios's
   * repeat-key semantics), which the `filter[...][]` list filters rely on.
   */
  params?:
    | Record<string, string | number | boolean | string[] | null | undefined>
    | URLSearchParams;
  /**
   * Only Authorization is meaningful: an explicit `Authorization: undefined`
   * entry marks the request as guest (background sends no Bearer).
   */
  headers?: Record<string, string | undefined>;
  /** DELETE-with-body support (axios `config.data`). */
  data?: unknown;
  /**
   * Accepted for source-compat with the ported services (several admin panels
   * pass one to drop a stale response after unmount). It CANNOT cross the RPC
   * boundary into the background fetch, so it is accepted and ignored here — an
   * in-flight API_CALL is not actually abortable from this iframe.
   */
  signal?: AbortSignal;
}

export interface ApiResponse<T = EnvelopeData> {
  status: number;
  data: T;
}

export class ApiError extends Error {
  readonly status: number;
  readonly response: { status: number; data: EnvelopeData };

  constructor(status: number, data: EnvelopeData) {
    super(data.header?.message || `Request failed with status code ${status}`);
    this.name = 'ApiError';
    this.status = status;
    this.response = { status, data };
  }
}

function withParams(path: string, params?: RequestConfig['params']): string {
  if (!params) return path;
  let sp: URLSearchParams;
  if (params instanceof URLSearchParams) {
    sp = params;
  } else {
    sp = new URLSearchParams();
    for (const [k, v] of Object.entries(params)) {
      if (v === null || v === undefined) continue;
      if (Array.isArray(v)) {
        for (const item of v) sp.append(k, String(item));
      } else {
        sp.append(k, String(v));
      }
    }
  }
  const qs = sp.toString();
  if (!qs) return path;
  return path + (path.includes('?') ? '&' : '?') + qs;
}

function isGuest(cfg?: RequestConfig): boolean {
  return (
    !!cfg?.headers && 'Authorization' in cfg.headers && cfg.headers.Authorization === undefined
  );
}

async function request<T>(
  method: HttpMethod,
  path: string,
  body: unknown,
  cfg?: RequestConfig,
): Promise<ApiResponse<T>> {
  const envelope = await rpc({
    type: 'API_CALL',
    method,
    path: withParams(path, cfg?.params),
    ...(body !== undefined ? { body } : {}),
    ...(isGuest(cfg) ? { guest: true } : {}),
  });
  const data: EnvelopeData = { header: envelope.header ?? undefined, body: envelope.body };
  if (envelope.status < 200 || envelope.status >= 300) {
    throw new ApiError(envelope.status, data);
  }
  return { status: envelope.status, data: data as unknown as T };
}

export const api = {
  get: <T = EnvelopeData>(path: string, cfg?: RequestConfig) =>
    request<T>('GET', path, undefined, cfg),
  post: <T = EnvelopeData>(path: string, body?: unknown, cfg?: RequestConfig) =>
    request<T>('POST', path, body, cfg),
  put: <T = EnvelopeData>(path: string, body?: unknown, cfg?: RequestConfig) =>
    request<T>('PUT', path, body, cfg),
  delete: <T = EnvelopeData>(path: string, cfg?: RequestConfig) =>
    request<T>('DELETE', path, cfg?.data, cfg),
};

export default api;

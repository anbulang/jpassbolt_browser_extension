/**
 * Core handlers owned by the foundation package: the authenticated API
 * pass-through (API_CALL) and key introspection (KEY_INFO). This file is also
 * the reference implementation for the domain handler files around it.
 */
import * as openpgp from 'openpgp';
import { t } from '../../shared/i18n';
import type { ApiEnvelope, Req } from '../../shared/messages';
import type { KeyInfo } from '../../shared/rpc/auth';
import { apiCallRaw } from '../http';
import { K, get, armLock, getUnlockedKey, invalidateResourceCache } from '../state';
import type { HandlerMap } from '../registry';

type ApiCallReq = Extract<Req, { type: 'API_CALL' }>;
type KeyInfoReq = Extract<Req, { type: 'KEY_INFO' }>;

async function apiCallHandler(req: ApiCallReq): Promise<ApiEnvelope> {
  // Guard: server-relative paths only. An absolute URL (or anything smuggling a
  // scheme) would let a compromised UI exfiltrate the Bearer token to a foreign
  // host — refuse before any header is attached.
  if (typeof req.path !== 'string' || !req.path.startsWith('/') || req.path.includes('://')) {
    throw new Error('API_CALL path must be server-relative (start with "/", no scheme).');
  }
  const envelope = await apiCallRaw(req.method, req.path, req.body, { guest: req.guest });
  // Any successful write that reaches the server through this pass-through
  // (e.g. the app UI's DELETE /resources/{id}.json) may change the resource
  // set, but bypasses the dedicated RESOURCE_* handlers that normally call
  // invalidateResourceCache(). Invalidate coarsely here so popup LIST and
  // in-form FIND_FOR_URL never serve deleted/stale credentials from the
  // in-memory cache. The cache is a lazily-loaded full table, so a blanket
  // invalidation on every 2xx write is cheap and safe.
  const method = String(req.method).toUpperCase();
  if (method !== 'GET' && method !== 'HEAD' && envelope.status >= 200 && envelope.status < 300) {
    invalidateResourceCache();
  }
  // Authenticated app activity counts as vault activity for the idle lock.
  if (!req.guest && getUnlockedKey()) armLock();
  return envelope;
}

async function keyInfoHandler(req: KeyInfoReq): Promise<KeyInfo> {
  const armored = req.armoredKey ?? (await get<string>(K.publicKey));
  if (!armored) throw new Error(t('bg.publicKeyUnavailable'));
  let key: openpgp.Key;
  try {
    key = await openpgp.readKey({ armoredKey: armored });
  } catch {
    throw new Error(t('bg.invalidPrivateKey'));
  }
  const alg = key.getAlgorithmInfo();
  return {
    fingerprint: key.getFingerprint(),
    keyId: key.getKeyID().toHex(),
    algorithm: alg.algorithm,
    bits: alg.bits,
    userIds: key.getUserIDs(),
    publicKeyArmored: key.toPublic().armor(),
  };
}

export const coreHandlers: HandlerMap = {
  API_CALL: apiCallHandler,
  KEY_INFO: keyInfoHandler,
};

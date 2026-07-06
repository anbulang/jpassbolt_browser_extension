/**
 * useResolvedResources — bridges async v5 metadata decryption into the vault
 * table WITHOUT blocking render (SPA hook rewired onto the background).
 *
 * v4 rows pass through untouched and render instantly. v5 rows (encrypted
 * `metadata` blob) start with a neutral '…' placeholder; all currently-pending
 * rows are shipped in ONE METADATA_DECRYPT_BATCH RPC and fill in as the batch
 * lands. The background decrypts (user_key -> session key, shared_key -> the
 * two-hop shared metadata key) and caches per `${id}:${modified}`; this hook
 * additionally keeps a page-lifetime cache of the PARSED projections so
 * re-renders and refetches cost nothing.
 *
 * A failed row (e.g. the org shared key is not configured) is NOT cached, so it
 * re-resolves on the next refetch instead of being stuck on '…' forever —
 * matching the SPA's retry-on-transition behavior.
 */
import { useEffect, useMemo, useState } from 'react';
import { rpc } from '../../../shared/messages';
import type { Resource } from '../../../shared/types';
import {
  isV5Resource,
  parseResourceMetadata,
  type ResolvedMetadata,
} from '../../../shared/vaultFormat';

/** A Resource with its display fields guaranteed populated (same field names). */
export type ResourceDisplay = Resource;

interface UseResolvedResources {
  display: ResourceDisplay[];
  /** True while one or more v5 rows are still decrypting. */
  resolving: boolean;
}

/** Version-aware key: an edited row (new `modified`) re-resolves. */
function stateKey(r: Resource): string {
  return `${r.id}:${r.modified}`;
}

/** Module-level cache of parsed projections (display plaintext only). */
const resolvedCache = new Map<string, ResolvedMetadata>();

/** Project a ResolvedMetadata back onto the Resource's display field names. */
function project(r: Resource, resolved: ResolvedMetadata): ResourceDisplay {
  return {
    ...r,
    name: resolved.name,
    username: resolved.username,
    uri: resolved.uri,
    description: resolved.description,
  };
}

export function useResolvedResources(resources: Resource[]): UseResolvedResources {
  const [resolvedById, setResolvedById] = useState<Map<string, ResolvedMetadata>>(
    () => new Map(),
  );

  // v5 rows in the current list that still lack a resolution. Computed during
  // render so `resolving` is derived, not stored.
  const pending = useMemo(
    () =>
      resources.filter(
        (r) =>
          isV5Resource(r) && !resolvedCache.get(stateKey(r)) && !resolvedById.get(stateKey(r)),
      ),
    [resources, resolvedById],
  );

  useEffect(() => {
    if (pending.length === 0) return;
    let cancelled = false;

    void (async () => {
      let results: Record<string, { json?: string; error?: string }>;
      try {
        ({ results } = await rpc({
          type: 'METADATA_DECRYPT_BATCH',
          items: pending.map((r) => ({
            id: r.id,
            metadata: r.metadata as string,
            metadataKeyId: r.metadata_key_id ?? null,
            metadataKeyType: r.metadata_key_type ?? null,
            modified: r.modified,
          })),
        }));
      } catch {
        // Vault locked mid-flight / background restart: keep the placeholders;
        // the rows retry on the next refetch.
        return;
      }
      const next = new Map<string, ResolvedMetadata>();
      for (const r of pending) {
        const json = results[r.id]?.json;
        if (!json) continue; // errored row: not cached -> retried later
        try {
          const resolved = parseResourceMetadata(json);
          resolvedCache.set(stateKey(r), resolved);
          next.set(stateKey(r), resolved);
        } catch {
          // Malformed blob: degrade to the placeholder rather than garbage.
        }
      }
      if (cancelled || next.size === 0) return;
      setResolvedById((prev) => {
        const merged = new Map(prev);
        for (const [key, resolved] of next) merged.set(key, resolved);
        return merged;
      });
    })();

    return () => {
      cancelled = true;
    };
  }, [pending]);

  const display = useMemo<ResourceDisplay[]>(() => {
    return resources.map((r) => {
      if (!isV5Resource(r)) return r;
      const resolved = resolvedCache.get(stateKey(r)) ?? resolvedById.get(stateKey(r));
      if (resolved) return project(r, resolved);
      // Not yet resolved: neutral placeholder so the row renders without blanks.
      return project(r, {
        name: '…',
        username: '',
        uri: '',
        description: '',
        resource_type_id: r.resource_type_id,
      });
    });
  }, [resources, resolvedById]);

  return { display, resolving: pending.length > 0 };
}

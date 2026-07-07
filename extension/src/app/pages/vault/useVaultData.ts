/**
 * Data layer for the Vault page (SPA useVaultData.ts port; transport now runs
 * through the API_CALL background pass-through via app/services/*).
 *
 * Loads the resource list (with favorite status + the encrypted v5 `metadata`
 * blob) and the folder list (with children_resources so folder membership can
 * be computed client-side, since Resource DTOs carry no folder field).
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import type { Folder, Resource } from '../../../shared/types';
import { listResources } from '../../services/resources';
import { listFolders } from '../../services/folders';
import { describeApiError } from '../../lib/errors';

interface VaultData {
  resources: Resource[];
  folders: Folder[];
  /** folderId -> set of resource ids that live directly in that folder. */
  folderMembership: Map<string, Set<string>>;
  /** set of resource ids that belong to ANY folder. */
  foldered: Set<string>;
  loading: boolean;
  /** First-load only — subsequent refetches keep the old data visible. */
  initialLoading: boolean;
  error: string | null;
  refetch: () => Promise<void>;
}

export function useVaultData(): VaultData {
  const [resources, setResources] = useState<Resource[]>([]);
  const [folders, setFolders] = useState<Folder[]>([]);
  const [loading, setLoading] = useState(true);
  const [initialLoading, setInitialLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refetch = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [res, fol] = await Promise.all([
        // containMetadata asks the server for the encrypted v5 `metadata` blob
        // so useResolvedResources can decrypt + display v5 rows transparently.
        listResources({ containFavorite: true, containMetadata: true }),
        // children_resources lets us compute folder membership locally.
        listFolders({ childrenResources: true }).catch(() => [] as Folder[]),
      ]);
      setResources(res);
      setFolders(fol);
    } catch (err) {
      setError(describeApiError(err));
    } finally {
      setLoading(false);
      setInitialLoading(false);
    }
  }, []);

  useEffect(() => {
    void refetch();
  }, [refetch]);

  const { folderMembership, foldered } = useMemo(() => {
    const membership = new Map<string, Set<string>>();
    const all = new Set<string>();
    for (const folder of folders) {
      const ids = new Set<string>();
      for (const child of folder.children_resources ?? []) {
        ids.add(child.id);
        all.add(child.id);
      }
      membership.set(folder.id, ids);
    }
    return { folderMembership: membership, foldered: all };
  }, [folders]);

  return {
    resources,
    folders,
    folderMembership,
    foldered,
    loading,
    initialLoading,
    error,
    refetch,
  };
}

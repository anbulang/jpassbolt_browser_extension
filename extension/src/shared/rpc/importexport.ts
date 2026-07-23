// Import/export RPC contract (implemented by background/handlers/importexport.ts).
// Staged plaintext passwords live ONLY in background memory (TTL-bound) and are
// never echoed back to the UI — the UI only ever sees ImportEntryMeta.

export interface ImportEntryMeta {
  index: number;
  name: string;
  username?: string;
  uri?: string;
  /** Folder hierarchy (top → leaf) the row will be imported into; UI preview. */
  folderPath?: string[];
}

export type ImportExportReq =
  // Import still accepts both formats — only EXPORT is KDBX-only.
  | { type: 'IMPORT_STAGE'; format: 'csv' | 'kdbx'; dataB64: string; kdbxPassword?: string }
  // indices lets the UI commit in batches (MV3 service-worker liveness); omitted
  // means "commit everything still staged".
  | { type: 'IMPORT_COMMIT'; importId: string; indices?: number[] }
  | { type: 'IMPORT_DISCARD'; importId: string }
  | {
      // KDBX-only: plaintext CSV export was removed (a decrypted vault must never
      // be written to disk unencrypted). The background rejects any other format.
      type: 'EXPORT_BUILD';
      format: 'kdbx';
      resourceIds?: string[];
      /** Restrict the export to these folders and their whole subtree (closure). */
      folderIds?: string[];
      kdbxPassword?: string;
      dbName?: string;
    };

export interface ImportExportRespMap {
  // rootFolderName is the `import-yyyymmdd-HHmmss` reference-root name the
  // background latches at stage time (local time, so the same file imported
  // twice in one day never collides). The UI shows it in the hierarchy note.
  IMPORT_STAGE: { importId: string; entries: ImportEntryMeta[]; rootFolderName?: string };
  IMPORT_COMMIT: { created: number; failed: { index: number; error: string }[] };
  IMPORT_DISCARD: { ok: true };
  // exported/failed mirror the SPA's ExportResult so the UI can surface rows
  // that were skipped (no READ secret, undecryptable metadata, transient fetch
  // failure) instead of reporting an incomplete backup as a full success.
  EXPORT_BUILD: {
    dataB64: string;
    filename: string;
    mime: string;
    exported: number;
    failed: { name: string; error: string }[];
  };
}

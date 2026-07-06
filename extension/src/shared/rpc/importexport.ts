// Import/export RPC contract (implemented by background/handlers/importexport.ts).
// Staged plaintext passwords live ONLY in background memory (TTL-bound) and are
// never echoed back to the UI — the UI only ever sees ImportEntryMeta.

export interface ImportEntryMeta {
  index: number;
  name: string;
  username?: string;
  uri?: string;
  folderPath?: string;
}

export type ImportExportReq =
  | { type: 'IMPORT_STAGE'; format: 'csv' | 'kdbx'; dataB64: string; kdbxPassword?: string }
  // indices lets the UI commit in batches (MV3 service-worker liveness); omitted
  // means "commit everything still staged".
  | { type: 'IMPORT_COMMIT'; importId: string; indices?: number[] }
  | { type: 'IMPORT_DISCARD'; importId: string }
  | {
      type: 'EXPORT_BUILD';
      format: 'csv' | 'kdbx';
      resourceIds?: string[];
      kdbxPassword?: string;
      dbName?: string;
    };

export interface ImportExportRespMap {
  IMPORT_STAGE: { importId: string; entries: ImportEntryMeta[] };
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

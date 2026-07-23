/**
 * Import / Export modal — extension edition of the SPA's vault modal.
 *
 * Unlike the SPA (which parsed files and ran crypto in-page), ALL parsing,
 * encryption and decryption happen in the background worker:
 *   import = IMPORT_STAGE (file bytes up, entry metadata back — never secrets)
 *            → IMPORT_COMMIT in batches of ≤50 (MV3 service-worker liveness)
 *   export = EXPORT_BUILD (finished file comes back as base64; export is always
 *            an encrypted KDBX archive protected by a user-chosen passphrase —
 *            plaintext CSV export was removed).
 * The UI's only jobs are file pickup, passphrase input, scope, progress and
 * download.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertTriangle,
  ArrowDownUp,
  CheckCircle2,
  Download,
  FileText,
  FolderTree,
  Lock,
  Upload,
} from 'lucide-react';
import { Modal } from '../Modal';
import { rpc } from '../../../shared/messages';
import type { ImportEntryMeta, ImportExportRespMap } from '../../../shared/rpc/importexport';
import { t } from '../../../shared/i18n';

export interface ImportExportModalProps {
  open: boolean;
  onClose: () => void;
  /** Ids of the resources currently in scope for export (EXPORT_BUILD resourceIds). */
  resourceIds: string[];
  /** The folder currently selected in the vault, enabling "current folder" export scope. */
  currentFolderId?: string | null;
  /** Display name of that folder (for the scope option label). */
  currentFolderName?: string;
  /**
   * Tab to land on when the modal opens. Omitted = keep whichever tab was last
   * used (the historical behaviour: reset() deliberately never touched `tab`).
   */
  initialTab?: Tab;
  /**
   * Export scope to preselect when the modal opens. 'folder' only takes effect
   * while `currentFolderId` is set; otherwise it falls back to 'all'.
   */
  initialExportScope?: ExportScope;
  /** Called after a successful import so the vault reloads. */
  onImported: () => void;
}

type Tab = 'import' | 'export';
type ExportScope = 'all' | 'folder';

const COMMIT_BATCH = 50;

function bufToB64(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf);
  let bin = '';
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    bin += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return btoa(bin);
}

function b64ToBytes(b64: string): Uint8Array<ArrayBuffer> {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/** Trigger a client-side download of bytes/text as a file. */
function downloadBlob(data: BlobPart, filename: string, mime: string): void {
  const blob = new Blob([data], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function ImportExportModal({
  open,
  onClose,
  resourceIds,
  currentFolderId,
  currentFolderName,
  initialTab,
  initialExportScope,
  onImported,
}: ImportExportModalProps) {
  const [tab, setTab] = useState<Tab>('import');
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [error, setError] = useState('');
  const [done, setDone] = useState<string | null>(null);

  // ---- import state ----
  const [file, setFile] = useState<File | null>(null);
  const [kdbxPass, setKdbxPass] = useState('');
  // The `import-yyyymmdd-HHmmss` reference-folder name the background latched at
  // stage time; shown in the hierarchy note once known. Null before the first
  // stage (the note then shows the generic wording).
  const [rootFolderName, setRootFolderName] = useState<string | null>(null);
  const isKdbxFile = useMemo(() => !!file && /\.kdbx$/i.test(file.name), [file]);
  // Set only if a stage outlived a failed commit run — discarded on close so
  // the background never keeps plaintext staged for a modal nobody looks at.
  const pendingImportId = useRef<string | null>(null);
  // Progress of an interrupted commit run. A retry RESUMES this stage from
  // nextPos instead of re-staging the whole file: rows already committed left
  // the background staging area, so a fresh full stage+commit would recreate
  // every one of them as a duplicate resource.
  const resumeRef = useRef<{
    file: File;
    importId: string;
    entries: ImportEntryMeta[];
    /** entries[] position of the first uncommitted batch. */
    nextPos: number;
    created: number;
    failed: number;
  } | null>(null);

  // ---- export state ----
  const [exportScope, setExportScope] = useState<ExportScope>('all');
  const [exportPass, setExportPass] = useState('');
  const [exportPass2, setExportPass2] = useState('');

  // -------------------------------------------------------------------------
  // On-open presets. This modal stays MOUNTED while closed (`open` is just a
  // prop; the `if (!open) return null` below sits after the hooks), so state
  // does not reset by itself — hence the false->true edge check.
  //
  // Deliberately NOT reset(): that clears `file`, and an interrupted import
  // resumes by comparing `resumeRef.current.file === file`. Dropping the file
  // would silently downgrade a resume into a full re-import (duplicating every
  // already-committed row). Only the view-level bits are touched here.
  // -------------------------------------------------------------------------
  const prevOpen = useRef(false);
  useEffect(() => {
    if (open && !prevOpen.current) {
      // Only force the tab when asked — an unqualified open keeps the last one.
      if (initialTab) setTab(initialTab);
      setExportScope(initialExportScope === 'folder' && currentFolderId ? 'folder' : 'all');
      setError('');
      setDone(null);
    }
    prevOpen.current = open;
  }, [open, initialTab, initialExportScope, currentFolderId]);

  const reset = () => {
    setBusy(false);
    setProgress(null);
    setError('');
    setDone(null);
    setFile(null);
    setKdbxPass('');
    setRootFolderName(null);
    setExportScope('all');
    setExportPass('');
    setExportPass2('');
  };

  const close = () => {
    if (pendingImportId.current) {
      void rpc({ type: 'IMPORT_DISCARD', importId: pendingImportId.current }).catch(() => undefined);
      pendingImportId.current = null;
    }
    resumeRef.current = null;
    reset();
    onClose();
  };

  // -------------------------------------------------------------------------
  // import: stage the file, then commit in batches (progress = committed rows)
  // -------------------------------------------------------------------------
  /** True when the background reports the staged import is gone (TTL / lock). */
  const isImportExpired = (err: unknown): boolean =>
    err instanceof Error && err.message === t('app.vault.ie.errors.importExpired');

  const runImport = async () => {
    if (!file) return;
    setBusy(true);
    setError('');
    setDone(null);
    setProgress(null);
    let created = 0;
    let failed = 0;
    try {
      if (isKdbxFile && !kdbxPass) throw new Error(t('app.vault.ie.errors.kdbxPassRequired'));

      const stageFile = async () => {
        const staged = await rpc({
          type: 'IMPORT_STAGE',
          format: isKdbxFile ? 'kdbx' : 'csv',
          dataB64: bufToB64(await file.arrayBuffer()),
          kdbxPassword: isKdbxFile ? kdbxPass : undefined,
        });
        pendingImportId.current = staged.importId;
        if (staged.rootFolderName) setRootFolderName(staged.rootFolderName);
        return staged;
      };

      // A retry after a mid-run failure resumes the SAME stage: committed rows
      // already left the background staging area (idempotent skips), so staging
      // the file again and committing everything would duplicate them all.
      const resume =
        resumeRef.current && resumeRef.current.file === file ? resumeRef.current : null;
      if (!resume && pendingImportId.current) {
        // The pending stage belongs to a different file — drop its plaintext
        // before staging the new one so it doesn't linger until the TTL.
        void rpc({ type: 'IMPORT_DISCARD', importId: pendingImportId.current }).catch(
          () => undefined,
        );
        pendingImportId.current = null;
        resumeRef.current = null;
      }

      let importId: string;
      let entries: ImportEntryMeta[];
      let startPos = 0;
      if (resume) {
        ({ importId, entries } = resume);
        startPos = resume.nextPos;
        created = resume.created;
        failed = resume.failed;
      } else {
        ({ importId, entries } = await stageFile());
      }
      const total = entries.length;
      if (total === 0) throw new Error(t('app.vault.ie.errors.empty'));
      resumeRef.current = { file, importId, entries, nextPos: startPos, created, failed };

      setProgress({ done: startPos, total });
      for (let i = startPos; i < total; i += COMMIT_BATCH) {
        const indices = entries.slice(i, i + COMMIT_BATCH).map((e) => e.index);
        let res: ImportExportRespMap['IMPORT_COMMIT'];
        try {
          res = await rpc({ type: 'IMPORT_COMMIT', importId, indices });
        } catch (err) {
          // The stage evaporated between runs (TTL sweep / worker lock wiped
          // it). Re-stage the same file and continue from position i: rows
          // before i were already created on the server, so they are skipped
          // by position (the parse is deterministic, indices line up).
          if (!isImportExpired(err)) throw err;
          ({ importId, entries } = await stageFile());
          res = await rpc({
            type: 'IMPORT_COMMIT',
            importId,
            indices: entries.slice(i, i + COMMIT_BATCH).map((e) => e.index),
          });
        }
        created += res.created;
        failed += res.failed.length;
        const nextPos = Math.min(i + COMMIT_BATCH, total);
        resumeRef.current = { file, importId, entries, nextPos, created, failed };
        setProgress({ done: nextPos, total });
      }
      pendingImportId.current = null; // fully processed — the stage is gone
      resumeRef.current = null;
      onImported();
      const failedNote =
        failed > 0 ? ' ' + t('app.vault.ie.import.failedCount', { count: failed }) : '';
      setDone(t('app.vault.ie.import.success', { count: created }) + failedNote);
      setFile(null);
      setKdbxPass('');
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      // A partial run still created rows server-side: refresh the vault so the
      // user sees them even though the import as a whole failed.
      if (created > 0) onImported();
    } finally {
      setBusy(false);
      setProgress(null);
    }
  };

  // -------------------------------------------------------------------------
  // export: one EXPORT_BUILD round-trip, then download the returned bytes
  // -------------------------------------------------------------------------
  const runExport = async () => {
    setError('');
    setDone(null);
    if (exportPass.length < 8) {
      setError(t('app.vault.ie.errors.exportPassWeak'));
      return;
    }
    if (exportPass !== exportPass2) {
      setError(t('app.vault.ie.errors.exportPassMismatch'));
      return;
    }

    // "Current folder" scope only applies when a folder is actually selected;
    // otherwise the export covers the whole visible vault.
    //
    // folderIds is a list of ROOTS, not an enumeration: the background expands
    // it with subtreeClosure() over the topology it fetches itself
    // (GET /folders.json?contain[children_resources]=1, handlers/importexport
    // .ts), then intersects the result with resourceIds. So one id here already
    // means "this folder AND its whole subtree" — expanding it in the UI would
    // duplicate that work against a possibly different view of the tree.
    const folderIds =
      exportScope === 'folder' && currentFolderId ? [currentFolderId] : undefined;

    setBusy(true);
    try {
      const built = await rpc({
        type: 'EXPORT_BUILD',
        format: 'kdbx',
        resourceIds,
        folderIds,
        kdbxPassword: exportPass,
        dbName: 'JPassbolt Export',
      });
      downloadBlob(b64ToBytes(built.dataB64), built.filename, built.mime);
      // Rows the worker had to skip (no READ secret, undecryptable metadata,
      // transient fetch failure) make the backup incomplete — say so instead of
      // reporting an unqualified success (SPA export failedCount parity).
      const failedNote =
        built.failed.length > 0
          ? ' ' + t('app.vault.ie.export.failedCount', { count: built.failed.length })
          : '';
      setDone(t('app.vault.ie.export.done') + failedNote);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  if (!open) return null;

  const pct =
    progress && progress.total > 0 ? Math.round((progress.done / progress.total) * 100) : 0;

  return (
    <Modal
      open={open}
      title={t('app.vault.ie.title')}
      icon={<ArrowDownUp />}
      // While a run is in flight, ESC/X/backdrop must not fire close(): it would
      // IMPORT_DISCARD the stage the commit loop is still consuming (same guard
      // pattern as ResourceFormModal / ShareDialog).
      onClose={busy ? () => {} : close}
      maxWidth={560}
    >
      <div className="seg" style={{ marginBottom: 16, width: 'fit-content' }}>
        <button
          type="button"
          className={tab === 'import' ? 'on' : ''}
          onClick={() => { setTab('import'); setError(''); setDone(null); }}
        >
          <Upload /> {t('app.vault.ie.tabs.import')}
        </button>
        <button
          type="button"
          className={tab === 'export' ? 'on' : ''}
          onClick={() => { setTab('export'); setError(''); setDone(null); }}
        >
          <Download /> {t('app.vault.ie.tabs.export')}
        </button>
      </div>

      {error && (
        <div className="warnbox" style={{ marginBottom: 14 }}>
          <AlertTriangle />
          <div>{error}</div>
        </div>
      )}
      {done && (
        <div className="jpb-ok" style={{ marginBottom: 14 }}>
          <CheckCircle2 size={16} />
          <div>{done}</div>
        </div>
      )}

      {busy && (
        <div style={{ marginBottom: 14 }}>
          {progress ? (
            <>
              <div className="decrypt-bar" style={{ height: 6 }}>
                <i style={{ width: `${pct}%`, transition: 'width .2s' }} />
              </div>
              <div
                style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 8, fontSize: 12, color: 'var(--text-3)' }}
              >
                <span className="spin-ring" /> {progress.done}/{progress.total}
              </div>
            </>
          ) : (
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, color: 'var(--text-3)' }}>
              <span className="spin-ring" />{' '}
              {tab === 'import' ? t('app.vault.ie.import.parsing') : t('app.vault.ie.export.working')}
            </div>
          )}
        </div>
      )}

      {tab === 'import' ? (
        <div>
          <p className="jpb-muted" style={{ marginBottom: 12 }}>{t('app.vault.ie.import.lead')}</p>
          <div
            style={{ display: 'flex', gap: 8, alignItems: 'flex-start', marginBottom: 12, fontSize: 12, color: 'var(--text-3)' }}
          >
            <FolderTree size={14} style={{ flexShrink: 0, marginTop: 1 }} />
            <span>
              {rootFolderName
                ? t('app.vault.ie.import.hierarchyNote', { name: rootFolderName })
                : t('app.vault.ie.import.hierarchyNoteGeneric')}
            </span>
          </div>
          <label
            className="pf-input"
            style={{ cursor: 'pointer', display: 'flex', gap: 10, alignItems: 'center' }}
          >
            <FileText size={16} />
            <span
              style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontSize: 13 }}
            >
              {file ? file.name : t('app.vault.ie.import.choose')}
            </span>
            <input
              type="file"
              accept=".csv,.kdbx,text/csv"
              style={{ display: 'none' }}
              onChange={(e) => { setFile(e.target.files?.[0] ?? null); setError(''); setDone(null); }}
            />
          </label>
          {isKdbxFile && (
            <div style={{ marginTop: 12 }}>
              <div className="pf-label" style={{ marginBottom: 6 }}>
                <Lock size={14} /> {t('app.vault.ie.import.kdbxPassLabel')}
              </div>
              <input
                className="sinput sans"
                style={{ width: '100%', boxSizing: 'border-box' }}
                type="password"
                value={kdbxPass}
                onChange={(e) => setKdbxPass(e.target.value)}
              />
            </div>
          )}
          <div style={{ marginTop: 18, display: 'flex', justifyContent: 'flex-end', gap: 10 }}>
            <button type="button" className="btn" onClick={close} disabled={busy}>
              {t('app.vault.ie.cancel')}
            </button>
            <button type="button" className="btn primary" onClick={runImport} disabled={busy || !file}>
              <Upload /> {t('app.vault.ie.import.run')}
            </button>
          </div>
        </div>
      ) : (
        <div>
          <p className="jpb-muted" style={{ marginBottom: 12 }}>
            {t('app.vault.ie.export.lead', { count: resourceIds.length })}
          </p>

          {/* Export is always an encrypted KDBX archive — plaintext CSV export
              was removed, so there is no format choice, only an info block. */}
          <div className="pick-opt sel" style={{ cursor: 'default', alignItems: 'flex-start' }}>
            <Lock size={16} style={{ flexShrink: 0, marginTop: 2, color: 'var(--accent)' }} />
            <span style={{ minWidth: 0 }}>
              <strong style={{ display: 'block', fontSize: 13 }}>
                {t('app.vault.ie.export.kdbxTitle')}
              </strong>
              <span style={{ fontSize: 12, color: 'var(--text-3)', lineHeight: 1.4 }}>
                {t('app.vault.ie.export.kdbxDesc')}
              </span>
            </span>
          </div>

          {/* Scope: the whole visible vault, or the selected folder + its subtree. */}
          <div style={{ marginTop: 14 }}>
            <div className="pf-label" style={{ marginBottom: 6 }}>
              <FolderTree size={14} /> {t('app.vault.ie.export.scopeLabel')}
            </div>
            <div className="seg" style={{ width: 'fit-content' }}>
              <button
                type="button"
                className={exportScope === 'all' ? 'on' : ''}
                onClick={() => setExportScope('all')}
              >
                {t('app.vault.ie.export.scopeAll')}
              </button>
              <button
                type="button"
                className={exportScope === 'folder' ? 'on' : ''}
                disabled={!currentFolderId}
                onClick={() => setExportScope('folder')}
                title={currentFolderName || undefined}
              >
                {/* Name the folder when we know it: the lead line above counts
                    the WHOLE visible vault, so an unnamed "current folder"
                    leaves the actual scope ambiguous. */}
                {currentFolderName
                  ? t('app.vault.ie.export.scopeFolderNamed', { name: currentFolderName })
                  : t('app.vault.ie.export.scopeFolder')}
              </button>
            </div>
          </div>

          <div style={{ marginTop: 14 }}>
            <div className="pf-label" style={{ marginBottom: 6 }}>
              <Lock size={14} /> {t('app.vault.ie.export.passLabel')}
            </div>
            <input
              className="sinput sans"
              style={{ width: '100%', boxSizing: 'border-box', marginBottom: 8 }}
              type="password"
              value={exportPass}
              onChange={(e) => setExportPass(e.target.value)}
              placeholder={t('app.vault.ie.export.passPlaceholder')}
            />
            <input
              className="sinput sans"
              style={{ width: '100%', boxSizing: 'border-box' }}
              type="password"
              value={exportPass2}
              onChange={(e) => setExportPass2(e.target.value)}
              placeholder={t('app.vault.ie.export.passConfirmPlaceholder')}
            />
            <p className="jpb-muted" style={{ marginTop: 8, fontSize: 12 }}>
              {t('app.vault.ie.export.kdbxHint')}
            </p>
          </div>

          <div style={{ marginTop: 18, display: 'flex', justifyContent: 'flex-end', gap: 10 }}>
            <button type="button" className="btn" onClick={close} disabled={busy}>
              {t('app.vault.ie.cancel')}
            </button>
            <button
              type="button"
              className="btn primary"
              onClick={runExport}
              disabled={busy || resourceIds.length === 0}
            >
              <Download /> {t('app.vault.ie.export.run')}
            </button>
          </div>
        </div>
      )}
    </Modal>
  );
}

export default ImportExportModal;

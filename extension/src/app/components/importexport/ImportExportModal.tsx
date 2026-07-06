/**
 * Import / Export modal — extension edition of the SPA's vault modal.
 *
 * Unlike the SPA (which parsed files and ran crypto in-page), ALL parsing,
 * encryption and decryption happen in the background worker:
 *   import = IMPORT_STAGE (file bytes up, entry metadata back — never secrets)
 *            → IMPORT_COMMIT in batches of ≤50 (MV3 service-worker liveness)
 *   export = EXPORT_BUILD (finished file comes back as base64; KDBX is
 *            encrypted with a user-chosen passphrase, CSV only behind the
 *            explicit plaintext acknowledgement).
 * The UI's only jobs are file pickup, passphrase input, progress and download.
 */
import { useMemo, useRef, useState } from 'react';
import {
  AlertTriangle,
  ArrowDownUp,
  CheckCircle2,
  Download,
  FileText,
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
  /** Called after a successful import so the vault reloads. */
  onImported: () => void;
}

type Tab = 'import' | 'export';
type ExportFormat = 'kdbx' | 'csv';

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

export function ImportExportModal({ open, onClose, resourceIds, onImported }: ImportExportModalProps) {
  const [tab, setTab] = useState<Tab>('import');
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [error, setError] = useState('');
  const [done, setDone] = useState<string | null>(null);

  // ---- import state ----
  const [file, setFile] = useState<File | null>(null);
  const [kdbxPass, setKdbxPass] = useState('');
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
  const [exportFormat, setExportFormat] = useState<ExportFormat>('kdbx');
  const [exportPass, setExportPass] = useState('');
  const [exportPass2, setExportPass2] = useState('');
  const [csvAck, setCsvAck] = useState(false);

  const reset = () => {
    setBusy(false);
    setProgress(null);
    setError('');
    setDone(null);
    setFile(null);
    setKdbxPass('');
    setExportPass('');
    setExportPass2('');
    setCsvAck(false);
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
    if (exportFormat === 'kdbx') {
      if (exportPass.length < 8) {
        setError(t('app.vault.ie.errors.exportPassWeak'));
        return;
      }
      if (exportPass !== exportPass2) {
        setError(t('app.vault.ie.errors.exportPassMismatch'));
        return;
      }
    } else if (!csvAck) {
      setError(t('app.vault.ie.errors.csvAckRequired'));
      return;
    }

    setBusy(true);
    try {
      const built = await rpc({
        type: 'EXPORT_BUILD',
        format: exportFormat,
        resourceIds,
        kdbxPassword: exportFormat === 'kdbx' ? exportPass : undefined,
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
                placeholder="••••••••••••"
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

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
            <button
              type="button"
              className={`pick-opt${exportFormat === 'kdbx' ? ' sel' : ''}`}
              onClick={() => setExportFormat('kdbx')}
            >
              <span className="radio" />
              <span style={{ minWidth: 0 }}>
                <strong style={{ display: 'block', fontSize: 13 }}>
                  {t('app.vault.ie.export.kdbxTitle')}
                </strong>
                <span style={{ fontSize: 12, color: 'var(--text-3)', lineHeight: 1.4 }}>
                  {t('app.vault.ie.export.kdbxDesc')}
                </span>
              </span>
            </button>
            <button
              type="button"
              className={`pick-opt${exportFormat === 'csv' ? ' sel' : ''}`}
              onClick={() => setExportFormat('csv')}
            >
              <span className="radio" />
              <span style={{ minWidth: 0 }}>
                <strong style={{ display: 'block', fontSize: 13 }}>
                  {t('app.vault.ie.export.csvTitle')}
                </strong>
                <span style={{ fontSize: 12, color: 'var(--text-3)', lineHeight: 1.4 }}>
                  {t('app.vault.ie.export.csvDesc')}
                </span>
              </span>
            </button>
          </div>

          {exportFormat === 'kdbx' ? (
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
          ) : (
            <div className="warnbox" style={{ marginTop: 14, alignItems: 'flex-start' }}>
              <AlertTriangle />
              <label style={{ display: 'flex', gap: 8, cursor: 'pointer', alignItems: 'flex-start' }}>
                <input
                  type="checkbox"
                  checked={csvAck}
                  onChange={(e) => setCsvAck(e.target.checked)}
                  style={{ marginTop: 3 }}
                />
                <span>{t('app.vault.ie.export.csvWarning')}</span>
              </label>
            </div>
          )}

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

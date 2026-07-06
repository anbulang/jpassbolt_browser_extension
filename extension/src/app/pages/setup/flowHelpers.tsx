/* eslint-disable react-refresh/only-export-components */
/**
 * flowHelpers.tsx — shared primitives for the Setup AND Recovery guest flows,
 * ported from the SPA's pages/flowHelpers.tsx (i18next → shared/i18n t()).
 *
 * Small pure helpers (ppScore / PP_LABEL / formatFingerprint / fullName /
 * downloadRecoveryKit) are co-located with three presentational components
 * (Stepper / KeyGen / KeyFileButton) by design — hence the react-refresh
 * disable above.
 *
 * KeyGen is JUST an animation: the CALLER awaits the real SETUP_GENERATE_KEY
 * RPC and decides when generation is truly done; KeyGen also fires onDone after
 * its own animation as a fallback so the UI never hangs, so onDone must be
 * idempotent.
 */
import { useEffect, useRef, useState, type JSX } from 'react';
import { Check, KeyRound, Upload } from 'lucide-react';
import { t } from '../../../shared/i18n';
import type { User } from '../../../shared/types';

// ---------------------------------------------------------------------------
// Passphrase strength (Aegis ppScore parity)
// ---------------------------------------------------------------------------

/**
 * Score a passphrase 0–4:
 *   +1 length >= 8, +1 length >= 14,
 *   +1 has lower AND upper AND digit, +1 has a symbol. Capped at 4.
 */
export function ppScore(p: string): number {
  let s = 0;
  if (p.length >= 8) s++;
  if (p.length >= 14) s++;
  if (/[a-z]/.test(p) && /[A-Z]/.test(p) && /\d/.test(p)) s++;
  if (/[^A-Za-z0-9]/.test(p)) s++;
  return Math.min(4, s);
}

/** Strength labels indexed by ppScore() (0 = empty), locale-aware via t(). */
export function PP_LABEL(score: number): string {
  const labels = [
    '',
    t('app.auth.keygen.strengthLabels.weak'),
    t('app.auth.keygen.strengthLabels.fair'),
    t('app.auth.keygen.strengthLabels.good'),
    t('app.auth.keygen.strengthLabels.strong'),
  ];
  return labels[score] ?? '';
}

// ---------------------------------------------------------------------------
// Display helpers
// ---------------------------------------------------------------------------

/** Pretty-print an armored fingerprint into the spaced 4-char groups Aegis shows. */
export function formatFingerprint(fp: string): string {
  const up = fp.toUpperCase().replace(/\s+/g, '');
  return up.replace(/(.{4})/g, '$1 ').trim();
}

/** Full display name from a profile, falling back to the username. */
export function fullName(user: User | null, fallbackKey = 'app.auth.setup.newMemberFallback'): string {
  const f = user?.profile?.first_name?.trim() ?? '';
  const l = user?.profile?.last_name?.trim() ?? '';
  return [f, l].filter(Boolean).join(' ') || user?.username || t(fallbackKey);
}

// ---------------------------------------------------------------------------
// Stepper
// ---------------------------------------------------------------------------

/**
 * The flow header stepper (flow-steps / fstep / fs-dot / fs-l / fstep-line).
 * `cur` is the active step index; earlier steps render a Check icon (done).
 */
export function Stepper({ steps, cur }: { steps: string[]; cur: number }): JSX.Element {
  return (
    <div className="flow-steps">
      {steps.map((s, i) => (
        <span style={{ display: 'contents' }} key={i}>
          <div className={'fstep ' + (i === cur ? 'on' : i < cur ? 'done' : '')}>
            <span className="fs-dot">{i < cur ? <Check /> : i + 1}</span>
            <span className="fs-l">{s}</span>
          </div>
          {i < steps.length - 1 && (
            <span className={'fstep-line' + (i < cur ? ' done' : '')} />
          )}
        </span>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// KeyGen (visual only)
// ---------------------------------------------------------------------------

export function KeyGen({ onDone }: { onDone: () => void }): JSX.Element {
  const logs = [
    t('app.auth.keygen.logs.entropy'),
    t('app.auth.keygen.logs.generating'),
    t('app.auth.keygen.logs.deriving'),
    t('app.auth.keygen.logs.encrypting'),
    t('app.auth.keygen.logs.done'),
  ];
  const total = 36;
  const [li, setLi] = useState(0);
  const [bits, setBits] = useState(0);

  useEffect(() => {
    const bi = setInterval(() => setBits((b) => Math.min(total, b + 2)), 70);
    const ll = setInterval(
      () =>
        setLi((i) => {
          if (i >= logs.length - 1) {
            clearInterval(ll);
            return i;
          }
          return i + 1;
        }),
      520,
    );
    // Fallback completion so the UI never hangs; the caller's real onDone
    // (fired when the RPC resolves) is the authoritative signal.
    const done = setTimeout(onDone, 2500);
    return () => {
      clearInterval(bi);
      clearInterval(ll);
      clearTimeout(done);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="keygen">
      <div className="keygen-ring">
        <div className="keygen-spin" />
        <div className="kr-core">
          <KeyRound />
        </div>
      </div>
      <div className="keygen-bits">
        {Array.from({ length: total }).map((_, i) => (
          <i key={i} className={i < bits ? 'on' : ''} />
        ))}
      </div>
      <div className="keygen-log" style={{ fontFamily: 'var(--mono)' }}>{logs[li]}</div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Key file picker (SPA components/KeyFileButton.tsx, inlined for this flow)
// ---------------------------------------------------------------------------

/**
 * "Choose .asc file" button that reads the picked file as text and hands it to
 * the caller. The file is read entirely in this page; nothing is uploaded.
 */
export function KeyFileButton({
  onLoaded,
  label,
}: {
  onLoaded: (text: string) => void;
  label?: string;
}): JSX.Element {
  const inputRef = useRef<HTMLInputElement>(null);
  return (
    <>
      <button type="button" className="btn sm" onClick={() => inputRef.current?.click()}>
        <Upload /> {label ?? t('app.auth.setup.key.chooseFile')}
      </button>
      <input
        ref={inputRef}
        type="file"
        accept=".asc,.txt,.key,.pgp"
        style={{ display: 'none' }}
        onChange={async (e) => {
          const f = e.target.files?.[0];
          if (f) onLoaded(await f.text());
          // allow re-picking the same file
          e.target.value = '';
        }}
      />
    </>
  );
}

// ---------------------------------------------------------------------------
// Recovery kit download
// ---------------------------------------------------------------------------

/**
 * Trigger a browser download of the user's armored PRIVATE key as a .asc file —
 * their offline recovery backup. This is the ONE sanctioned place the (still
 * passphrase-protected) private key surfaces in the UI, and it goes only to the
 * user's local disk, never the network.
 */
export function downloadRecoveryKit(filename: string, armoredPrivateKey: string): void {
  const blob = new Blob([armoredPrivateKey], { type: 'application/pgp-keys' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename.endsWith('.asc') ? filename : `${filename}.asc`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  // Release the object URL on the next tick so the click has a chance to start.
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

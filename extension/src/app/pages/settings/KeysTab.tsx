/**
 * Keys inspector — the OpenPGP key card lifted out of the retired AccountTab,
 * plus the armored PUBLIC key (view / copy / download).
 *
 * ZERO-KNOWLEDGE: everything here is derived from the account's PUBLIC key. The
 * KEY_INFO RPC reads chrome.storage.local's public-key slot inside the
 * background and returns only public material (fingerprint, key id, algorithm,
 * bits, user ids, armored public key). The private key is never requested,
 * never rendered and never exported from this page — the only private-key
 * export in the product is the setup flow's recovery kit, behind its own gate.
 *
 * Copies go through the background COPY RPC (offscreen document): the app
 * iframe cannot rely on navigator.clipboard inside the host page.
 */
import { useEffect, useState } from 'react';
import { Check, Copy, Download, Eye, EyeOff, Fingerprint, KeyRound } from 'lucide-react';
import { rpc } from '../../../shared/messages';
import type { KeyInfo } from '../../../shared/rpc/auth';
import { t } from '../../../shared/i18n';
import type { User } from '../../../shared/types';
import { SectionHeader } from './cardKit';

/** Group an OpenPGP fingerprint into 4-char blocks for readability. */
function formatFingerprint(fp: string): string {
  const clean = fp.replace(/\s+/g, '').toUpperCase();
  return clean.match(/.{1,4}/g)?.join(' ') ?? clean;
}

/** Save `text` to the user's disk as `filename` (no network, no extension API). */
function downloadText(filename: string, text: string, mime: string): void {
  const blob = new Blob([text], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

export function KeysTab({ me }: { me: User }) {
  const [showFp, setShowFp] = useState(false);
  const [fpCopied, setFpCopied] = useState(false);
  const [pubCopied, setPubCopied] = useState(false);
  const [showPub, setShowPub] = useState(false);

  // KEY_INFO gives the account key's derived public info; null while loading or
  // when the background has no key to report.
  const [keyInfo, setKeyInfo] = useState<KeyInfo | null>(null);
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const info = await rpc({ type: 'KEY_INFO' });
        if (!cancelled) setKeyInfo(info);
      } catch {
        if (!cancelled) setKeyInfo(null);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // Prefer the background-derived values; fall back to the server's gpgkey row.
  const fingerprint = keyInfo?.fingerprint ?? me.gpgkey?.fingerprint ?? null;
  const fingerprintPretty = fingerprint ? formatFingerprint(fingerprint) : null;
  const fingerprintMasked = fingerprintPretty
    ? fingerprintPretty.replace(/[0-9A-F]/g, '•')
    : null;
  const keyId = me.gpgkey?.key_id ?? keyInfo?.keyId ?? null;
  const bits = me.gpgkey?.bits ?? keyInfo?.bits ?? null;
  const algorithm = keyInfo?.algorithm ?? null;
  const userIds = keyInfo?.userIds ?? [];
  // Only ever the PUBLIC half — see the file header. Deliberately NOT falling
  // back to me.gpgkey.armored_key: that blob is whatever the (untrusted, per
  // crypto.ts verifyArmoredKeyFingerprint) server chose to return. Offering it
  // for copy/download as "your public key" would let a compromised backend get
  // its own key distributed by the victim's own hand.
  const publicKeyArmored = keyInfo?.publicKeyArmored ?? null;

  const copy = async (text: string, mark: (v: boolean) => void) => {
    try {
      await rpc({ type: 'COPY', text });
      mark(true);
      window.setTimeout(() => mark(false), 2000);
    } catch {
      /* clipboard unavailable */
    }
  };

  const downloadPublicKey = () => {
    if (!publicKeyArmored) return;
    const who = me.username || 'account';
    downloadText(`jpassbolt-${who}-public.asc`, publicKeyArmored, 'application/pgp-keys');
  };

  return (
    <span style={{ display: 'contents' }}>
      <SectionHeader
        title={t('app.settings.keys.title')}
        subtitle={t('app.settings.keys.subtitle')}
      />

      {/* Fingerprint / identity card */}
      <div className="scard">
        {/* No lock-state badge here: KEY_INFO reads the PUBLIC key, which is
            readable whether or not the vault is unlocked, so any such badge
            would always claim "unlocked" — the old AccountTab's mislabel. */}
        <div className="scard-h">
          <Fingerprint />
          <h3>{t('app.settings.account.gpg.title')}</h3>
        </div>
        <div className="srow" style={{ display: 'block' }}>
          <div className="hint" style={{ marginBottom: 10, lineHeight: 1.5 }}>
            {t('app.settings.account.gpg.intro')}
          </div>
          {fingerprintPretty ? (
            <div className="fpbox">
              <KeyRound style={{ width: 16, height: 16, color: 'var(--text-3)' }} />
              <span className="fpv">{showFp ? fingerprintPretty : fingerprintMasked}</span>
              <button
                type="button"
                className="copybtn"
                onClick={() => setShowFp((s) => !s)}
                aria-label={showFp ? t('app.common.actions.hide') : t('app.common.actions.show')}
                title={showFp ? t('app.common.actions.hide') : t('app.common.actions.show')}
              >
                {showFp ? <EyeOff size={16} /> : <Eye size={16} />}
              </button>
              <button
                type="button"
                className={`copybtn${fpCopied ? ' ok' : ''}`}
                onClick={() => void copy(fingerprintPretty, setFpCopied)}
                aria-label={t('app.settings.account.gpg.copyFingerprint')}
                title={t('app.settings.account.gpg.copyFingerprint')}
              >
                {fpCopied ? <Check size={16} /> : <Copy size={16} />}
              </button>
            </div>
          ) : (
            <div style={{ color: 'var(--text-3)', fontSize: '13.5px' }}>
              {t('app.settings.keys.fingerprintUnavailable')}
            </div>
          )}
        </div>

        {keyId && (
          <div className="srow">
            <div className="sk">
              <div className="label">{t('app.settings.account.gpg.keyId')}</div>
            </div>
            <div className="sv keyval">{keyId}</div>
          </div>
        )}
        {algorithm && (
          <div className="srow">
            <div className="sk">
              <div className="label">{t('app.settings.keys.algorithm')}</div>
            </div>
            <div className="sv keyval">{algorithm}</div>
          </div>
        )}
        {bits != null && (
          <div className="srow">
            <div className="sk">
              <div className="label">{t('app.settings.account.gpg.keyBits')}</div>
            </div>
            <div className="sv keyval">
              {t('app.settings.account.gpg.bitsValue', { bits })}
            </div>
          </div>
        )}
        {userIds.length > 0 && (
          <div className="srow">
            <div className="sk">
              <div className="label">{t('app.settings.keys.userIds')}</div>
            </div>
            <div className="sv keyval" style={{ whiteSpace: 'normal', textAlign: 'right' }}>
              {userIds.join(', ')}
            </div>
          </div>
        )}
      </div>

      {/* Armored public key — safe to display, copy and share */}
      <div className="scard">
        <div className="scard-h">
          <KeyRound />
          <h3>{t('app.settings.keys.publicKey.title')}</h3>
        </div>
        <div style={{ padding: '15px 18px' }}>
          <div className="hint" style={{ marginBottom: 12, lineHeight: 1.5 }}>
            {t('app.settings.keys.publicKey.intro')}
          </div>

          {publicKeyArmored ? (
            <>
              {showPub && (
                <textarea
                  className="keybox"
                  readOnly
                  value={publicKeyArmored}
                  spellCheck={false}
                  aria-label={t('app.settings.keys.publicKey.title')}
                />
              )}
              <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginTop: showPub ? 12 : 0 }}>
                <button type="button" className="btn sm" onClick={() => setShowPub((s) => !s)}>
                  {showPub ? <EyeOff size={16} /> : <Eye size={16} />}
                  {showPub
                    ? t('app.settings.keys.publicKey.hide')
                    : t('app.settings.keys.publicKey.show')}
                </button>
                <button
                  type="button"
                  className="btn sm"
                  onClick={() => void copy(publicKeyArmored, setPubCopied)}
                >
                  {pubCopied ? <Check size={16} /> : <Copy size={16} />}
                  {pubCopied
                    ? t('app.common.actions.copied')
                    : t('app.settings.keys.publicKey.copy')}
                </button>
                <button type="button" className="btn sm" onClick={downloadPublicKey}>
                  <Download size={16} /> {t('app.settings.keys.publicKey.download')}
                </button>
              </div>
            </>
          ) : (
            <div style={{ color: 'var(--text-3)', fontSize: '13.5px' }}>
              {t('app.settings.keys.publicKey.unavailable')}
            </div>
          )}
        </div>
      </div>

      <div className="warn-soft">
        <KeyRound /> {t('app.settings.keys.privateKeyNote')}
      </div>
    </span>
  );
}

export default KeysTab;

/**
 * Passphrase section — change the passphrase that protects the account's
 * OpenPGP private key on THIS device.
 *
 * ZERO-KNOWLEDGE: the passphrase has no server-side existence. This form only
 * hands both strings to the background's CHANGE_PASSPHRASE RPC, which decrypts
 * the stored armored key with the current passphrase and re-encrypts it with the
 * new one, entirely inside the service worker. No request is made; the UI never
 * holds a decrypted key. On success the background LOCKS the vault, so the shell
 * drops to the unlock screen and the new passphrase is exercised immediately.
 *
 * The strength meter reuses the setup flow's ppScore/PP_LABEL so a passphrase
 * chosen here is judged exactly as one chosen at account creation.
 *
 * NO breach check (shared/pwned.ts) here, on purpose: HIBP's range API is
 * k-anonymous, but the master passphrase is the one secret whose SHA-1 prefix we
 * are not willing to hand to a third party — and official Passbolt does not
 * either. The generated-password fields keep their HIBP check.
 */
import { useState, type FormEvent } from 'react';
import { AlertTriangle, Check, KeyRound, Lock } from 'lucide-react';
import { rpc } from '../../../shared/messages';
import { t } from '../../../shared/i18n';
import { useToast } from '../../lib/toast';
import PassphraseInput from '../../components/PassphraseInput';
import { PP_LABEL, ppScore } from '../setup/flowHelpers';
import { ErrorBanner, SectionHeader } from './cardKit';

/** Minimum score (of 4) the setup flow demands; kept identical here. */
const MIN_SCORE = 3;

export function PassphraseTab() {
  const toast = useToast();
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const score = ppScore(next);
  const match = confirm.length === 0 || next === confirm;
  const canSubmit =
    current.length > 0 && next.length > 0 && next === confirm && score >= MIN_SCORE && !saving;

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!canSubmit) return;
    setSaving(true);
    setError(null);
    try {
      // The background re-encrypts the key and locks the vault; the shell reacts
      // to the resulting SESSION_CHANGED broadcast and shows the unlock screen.
      await rpc({
        type: 'CHANGE_PASSPHRASE',
        currentPassphrase: current,
        newPassphrase: next,
      });
      setCurrent('');
      setNext('');
      setConfirm('');
      toast.success(t('app.settings.passphrase.changed'));
    } catch (err: unknown) {
      const msg = (err instanceof Error && err.message) || t('app.settings.passphrase.failed');
      setError(msg);
      toast.error(msg);
    } finally {
      setSaving(false);
    }
  };

  return (
    <form onSubmit={submit} style={{ display: 'contents' }}>
      <SectionHeader
        title={t('app.settings.passphrase.title')}
        subtitle={t('app.settings.passphrase.subtitle')}
      />

      {error && (
        <div style={{ marginBottom: 18 }}>
          <ErrorBanner>{error}</ErrorBanner>
        </div>
      )}

      <div className="warn-soft" style={{ marginBottom: 18 }}>
        <AlertTriangle /> {t('app.settings.passphrase.warning')}
      </div>

      <div className="scard">
        <div className="scard-h">
          <KeyRound />
          <h3>{t('app.settings.passphrase.card.title')}</h3>
        </div>

        <div style={{ padding: '18px' }}>
          <div className="pp-fields">
            <div>
              <div className="pf-label">
                <Lock size={15} /> {t('app.settings.passphrase.current')}
              </div>
              {/* Security token badge + tinted focus ring (reads the stored mark)
                  so the passphrase fields here carry the same anti-phishing mark
                  as every other passphrase surface (white-paper SP-27). */}
              <PassphraseInput
                value={current}
                onChange={setCurrent}
                autoComplete="current-password"
                disabled={saving}
              />
            </div>

            <div>
              <div className="pf-label">
                <KeyRound size={15} /> {t('app.settings.passphrase.new')}
              </div>
              <PassphraseInput
                value={next}
                onChange={setNext}
                autoComplete="new-password"
                showToggle={false}
                disabled={saving}
              />
              {next && (
                <>
                  <div className={'pp-meter s' + score} style={{ marginTop: 10 }}>
                    <i />
                    <i />
                    <i />
                    <i />
                  </div>
                  <div className="pp-meter-row">
                    <span style={{ color: 'var(--text-3)' }}>
                      {t('app.settings.passphrase.strength')}
                    </span>
                    <span
                      style={{
                        color: score >= MIN_SCORE ? 'var(--green-text)' : 'var(--amber-text)',
                        fontWeight: 500,
                      }}
                    >
                      {PP_LABEL(score)}
                    </span>
                  </div>
                </>
              )}
            </div>

            <div>
              <div className="pf-label">
                <Check size={15} /> {t('app.settings.passphrase.confirm')}
              </div>
              <PassphraseInput
                value={confirm}
                onChange={setConfirm}
                err={!match}
                autoComplete="new-password"
                showToggle={false}
                disabled={saving}
              />
              {!match && (
                <div className="pf-err">
                  <AlertTriangle size={13} /> {t('app.settings.passphrase.mismatch')}
                </div>
              )}
            </div>
          </div>

          <div className="req-list">
            <div className={'req' + (next.length >= 8 ? ' ok' : '')}>
              <span className="rc">{next.length >= 8 && <Check />}</span>{' '}
              {t('app.auth.setup.passphrase.reqLength')}
            </div>
            <div
              className={
                'req' + (/[A-Z]/.test(next) && /[a-z]/.test(next) && /\d/.test(next) ? ' ok' : '')
              }
            >
              <span className="rc">
                {/[A-Z]/.test(next) && /[a-z]/.test(next) && /\d/.test(next) && <Check />}
              </span>{' '}
              {t('app.auth.setup.passphrase.reqMixed')}
            </div>
            <div className={'req' + (/[^A-Za-z0-9]/.test(next) ? ' ok' : '')}>
              <span className="rc">{/[^A-Za-z0-9]/.test(next) && <Check />}</span>{' '}
              {t('app.auth.setup.passphrase.reqSymbol')}
            </div>
          </div>

          <div style={{ display: 'flex', gap: 12, marginTop: 20 }}>
            <button type="submit" className="btn primary" disabled={!canSubmit}>
              {saving
                ? t('app.settings.passphrase.saving')
                : t('app.settings.passphrase.submit')}
            </button>
          </div>

          <div className="hint" style={{ marginTop: 12, lineHeight: 1.5 }}>
            {t('app.settings.passphrase.relockNote')}
          </div>
        </div>
      </div>
    </form>
  );
}

export default PassphraseTab;

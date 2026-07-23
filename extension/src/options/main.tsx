import { StrictMode, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { Globe, Lock, LogOut, ShieldCheck, Trash2 } from 'lucide-react';
import '../ui/base.css';
import '../ui/aegis.css';
import '../ui/jpb.css';
import {
  Btn, ErrorMsg, Header, PasswordGenerator, ServerForm, Spinner, useStatus,
} from '../ui/components';
import { rpc, type StatusResult } from '../shared/messages';
import { getLocale, setLocale, t, type Locale } from '../shared/i18n';

function Options() {
  const { status, setStatus } = useStatus();
  const [flash, setFlash] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  // Local copy of the active locale; bumping it forces a re-render of every
  // t(...) call after the user switches language (t() reads the module cache).
  const [locale, setLocaleState] = useState<Locale>(getLocale());

  const apply = (s: StatusResult, msg: string) => { setStatus(s); setFlash(msg); setTimeout(() => setFlash(null), 2000); };
  const lock = async () => { try { apply(await rpc({ type: 'LOCK' }), t('options.flash.vaultLocked')); } catch (e) { setErr(String(e)); } };
  // Ends the session only: the account key stays, so the next visit lands on the
  // passphrase screen rather than back at onboarding.
  const signOut = async () => { try { apply(await rpc({ type: 'LOGOUT' }), t('options.flash.loggedOut')); } catch (e) { setErr(String(e)); } };
  // Destructive and irreversible without the user's own key backup (the server
  // never holds the private key) — always confirm before firing.
  const removeAccount = async () => {
    if (!window.confirm(t('options.removeAccountConfirm'))) return;
    try { apply(await rpc({ type: 'REMOVE_ACCOUNT' }), t('options.flash.accountRemoved')); } catch (e) { setErr(String(e)); }
  };
  const changeLanguage = async (l: Locale) => {
    await setLocale(l);
    setLocaleState(l);
    setFlash(t('options.flash.languageChanged'));
    setTimeout(() => setFlash(null), 2000);
  };

  if (!status) return <div className="jpb-body"><Spinner label={t('flow.loading')} /></div>;

  return (
    <div className="jpb-shell">
      <Header account={status.account} />
      <div className="jpb-body">
        {flash ? <div className="jpb-ok">{flash}</div> : null}
        <ErrorMsg text={err} />

        <div className="jpb-card">
          <div className="jpb-h2"><Globe size={16} style={{ verticalAlign: '-2px', marginRight: 6 }} />{t('options.language')}</div>
          <p className="jpb-muted">{t('options.languageIntro')}</p>
          <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
            <Btn variant={locale === 'zh' ? 'primary' : 'default'} onClick={() => changeLanguage('zh')}>{t('options.lang.zh')}</Btn>
            <Btn variant={locale === 'en' ? 'primary' : 'default'} onClick={() => changeLanguage('en')}>{t('options.lang.en')}</Btn>
          </div>
        </div>

        <ServerForm initial={status.serverUrl} onDone={(s) => apply(s, t('options.flash.serverSaved'))} />

        <PasswordGenerator />

        <div className="jpb-card">
          <div className="jpb-h2"><ShieldCheck size={16} style={{ verticalAlign: '-2px', marginRight: 6 }} />{t('options.session')}</div>
          <p className="jpb-muted">
            {t('options.status')}: <strong>{t('phase.' + status.phase)}</strong>
            {status.account ? <> · {status.account.username} · {status.account.fingerprint.slice(0, 16)}…</> : null}
          </p>
          <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
            <Btn onClick={lock} disabled={status.phase !== 'unlocked'}><Lock size={14} /> {t('options.lockVault')}</Btn>
            <Btn onClick={signOut} disabled={status.phase === 'no_server' || status.phase === 'no_account'}>
              <LogOut size={14} /> {t('options.signOut')}
            </Btn>
          </div>
          <p className="jpb-muted" style={{ marginTop: 16 }}>{t('options.removeAccountHint')}</p>
          <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
            <Btn onClick={removeAccount} disabled={status.phase === 'no_server' || status.phase === 'no_account'}>
              <Trash2 size={14} /> {t('options.removeAccount')}
            </Btn>
          </div>
        </div>

        <div className="jpb-card">
          <div className="jpb-h2">{t('options.about')}</div>
          <p className="jpb-muted">{t('options.aboutBody')}</p>
        </div>
      </div>
    </div>
  );
}

createRoot(document.getElementById('root')!).render(
  <StrictMode><Options /></StrictMode>,
);

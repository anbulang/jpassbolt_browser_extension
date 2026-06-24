import { StrictMode, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { Lock, LogOut, ShieldCheck } from 'lucide-react';
import '../ui/base.css';
import '../ui/aegis.css';
import '../ui/jpb.css';
import {
  Btn, ErrorMsg, Header, KeyImportForm, PasswordGenerator, ServerForm, Spinner, useStatus,
} from '../ui/components';
import { rpc, type StatusResult } from '../shared/messages';

function Options() {
  const { status, setStatus } = useStatus();
  const [flash, setFlash] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const apply = (s: StatusResult, msg: string) => { setStatus(s); setFlash(msg); setTimeout(() => setFlash(null), 2000); };
  const lock = async () => { try { apply(await rpc({ type: 'LOCK' }), 'Vault locked.'); } catch (e) { setErr(String(e)); } };
  const logout = async () => { try { apply(await rpc({ type: 'LOGOUT' }), 'Account removed from this browser.'); } catch (e) { setErr(String(e)); } };

  if (!status) return <div className="jpb-body"><Spinner label="Loading…" /></div>;

  return (
    <div className="jpb-shell">
      <Header account={status.account} />
      <div className="jpb-body">
        {flash ? <div className="jpb-ok">{flash}</div> : null}
        <ErrorMsg text={err} />

        <ServerForm initial={status.serverUrl} onDone={(s) => apply(s, 'Server saved.')} />

        <KeyImportForm onDone={(s) => apply(s, 'Key imported.')} />

        <PasswordGenerator />

        <div className="jpb-card">
          <div className="jpb-h2"><ShieldCheck size={16} style={{ verticalAlign: '-2px', marginRight: 6 }} />Session</div>
          <p className="jpb-muted">
            Status: <strong>{status.phase}</strong>
            {status.account ? <> · {status.account.username} · {status.account.fingerprint.slice(0, 16)}…</> : null}
          </p>
          <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
            <Btn onClick={lock} disabled={status.phase !== 'unlocked'}><Lock size={14} /> Lock vault</Btn>
            <Btn onClick={logout}><LogOut size={14} /> Remove account</Btn>
          </div>
        </div>

        <div className="jpb-card">
          <div className="jpb-h2">About</div>
          <p className="jpb-muted">
            JPassbolt browser extension — an Aegis-styled, Passbolt-compatible E2EE client.
            Your private key and all decryption run only inside the extension's background
            service worker; web pages never see your key or passphrase. The vault auto-locks
            after 15 minutes of inactivity.
          </p>
        </div>
      </div>
    </div>
  );
}

createRoot(document.getElementById('root')!).render(
  <StrictMode><Options /></StrictMode>,
);

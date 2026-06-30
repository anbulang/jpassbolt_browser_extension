import { StrictMode, useMemo, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { Copy, Eye, EyeOff, LogIn, Plus, RefreshCw, Search, Settings, ShieldAlert } from 'lucide-react';
import '../ui/base.css';
import '../ui/aegis.css';
import '../ui/jpb.css';
import {
  Btn, CreateResourceForm, ErrorMsg, Flow, Header, Spinner, TotpView, initials, useStatus, useVault,
} from '../ui/components';
import { rpc, type SecretFields, type StatusResult, type VaultItem } from '../shared/messages';
import { t } from '../shared/i18n';

/**
 * The web page the full-page app should act on. The app lives in its own
 * chrome-extension:// tab (where no content script runs), so "fill" must target
 * the most recently used http(s) tab, not the active tab (which is the app).
 */
async function lastWebTab(): Promise<chrome.tabs.Tab | null> {
  const tabs = await chrome.tabs.query({ url: ['http://*/*', 'https://*/*'] });
  if (!tabs.length) return null;
  return tabs.reduce((a, b) =>
    (((b as { lastAccessed?: number }).lastAccessed ?? 0) > ((a as { lastAccessed?: number }).lastAccessed ?? 0) ? b : a));
}

function Detail({ item }: { item: VaultItem }) {
  const [secret, setSecret] = useState<SecretFields | null>(null);
  const [show, setShow] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [flash, setFlash] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [pwned, setPwned] = useState<number | null>(null);
  const [checking, setChecking] = useState(false);

  const reveal = async () => {
    setErr(null); setBusy(true);
    try { setSecret((await rpc({ type: 'REVEAL', id: item.id })).secret); setShow(true); }
    catch (e) { setErr(e instanceof Error ? e.message : String(e)); }
    finally { setBusy(false); }
  };
  const copy = async () => {
    try {
      const s = secret ?? (await rpc({ type: 'REVEAL', id: item.id })).secret;
      setSecret(s);
      await rpc({ type: 'COPY', text: s.password, temporary: true });
      setFlash(t('detail.copied30s')); setTimeout(() => setFlash(null), 1800);
    } catch (e) { setErr(e instanceof Error ? e.message : String(e)); }
  };
  const fill = async () => {
    try {
      const tab = await lastWebTab();
      if (!tab?.id) { setErr(t('detail.noOpenPage')); return; }
      const r = await rpc({ type: 'FILL', id: item.id, tabId: tab.id });
      setFlash(r.filled ? t('detail.filledPage') : t('detail.noLoginFormPage'));
      setTimeout(() => setFlash(null), 2200);
    } catch (e) { setErr(e instanceof Error ? e.message : String(e)); }
  };
  const copyTotp = async (code: string) => {
    try { await rpc({ type: 'COPY', text: code, temporary: true }); setFlash(t('detail.codeCopied30s')); setTimeout(() => setFlash(null), 1800); }
    catch (e) { setErr(e instanceof Error ? e.message : String(e)); }
  };
  const fillTotpOnPage = async () => {
    try {
      const tab = await lastWebTab();
      if (!tab?.id) { setErr(t('detail.noOpenPage')); return; }
      const r = await rpc({ type: 'FILL_TOTP', id: item.id, tabId: tab.id });
      setFlash(r.filled ? t('detail.filledCode') : t('detail.noCodeField'));
      setTimeout(() => setFlash(null), 2200);
    } catch (e) { setErr(e instanceof Error ? e.message : String(e)); }
  };
  const checkBreach = async () => {
    if (!secret) return;
    setChecking(true);
    try { setPwned((await rpc({ type: 'PWNED', password: secret.password })).count); }
    catch { setPwned(-1); }
    finally { setChecking(false); }
  };

  return (
    <div className="jpb-card jpb-secret">
      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        <div className="jpb-row-icon" style={{ width: 44, height: 44, fontSize: 18 }}>{initials(item.name)}</div>
        <div style={{ minWidth: 0 }}>
          <div className="jpb-h2" style={{ margin: 0 }}>{item.name}</div>
          {item.uri ? <a className="jpb-link" href={item.uri.includes('://') ? item.uri : `https://${item.uri}`} target="_blank" rel="noreferrer">{item.uri}</a> : null}
        </div>
      </div>

      <div className="jpb-field" style={{ margin: 0 }}>
        <span className="jpb-label">{t('detail.username')}</span>
        <div className="jpb-secret-val" style={{ fontFamily: 'var(--sans)' }}>{item.username || t('common.dash')}</div>
      </div>

      <div className="jpb-field" style={{ margin: 0 }}>
        <span className="jpb-label">{t('detail.password')}</span>
        {secret ? (
          <div className="jpb-secret-val">{show ? secret.password : '••••••••••'}</div>
        ) : (
          <div className="jpb-secret-val" style={{ color: 'var(--text-muted)' }}>{t('detail.passwordLocked')}</div>
        )}
      </div>

      {secret?.description ? (
        <div className="jpb-field" style={{ margin: 0 }}>
          <span className="jpb-label">{t('detail.description')}</span>
          <div className="jpb-secret-val" style={{ fontFamily: 'var(--sans)' }}>{secret.description}</div>
        </div>
      ) : null}

      {secret?.totp ? <TotpView cfg={secret.totp} onCopy={copyTotp} onFill={fillTotpOnPage} /> : null}

      <ErrorMsg text={err} />
      {flash ? <div className="jpb-ok">{flash}</div> : null}
      {pwned !== null ? (
        pwned === -1 ? <div className="jpb-muted" style={{ fontSize: 12 }}>{t('breach.unavailable')}</div>
          : pwned === 0 ? <div className="jpb-ok">{t('breach.notFound')}</div>
            : <div className="jpb-error">{t('breach.foundConsiderChanging', { count: pwned.toLocaleString() })}</div>
      ) : null}

      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        {!secret ? (
          <Btn variant="primary" onClick={reveal} disabled={busy}><Eye size={14} /> {busy ? t('detail.decrypting') : t('detail.reveal')}</Btn>
        ) : (
          <Btn onClick={() => setShow((s) => !s)}>{show ? <><EyeOff size={14} /> {t('detail.hide')}</> : <><Eye size={14} /> {t('detail.show')}</>}</Btn>
        )}
        <Btn onClick={copy}><Copy size={14} /> {t('detail.copyPassword')}</Btn>
        <Btn onClick={fill}><LogIn size={14} /> {t('detail.fillActiveTab')}</Btn>
        {secret ? <Btn onClick={checkBreach} disabled={checking}><ShieldAlert size={14} /> {checking ? t('detail.checking') : t('detail.breachCheck')}</Btn> : null}
      </div>
    </div>
  );
}

function Vault() {
  const { items, err, reload } = useVault(true);
  const [q, setQ] = useState('');
  const [selected, setSelected] = useState<VaultItem | null>(null);
  const [creating, setCreating] = useState(false);

  const filtered = useMemo(() => {
    const all = items ?? [];
    const n = q.trim().toLowerCase();
    return n ? all.filter((i) => [i.name, i.username, i.uri].some((f) => f.toLowerCase().includes(n))) : all;
  }, [items, q]);

  return (
    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 18, alignItems: 'start' }}>
      <div className="jpb-card" style={{ padding: 12 }}>
        <div style={{ display: 'flex', gap: 8, marginBottom: 10 }}>
          <div style={{ position: 'relative', flex: 1 }}>
            <Search size={15} style={{ position: 'absolute', left: 10, top: 10, color: 'var(--text-muted)' }} />
            <input className="jpb-search" style={{ paddingLeft: 32 }} placeholder={t('vault.searchShort')} value={q} onChange={(e) => setQ(e.target.value)} />
          </div>
          <Btn variant="primary" title={t('create.title')} onClick={() => { setCreating(true); setSelected(null); }}><Plus size={14} /> {t('common.new')}</Btn>
          <Btn variant="ghost" title={t('common.refresh')} onClick={() => reload(true)}><RefreshCw size={14} /></Btn>
        </div>
        <ErrorMsg text={err} />
        {!items ? <Spinner label={t('flow.loadingVault')} /> :
          filtered.length === 0 ? <div className="jpb-empty">{t('vault.noneYet')}</div> :
            <div className="jpb-list" style={{ maxHeight: '70vh' }}>
              {filtered.map((i) => (
                <div key={i.id} className="jpb-row" onClick={() => { setSelected(i); setCreating(false); }} style={selected?.id === i.id ? { background: 'var(--surface-2)', borderColor: 'var(--border)' } : undefined}>
                  <div className="jpb-row-icon">{initials(i.name)}</div>
                  <div className="jpb-row-main">
                    <div className="jpb-row-name">{i.name}</div>
                    <div className="jpb-row-sub">{i.username || i.uri || t('common.dash')}</div>
                  </div>
                </div>
              ))}
            </div>}
      </div>
      <div>
        {creating ? (
          <CreateResourceForm
            onCreated={(item) => { setCreating(false); reload(true); setSelected(item); }}
            onCancel={() => setCreating(false)}
          />
        ) : selected ? (
          <Detail key={selected.id} item={selected} />
        ) : (
          <div className="jpb-card jpb-empty">{t('vault.selectHint')}</div>
        )}
      </div>
    </div>
  );
}

function App() {
  const { status, setStatus } = useStatus();
  const lock = async () => setStatus(await rpc({ type: 'LOCK' }));
  return (
    <div className="jpb-shell">
      <Header
        account={status?.account ?? null}
        onLock={status?.phase === 'unlocked' ? lock : undefined}
        right={<Btn small variant="ghost" title={t('header.settings')} onClick={() => chrome.runtime.openOptionsPage()}><Settings size={14} /></Btn>}
      />
      <div className="jpb-body">
        <Flow status={status} onChange={(s: StatusResult) => setStatus(s)}>
          <Vault />
        </Flow>
      </div>
    </div>
  );
}

createRoot(document.getElementById('root')!).render(
  <StrictMode><App /></StrictMode>,
);

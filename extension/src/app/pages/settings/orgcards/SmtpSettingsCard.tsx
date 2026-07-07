/**
 * SMTP (email server) settings card (admin only) — ported from the SPA
 * Settings.tsx SmtpSettingsCard. GET/POST /smtp/settings.json plus a
 * test-email action (POST /smtp/email.json) that surfaces the backend's
 * credentials-masked SMTP wire trace — on failure too, where the 400 body
 * still carries `debug`.
 */
import { useEffect, useState } from 'react';
import { Eye, EyeOff, Mail, Send } from 'lucide-react';
import {
  getSmtpSettings,
  saveSmtpSettings,
  sendTestEmail,
  type SmtpSettings,
  type SmtpSettingsWrite,
} from '../../../services/smtpSettings';
import { describeApiError } from '../../../lib/errors';
import { useToast } from '../../../lib/toast';
import { tf } from '../../../lib/i18n';
import { CardSpinner, ErrorBanner } from '../OrgPoliciesSection';

interface SmtpForm {
  sender_name: string;
  sender_email: string;
  host: string;
  port: string;
  tls: boolean;
  username: string;
  password: string;
  client: string;
}

const EMPTY_SMTP_FORM: SmtpForm = {
  sender_name: '',
  sender_email: '',
  host: '',
  port: '',
  tls: true,
  username: '',
  password: '',
  client: '',
};

/**
 * Coerce the backend's permissive tls value (bool/number/string) to a boolean.
 * The backend renders disabled TLS as `null` (PHP mapTlsToTrueOrNull; the env
 * fallback also returns null), so null/unknown MUST map to false — defaulting to
 * true would silently flip a plain SMTP relay (e.g. port 25, no STARTTLS) to TLS
 * on the next save and break delivery.
 */
function coerceTls(v: unknown): boolean {
  if (typeof v === 'boolean') return v;
  if (typeof v === 'number') return v !== 0;
  if (typeof v === 'string') {
    const s = v.trim().toLowerCase();
    return s === 'true' || s === '1' || s === 'tls' || s === 'ssl' || s === 'starttls';
  }
  return false;
}

/** Parse the port field to a valid 1..65535 integer, or null when invalid/blank. */
function parsePort(raw: string): number | null {
  const s = raw.trim();
  if (!/^\d+$/.test(s)) return null;
  const n = Number(s);
  return n >= 1 && n <= 65535 ? n : null;
}

function smtpToForm(s: SmtpSettings): SmtpForm {
  return {
    sender_name: s.sender_name ?? '',
    sender_email: s.sender_email ?? '',
    host: s.host ?? '',
    port: s.port != null ? String(s.port) : '',
    tls: coerceTls(s.tls),
    username: s.username ?? '',
    password: s.password ?? '',
    client: s.client ?? '',
  };
}

function smtpToWrite(f: SmtpForm, port: number): SmtpSettingsWrite {
  return {
    sender_name: f.sender_name.trim(),
    sender_email: f.sender_email.trim(),
    host: f.host.trim(),
    port,
    tls: f.tls,
    client: f.client.trim(),
    username: f.username,
    password: f.password,
  };
}

export function SmtpSettingsCard() {
  const toast = useToast();
  const [form, setForm] = useState<SmtpForm>(EMPTY_SMTP_FORM);
  const [source, setSource] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [showPw, setShowPw] = useState(false);

  // Test-email sub-state.
  const [testTo, setTestTo] = useState('');
  const [testing, setTesting] = useState(false);
  const [trace, setTrace] = useState<string[] | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    (async () => {
      setLoading(true);
      setError(null);
      try {
        const s = await getSmtpSettings(controller.signal);
        if (!controller.signal.aborted) {
          setForm(smtpToForm(s));
          setSource(s.source ?? null);
        }
      } catch (err: unknown) {
        if (controller.signal.aborted) return;
        setError(describeApiError(err));
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    })();
    return () => controller.abort();
  }, []);

  const handleSave = async () => {
    const port = parsePort(form.port);
    if (port === null) {
      const msg = tf('app.administration.smtp.invalidPort', '请输入有效的端口号（1–65535）。');
      setError(msg);
      toast.error(msg);
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const updated = await saveSmtpSettings(smtpToWrite(form, port));
      setForm(smtpToForm(updated));
      setSource(updated.source ?? 'db');
      toast.success(tf('app.administration.smtp.saved', 'SMTP 设置已保存。'));
    } catch (err: unknown) {
      const msg = describeApiError(err);
      setError(msg);
      toast.error(msg);
    } finally {
      setSaving(false);
    }
  };

  const handleTest = async () => {
    if (!testTo.trim()) {
      toast.error(tf('app.administration.smtp.test.needRecipient', '请先填写收件人地址。'));
      return;
    }
    const port = parsePort(form.port);
    if (port === null) {
      toast.error(tf('app.administration.smtp.invalidPort', '请输入有效的端口号（1–65535）。'));
      return;
    }
    setTesting(true);
    setTrace(null);
    try {
      const res = await sendTestEmail({ ...smtpToWrite(form, port), email_test_to: testTo.trim() });
      setTrace(res.debug ?? []);
      toast.success(
        tf('app.administration.smtp.test.success', '测试邮件已发送，请查看下方服务器追踪。'),
      );
    } catch (err: unknown) {
      // A delivery/validation failure (400) still carries the masked trace
      // under body.debug — show it so the admin can diagnose.
      const e = err as { response?: { data?: { body?: { debug?: string[] } } } };
      const debug = e.response?.data?.body?.debug;
      if (Array.isArray(debug)) setTrace(debug);
      toast.error(describeApiError(err));
    } finally {
      setTesting(false);
    }
  };

  const sourceKey = source === 'db' || source === 'env' ? source : 'undefined';

  return (
    <div className="scard">
      <div className="scard-h">
        <Mail />
        <h3>{tf('app.administration.smtp.title', '邮件服务器（SMTP）')}</h3>
        {source && (
          <span
            className={`chip ${source === 'db' ? 'green' : 'neutral'}`}
            style={{ marginLeft: 'auto' }}
          >
            {tf(`app.administration.smtp.source.${sourceKey}`, sourceKey)}
          </span>
        )}
      </div>

      {loading ? (
        <div style={{ padding: '15px 18px' }}>
          <CardSpinner label={tf('app.administration.smtp.loading', '正在加载 SMTP 设置…')} />
        </div>
      ) : (
        <>
          <div style={{ padding: '15px 18px 0' }}>
            <div className="hint" style={{ lineHeight: 1.5 }}>
              {tf(
                'app.administration.smtp.subtitle',
                '配置用于发送邀请、恢复链接和通知的外发邮件服务器。',
              )}
            </div>
            {source === 'env' && (
              <div style={{ marginTop: 12 }}>
                <ErrorBanner>
                  {tf(
                    'app.administration.smtp.envNote',
                    '这些值来自服务器环境变量。在此保存会写入数据库覆盖项，并优先生效。',
                  )}
                </ErrorBanner>
              </div>
            )}
            {error && (
              <div style={{ marginTop: 12 }}>
                <ErrorBanner>{error}</ErrorBanner>
              </div>
            )}
          </div>

          <div className="srow">
            <div className="sk">
              <div className="label">
                {tf('app.administration.smtp.fields.senderName', '发件人名称')}
              </div>
              <div className="hint">
                {tf(
                  'app.administration.smtp.fields.senderNameHint',
                  '收件人看到的显示名称（如 “JPassbolt”）。',
                )}
              </div>
            </div>
            <div className="sv">
              <input
                className="sinput sans"
                value={form.sender_name}
                disabled={saving}
                onChange={(e) => setForm((f) => ({ ...f, sender_name: e.target.value }))}
              />
            </div>
          </div>

          <div className="srow">
            <div className="sk">
              <div className="label">
                {tf('app.administration.smtp.fields.senderEmail', '发件人邮箱')}
              </div>
              <div className="hint">
                {tf(
                  'app.administration.smtp.fields.senderEmailHint',
                  '所有外发邮件的 “发件人” 地址。',
                )}
              </div>
            </div>
            <div className="sv">
              <input
                className="sinput sans"
                type="email"
                value={form.sender_email}
                disabled={saving}
                onChange={(e) => setForm((f) => ({ ...f, sender_email: e.target.value }))}
              />
            </div>
          </div>

          <div className="srow">
            <div className="sk">
              <div className="label">{tf('app.administration.smtp.fields.host', 'SMTP 主机')}</div>
            </div>
            <div className="sv">
              <input
                className="sinput"
                value={form.host}
                disabled={saving}
                placeholder="smtp.example.com"
                onChange={(e) => setForm((f) => ({ ...f, host: e.target.value }))}
              />
            </div>
          </div>

          <div className="srow">
            <div className="sk">
              <div className="label">{tf('app.administration.smtp.fields.port', '端口')}</div>
            </div>
            <div className="sv">
              <input
                className="sinput"
                inputMode="numeric"
                value={form.port}
                disabled={saving}
                placeholder="587"
                onChange={(e) => setForm((f) => ({ ...f, port: e.target.value }))}
              />
            </div>
          </div>

          <div className="srow">
            <div className="sk">
              <div className="label">{tf('app.administration.smtp.fields.tls', '使用 TLS')}</div>
              <div className="hint">
                {tf('app.administration.smtp.fields.tlsHint', '对与邮件服务器的连接加密。')}
              </div>
            </div>
            <div className="sv">
              <button
                type="button"
                className={`switch${form.tls ? ' on' : ''}`}
                onClick={() => setForm((f) => ({ ...f, tls: !f.tls }))}
                disabled={saving}
                aria-pressed={form.tls}
                aria-label={tf('app.administration.smtp.fields.tls', '使用 TLS')}
              />
            </div>
          </div>

          <div className="srow">
            <div className="sk">
              <div className="label">{tf('app.administration.smtp.fields.username', '用户名')}</div>
            </div>
            <div className="sv">
              <input
                className="sinput"
                value={form.username}
                disabled={saving}
                autoComplete="off"
                onChange={(e) => setForm((f) => ({ ...f, username: e.target.value }))}
              />
            </div>
          </div>

          <div className="srow">
            <div className="sk">
              <div className="label">{tf('app.administration.smtp.fields.password', '密码')}</div>
            </div>
            <div className="sv" style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              <input
                className="sinput"
                type={showPw ? 'text' : 'password'}
                value={form.password}
                disabled={saving}
                autoComplete="new-password"
                style={{ flex: 1 }}
                onChange={(e) => setForm((f) => ({ ...f, password: e.target.value }))}
              />
              <button
                type="button"
                className="copybtn"
                onClick={() => setShowPw((v) => !v)}
                aria-label={
                  showPw
                    ? tf('app.common.actions.hide', '隐藏')
                    : tf('app.common.actions.show', '显示')
                }
                title={
                  showPw
                    ? tf('app.common.actions.hide', '隐藏')
                    : tf('app.common.actions.show', '显示')
                }
              >
                {showPw ? <EyeOff size={16} /> : <Eye size={16} />}
              </button>
            </div>
          </div>

          <div className="srow">
            <div className="sk">
              <div className="label">
                {tf('app.administration.smtp.fields.client', '客户端（HELO/EHLO）')}
              </div>
              <div className="hint">
                {tf(
                  'app.administration.smtp.fields.clientHint',
                  '可选。本服务器向 SMTP 服务器声明的主机名。',
                )}
              </div>
            </div>
            <div className="sv">
              <input
                className="sinput"
                value={form.client}
                disabled={saving}
                onChange={(e) => setForm((f) => ({ ...f, client: e.target.value }))}
              />
            </div>
          </div>

          <div style={{ padding: '4px 18px 16px' }}>
            <button
              type="button"
              className="btn primary"
              onClick={() => void handleSave()}
              disabled={saving}
            >
              {saving ? <span className="spin-ring" /> : null}
              {tf('app.administration.smtp.save', '保存设置')}
            </button>
          </div>

          {/* Test email */}
          <div className="scard-h" style={{ borderTop: '1px solid var(--border)' }}>
            <Send />
            <h3>{tf('app.administration.smtp.test.title', '发送测试邮件')}</h3>
          </div>
          <div style={{ padding: '15px 18px' }}>
            <div className="hint" style={{ marginBottom: 12, lineHeight: 1.5 }}>
              {tf(
                'app.administration.smtp.test.subtitle',
                '用上面的设置发送一封测试邮件——无需先保存。',
              )}
            </div>
            <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
              <input
                className="sinput sans"
                type="email"
                value={testTo}
                disabled={testing}
                placeholder={tf(
                  'app.administration.smtp.test.recipientPlaceholder',
                  'you@example.com',
                )}
                aria-label={tf('app.administration.smtp.test.recipient', '测试邮件收件人')}
                style={{ flex: 1, minWidth: 220 }}
                onChange={(e) => setTestTo(e.target.value)}
              />
              <button
                type="button"
                className="btn"
                onClick={() => void handleTest()}
                disabled={testing}
              >
                {testing ? <span className="spin-ring" /> : <Send size={16} />}
                {testing
                  ? tf('app.administration.smtp.test.sending', '发送中…')
                  : tf('app.administration.smtp.test.send', '发送测试邮件')}
              </button>
            </div>
            {trace && (
              <div style={{ marginTop: 12 }}>
                <div className="hint" style={{ marginBottom: 6 }}>
                  {tf('app.administration.smtp.test.traceTitle', 'SMTP 追踪')}
                </div>
                <pre
                  style={{
                    margin: 0,
                    padding: 12,
                    background: 'var(--surface-3)',
                    border: '1px solid var(--border)',
                    borderRadius: 9,
                    fontSize: 12,
                    lineHeight: 1.5,
                    whiteSpace: 'pre-wrap',
                    wordBreak: 'break-word',
                    maxHeight: 260,
                    overflow: 'auto',
                    fontFamily: 'var(--mono)',
                    color: 'var(--text-2)',
                  }}
                >
                  {trace.length ? trace.join('\n') : '—'}
                </pre>
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}

export default SmtpSettingsCard;

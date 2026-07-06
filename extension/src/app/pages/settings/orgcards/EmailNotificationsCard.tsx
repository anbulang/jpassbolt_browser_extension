/**
 * Email-notification policy card (admin only) — ported from the SPA
 * Settings.tsx EmailNotificationsCard. 25 grouped toggles; each change is
 * saved instantly (optimistic flip, revert on failure).
 */
import { useEffect, useState } from 'react';
import { Mail } from 'lucide-react';
import {
  getEmailNotificationSettings,
  setEmailNotificationSettings,
} from '../../../services/orgPolicies';
import type { EmailNotificationSettings } from '../../../../shared/types';
import { describeApiError } from '../../../lib/errors';
import { useToast } from '../../../lib/toast';
import { tf } from '../../../lib/i18n';
import { CardSpinner, ErrorBanner } from '../OrgPoliciesSection';

/** A notification-toggle key (one of the 25 EmailNotificationSettings flags). */
type EmailNotifKey = keyof EmailNotificationSettings;

/**
 * The 25 toggles grouped by prefix for display. Order is stable and each key is
 * unique, so the rendered checkbox list keys on the toggle key (never an index).
 */
const EMAIL_NOTIF_GROUPS: { groupKey: string; keys: EmailNotifKey[] }[] = [
  {
    groupKey: 'content',
    keys: ['show_username', 'show_uri', 'show_secret', 'show_description', 'show_comment'],
  },
  {
    groupKey: 'password',
    keys: [
      'send_password_create',
      'send_password_update',
      'send_password_delete',
      'send_password_share',
    ],
  },
  {
    groupKey: 'comment',
    keys: ['send_comment_add', 'send_comment_update', 'send_comment_delete'],
  },
  {
    groupKey: 'folder',
    keys: [
      'send_folder_create',
      'send_folder_update',
      'send_folder_delete',
      'send_folder_share',
    ],
  },
  {
    groupKey: 'group',
    keys: [
      'send_group_delete',
      'send_group_user_add',
      'send_group_user_delete',
      'send_group_user_update',
      'send_group_manager_update',
    ],
  },
  {
    groupKey: 'user',
    keys: [
      'send_user_create',
      'send_user_recover',
      'send_admin_user_setup_completed',
      'send_admin_user_recover_complete',
    ],
  },
];

export function EmailNotificationsCard() {
  const toast = useToast();

  const [settings, setSettings] = useState<EmailNotificationSettings | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  // Per-toggle in-flight guard so a key cannot be double-submitted mid-request.
  const [pending, setPending] = useState<Set<EmailNotifKey>>(() => new Set());

  useEffect(() => {
    // The abort controller only drops the stale response after unmount (the
    // API_CALL itself is not abortable across the RPC boundary).
    const controller = new AbortController();
    (async () => {
      setLoading(true);
      setError(null);
      try {
        const s = await getEmailNotificationSettings(controller.signal);
        if (!controller.signal.aborted) setSettings(s);
      } catch (err: unknown) {
        if (controller.signal.aborted) return;
        setError(describeApiError(err));
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    })();
    return () => controller.abort();
  }, []);

  const toggle = async (key: EmailNotifKey, next: boolean) => {
    if (!settings || pending.has(key)) return;
    const previous = settings[key];
    // Optimistic update so the switch responds instantly.
    setSettings({ ...settings, [key]: next });
    setPending((p) => new Set(p).add(key));
    try {
      const updated = await setEmailNotificationSettings({ [key]: next });
      setSettings(updated);
    } catch (err: unknown) {
      // Revert just this key on failure; surface via describeApiError.
      setSettings((curr) => (curr ? { ...curr, [key]: previous } : curr));
      toast.error(describeApiError(err));
    } finally {
      setPending((p) => {
        const nextSet = new Set(p);
        nextSet.delete(key);
        return nextSet;
      });
    }
  };

  return (
    <div className="scard">
      <div className="scard-h">
        <Mail />
        <h3>{tf('app.administration.orgPolicies.emails.title', '邮件通知')}</h3>
      </div>

      <div style={{ padding: '15px 18px' }}>
        <div className="hint" style={{ marginBottom: 14, lineHeight: 1.5 }}>
          {tf(
            'app.administration.orgPolicies.emails.subtitle',
            '控制服务器发送哪些事务性邮件，以及邮件中显示多少内容。更改将即时保存。',
          )}
        </div>

        {loading ? (
          <CardSpinner
            label={tf('app.administration.orgPolicies.emails.loading', '正在加载邮件通知设置……')}
          />
        ) : error ? (
          <ErrorBanner>{error}</ErrorBanner>
        ) : settings ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
            {EMAIL_NOTIF_GROUPS.map(({ groupKey, keys }) => (
              <fieldset
                key={groupKey}
                style={{ border: 'none', margin: 0, padding: 0, minWidth: 0 }}
              >
                <legend
                  style={{
                    fontSize: '12px',
                    fontWeight: 600,
                    color: 'var(--text-2)',
                    textTransform: 'uppercase',
                    letterSpacing: '0.04em',
                    marginBottom: '8px',
                    padding: 0,
                  }}
                >
                  {tf(`app.administration.orgPolicies.emails.groups.${groupKey}`, groupKey)}
                </legend>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                  {keys.map((key) => {
                    const inputId = `email-notif-${key}`;
                    return (
                      <label
                        key={key}
                        htmlFor={inputId}
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          gap: '10px',
                          fontSize: '13.5px',
                          cursor: pending.has(key) ? 'progress' : 'pointer',
                        }}
                      >
                        <input
                          id={inputId}
                          type="checkbox"
                          checked={settings[key]}
                          disabled={pending.has(key)}
                          onChange={(e) => void toggle(key, e.target.checked)}
                        />
                        <span>
                          {tf(`app.administration.orgPolicies.emails.toggles.${key}`, key)}
                        </span>
                      </label>
                    );
                  })}
                </div>
              </fieldset>
            ))}
          </div>
        ) : null}
      </div>
    </div>
  );
}

export default EmailNotificationsCard;

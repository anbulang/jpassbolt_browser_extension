/**
 * Password/passphrase generator policy card — ported from the SPA Settings.tsx
 * PasswordPolicyCard. Read-only in CE: any user may READ the policy, but this
 * card is only mounted inside the settings page's admin-gated section group.
 */
import { useEffect, useState } from 'react';
import { KeySquare } from 'lucide-react';
import { getPasswordPolicies } from '../../../services/orgPolicies';
import type { PasswordPolicies } from '../../../../shared/types';
import { describeApiError } from '../../../lib/errors';
import { tf } from '../../../lib/i18n';
import { Badge } from '../../../components/Badge';
import { CardSpinner, CardErrorBanner as ErrorBanner } from '../cardKit';

export function PasswordPolicyCard() {
  const [policy, setPolicy] = useState<PasswordPolicies | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    (async () => {
      setLoading(true);
      setError(null);
      try {
        const p = await getPasswordPolicies(controller.signal);
        if (!controller.signal.aborted) setPolicy(p);
      } catch (err: unknown) {
        if (controller.signal.aborted) return;
        setError(describeApiError(err));
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    })();
    return () => controller.abort();
  }, []);

  const generatorLabel = (gen: string): string => {
    if (gen === 'password' || gen === 'passphrase') {
      return tf(`app.administration.orgPolicies.password.generator.${gen}`, gen);
    }
    return gen;
  };

  return (
    <div className="scard">
      <div className="scard-h">
        <KeySquare />
        <h3>{tf('app.administration.orgPolicies.password.title', '密码策略')}</h3>
      </div>

      <div style={{ padding: '15px 18px 0' }}>
        <div className="hint" style={{ lineHeight: 1.5 }}>
          {tf(
            'app.administration.orgPolicies.password.readonly',
            '由 JPassbolt API 返回的只读策略。',
          )}
        </div>
      </div>

      {loading ? (
        <div style={{ padding: '15px 18px' }}>
          <CardSpinner
            label={tf('app.administration.orgPolicies.password.loading', '正在加载密码策略……')}
          />
        </div>
      ) : error ? (
        <div style={{ padding: '15px 18px' }}>
          <ErrorBanner>{error}</ErrorBanner>
        </div>
      ) : policy ? (
        <>
          <div className="srow">
            <div className="sk">
              <div className="label">
                {tf('app.administration.orgPolicies.password.defaultGenerator', '默认生成器')}
              </div>
            </div>
            <div className="sv">
              <Badge variant="default">{generatorLabel(policy.default_generator)}</Badge>
            </div>
          </div>

          <div className="srow">
            <div className="sk">
              <div className="label">
                {tf('app.administration.orgPolicies.password.passwordLength', '密码长度')}
              </div>
            </div>
            <div className="sv">
              {tf('app.administration.orgPolicies.password.lengthValue', '{{count}} 个字符', {
                count: policy.password_generator_settings.length,
              })}
            </div>
          </div>

          <div className="srow">
            <div className="sk">
              <div className="label">
                {tf('app.administration.orgPolicies.password.passphraseWords', '口令单词数')}
              </div>
            </div>
            <div className="sv">
              {tf('app.administration.orgPolicies.password.wordsValue', '{{count}} 个单词', {
                count: policy.passphrase_generator_settings.words,
              })}
            </div>
          </div>

          <div className="srow">
            <div className="sk">
              <div className="label">
                {tf(
                  'app.administration.orgPolicies.password.dictionaryCheck',
                  '外部词典 / 泄露检测',
                )}
              </div>
            </div>
            <div className="sv">
              <span
                className={`chip ${policy.external_dictionary_check ? 'green' : 'neutral'}`}
              >
                {policy.external_dictionary_check
                  ? tf('app.administration.orgPolicies.password.bool.yes', '是')
                  : tf('app.administration.orgPolicies.password.bool.no', '否')}
              </span>
            </div>
          </div>

          {policy.source && (
            <div className="srow">
              <div className="sk">
                <div className="label">
                  {tf('app.administration.orgPolicies.password.source', '策略来源')}
                </div>
              </div>
              <div
                className="sv"
                style={{ fontFamily: 'var(--mono)', fontSize: 13, color: 'var(--text-2)' }}
              >
                {policy.source}
              </div>
            </div>
          )}
        </>
      ) : null}
    </div>
  );
}

export default PasswordPolicyCard;

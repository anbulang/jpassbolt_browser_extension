/**
 * The credential row + list, shared by every quickaccess screen (Suggested,
 * search results, a filter's results, a group's results).
 *
 * Zero-knowledge: this component only ever renders METADATA (name / username /
 * uri) and hands ids back to the caller. Revealing or copying a password is a
 * background RPC in main.tsx — no plaintext, key material or decryption ever
 * touches this popup context.
 */
import { Copy, LogIn } from 'lucide-react';
import type { VaultItem } from '../shared/messages';
import { Btn, Spinner, initials } from '../ui/components';
import { t } from '../shared/i18n';

export interface RowActions {
  onFill: (id: string) => void;
  onCopy: (id: string) => void;
}

export function ResourceRow({ item, onFill, onCopy }: { item: VaultItem } & RowActions) {
  return (
    <div className="jpb-row" onClick={() => onFill(item.id)} title={t('vault.fillThisLogin')}>
      <div className="jpb-row-icon">{initials(item.name)}</div>
      <div className="jpb-row-main">
        <div className="jpb-row-name">{item.name}</div>
        <div className="jpb-row-sub">{item.username || item.uri || t('common.dash')}</div>
      </div>
      {/* Stop propagation so the action buttons don't also trigger the row's
          fill-and-close click handler (double FILL / interrupted copy). */}
      <div className="jpb-row-actions" onClick={(e) => e.stopPropagation()}>
        <Btn small variant="ghost" title={t('vault.copyPassword')} onClick={(e) => { e.stopPropagation(); onCopy(item.id); }}><Copy size={14} /></Btn>
        <Btn small variant="ghost" title={t('vault.fillLogin')} onClick={(e) => { e.stopPropagation(); onFill(item.id); }}><LogIn size={14} /></Btn>
      </div>
    </div>
  );
}

/**
 * `items === null` means "still loading" (spinner); an empty array renders
 * `empty`, which each screen phrases for itself.
 */
export function ResourceList({ items, empty, onFill, onCopy }: {
  items: VaultItem[] | null;
  empty: string;
  } & RowActions) {
  if (!items) return <Spinner label={t('flow.loadingVault')} />;
  if (items.length === 0) return <div className="jpb-empty">{empty}</div>;
  return (
    <div className="jpb-list">
      {items.map((i) => <ResourceRow key={i.id} item={i} onFill={onFill} onCopy={onCopy} />)}
    </div>
  );
}

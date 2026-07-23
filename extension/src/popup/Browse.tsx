/**
 * The "Browse" side of the official quickaccess layout: the drill-down return
 * bar, the navigational rows, and the two index screens (Filters / Groups).
 *
 * The popup has no router, so navigation is a plain view stack in main.tsx;
 * these components are pure presentation over callbacks.
 */
import { useEffect, useState, type ReactNode } from 'react';
import { ChevronLeft, ChevronRight, Clock, Share2, SlidersHorizontal, Star, User, Users, X } from 'lucide-react';
import { Btn, Spinner } from '../ui/components';
import { rpc } from '../shared/messages';
import type { QuickFilterKind, QuickGroup } from '../shared/rpc/vault';
import { t } from '../shared/i18n';

/** The drill-down header: "‹ Title ×" — back one level, or close the popup. */
export function NavBar({ title, onBack, onClose }: {
  title: string;
  onBack: () => void;
  onClose: () => void;
}) {
  return (
    <div className="jpb-navbar">
      <Btn small variant="ghost" title={t('qa.back')} onClick={onBack}><ChevronLeft size={16} /></Btn>
      <div className="jpb-navbar-title">{title}</div>
      <Btn small variant="ghost" title={t('qa.close')} onClick={onClose}><X size={14} /></Btn>
    </div>
  );
}

/** A row that drills one level deeper: glyph + label + chevron. */
export function BrowseRow({ icon, label, onClick }: {
  icon: ReactNode;
  label: string;
  onClick: () => void;
}) {
  return (
    <div
      className="jpb-row"
      role="button"
      tabIndex={0}
      onClick={onClick}
      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onClick(); } }}
    >
      <div className="jpb-row-icon jpb-row-icon-sm">{icon}</div>
      <div className="jpb-row-main">
        <div className="jpb-row-name">{label}</div>
      </div>
      <div className="jpb-row-chev"><ChevronRight size={16} /></div>
    </div>
  );
}

/**
 * The four filters, in the official order. `labelKey` (not a t() call) because
 * this is module-level: t() must run at render, after the locale is primed.
 */
export const QUICK_FILTERS: { kind: QuickFilterKind; labelKey: string; icon: ReactNode }[] = [
  { kind: 'favorite', labelKey: 'qa.filter.favorites', icon: <Star /> },
  { kind: 'owned', labelKey: 'qa.filter.owned', icon: <User /> },
  { kind: 'recent', labelKey: 'qa.filter.recent', icon: <Clock /> },
  { kind: 'shared', labelKey: 'qa.filter.shared', icon: <Share2 /> },
];

export function filterLabel(kind: QuickFilterKind): string {
  return t(QUICK_FILTERS.find((f) => f.kind === kind)?.labelKey ?? 'qa.filters');
}

/** Home's two entry rows: "Filters ›" and "Groups ›". */
export function BrowseSection({ onFilters, onGroups }: { onFilters: () => void; onGroups: () => void }) {
  return (
    <div>
      <div className="jpb-section">{t('qa.browse')}</div>
      <div className="jpb-list">
        <BrowseRow icon={<SlidersHorizontal />} label={t('qa.filters')} onClick={onFilters} />
        <BrowseRow icon={<Users />} label={t('qa.groups')} onClick={onGroups} />
      </div>
    </div>
  );
}

/** The Filters index screen. */
export function FilterList({ onPick }: { onPick: (kind: QuickFilterKind) => void }) {
  return (
    <div className="jpb-list">
      {QUICK_FILTERS.map((f) => (
        <BrowseRow key={f.kind} icon={f.icon} label={t(f.labelKey)} onClick={() => onPick(f.kind)} />
      ))}
    </div>
  );
}

/**
 * The Groups index screen — the groups the current user belongs to
 * (LIST_MY_GROUPS). Loads on mount; the popup is short-lived so there is no
 * refresh affordance, matching the official popup.
 */
export function GroupList({ onPick, onError }: {
  onPick: (group: QuickGroup) => void;
  onError: (message: string) => void;
}) {
  const [groups, setGroups] = useState<QuickGroup[] | null>(null);

  useEffect(() => {
    let alive = true;
    void (async () => {
      try {
        const r = await rpc({ type: 'LIST_MY_GROUPS' });
        if (alive) setGroups(r.groups);
      } catch (e) {
        if (!alive) return;
        setGroups([]);
        onError(e instanceof Error ? e.message : String(e));
      }
    })();
    return () => { alive = false; };
    // onError is a fresh closure each render; this must run once per mount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (!groups) return <Spinner label={t('qa.loadingGroups')} />;
  if (groups.length === 0) return <div className="jpb-empty">{t('qa.noGroups')}</div>;
  return (
    <div className="jpb-list">
      {groups.map((g) => (
        <BrowseRow key={g.id} icon={<Users />} label={g.name} onClick={() => onPick(g)} />
      ))}
    </div>
  );
}

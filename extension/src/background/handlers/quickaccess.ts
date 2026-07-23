/**
 * Quickaccess browse handlers — the server-side filters behind the popup's
 * "Filters" / "Groups" drill-downs (contract: shared/rpc/vault.ts).
 *
 * These deliberately BYPASS the resource cache in state.ts: that cache is the
 * full unfiltered table backing LIST / FIND_FOR_URL, and the filtered reads ask
 * the server questions the cache cannot answer (favourite flags, permission
 * inheritance through groups). They are also read-only and short — one GET per
 * drill-down — so there is nothing worth caching, and no cache to invalidate.
 *
 * Backend contract notes that shaped this file (all verified against the API):
 *  - `filter[is-owned-by-me]` / `filter[is-shared-with-me]` are BOOLEAN and
 *    mirror PHP's isset() quirk: `=0` applies the filter exactly like `=1`. The
 *    only way to not filter is to omit the parameter, so we only ever send `=1`.
 *  - `filter[is-shared-with-group]` is a UUID STRING (not a boolean), and an
 *    invalid uuid is a hard 400. We pre-validate rather than surface that.
 *  - The index has NO sorting and NO pagination, so every list is ordered here.
 */
import { t } from '../../shared/i18n';
import type { AccountInfo, Req, VaultItem } from '../../shared/messages';
import type { QuickFilter, QuickGroup, VaultRespMap } from '../../shared/rpc/vault';
import type { Group } from '../../shared/types';
import { apiCall } from '../http';
import { K, get, armLock, getUnlockedKey } from '../state';
import type { HandlerMap } from '../registry';

type ListFilteredReq = Extract<Req, { type: 'LIST_FILTERED' }>;

/** How many rows "Recently modified" keeps after ordering. Official shows a short list. */
const RECENT_LIMIT = 20;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Raw row shape for the filtered reads. Intentionally NOT state.ts's
 * RawResource: this path needs `modified` (to order "Recently modified"), which
 * the cached type does not carry, and widening the cached type would ripple
 * through the LIST/FIND_FOR_URL consumers for no gain here.
 */
interface FilteredResource {
  id: string;
  name?: string;
  username?: string;
  uri?: string;
  resource_type_id?: string;
  /** RFC3339 (the API's global date format). */
  modified?: string;
}

/**
 * Same projection as index.ts's toItem, kept local: importing it from index.ts
 * would close a cycle (index.ts imports this module's handler map).
 */
function toItem(r: FilteredResource): VaultItem {
  return {
    id: r.id,
    name: r.name || t('bg.encryptedItem'),
    username: r.username || '',
    uri: r.uri || '',
    resourceTypeId: r.resource_type_id || '',
  };
}

/**
 * Build the GET /resources.json query for a browse selection.
 *
 * Built via URLSearchParams, never string concatenation: the filter NAMES
 * contain square brackets, and RFC3986 puts `[`/`]` in gen-delims — outside the
 * query's allowed set. Browsers do NOT encode them (the WHATWG query
 * percent-encode set omits both), so a hand-built `?filter[x]=1` reaches Tomcat
 * verbatim and is rejected by its query parser (HttpParser.isQueryRelaxed) with
 * a bare 400 HTML page BEFORE Spring ever sees the request. URLSearchParams
 * emits `filter%5Bx%5D=1`, which the servlet decodes back to the literal
 * `filter[x]` name the @RequestParam is bound to.
 */
function queryFor(filter: QuickFilter): string {
  const sp = new URLSearchParams();
  switch (filter.kind) {
    case 'favorite':
      sp.set('filter[is-favorite]', '1');
      break;
    case 'owned':
      sp.set('filter[is-owned-by-me]', '1');
      break;
    case 'shared':
      sp.set('filter[is-shared-with-me]', '1');
      break;
    case 'group':
      sp.set('filter[is-shared-with-group]', filter.groupId);
      break;
    case 'recent':
      // No server filter: fetch the accessible set and order it below. Sending
      // any `=0` here would filter rather than not-filter (isset quirk).
      return '';
  }
  return '?' + sp.toString();
}

function byName(a: VaultItem, b: VaultItem): number {
  return a.name.localeCompare(b.name);
}

/** RFC3339 -> epoch ms; unparseable/missing sorts last. */
function modifiedAt(r: FilteredResource): number {
  const ms = r.modified ? Date.parse(r.modified) : NaN;
  return Number.isNaN(ms) ? 0 : ms;
}

async function listFiltered(req: ListFilteredReq): Promise<VaultRespMap['LIST_FILTERED']> {
  if (!getUnlockedKey()) throw new Error(t('bg.vaultLocked'));
  const filter = req.filter;
  // Pre-validate the group id: the backend answers an invalid uuid with a 400
  // whose message names the bad value. Ours always come from LIST_MY_GROUPS, so
  // a miss here is a bug, not user input — fail with a clean error either way.
  if (filter.kind === 'group' && !UUID_RE.test(filter.groupId)) {
    throw new Error(t('bg.invalidGroupId'));
  }

  const rows = (await apiCall<FilteredResource[]>('GET', '/resources.json' + queryFor(filter))) ?? [];
  armLock();

  if (filter.kind === 'recent') {
    // Copy before sorting: never reorder an array we may not own.
    const recent = [...rows].sort((a, b) => modifiedAt(b) - modifiedAt(a)).slice(0, RECENT_LIMIT);
    return { items: recent.map(toItem) };
  }
  return { items: rows.map(toItem).sort(byName) };
}

/** The current user's id — the account record normally has it; fall back to the server. */
async function myUserId(): Promise<string> {
  const account = await get<AccountInfo>(K.account);
  // A cosmetic/backfilled account record carries userId: '' — go ask instead.
  if (account?.userId) return account.userId;
  const me = await apiCall<{ id: string }>('GET', '/users/me.json');
  return me.id;
}

async function listMyGroups(): Promise<VaultRespMap['LIST_MY_GROUPS']> {
  if (!getUnlockedKey()) throw new Error(t('bg.vaultLocked'));
  const userId = await myUserId();
  if (!userId) return { groups: [] };
  // `filter[has-users]`, NOT `filter[has-users][]`: the `[]` array suffix is a
  // PHP/CakePHP convention that Spring does not understand. GroupController
  // binds @RequestParam(name = "filter[has-users]") by EXACT name, so the `[]`
  // form binds nothing, leaves the filter null, and GroupService then returns
  // every undeleted group in the organisation — breaking this handler's "only
  // groups the current user is a member of" contract (shared/rpc/vault.ts).
  const sp = new URLSearchParams({ 'filter[has-users]': userId });
  const groups = (await apiCall<Group[]>('GET', `/groups.json?${sp}`)) ?? [];
  armLock();
  const projected: QuickGroup[] = groups
    .filter((g) => !g.deleted)
    .map((g) => ({ id: g.id, name: g.name }));
  return { groups: projected.sort((a, b) => a.name.localeCompare(b.name)) };
}

export const quickaccessHandlers: HandlerMap = {
  LIST_FILTERED: listFiltered,
  LIST_MY_GROUPS: listMyGroups,
};

/**
 * Groups — master/detail page, ported from SPA pages/Groups.tsx.
 *
 * Left: group list (name + member count, manager badge). Right: the selected
 * group's members (Avatar + name + Manager badge from groups_users.is_admin).
 * Admins and group managers can create / rename / delete groups and manage
 * members.
 *
 * Migration deltas vs the SPA:
 *   - Current user (admin gating + create-modal seeding) comes from
 *     GET /users/me.json via the API_CALL pass-through — never from a cached
 *     localStorage blob (that SPA mechanism is retired).
 *   - The member-change re-encryption pipeline lives in the background behind
 *     GROUP_SAVE_REENCRYPT (see GroupModals.tsx / background/handlers/groups.ts);
 *     this page performs no crypto at all.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Pencil, Plus, ShieldCheck, Trash2, UserPlus, UsersRound } from 'lucide-react';

import { Avatar } from '../../components/Avatar';
import { useToast } from '../../lib/toast';
import { describeApiError } from '../../lib/errors';
import { t } from '../../../shared/i18n';

import * as groupsService from '../../services/groups';
import { getUser } from '../../services/users';
import type { Group, GroupUser, User } from '../../../shared/types';
import {
  CreateGroupModal,
  DeleteGroupDialog,
  ErrorBanner,
  FullSpinner,
  ManageMembersModal,
  RenameGroupModal,
  userName,
} from './GroupModals';

export default function GroupsPage() {
  const toast = useToast();

  // ---- current user (network role — admin gating + create-modal seed)
  const [currentUser, setCurrentUser] = useState<User | null>(null);
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const me = await getUser('me');
        if (!cancelled) setCurrentUser(me);
      } catch {
        if (!cancelled) setCurrentUser(null);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);
  const isAdmin = currentUser?.role?.name === 'admin';

  // ---- list state
  const [groups, setGroups] = useState<Group[]>([]);
  const [listLoading, setListLoading] = useState(true);
  const [listError, setListError] = useState<string | null>(null);

  // ---- detail state
  const [selectedId, setSelectedId] = useState<string | null>(null);
  // Latest selection, readable from async closures — lets loadDetail discard
  // responses that arrive after the user has already switched to another group.
  const selectedIdRef = useRef<string | null>(null);
  const [detail, setDetail] = useState<Group | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState<string | null>(null);

  // ---- modals
  const [createOpen, setCreateOpen] = useState(false);
  const [renameOpen, setRenameOpen] = useState(false);
  const [manageOpen, setManageOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);

  // -------------------------------------------------------------------------
  // Data loading
  // -------------------------------------------------------------------------
  const loadGroups = useCallback(async () => {
    setListLoading(true);
    setListError(null);
    try {
      const list = await groupsService.listGroups({ containMyGroupUser: true });
      setGroups(list);
      // Keep / clear the selection sensibly.
      setSelectedId((prev) => {
        if (prev && list.some((g) => g.id === prev)) return prev;
        return list.length > 0 ? list[0].id : null;
      });
    } catch (err) {
      setListError(describeApiError(err));
      setGroups([]);
    } finally {
      setListLoading(false);
    }
  }, []);

  const loadDetail = useCallback(async (groupId: string) => {
    setDetailLoading(true);
    setDetailError(null);
    try {
      const g = await groupsService.getGroup(groupId, {
        containUsers: true,
        containUserProfile: true,
        containUserGpgkey: true,
        containMyGroupUser: true,
      });
      // Stale-response guard: the user may have selected another group while
      // this request was in flight. Applying it anyway would show (and let the
      // manage-members modal edit) the wrong group.
      if (selectedIdRef.current !== groupId) return;
      setDetail(g);
    } catch (err) {
      if (selectedIdRef.current !== groupId) return;
      setDetailError(describeApiError(err));
      setDetail(null);
    } finally {
      // Only the request for the current selection may clear the spinner;
      // a stale one finishing late must not hide a newer in-flight load.
      if (selectedIdRef.current === groupId) setDetailLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadGroups();
  }, [loadGroups]);

  useEffect(() => {
    selectedIdRef.current = selectedId;
    if (selectedId) {
      void loadDetail(selectedId);
    } else {
      setDetail(null);
    }
  }, [selectedId, loadDetail]);

  // -------------------------------------------------------------------------
  // Permission: admins always; otherwise only managers of this group.
  // -------------------------------------------------------------------------
  const canManageSelected = useMemo(() => {
    if (isAdmin) return true;
    return Boolean(detail?.my_group_user?.is_admin);
  }, [isAdmin, detail]);

  const sortedMembers = useMemo(() => {
    const members: GroupUser[] = detail?.groups_users ?? [];
    return [...members].sort((a, b) => {
      // Managers first, then alphabetical by display name.
      if (a.is_admin !== b.is_admin) return a.is_admin ? -1 : 1;
      return userName(a.user).localeCompare(userName(b.user));
    });
  }, [detail]);

  // -------------------------------------------------------------------------
  // Render
  // -------------------------------------------------------------------------
  const selectedGroup = groups.find((g) => g.id === selectedId) ?? detail ?? null;

  return (
    <>
      <div className="page">
        {listError && (
          <div style={{ padding: '16px 28px 0' }}>
            <ErrorBanner message={listError} />
          </div>
        )}

        {listLoading ? (
          <FullSpinner label={t('app.directory.groups.loadingGroups')} />
        ) : groups.length === 0 && !listError ? (
          <div className="empty" style={{ flex: 1 }}>
            <div className="ico">
              <UsersRound />
            </div>
            <h3>{t('app.directory.groups.emptyList.title')}</h3>
            <p>
              {isAdmin
                ? t('app.directory.groups.emptyList.descAdmin')
                : t('app.directory.groups.emptyList.descMember')}
            </p>
            {isAdmin && (
              <button type="button" className="btn primary" onClick={() => setCreateOpen(true)}>
                <Plus /> {t('app.directory.groups.newGroup')}
              </button>
            )}
          </div>
        ) : (
          <div className="glayout">
            {/* Master list */}
            <div className="glist">
              <div className="glist-head">
                <h3>{t('app.directory.groups.list.heading', { count: groups.length })}</h3>
                {isAdmin && (
                  <button
                    type="button"
                    className="btn sm primary"
                    onClick={() => setCreateOpen(true)}
                  >
                    <Plus /> {t('app.directory.groups.list.new')}
                  </button>
                )}
              </div>
              <div className="glist-scroll">
                {groups.map((g) => {
                  const active = g.id === selectedId;
                  const count = g.groups_users?.length ?? g.user_count;
                  const manages = isAdmin || Boolean(g.my_group_user?.is_admin);
                  return (
                    <button
                      key={g.id}
                      type="button"
                      className={'gcard' + (active ? ' active' : '')}
                      onClick={() => setSelectedId(g.id)}
                    >
                      <Avatar name={g.name} size={38} />
                      <div className="gc-info">
                        <div className="gn">{g.name}</div>
                        <div className="gm">
                          {count !== undefined
                            ? t('app.directory.groups.list.memberCount', { count })
                            : t('app.directory.groups.list.members')}
                        </div>
                      </div>
                      {manages && (
                        <span
                          className="admin-badge"
                          title={t('app.directory.groups.list.managerTitle')}
                        >
                          <ShieldCheck />
                        </span>
                      )}
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Detail */}
            <div className="gdetail">
              {selectedGroup ? (
                <GroupDetail
                  group={selectedGroup}
                  members={sortedMembers}
                  loading={detailLoading}
                  error={detailError}
                  canManage={canManageSelected}
                  onManage={() => setManageOpen(true)}
                  onRename={() => setRenameOpen(true)}
                  onDelete={() => setDeleteOpen(true)}
                />
              ) : (
                <div className="empty" style={{ flex: 1 }}>
                  <div className="ico">
                    <UsersRound />
                  </div>
                  <h3>{t('app.directory.groups.selectPrompt.title')}</h3>
                  <p>{t('app.directory.groups.selectPrompt.desc')}</p>
                </div>
              )}
            </div>
          </div>
        )}
      </div>

      {/* ---- Create group ---- */}
      {createOpen && (
        <CreateGroupModal
          currentUser={currentUser}
          onClose={() => setCreateOpen(false)}
          onCreated={async (newId) => {
            setCreateOpen(false);
            toast.success(t('app.directory.groups.toast.created'));
            await loadGroups();
            setSelectedId(newId);
          }}
          onError={(m) => toast.error(m)}
        />
      )}

      {/* ---- Rename group ---- */}
      {renameOpen && selectedGroup && (
        <RenameGroupModal
          group={selectedGroup}
          onClose={() => setRenameOpen(false)}
          onRenamed={async () => {
            setRenameOpen(false);
            toast.success(t('app.directory.groups.toast.renamed'));
            await loadGroups();
            if (selectedId) await loadDetail(selectedId);
          }}
          onError={(m) => toast.error(m)}
        />
      )}

      {/* ---- Manage members (re-encryption runs in the background) ----
          detail.id === selectedId double-guards against a stale detail (from a
          previously selected group) ever backing the member-editing modal. */}
      {manageOpen && detail && detail.id === selectedId && (
        <ManageMembersModal
          group={detail}
          onClose={() => setManageOpen(false)}
          onSaved={async () => {
            setManageOpen(false);
            toast.success(t('app.directory.groups.toast.membersUpdated'));
            await loadGroups();
            if (selectedId) await loadDetail(selectedId);
          }}
          onError={(m) => toast.error(m)}
        />
      )}

      {/* ---- Delete group ---- */}
      {deleteOpen && selectedGroup && (
        <DeleteGroupDialog
          group={selectedGroup}
          onClose={() => setDeleteOpen(false)}
          onDeleted={async () => {
            setDeleteOpen(false);
            toast.success(t('app.directory.groups.toast.deleted'));
            setSelectedId(null);
            await loadGroups();
          }}
          onError={(m) => toast.error(m)}
        />
      )}
    </>
  );
}

// ===========================================================================
// Detail panel
// ===========================================================================

function GroupDetail({
  group,
  members,
  loading,
  error,
  canManage,
  onManage,
  onRename,
  onDelete,
}: {
  group: Group;
  members: GroupUser[];
  loading: boolean;
  error: string | null;
  canManage: boolean;
  onManage: () => void;
  onRename: () => void;
  onDelete: () => void;
}) {
  return (
    <>
      {/* Detail header */}
      <div className="gd-head">
        <div className="gd-ico" style={{ background: 'var(--accent)' }}>
          <UsersRound />
        </div>
        <div className="gd-t">
          <h2>{group.name}</h2>
          <p>&nbsp;</p>
          <div className="gd-meta">
            <span className="chip neutral">
              <UsersRound />{' '}
              {t('app.directory.groups.detail.memberCount', { count: members.length })}
            </span>
            {canManage && (
              <span className="chip green">
                <ShieldCheck /> {t('app.directory.groups.detail.youAreManager')}
              </span>
            )}
          </div>
        </div>

        {canManage && (
          <div style={{ display: 'flex', gap: 8, flexShrink: 0 }}>
            <button
              type="button"
              className="btn primary"
              onClick={onManage}
              title={t('app.directory.groups.detail.manageTitle')}
            >
              <UserPlus /> {t('app.directory.groups.detail.members')}
            </button>
            <button
              type="button"
              className="iconbtn"
              onClick={onRename}
              title={t('app.directory.groups.detail.renameTitle')}
              aria-label={t('app.directory.groups.detail.renameAria')}
            >
              <Pencil />
            </button>
            <button
              type="button"
              className="iconbtn"
              onClick={onDelete}
              title={t('app.directory.groups.detail.deleteTitle')}
              aria-label={t('app.directory.groups.detail.deleteAria')}
              style={{ color: 'var(--red-text)' }}
            >
              <Trash2 />
            </button>
          </div>
        )}
      </div>

      {/* Detail body */}
      {error && (
        <div style={{ padding: '16px 28px 0' }}>
          <ErrorBanner message={error} />
        </div>
      )}

      {loading ? (
        <FullSpinner label={t('app.directory.groups.detail.loadingMembers')} />
      ) : members.length === 0 && !error ? (
        <div className="empty" style={{ padding: '48px 20px' }}>
          <div className="ico">
            <UsersRound />
          </div>
          <h3>{t('app.directory.groups.detail.emptyTitle')}</h3>
          <p>
            {canManage
              ? t('app.directory.groups.detail.emptyDescManage')
              : t('app.directory.groups.detail.emptyDescMember')}
          </p>
        </div>
      ) : (
        <div className="gd-section">
          <h4>
            {t('app.directory.groups.detail.membersHeading')}{' '}
            <span className="ct">{members.length}</span>
            <span className="h4-spacer" />
          </h4>
          {members.map((gu) => (
            <div className="member-row" key={gu.id}>
              <Avatar
                src={gu.user?.profile?.avatar?.url?.small ?? null}
                firstName={gu.user?.profile?.first_name}
                lastName={gu.user?.profile?.last_name}
                name={gu.user?.username}
                size={38}
              />
              <div className="mr-info">
                <div className="mn">
                  {userName(gu.user)}
                  {gu.is_admin && (
                    <span
                      className="admin-badge"
                      title={t('app.directory.groups.detail.managerBadge')}
                    >
                      <ShieldCheck /> {t('app.directory.groups.detail.managerBadge')}
                    </span>
                  )}
                </div>
                {gu.user?.username && <div className="me">{gu.user.username}</div>}
              </div>
            </div>
          ))}
        </div>
      )}
    </>
  );
}

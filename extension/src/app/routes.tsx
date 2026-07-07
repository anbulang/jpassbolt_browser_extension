/**
 * Central hash-route table — ONLY the foundation package edits this file.
 * Domain packages own the page files it points at.
 *
 * Protected routes render inside the Flow phase machine + AppLayout (rail nav);
 * guest routes (setup / recovery — no account exists yet) bypass Flow entirely
 * and render standalone.
 */
import type { ComponentType } from 'react';
import VaultPage from './pages/vault';
import UsersPage from './pages/users';
import GroupsPage from './pages/groups';
import SettingsPage from './pages/settings';
import MetadataPage from './pages/metadata';
import SetupPage from './pages/setup/SetupPage';
import RecoveryPage from './pages/setup/RecoveryPage';

export interface AppRoute {
  path: string;
  Component: ComponentType;
}

export const protectedRoutes: AppRoute[] = [
  { path: '/', Component: VaultPage },
  { path: '/users', Component: UsersPage },
  { path: '/groups', Component: GroupsPage },
  // ?tab=profile|security|account is read by the settings page itself.
  { path: '/settings', Component: SettingsPage },
  { path: '/settings/encrypted-metadata', Component: MetadataPage },
];

export const guestRoutes: AppRoute[] = [
  { path: '/setup/:userId/:tokenId', Component: SetupPage },
  { path: '/recover', Component: RecoveryPage },
  { path: '/recover/:userId/:tokenId', Component: RecoveryPage },
];

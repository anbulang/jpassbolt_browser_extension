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
  // The My Profile workspace. ?section=<id> is read by the page itself; the
  // legacy ?tab=profile|security|account values still resolve there too.
  { path: '/profile', Component: SettingsPage },
  // Kept as a live ALIAS rather than a redirect: main.tsx's mapHostPathname maps
  // a host deep link '/app/settings' onto this hash route, and the rail linked
  // here for the whole life of the extension. Rendering the same page keeps both
  // working without a second navigation.
  { path: '/settings', Component: SettingsPage },
  { path: '/settings/encrypted-metadata', Component: MetadataPage },
];

export const guestRoutes: AppRoute[] = [
  { path: '/setup/:userId/:tokenId', Component: SetupPage },
  { path: '/recover', Component: RecoveryPage },
  { path: '/recover/:userId/:tokenId', Component: RecoveryPage },
];

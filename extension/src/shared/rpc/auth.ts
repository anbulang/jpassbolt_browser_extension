// Auth-domain RPC contract. KEY_INFO is implemented by the foundation
// (background/handlers/core.ts); SETUP_GENERATE_KEY and MFA_VERIFY are
// implemented by the auth/setup work package (background/handlers/auth.ts).

import type { StatusResult } from '../messages';

export interface KeyInfo {
  fingerprint: string;
  keyId: string;
  algorithm?: string;
  bits?: number;
  userIds?: string[];
  publicKeyArmored?: string;
}

export type AuthReq =
  // Generates a passphrase-protected RSA key pair (3072 default) and STAGES it
  // (staged_* storage slots) — the account key is NOT touched until
  // SETUP_COMMIT, so an abandoned setup cannot clobber an existing account.
  // privateKeyArmored is returned ONCE, solely for the recovery-kit download —
  // it is the passphrase-protected at-rest form, the same trust level as a
  // user-imported private key.
  | { type: 'SETUP_GENERATE_KEY'; name: string; email: string; passphrase: string; rsaBits?: number }
  // Validates a pasted setup/recovery private key and STAGES it (like
  // SETUP_GENERATE_KEY, never the account key — unlike the deliberate
  // IMPORT_KEY, which replaces the account key immediately).
  | { type: 'SETUP_IMPORT_KEY'; armoredPrivateKey: string }
  // Promotes the staged pair to the account keys and drops the old session
  // (JWT/user/account). Call ONLY after setup/recover complete succeeded.
  | { type: 'SETUP_COMMIT' }
  // Without armoredKey: info about the account's own public key.
  | { type: 'KEY_INFO'; armoredKey?: string }
  // Login-time MFA challenge; the pending JWT lives ONLY in background memory.
  | { type: 'MFA_VERIFY'; provider: 'totp'; code: string; remember?: boolean };

export interface AuthRespMap {
  SETUP_GENERATE_KEY: { fingerprint: string; publicKeyArmored: string; privateKeyArmored: string };
  SETUP_IMPORT_KEY: { fingerprint: string; publicKeyArmored: string };
  SETUP_COMMIT: StatusResult;
  KEY_INFO: KeyInfo;
  MFA_VERIFY: StatusResult;
}

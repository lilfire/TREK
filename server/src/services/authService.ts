// authService is the public façade for all authentication, account, MFA,
// admin-settings, app-config, password-reset, token-issuing and travel-stats
// helpers. Internally each responsibility lives in its own focused module
// (see ./auth* and friends); this file re-exports them so existing callers
// (routes, MCP tools, tests, other services) keep their `import { … } from
// './authService'` working unchanged.

import { createHash } from 'crypto';
import { db } from '../db/database';
import { isDemoEmail } from './demo';
import { verifyJwtAndLoadUser } from '../middleware/auth';
import { User } from '../types';

export {
  // Shared helpers
  utcSuffix,
  stripUserForClient,
  maskKey,
  mask_stored_api_key,
  avatarUrl,
  resolveAuthToggles,
  isOidcOnlyMode,
  generateToken,
  // MFA primitives
  normalizeBackupCode,
  hashBackupCode,
  hashBackupCodeBcrypt,
  matchBackupCode,
  generateBackupCodes,
  parseBackupCodeHashes,
  getPendingMfaSecret,
} from './authShared';

export { getAppConfig } from './appConfigService';
export { demoLogin, validateInviteToken, registerUser } from './userRegistrationService';
export { loginUser } from './userLoginService';
export {
  getCurrentUser,
  deleteAccount,
  updateMapsKey,
  updateApiKeys,
  updateSettings,
  getSettings,
  saveAvatar,
  deleteAvatar,
  listUsers,
} from './userAccountService';
export {
  changePassword,
  requestPasswordReset,
  issueAccountSetupToken,
  resetPassword,
} from './passwordService';
export type { PasswordResetRequestOutcome, ResetPasswordOutcome } from './passwordService';
export { setupMfa, enableMfa, disableMfa, verifyMfaLogin } from './mfaService';
export { getAppSettings, updateAppSettings, validateKeys } from './adminSettingsService';
export { getTravelStats } from './travelStatsService';
export {
  listMcpTokens,
  createMcpToken,
  deleteMcpToken,
  createWsToken,
  createResourceToken,
} from './mcpTokenService';

// ---------------------------------------------------------------------------
// MCP / JWT verification — the small, callsite-light helpers that don't
// warrant their own module. Kept here so MCP routes have a stable
// `authService` entry point even after the decomposition.
// ---------------------------------------------------------------------------

export function isDemoUser(userId: number): boolean {
  if (process.env.DEMO_MODE !== 'true') return false;
  const user = db.prepare('SELECT email FROM users WHERE id = ?').get(userId) as { email: string } | undefined;
  return isDemoEmail(user?.email);
}

export function verifyMcpToken(rawToken: string): User | null {
  const hash = createHash('sha256').update(rawToken).digest('hex');
  const row = db.prepare(`
    SELECT u.id, u.username, u.email, u.role
    FROM mcp_tokens mt
    JOIN users u ON mt.user_id = u.id
    WHERE mt.token_hash = ?
  `).get(hash) as User | undefined;
  if (row) {
    db.prepare('UPDATE mcp_tokens SET last_used_at = CURRENT_TIMESTAMP WHERE token_hash = ?').run(hash);
    return row;
  }
  return null;
}

/**
 * Verify a JWT the same way `middleware/auth.ts#verifyJwtAndLoadUser`
 * does — including the `password_version` check — so that stolen tokens
 * lose access the moment the victim resets their password.
 *
 * This is the single entry point every non-cookie JWT verification path
 * (MCP bearer, WebSocket handshake, file-download query tokens, photo
 * route) should go through.
 */
export function verifyJwtToken(token: string): User | null {
  return verifyJwtAndLoadUser(token);
}

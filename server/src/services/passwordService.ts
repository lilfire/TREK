import bcrypt from 'bcryptjs';
import { authenticator } from 'otplib';
import { randomBytes, createHash } from 'crypto';
import { db } from '../db/database';
import { validatePassword } from './passwordPolicy';
import { decryptMfaSecret } from './mfaCrypto';
import { revokeUserSessions } from '../mcp';
import { isDemoEmail } from './demo';
import { isOidcOnlyMode, matchBackupCode, parseBackupCodeHashes } from './authShared';

// ---------------------------------------------------------------------------
// Password change (logged-in user)
// ---------------------------------------------------------------------------

export function changePassword(
  userId: number,
  userEmail: string,
  body: { current_password?: string; new_password?: string }
): { error?: string; status?: number; success?: boolean } {
  if (isOidcOnlyMode()) {
    return { error: 'Password authentication is disabled.', status: 403 };
  }
  if (process.env.DEMO_MODE === 'true' && isDemoEmail(userEmail)) {
    return { error: 'Password change is disabled in demo mode.', status: 403 };
  }

  const { current_password, new_password } = body;
  if (!current_password) return { error: 'Current password is required', status: 400 };
  if (!new_password) return { error: 'New password is required', status: 400 };

  const pwCheck = validatePassword(new_password);
  if (!pwCheck.ok) return { error: pwCheck.reason, status: 400 };

  const user = db.prepare('SELECT password_hash FROM users WHERE id = ?').get(userId) as { password_hash: string } | undefined;
  if (!user || !bcrypt.compareSync(current_password, user.password_hash)) {
    return { error: 'Current password is incorrect', status: 401 };
  }

  const hash = bcrypt.hashSync(new_password, 12);
  db.prepare('UPDATE users SET password_hash = ?, must_change_password = 0, updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(hash, userId);
  return { success: true };
}

// ---------------------------------------------------------------------------
// Password reset — request, account-setup token issuing, consume + reset
// ---------------------------------------------------------------------------

// 60 min; long enough to read the email in a second tab, short enough
// that a leaked link is unlikely to still be valid when someone tries it.
const PASSWORD_RESET_TTL_MS = 60 * 60 * 1000;
const PASSWORD_RESET_TOKEN_BYTES = 32; // 256-bit entropy
const ACCOUNT_SETUP_TTL_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * Returns the SHA-256 hex hash of a reset token. Raw tokens are never
 * persisted — we only store and compare their hashes.
 */
function hashResetToken(raw: string): string {
  return createHash('sha256').update(raw).digest('hex');
}

/**
 * Shape returned by requestPasswordReset. For enumeration-safety the
 * route ALWAYS returns the same response to the client regardless of
 * whether a user existed — this struct is only consumed internally by
 * the route handler to decide whether to send an email / log a link.
 */
export interface PasswordResetRequestOutcome {
  tokenForDelivery: string | null;   // raw token — send via email or log, never return to client
  userId: number | null;
  userEmail: string | null;
  reason: 'issued' | 'no_user' | 'oidc_only' | 'throttled_per_email' | 'password_login_disabled';
}

// Per-email throttle (defence-in-depth on top of the per-IP limiter).
const perEmailResetAttempts = new Map<string, { count: number; first: number }>();
const PASSWORD_RESET_PER_EMAIL_WINDOW_MS = 15 * 60 * 1000;
const PASSWORD_RESET_PER_EMAIL_MAX = 3;
setInterval(() => {
  const now = Date.now();
  for (const [key, record] of perEmailResetAttempts) {
    if (now - record.first >= PASSWORD_RESET_PER_EMAIL_WINDOW_MS) perEmailResetAttempts.delete(key);
  }
}, 5 * 60 * 1000).unref?.();

export function requestPasswordReset(rawEmail: string, createdIp: string | null): PasswordResetRequestOutcome {
  const email = String(rawEmail || '').trim().toLowerCase();
  // Basic shape check — a fully empty / malformed email is treated like
  // "no user" so we still spend the same time internally.
  const looksLikeEmail = email.length > 0 && /.+@.+\..+/.test(email);

  // Global policy check: password login disabled → no reset possible.
  if (isOidcOnlyMode()) {
    return { tokenForDelivery: null, userId: null, userEmail: null, reason: 'password_login_disabled' };
  }

  // Per-email throttle. We check this BEFORE the DB lookup so the timing
  // is identical regardless of whether the account exists.
  const throttleKey = email || '__noemail__';
  const now = Date.now();
  const record = perEmailResetAttempts.get(throttleKey);
  if (record && record.count >= PASSWORD_RESET_PER_EMAIL_MAX && now - record.first < PASSWORD_RESET_PER_EMAIL_WINDOW_MS) {
    return { tokenForDelivery: null, userId: null, userEmail: null, reason: 'throttled_per_email' };
  }
  if (!record || now - record.first >= PASSWORD_RESET_PER_EMAIL_WINDOW_MS) {
    perEmailResetAttempts.set(throttleKey, { count: 1, first: now });
  } else {
    record.count++;
  }

  if (!looksLikeEmail) {
    return { tokenForDelivery: null, userId: null, userEmail: null, reason: 'no_user' };
  }

  const user = db.prepare('SELECT id, email, password_hash, oidc_sub FROM users WHERE email = ?').get(email) as
    | { id: number; email: string; password_hash: string | null; oidc_sub: string | null }
    | undefined;

  if (!user) {
    return { tokenForDelivery: null, userId: null, userEmail: null, reason: 'no_user' };
  }
  // OIDC-only account (no local password) — we can't reset what isn't there.
  // The client still gets the generic "if that email exists…" response.
  if (!user.password_hash && user.oidc_sub) {
    return { tokenForDelivery: null, userId: user.id, userEmail: user.email, reason: 'oidc_only' };
  }

  // Invalidate any prior unconsumed tokens for this user so there is
  // always at most one live reset link in flight.
  db.prepare(
    "UPDATE password_reset_tokens SET consumed_at = CURRENT_TIMESTAMP WHERE user_id = ? AND consumed_at IS NULL"
  ).run(user.id);

  const raw = randomBytes(PASSWORD_RESET_TOKEN_BYTES).toString('base64url');
  const token_hash = hashResetToken(raw);
  const expires_at = new Date(Date.now() + PASSWORD_RESET_TTL_MS).toISOString();

  db.prepare(
    'INSERT INTO password_reset_tokens (user_id, token_hash, expires_at, created_ip) VALUES (?, ?, ?, ?)'
  ).run(user.id, token_hash, expires_at, createdIp);

  return { tokenForDelivery: raw, userId: user.id, userEmail: user.email, reason: 'issued' };
}

export function issueAccountSetupToken(userId: number, createdIp: string | null): string {
  db.prepare(
    "UPDATE password_reset_tokens SET consumed_at = CURRENT_TIMESTAMP WHERE user_id = ? AND consumed_at IS NULL"
  ).run(userId);

  const raw = randomBytes(PASSWORD_RESET_TOKEN_BYTES).toString('base64url');
  const token_hash = hashResetToken(raw);
  const expires_at = new Date(Date.now() + ACCOUNT_SETUP_TTL_MS).toISOString();

  db.prepare(
    'INSERT INTO password_reset_tokens (user_id, token_hash, expires_at, created_ip) VALUES (?, ?, ?, ?)'
  ).run(userId, token_hash, expires_at, createdIp);

  return raw;
}

export interface ResetPasswordOutcome {
  error?: string;
  status?: number;
  success?: boolean;
  /** When true the client must collect a TOTP/backup code and call again. */
  mfa_required?: boolean;
  userId?: number;
}

/**
 * Consume a reset token and set a new password. If the target user has
 * MFA enabled, a valid TOTP code or backup code must be supplied — a
 * compromised email alone therefore does NOT allow taking over a
 * 2FA-protected account.
 */
export function resetPassword(body: {
  token?: string;
  new_password?: string;
  mfa_code?: string;
}): ResetPasswordOutcome {
  const { token, new_password, mfa_code } = body;
  if (!token || typeof token !== 'string') {
    return { error: 'Reset token is required', status: 400 };
  }
  if (!new_password || typeof new_password !== 'string') {
    return { error: 'New password is required', status: 400 };
  }
  // Check the policy BEFORE touching the token so an invalid password
  // does not burn the user's one-time link.
  const pwCheck = validatePassword(new_password);
  if (!pwCheck.ok) return { error: pwCheck.reason!, status: 400 };

  const tokenHash = hashResetToken(token);
  const row = db.prepare(
    'SELECT id, user_id, expires_at, consumed_at FROM password_reset_tokens WHERE token_hash = ?'
  ).get(tokenHash) as
    | { id: number; user_id: number; expires_at: string; consumed_at: string | null }
    | undefined;

  if (!row) return { error: 'Invalid or expired reset link', status: 400 };
  if (row.consumed_at) return { error: 'This reset link has already been used', status: 400 };
  if (new Date(row.expires_at).getTime() < Date.now()) {
    return { error: 'Reset link has expired. Please request a new one.', status: 400 };
  }

  const user = db.prepare(
    'SELECT id, email, mfa_enabled, mfa_secret, mfa_backup_codes, password_version FROM users WHERE id = ?'
  ).get(row.user_id) as
    | { id: number; email: string; mfa_enabled: number | boolean; mfa_secret: string | null; mfa_backup_codes: string | null; password_version: number }
    | undefined;

  if (!user) return { error: 'Invalid or expired reset link', status: 400 };

  // MFA gate. If enabled, require a valid TOTP or backup code.
  const mfaOn = user.mfa_enabled === 1 || user.mfa_enabled === true;
  let backupCodeConsumedIndex: number | null = null;
  if (mfaOn) {
    if (!user.mfa_secret) {
      // Data inconsistency — fail closed.
      return { error: 'MFA is enabled but not configured. Contact your administrator.', status: 500 };
    }
    const supplied = typeof mfa_code === 'string' ? mfa_code.trim() : '';
    if (!supplied) return { mfa_required: true, status: 200 };

    const secret = decryptMfaSecret(user.mfa_secret);
    const okTotp = authenticator.verify({ token: supplied.replace(/\s/g, ''), secret });
    if (!okTotp) {
      const hashes = parseBackupCodeHashes(user.mfa_backup_codes);
      const idx = hashes.findIndex((h) => matchBackupCode(supplied, h));
      if (idx === -1) return { error: 'Invalid MFA code', status: 401 };
      backupCodeConsumedIndex = idx;
    }
  }

  const newHash = bcrypt.hashSync(new_password, 12);
  const newPv = (user.password_version ?? 0) + 1;

  db.transaction(() => {
    // Burn the token first to keep it atomic with the password change.
    db.prepare('UPDATE password_reset_tokens SET consumed_at = CURRENT_TIMESTAMP WHERE id = ?').run(row.id);
    // Also burn every OTHER live token for this user — a fresh login
    // should not leave a second door open.
    db.prepare(
      "UPDATE password_reset_tokens SET consumed_at = CURRENT_TIMESTAMP WHERE user_id = ? AND consumed_at IS NULL AND id != ?"
    ).run(user.id, row.id);
    db.prepare(
      'UPDATE users SET password_hash = ?, must_change_password = 0, password_version = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?'
    ).run(newHash, newPv, user.id);
    // Consume backup code if one was used.
    if (backupCodeConsumedIndex !== null) {
      const hashes = parseBackupCodeHashes(user.mfa_backup_codes);
      hashes.splice(backupCodeConsumedIndex, 1);
      db.prepare('UPDATE users SET mfa_backup_codes = ? WHERE id = ?').run(JSON.stringify(hashes), user.id);
    }
    // Revoke every other credential class the user had. The
    // password_version bump alone invalidates JWT cookie sessions, but
    // MCP static tokens and OAuth 2.1 bearer tokens are separate stores
    // that survive the bump unless we prune them here.
    db.prepare('DELETE FROM mcp_tokens WHERE user_id = ?').run(user.id);
    try {
      db.prepare(
        "UPDATE oauth_tokens SET revoked_at = CURRENT_TIMESTAMP WHERE user_id = ? AND revoked_at IS NULL"
      ).run(user.id);
    } catch { /* oauth_tokens table may not exist in very old installs */ }
  })();

  // Kick off any MCP/WS session cleanup — same hook the account-delete path uses.
  try { revokeUserSessions?.(user.id); } catch { /* best-effort */ }

  return { success: true, userId: user.id };
}

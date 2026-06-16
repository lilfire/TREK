import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { authenticator } from 'otplib';
import QRCode from 'qrcode';
import { db } from '../db/database';
import { JWT_SECRET } from '../config';
import { encryptMfaSecret, decryptMfaSecret } from './mfaCrypto';
import { isDemoEmail } from './demo';
import { User } from '../types';
import {
  avatarUrl,
  generateBackupCodes,
  generateToken,
  getPendingMfaSecret,
  hashBackupCodeBcrypt,
  matchBackupCode,
  MFA_SETUP_TTL_MS,
  mfaSetupPending,
  parseBackupCodeHashes,
  stripUserForClient,
} from './authShared';

// Constant-window for otplib — kept here so any time-skew tweak only
// touches the MFA module. authenticator is global to the otplib import,
// so this assignment is idempotent across re-imports.
authenticator.options = { window: 1 };

export function setupMfa(userId: number, userEmail: string): { error?: string; status?: number; secret?: string; otpauth_url?: string; qrPromise?: Promise<string> } {
  if (process.env.DEMO_MODE === 'true' && isDemoEmail(userEmail)) {
    return { error: 'MFA is not available in demo mode.', status: 403 };
  }
  const row = db.prepare('SELECT mfa_enabled FROM users WHERE id = ?').get(userId) as { mfa_enabled: number } | undefined;
  if (row?.mfa_enabled) {
    return { error: 'MFA is already enabled', status: 400 };
  }
  let secret: string, otpauth_url: string;
  try {
    secret = authenticator.generateSecret();
    mfaSetupPending.set(userId, { secret, exp: Date.now() + MFA_SETUP_TTL_MS });
    otpauth_url = authenticator.keyuri(userEmail, 'TREK', secret);
  } catch (err) {
    console.error('[MFA] Setup error:', err);
    return { error: 'MFA setup failed', status: 500 };
  }
  return { secret, otpauth_url, qrPromise: QRCode.toString(otpauth_url, { type: 'svg', width: 250 }) };
}

export function enableMfa(userId: number, code?: string): { error?: string; status?: number; success?: boolean; mfa_enabled?: boolean; backup_codes?: string[] } {
  if (!code) {
    return { error: 'Verification code is required', status: 400 };
  }
  const pending = getPendingMfaSecret(userId);
  if (!pending) {
    return { error: 'No MFA setup in progress. Start the setup again.', status: 400 };
  }
  const tokenStr = String(code).replace(/\s/g, '');
  const ok = authenticator.verify({ token: tokenStr, secret: pending });
  if (!ok) {
    return { error: 'Invalid verification code', status: 401 };
  }
  const backupCodes = generateBackupCodes();
  const backupHashes = backupCodes.map(hashBackupCodeBcrypt);
  const enc = encryptMfaSecret(pending);
  db.prepare('UPDATE users SET mfa_enabled = 1, mfa_secret = ?, mfa_backup_codes = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(
    enc,
    JSON.stringify(backupHashes),
    userId
  );
  mfaSetupPending.delete(userId);
  return { success: true, mfa_enabled: true, backup_codes: backupCodes };
}

export function disableMfa(
  userId: number,
  userEmail: string,
  body: { password?: string; code?: string }
): { error?: string; status?: number; success?: boolean; mfa_enabled?: boolean } {
  if (process.env.DEMO_MODE === 'true' && isDemoEmail(userEmail)) {
    return { error: 'MFA cannot be changed in demo mode.', status: 403 };
  }
  const policy = db.prepare("SELECT value FROM app_settings WHERE key = 'require_mfa'").get() as { value: string } | undefined;
  if (policy?.value === 'true') {
    return { error: 'Two-factor authentication cannot be disabled while it is required for all users.', status: 403 };
  }
  const { password, code } = body;
  if (!password || !code) {
    return { error: 'Password and authenticator code are required', status: 400 };
  }
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(userId) as User | undefined;
  if (!user?.mfa_enabled || !user.mfa_secret) {
    return { error: 'MFA is not enabled', status: 400 };
  }
  if (!user.password_hash || !bcrypt.compareSync(password, user.password_hash)) {
    return { error: 'Incorrect password', status: 401 };
  }
  const secret = decryptMfaSecret(user.mfa_secret);
  const tokenStr = String(code).replace(/\s/g, '');
  const ok = authenticator.verify({ token: tokenStr, secret });
  if (!ok) {
    return { error: 'Invalid verification code', status: 401 };
  }
  db.prepare('UPDATE users SET mfa_enabled = 0, mfa_secret = NULL, mfa_backup_codes = NULL, updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(
    userId
  );
  mfaSetupPending.delete(userId);
  return { success: true, mfa_enabled: false };
}

export function verifyMfaLogin(body: {
  mfa_token?: string;
  code?: string;
}): {
  error?: string;
  status?: number;
  token?: string;
  user?: Record<string, unknown>;
  auditUserId?: number;
} {
  const { mfa_token, code } = body;
  if (!mfa_token || !code) {
    return { error: 'Verification token and code are required', status: 400 };
  }
  try {
    const decoded = jwt.verify(mfa_token, JWT_SECRET, { algorithms: ['HS256'] }) as { id: number; purpose?: string };
    if (decoded.purpose !== 'mfa_login') {
      return { error: 'Invalid verification token', status: 401 };
    }
    const user = db.prepare('SELECT * FROM users WHERE id = ?').get(decoded.id) as User | undefined;
    if (!user || !(user.mfa_enabled === 1 || user.mfa_enabled === true) || !user.mfa_secret) {
      return { error: 'Invalid session', status: 401 };
    }
    const secret = decryptMfaSecret(user.mfa_secret);
    const tokenStr = String(code).trim();
    const okTotp = authenticator.verify({ token: tokenStr.replace(/\s/g, ''), secret });
    if (!okTotp) {
      const hashes = parseBackupCodeHashes(user.mfa_backup_codes);
      // matchBackupCode handles both bcrypt and legacy SHA-256 hashes;
      // any store older than the bcrypt migration keeps working.
      const idx = hashes.findIndex((h) => matchBackupCode(tokenStr, h));
      if (idx === -1) {
        return { error: 'Invalid verification code', status: 401 };
      }
      hashes.splice(idx, 1);
      db.prepare('UPDATE users SET mfa_backup_codes = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(
        JSON.stringify(hashes),
        user.id
      );
    }
    db.prepare('UPDATE users SET last_login = CURRENT_TIMESTAMP, login_count = login_count + 1 WHERE id = ?').run(user.id);
    const sessionToken = generateToken(user);
    const userSafe = stripUserForClient(user) as Record<string, unknown>;
    return {
      token: sessionToken,
      user: { ...userSafe, avatar_url: avatarUrl(user) },
      auditUserId: Number(user.id),
    };
  } catch {
    return { error: 'Invalid or expired verification token', status: 401 };
  }
}

import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import crypto from 'crypto';
import path from 'path';
import fs from 'fs';
import { db } from '../db/database';
import { JWT_SECRET } from '../config';
import { decrypt_api_key } from './apiKeyCrypto';
import { User } from '../types';

// ---------------------------------------------------------------------------
// Constants & shared state
// ---------------------------------------------------------------------------

// Pre-computed bcrypt hash to equalise timing of "unknown email" and
// "OIDC-only account" branches with the real verification path (CWE-208).
// Cost factor 12 matches register/changePassword/resetPassword — must stay in sync.
export const DUMMY_PASSWORD_HASH = bcrypt.hashSync('__trek_no_such_user__', 12);

export const MFA_SETUP_TTL_MS = 15 * 60 * 1000;
export const MFA_BACKUP_CODE_COUNT = 10;
export const mfaSetupPending = new Map<number, { secret: string; exp: number }>();

export const avatarDir = path.join(__dirname, '../../uploads/avatars');
if (!fs.existsSync(avatarDir)) fs.mkdirSync(avatarDir, { recursive: true });

// ---------------------------------------------------------------------------
// User shaping & masking helpers
// ---------------------------------------------------------------------------

export function utcSuffix(ts: string | null | undefined): string | null {
  if (!ts) return null;
  return ts.endsWith('Z') ? ts : ts.replace(' ', 'T') + 'Z';
}

export function stripUserForClient(user: User): Record<string, unknown> {
  const {
    password_hash: _p,
    maps_api_key: _m,
    openweather_api_key: _o,
    unsplash_api_key: _u,
    mfa_secret: _mf,
    mfa_backup_codes: _mbc,
    ...rest
  } = user;
  return {
    ...rest,
    created_at: utcSuffix(rest.created_at),
    updated_at: utcSuffix(rest.updated_at),
    last_login: utcSuffix(rest.last_login),
    mfa_enabled: !!(user.mfa_enabled === 1 || user.mfa_enabled === true),
    must_change_password: !!(user.must_change_password === 1 || user.must_change_password === true),
  };
}

export function maskKey(key: string | null | undefined): string | null {
  if (!key) return null;
  if (key.length <= 8) return '--------';
  return '----' + key.slice(-4);
}

export function mask_stored_api_key(key: string | null | undefined): string | null {
  const plain = decrypt_api_key(key);
  return maskKey(plain);
}

export function avatarUrl(user: { avatar?: string | null }): string | null {
  return user.avatar ? `/uploads/avatars/${user.avatar}` : null;
}

// ---------------------------------------------------------------------------
// Auth toggles & JWT
// ---------------------------------------------------------------------------

export function resolveAuthToggles(): {
  password_login: boolean;
  password_registration: boolean;
  oidc_login: boolean;
  oidc_registration: boolean;
} {
  const get = (key: string) =>
    (db.prepare("SELECT value FROM app_settings WHERE key = ?").get(key) as { value: string } | undefined)?.value ?? null;

  const hasNewKeys = ['password_login', 'password_registration', 'oidc_login', 'oidc_registration']
    .some(k => get(k) !== null);

  if (hasNewKeys) {
    const result = {
      password_login: get('password_login') !== 'false',
      password_registration: get('password_registration') !== 'false',
      oidc_login: get('oidc_login') !== 'false',
      oidc_registration: get('oidc_registration') !== 'false',
    };
    if (process.env.OIDC_ONLY?.toLowerCase() === 'true') {
      result.password_login = false;
      result.password_registration = false;
    }
    return result;
  }

  // Legacy fallback
  const oidcOnlyEnabled = process.env.OIDC_ONLY?.toLowerCase() === 'true' || get('oidc_only') === 'true';
  const oidcConfigured = !!(
    (process.env.OIDC_ISSUER || get('oidc_issuer')) &&
    (process.env.OIDC_CLIENT_ID || get('oidc_client_id'))
  );
  const oidcOnly = oidcOnlyEnabled && oidcConfigured;
  const allowReg = (get('allow_registration') ?? 'true') === 'true';

  return {
    password_login: !oidcOnly,
    password_registration: !oidcOnly && allowReg,
    oidc_login: true,
    oidc_registration: allowReg,
  };
}

export function isOidcOnlyMode(): boolean {
  return !resolveAuthToggles().password_login;
}

export function generateToken(user: { id: number | bigint; password_version?: number }) {
  const pv = typeof user.password_version === 'number'
    ? user.password_version
    : ((db.prepare('SELECT password_version FROM users WHERE id = ?').get(user.id) as { password_version?: number } | undefined)?.password_version ?? 0);
  return jwt.sign(
    { id: user.id, pv },
    JWT_SECRET,
    { expiresIn: '24h', algorithm: 'HS256' }
  );
}

// ---------------------------------------------------------------------------
// MFA helpers — code generation, hashing, verification primitives
// ---------------------------------------------------------------------------

export function normalizeBackupCode(input: string): string {
  return String(input || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
}

// Legacy SHA-256 hex hash. Kept so existing stored hashes (from before
// the bcrypt migration) can still be verified in `matchBackupCode`
// without forcing every user to re-enrol their MFA device. New hashes
// are produced by `hashBackupCodeBcrypt` below.
export function hashBackupCode(input: string): string {
  return crypto.createHash('sha256').update(normalizeBackupCode(input)).digest('hex');
}

const BCRYPT_BACKUP_COST = 10;

/**
 * Hash a backup code with bcrypt for at-rest storage. Backup codes only
 * have ~40 bits of entropy (8 hex chars) so a plain SHA-256 rainbow
 * table cracks them in minutes if the DB ever leaks. bcrypt with a
 * moderate cost raises that cost by ~3-4 orders of magnitude.
 */
export function hashBackupCodeBcrypt(input: string): string {
  return bcrypt.hashSync(normalizeBackupCode(input), BCRYPT_BACKUP_COST);
}

/**
 * Constant-time match of a plaintext backup code against a stored hash
 * in either format (bcrypt or legacy SHA-256 hex). Used by login and
 * password-reset flows; callers that need to CONSUME the matching
 * entry should use this to find the index, then splice it out.
 */
export function matchBackupCode(plaintext: string, storedHash: string): boolean {
  if (!storedHash) return false;
  if (storedHash.startsWith('$2')) {
    // bcrypt hash — compareSync is constant-time internally.
    try { return bcrypt.compareSync(normalizeBackupCode(plaintext), storedHash); }
    catch { return false; }
  }
  // Legacy SHA-256 hex. Compare the SHA-256 of the input against the
  // stored hex with a constant-time comparator so timing can't leak.
  const candidate = hashBackupCode(plaintext);
  if (candidate.length !== storedHash.length) return false;
  return crypto.timingSafeEqual(Buffer.from(candidate), Buffer.from(storedHash));
}

export function generateBackupCodes(count = MFA_BACKUP_CODE_COUNT): string[] {
  const codes: string[] = [];
  while (codes.length < count) {
    const raw = crypto.randomBytes(4).toString('hex').toUpperCase();
    const code = `${raw.slice(0, 4)}-${raw.slice(4)}`;
    if (!codes.includes(code)) codes.push(code);
  }
  return codes;
}

export function parseBackupCodeHashes(raw: string | null | undefined): string[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter(v => typeof v === 'string') : [];
  } catch {
    return [];
  }
}

export function getPendingMfaSecret(userId: number): string | null {
  const row = mfaSetupPending.get(userId);
  if (!row || Date.now() > row.exp) {
    mfaSetupPending.delete(userId);
    return null;
  }
  return row.secret;
}

import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { db } from '../db/database';
import { JWT_SECRET } from '../config';
import { User } from '../types';
import {
  avatarUrl,
  DUMMY_PASSWORD_HASH,
  generateToken,
  isOidcOnlyMode,
  stripUserForClient,
} from './authShared';

export function loginUser(body: {
  email?: string;
  password?: string;
}): {
  error?: string;
  status?: number;
  token?: string;
  user?: Record<string, unknown>;
  mfa_required?: boolean;
  mfa_token?: string;
  auditUserId?: number | null;
  auditAction?: string;
  auditDetails?: Record<string, unknown>;
} {
  if (isOidcOnlyMode()) {
    return { error: 'Password authentication is disabled. Please sign in with SSO.', status: 403 };
  }

  const { email, password } = body;
  if (!email || !password) {
    return { error: 'Email and password are required', status: 400 };
  }

  const user = db.prepare('SELECT * FROM users WHERE LOWER(email) = LOWER(?)').get(email) as User | undefined;

  // Always run bcrypt — even for unknown/OIDC-only users — so response time
  // does not reveal whether the email exists in the database (CWE-203/208).
  const hashToCheck = user?.password_hash ?? DUMMY_PASSWORD_HASH;
  const validPassword = bcrypt.compareSync(password, hashToCheck);

  if (!user) {
    return {
      error: 'Invalid email or password', status: 401,
      auditUserId: null, auditAction: 'user.login_failed', auditDetails: { email, reason: 'unknown_email' },
    };
  }
  if (!user.password_hash) {
    return {
      error: 'Invalid email or password', status: 401,
      auditUserId: Number(user.id), auditAction: 'user.login_failed', auditDetails: { email, reason: 'oidc_only' },
    };
  }
  if (!validPassword) {
    return {
      error: 'Invalid email or password', status: 401,
      auditUserId: Number(user.id), auditAction: 'user.login_failed', auditDetails: { email, reason: 'wrong_password' },
    };
  }

  if (user.mfa_enabled === 1 || user.mfa_enabled === true) {
    const mfa_token = jwt.sign(
      { id: Number(user.id), purpose: 'mfa_login' },
      JWT_SECRET,
      { expiresIn: '5m', algorithm: 'HS256' }
    );
    return { mfa_required: true, mfa_token };
  }

  db.prepare('UPDATE users SET last_login = CURRENT_TIMESTAMP, login_count = login_count + 1 WHERE id = ?').run(user.id);
  const token = generateToken(user);
  const userSafe = stripUserForClient(user) as Record<string, unknown>;

  return {
    token,
    user: { ...userSafe, avatar_url: avatarUrl(user) },
    auditUserId: Number(user.id),
    auditAction: 'user.login',
    auditDetails: { email },
  };
}

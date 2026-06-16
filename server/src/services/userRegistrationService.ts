import bcrypt from 'bcryptjs';
import { db } from '../db/database';
import { validatePassword } from './passwordPolicy';
import { User } from '../types';
import { DEMO_EMAIL_PRIMARY } from './demo';
import {
  avatarUrl,
  generateToken,
  resolveAuthToggles,
  stripUserForClient,
} from './authShared';

export function demoLogin(): { error?: string; status?: number; token?: string; user?: Record<string, unknown> } {
  if (process.env.DEMO_MODE !== 'true') {
    return { error: 'Not found', status: 404 };
  }
  const user = db.prepare('SELECT * FROM users WHERE email = ?').get(DEMO_EMAIL_PRIMARY) as User | undefined;
  if (!user) return { error: 'Demo user not found', status: 500 };
  const token = generateToken(user);
  const safe = stripUserForClient(user) as Record<string, unknown>;
  return { token, user: { ...safe, avatar_url: avatarUrl(user) } };
}

export function validateInviteToken(token: string): { error?: string; status?: number; valid?: boolean; max_uses?: number; used_count?: number; expires_at?: string } {
  const invite = db.prepare('SELECT * FROM invite_tokens WHERE token = ?').get(token) as any;
  if (!invite) return { error: 'Invalid invite link', status: 404 };
  if (invite.max_uses > 0 && invite.used_count >= invite.max_uses) return { error: 'Invite link has been fully used', status: 410 };
  if (invite.expires_at && new Date(invite.expires_at) < new Date()) return { error: 'Invite link has expired', status: 410 };
  return { valid: true, max_uses: invite.max_uses, used_count: invite.used_count, expires_at: invite.expires_at };
}

export function registerUser(body: {
  username?: string;
  email?: string;
  password?: string;
  invite_token?: string;
}): { error?: string; status?: number; token?: string; user?: Record<string, unknown>; auditUserId?: number; auditDetails?: Record<string, unknown> } {
  const username = typeof body.username === 'string' ? body.username.trim() : '';
  const email = typeof body.email === 'string' ? body.email.trim() : '';
  const { password, invite_token } = body;

  const userCount = (db.prepare('SELECT COUNT(*) as count FROM users').get() as { count: number }).count;

  let validInvite: any = null;
  if (invite_token) {
    validInvite = db.prepare('SELECT * FROM invite_tokens WHERE token = ?').get(invite_token);
    if (!validInvite) return { error: 'Invalid invite link', status: 400 };
    if (validInvite.max_uses > 0 && validInvite.used_count >= validInvite.max_uses) return { error: 'Invite link has been fully used', status: 410 };
    if (validInvite.expires_at && new Date(validInvite.expires_at) < new Date()) return { error: 'Invite link has expired', status: 410 };
  }

  if (userCount > 0 && !validInvite) {
    const toggles = resolveAuthToggles();
    if (!toggles.password_registration) {
      return { error: 'Password registration is disabled. Contact your administrator.', status: 403 };
    }
  }

  if (!username || !email || !password) {
    return { error: 'Username, email and password are required', status: 400 };
  }

  const pwCheck = validatePassword(password);
  if (!pwCheck.ok) return { error: pwCheck.reason, status: 400 };

  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!emailRegex.test(email)) {
    return { error: 'Invalid email format', status: 400 };
  }

  const existingUser = db.prepare('SELECT id FROM users WHERE LOWER(email) = LOWER(?) OR LOWER(username) = LOWER(?)').get(email, username);
  if (existingUser) {
    return { error: 'Registration failed. Please try different credentials.', status: 409 };
  }

  const password_hash = bcrypt.hashSync(password, 12);
  const isFirstUser = userCount === 0;
  const role = isFirstUser ? 'admin' : 'user';

  try {
    const result = db.prepare(
      'INSERT INTO users (username, email, password_hash, role, first_seen_version, login_count) VALUES (?, ?, ?, ?, ?, 0)'
    ).run(username, email, password_hash, role, process.env.APP_VERSION || '0.0.0');

    const user = { id: result.lastInsertRowid, username, email, role, avatar: null, mfa_enabled: false };
    const token = generateToken(user);

    if (validInvite) {
      const updated = db.prepare(
        'UPDATE invite_tokens SET used_count = used_count + 1 WHERE id = ? AND (max_uses = 0 OR used_count < max_uses) RETURNING used_count'
      ).get(validInvite.id);
      if (!updated) {
        console.warn(`[Auth] Invite token ${validInvite.token.slice(0, 8)}... exceeded max_uses due to race condition`);
      }
    }

    return {
      token,
      user: { ...user, avatar_url: null },
      auditUserId: Number(result.lastInsertRowid),
      auditDetails: { username, email, role },
    };
  } catch {
    return { error: 'Error creating user', status: 500 };
  }
}

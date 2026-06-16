import path from 'path';
import fs from 'fs';
import { db } from '../db/database';
import { decrypt_api_key, maybe_encrypt_api_key } from './apiKeyCrypto';
import { deleteUserCompletely } from './userCleanupService';
import { isDemoEmail } from './demo';
import { User } from '../types';
import { avatarDir, avatarUrl, mask_stored_api_key, stripUserForClient } from './authShared';

// ---------------------------------------------------------------------------
// Session
// ---------------------------------------------------------------------------

export function getCurrentUser(userId: number) {
  const user = db.prepare(
    'SELECT id, username, email, role, avatar, oidc_issuer, created_at, mfa_enabled, must_change_password FROM users WHERE id = ?'
  ).get(userId) as User | undefined;
  if (!user) return null;
  const base = stripUserForClient(user as User) as Record<string, unknown>;
  return { ...base, avatar_url: avatarUrl(user) };
}

// ---------------------------------------------------------------------------
// Account deletion
// ---------------------------------------------------------------------------

export function deleteAccount(userId: number, userEmail: string, userRole: string): { error?: string; status?: number; success?: boolean } {
  if (process.env.DEMO_MODE === 'true' && isDemoEmail(userEmail)) {
    return { error: 'Account deletion is disabled in demo mode.', status: 403 };
  }
  if (userRole === 'admin') {
    const adminCount = (db.prepare("SELECT COUNT(*) as count FROM users WHERE role = 'admin'").get() as { count: number }).count;
    if (adminCount <= 1) {
      return { error: 'Cannot delete the last admin account', status: 400 };
    }
  }
  deleteUserCompletely(userId);
  return { success: true };
}

// ---------------------------------------------------------------------------
// API keys & profile settings
// ---------------------------------------------------------------------------

export function updateMapsKey(userId: number, maps_api_key: string | null | undefined) {
  db.prepare(
    'UPDATE users SET maps_api_key = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?'
  ).run(maybe_encrypt_api_key(maps_api_key), userId);
  return { success: true, maps_api_key: mask_stored_api_key(maps_api_key) };
}

export function updateApiKeys(
  userId: number,
  body: { maps_api_key?: string; openweather_api_key?: string }
) {
  const current = db.prepare('SELECT maps_api_key, openweather_api_key FROM users WHERE id = ?').get(userId) as Pick<User, 'maps_api_key' | 'openweather_api_key'> | undefined;

  db.prepare(
    'UPDATE users SET maps_api_key = ?, openweather_api_key = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?'
  ).run(
    body.maps_api_key !== undefined ? maybe_encrypt_api_key(body.maps_api_key) : current!.maps_api_key,
    body.openweather_api_key !== undefined ? maybe_encrypt_api_key(body.openweather_api_key) : current!.openweather_api_key,
    userId
  );

  const updated = db.prepare(
    'SELECT id, username, email, role, maps_api_key, openweather_api_key, avatar, mfa_enabled FROM users WHERE id = ?'
  ).get(userId) as Pick<User, 'id' | 'username' | 'email' | 'role' | 'maps_api_key' | 'openweather_api_key' | 'avatar' | 'mfa_enabled'> | undefined;

  const u = updated ? { ...updated, mfa_enabled: !!(updated.mfa_enabled === 1 || updated.mfa_enabled === true) } : undefined;
  return {
    success: true,
    user: { ...u, maps_api_key: mask_stored_api_key(u?.maps_api_key), openweather_api_key: mask_stored_api_key(u?.openweather_api_key), avatar_url: avatarUrl(updated || {}) },
  };
}

export function updateSettings(
  userId: number,
  body: { maps_api_key?: string; openweather_api_key?: string; username?: string; email?: string }
): { error?: string; status?: number; success?: boolean; user?: Record<string, unknown> } {
  const { maps_api_key, openweather_api_key, username, email } = body;

  if (username !== undefined) {
    const trimmed = username.trim();
    if (!trimmed || trimmed.length < 2 || trimmed.length > 50) {
      return { error: 'Username must be between 2 and 50 characters', status: 400 };
    }
    if (!/^[a-zA-Z0-9_.-]+$/.test(trimmed)) {
      return { error: 'Username can only contain letters, numbers, underscores, dots and hyphens', status: 400 };
    }
    const conflict = db.prepare('SELECT id FROM users WHERE LOWER(username) = LOWER(?) AND id != ?').get(trimmed, userId);
    if (conflict) return { error: 'Username already taken', status: 409 };
  }

  if (email !== undefined) {
    const trimmed = email.trim();
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!trimmed || !emailRegex.test(trimmed)) {
      return { error: 'Invalid email format', status: 400 };
    }
    const conflict = db.prepare('SELECT id FROM users WHERE LOWER(email) = LOWER(?) AND id != ?').get(trimmed, userId);
    if (conflict) return { error: 'Email already taken', status: 409 };
  }

  const updates: string[] = [];
  const params: (string | number | null)[] = [];

  if (maps_api_key !== undefined) { updates.push('maps_api_key = ?'); params.push(maybe_encrypt_api_key(maps_api_key)); }
  if (openweather_api_key !== undefined) { updates.push('openweather_api_key = ?'); params.push(maybe_encrypt_api_key(openweather_api_key)); }
  if (username !== undefined) { updates.push('username = ?'); params.push(username.trim()); }
  if (email !== undefined) { updates.push('email = ?'); params.push(email.trim()); }

  if (updates.length > 0) {
    updates.push('updated_at = CURRENT_TIMESTAMP');
    params.push(userId);
    db.prepare(`UPDATE users SET ${updates.join(', ')} WHERE id = ?`).run(...params);
  }

  const updated = db.prepare(
    'SELECT id, username, email, role, maps_api_key, openweather_api_key, avatar, mfa_enabled FROM users WHERE id = ?'
  ).get(userId) as Pick<User, 'id' | 'username' | 'email' | 'role' | 'maps_api_key' | 'openweather_api_key' | 'avatar' | 'mfa_enabled'> | undefined;

  const u = updated ? { ...updated, mfa_enabled: !!(updated.mfa_enabled === 1 || updated.mfa_enabled === true) } : undefined;
  return {
    success: true,
    user: { ...u, maps_api_key: mask_stored_api_key(u?.maps_api_key), openweather_api_key: mask_stored_api_key(u?.openweather_api_key), avatar_url: avatarUrl(updated || {}) },
  };
}

export function getSettings(userId: number): { error?: string; status?: number; settings?: Record<string, unknown> } {
  const user = db.prepare(
    'SELECT role, maps_api_key, openweather_api_key FROM users WHERE id = ?'
  ).get(userId) as Pick<User, 'role' | 'maps_api_key' | 'openweather_api_key'> | undefined;
  if (user?.role !== 'admin') return { error: 'Admin access required', status: 403 };

  return {
    settings: {
      maps_api_key: decrypt_api_key(user.maps_api_key),
      openweather_api_key: decrypt_api_key(user.openweather_api_key),
    },
  };
}

// ---------------------------------------------------------------------------
// Avatar
// ---------------------------------------------------------------------------

export async function saveAvatar(userId: number, filename: string) {
  const current = db.prepare('SELECT avatar FROM users WHERE id = ?').get(userId) as { avatar: string | null } | undefined;
  if (current && current.avatar) {
    // Fire-and-forget: leftover files are harmless; the DB update is
    // the source of truth for which avatar is current.
    const oldPath = path.join(avatarDir, current.avatar);
    await fs.promises.rm(oldPath, { force: true }).catch(() => {});
  }

  db.prepare('UPDATE users SET avatar = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(filename, userId);

  const updated = db.prepare('SELECT id, username, email, role, avatar FROM users WHERE id = ?').get(userId) as Pick<User, 'id' | 'username' | 'email' | 'role' | 'avatar'> | undefined;
  return { success: true, avatar_url: avatarUrl(updated || {}) };
}

export async function deleteAvatar(userId: number) {
  const current = db.prepare('SELECT avatar FROM users WHERE id = ?').get(userId) as { avatar: string | null } | undefined;
  if (current && current.avatar) {
    const filePath = path.join(avatarDir, current.avatar);
    await fs.promises.rm(filePath, { force: true }).catch(() => {});
  }
  db.prepare('UPDATE users SET avatar = NULL, updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(userId);
  return { success: true };
}

// ---------------------------------------------------------------------------
// User directory
// ---------------------------------------------------------------------------

export function listUsers(excludeUserId: number) {
  const users = db.prepare(
    'SELECT id, username, avatar FROM users WHERE id != ? ORDER BY username ASC'
  ).all(excludeUserId) as Pick<User, 'id' | 'username' | 'avatar'>[];
  return users.map(u => ({ ...u, avatar_url: avatarUrl(u) }));
}

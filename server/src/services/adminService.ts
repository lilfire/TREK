import bcrypt from 'bcryptjs';
import crypto from 'crypto';
import path from 'path';
import fs from 'fs';
import { db } from '../db/database';
import { User } from '../types';
import { updateJwtSecret } from '../config';
import { maybe_encrypt_api_key, decrypt_api_key } from './apiKeyCrypto';
import { getAllPermissions, savePermissions as savePerms, PERMISSION_ACTIONS } from './permissions';
import { revokeUserSessions, revokeUserSessionsForClient } from '../mcp';
import { deleteUserCompletely } from './userCleanupService';
import { validatePassword } from './passwordPolicy';
import { resolveAuthToggles } from './authService';

// Re-exports keep the existing route handlers importing from adminService while
// the underlying logic lives in focused per-concern modules.
export {
  compareVersions,
  isDocker,
  getGithubReleases,
  checkVersion,
  checkAndNotifyVersion,
  __clearVersionCacheForTests,
} from './versionCheckService';
export {
  listPackingTemplates,
  getPackingTemplate,
  createPackingTemplate,
  updatePackingTemplate,
  deletePackingTemplate,
  createTemplateCategory,
  updateTemplateCategory,
  deleteTemplateCategory,
  createTemplateItem,
  updateTemplateItem,
  deleteTemplateItem,
} from './packingTemplateService';
export { isAddonEnabled, listAddons, updateAddon } from './addonService';

// ── Helpers ────────────────────────────────────────────────────────────────

export function utcSuffix(ts: string | null | undefined): string | null {
  if (!ts) return null;
  return ts.endsWith('Z') ? ts : ts.replace(' ', 'T') + 'Z';
}

// ── User CRUD ──────────────────────────────────────────────────────────────

export function listUsers() {
  const users = db.prepare(
    'SELECT id, username, email, role, avatar, created_at, updated_at, last_login FROM users ORDER BY created_at DESC'
  ).all() as (Pick<User, 'id' | 'username' | 'email' | 'role' | 'created_at' | 'updated_at' | 'last_login'> & { avatar?: string | null })[];
  let onlineUserIds = new Set<number>();
  try {
    const { getOnlineUserIds } = require('../websocket');
    onlineUserIds = getOnlineUserIds();
  } catch { /* */ }
  return users.map(u => ({
    ...u,
    avatar_url: u.avatar ? `/uploads/avatars/${u.avatar}` : null,
    created_at: utcSuffix(u.created_at),
    updated_at: utcSuffix(u.updated_at as string),
    last_login: utcSuffix(u.last_login),
    online: onlineUserIds.has(u.id),
  }));
}

export function createUser(data: { username: string; email: string; password: string; role?: string }) {
  const username = data.username?.trim();
  const email = data.email?.trim();
  const password = data.password?.trim();

  if (!username || !email || !password) {
    return { error: 'Username, email and password are required', status: 400 };
  }

  const pwCheck = validatePassword(password);
  if (!pwCheck.ok) return { error: pwCheck.reason, status: 400 };

  if (data.role && !['user', 'admin'].includes(data.role)) {
    return { error: 'Invalid role', status: 400 };
  }

  const existingUsername = db.prepare('SELECT id FROM users WHERE username = ?').get(username);
  if (existingUsername) return { error: 'Username already taken', status: 409 };

  const existingEmail = db.prepare('SELECT id FROM users WHERE email = ?').get(email);
  if (existingEmail) return { error: 'Email already taken', status: 409 };

  const passwordHash = bcrypt.hashSync(password, 12);

  const result = db.prepare(
    'INSERT INTO users (username, email, password_hash, role) VALUES (?, ?, ?, ?)'
  ).run(username, email, passwordHash, data.role || 'user');

  const user = db.prepare(
    'SELECT id, username, email, role, created_at, updated_at FROM users WHERE id = ?'
  ).get(result.lastInsertRowid);

  return {
    user,
    insertedId: Number(result.lastInsertRowid),
    auditDetails: { username, email, role: data.role || 'user' },
  };
}

export function updateUser(id: string, data: { username?: string; email?: string; role?: string; password?: string }) {
  const username = typeof data.username === 'string' ? data.username.trim() : data.username;
  const email = typeof data.email === 'string' ? data.email.trim() : data.email;
  const { role, password } = data;
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(id) as User | undefined;

  if (!user) return { error: 'User not found', status: 404 };

  if (role && !['user', 'admin'].includes(role)) {
    return { error: 'Invalid role', status: 400 };
  }

  if (username && username !== user.username) {
    const conflict = db.prepare('SELECT id FROM users WHERE username = ? AND id != ?').get(username, id);
    if (conflict) return { error: 'Username already taken', status: 409 };
  }
  if (email && email !== user.email) {
    const conflict = db.prepare('SELECT id FROM users WHERE email = ? AND id != ?').get(email, id);
    if (conflict) return { error: 'Email already taken', status: 409 };
  }

  if (password) {
    const pwCheck = validatePassword(password);
    if (!pwCheck.ok) return { error: pwCheck.reason, status: 400 };
  }
  const passwordHash = password ? bcrypt.hashSync(password, 12) : null;

  db.prepare(`
    UPDATE users SET
      username = COALESCE(?, username),
      email = COALESCE(?, email),
      role = COALESCE(?, role),
      password_hash = COALESCE(?, password_hash),
      updated_at = CURRENT_TIMESTAMP
    WHERE id = ?
  `).run(username || null, email || null, role || null, passwordHash, id);

  const updated = db.prepare(
    'SELECT id, username, email, role, created_at, updated_at FROM users WHERE id = ?'
  ).get(id);

  const changed: string[] = [];
  if (username) changed.push('username');
  if (email) changed.push('email');
  if (role) changed.push('role');
  if (password) changed.push('password');

  return {
    user: updated,
    previousEmail: user.email,
    changed,
  };
}

export function deleteUser(id: string, currentUserId: number) {
  if (parseInt(id) === currentUserId) {
    return { error: 'Cannot delete own account', status: 400 };
  }

  const userToDel = db.prepare('SELECT id, email FROM users WHERE id = ?').get(id) as { id: number; email: string } | undefined;
  if (!userToDel) return { error: 'User not found', status: 404 };

  deleteUserCompletely(userToDel.id);
  return { email: userToDel.email };
}

// ── Stats ──────────────────────────────────────────────────────────────────

export function getStats() {
  const totalUsers = (db.prepare('SELECT COUNT(*) as count FROM users').get() as { count: number }).count;
  const totalTrips = (db.prepare('SELECT COUNT(*) as count FROM trips').get() as { count: number }).count;
  const totalPlaces = (db.prepare('SELECT COUNT(*) as count FROM places').get() as { count: number }).count;
  const totalFiles = (db.prepare('SELECT COUNT(*) as count FROM trip_files').get() as { count: number }).count;
  return { totalUsers, totalTrips, totalPlaces, totalFiles };
}

// ── Permissions ────────────────────────────────────────────────────────────

export function getPermissions() {
  const current = getAllPermissions();
  const actions = PERMISSION_ACTIONS.map(a => ({
    key: a.key,
    level: current[a.key],
    defaultLevel: a.defaultLevel,
    allowedLevels: a.allowedLevels,
  }));
  return { permissions: actions };
}

export function savePermissions(permissions: Record<string, string>) {
  const { skipped } = savePerms(permissions);
  return { permissions: getAllPermissions(), skipped };
}

// ── Audit Log ──────────────────────────────────────────────────────────────

export function getAuditLog(query: { limit?: string; offset?: string }) {
  const limitRaw = parseInt(String(query.limit || '100'), 10);
  const offsetRaw = parseInt(String(query.offset || '0'), 10);
  const limit = Math.min(Math.max(Number.isFinite(limitRaw) ? limitRaw : 100, 1), 500);
  const offset = Math.max(Number.isFinite(offsetRaw) ? offsetRaw : 0, 0);

  type Row = {
    id: number;
    created_at: string;
    user_id: number | null;
    username: string | null;
    user_email: string | null;
    action: string;
    resource: string | null;
    details: string | null;
    ip: string | null;
  };

  const rows = db.prepare(`
    SELECT a.id, a.created_at, a.user_id, u.username, u.email as user_email, a.action, a.resource, a.details, a.ip
    FROM audit_log a
    LEFT JOIN users u ON u.id = a.user_id
    ORDER BY a.id DESC
    LIMIT ? OFFSET ?
  `).all(limit, offset) as Row[];

  const total = (db.prepare('SELECT COUNT(*) as c FROM audit_log').get() as { c: number }).c;

  const entries = rows.map((r) => {
    let details: Record<string, unknown> | null = null;
    if (r.details) {
      try {
        details = JSON.parse(r.details) as Record<string, unknown>;
      } catch {
        details = { _parse_error: true };
      }
    }
    const created_at = r.created_at && !r.created_at.endsWith('Z') ? r.created_at.replace(' ', 'T') + 'Z' : r.created_at;
    return { ...r, created_at, details };
  });

  return { entries, total, limit, offset };
}

// ── OIDC Settings ──────────────────────────────────────────────────────────

export function getOidcSettings() {
  const get = (key: string) => (db.prepare("SELECT value FROM app_settings WHERE key = ?").get(key) as { value: string } | undefined)?.value || '';
  const secret = decrypt_api_key(get('oidc_client_secret'));
  return {
    issuer: get('oidc_issuer'),
    client_id: get('oidc_client_id'),
    client_secret_set: !!secret,
    display_name: get('oidc_display_name'),
    oidc_only: get('oidc_only') === 'true',
    discovery_url: get('oidc_discovery_url'),
  };
}

export function updateOidcSettings(data: {
  issuer?: string;
  client_id?: string;
  client_secret?: string;
  display_name?: string;
  discovery_url?: string;
}): { error?: string; status?: number; success?: boolean } {
  // Lockout prevention: can't remove OIDC config when password login is disabled
  if ((data.issuer === '' || data.client_id === '') && !resolveAuthToggles().password_login) {
    return { error: 'Cannot remove SSO configuration while password login is disabled. Enable password login first.', status: 400 };
  }

  const set = (key: string, val: string) => db.prepare("INSERT OR REPLACE INTO app_settings (key, value) VALUES (?, ?)").run(key, val || '');
  set('oidc_issuer', data.issuer ?? '');
  set('oidc_client_id', data.client_id ?? '');
  if (data.client_secret !== undefined) set('oidc_client_secret', maybe_encrypt_api_key(data.client_secret) ?? '');
  set('oidc_display_name', data.display_name ?? '');
  set('oidc_discovery_url', data.discovery_url ?? '');
  return { success: true };
}

// ── Demo Baseline ──────────────────────────────────────────────────────────

export function saveDemoBaseline(): { error?: string; status?: number; message?: string } {
  if (process.env.DEMO_MODE?.toLowerCase() !== 'true') {
    return { error: 'Not found', status: 404 };
  }
  try {
    const { saveBaseline } = require('../demo/demo-reset');
    saveBaseline();
    return { message: 'Demo baseline saved. Hourly resets will restore to this state.' };
  } catch (err: unknown) {
    console.error(err);
    return { error: 'Failed to save baseline', status: 500 };
  }
}

// ── Invite Tokens ──────────────────────────────────────────────────────────

export function listInvites() {
  return db.prepare(`
    SELECT i.*, u.username as created_by_name
    FROM invite_tokens i
    JOIN users u ON i.created_by = u.id
    ORDER BY i.created_at DESC
  `).all();
}

export function createInvite(createdBy: number, data: { max_uses?: string | number; expires_in_days?: string | number }) {
  const rawUses = parseInt(String(data.max_uses));
  const uses = rawUses === 0 ? 0 : Math.min(Math.max(rawUses || 1, 1), 5);
  const token = crypto.randomBytes(16).toString('hex');
  const expiresAt = data.expires_in_days
    ? new Date(Date.now() + parseInt(String(data.expires_in_days)) * 86400000).toISOString()
    : null;

  const ins = db.prepare(
    'INSERT INTO invite_tokens (token, max_uses, expires_at, created_by) VALUES (?, ?, ?, ?)'
  ).run(token, uses, expiresAt, createdBy);

  const inviteId = Number(ins.lastInsertRowid);
  const invite = db.prepare(`
    SELECT i.*, u.username as created_by_name
    FROM invite_tokens i
    JOIN users u ON i.created_by = u.id
    WHERE i.id = ?
  `).get(inviteId);

  return { invite, inviteId, uses, expiresInDays: data.expires_in_days ?? null };
}

export function deleteInvite(id: string) {
  const invite = db.prepare('SELECT id FROM invite_tokens WHERE id = ?').get(id);
  if (!invite) return { error: 'Invite not found', status: 404 };
  db.prepare('DELETE FROM invite_tokens WHERE id = ?').run(id);
  return {};
}

// ── Bag Tracking ───────────────────────────────────────────────────────────

export function getBagTracking() {
  const row = db.prepare("SELECT value FROM app_settings WHERE key = 'bag_tracking_enabled'").get() as { value: string } | undefined;
  return { enabled: row?.value === 'true' };
}

export function updateBagTracking(enabled: boolean) {
  db.prepare("INSERT OR REPLACE INTO app_settings (key, value) VALUES ('bag_tracking_enabled', ?)").run(enabled ? 'true' : 'false');
  return { enabled: !!enabled };
}

// ── Places Photos ─────────────────────────────────────────────────────────

export function getPlacesPhotos() {
  const row = db.prepare("SELECT value FROM app_settings WHERE key = 'places_photos_enabled'").get() as { value: string } | undefined;
  return { enabled: row?.value !== 'false' };
}

export function updatePlacesPhotos(enabled: boolean) {
  db.prepare("INSERT OR REPLACE INTO app_settings (key, value) VALUES ('places_photos_enabled', ?)").run(enabled ? 'true' : 'false');
  return { enabled: !!enabled };
}

// ── Places Autocomplete ────────────────────────────────────────────────────

export function getPlacesAutocomplete() {
  const row = db.prepare("SELECT value FROM app_settings WHERE key = 'places_autocomplete_enabled'").get() as { value: string } | undefined;
  return { enabled: row?.value !== 'false' };
}

export function updatePlacesAutocomplete(enabled: boolean) {
  db.prepare("INSERT OR REPLACE INTO app_settings (key, value) VALUES ('places_autocomplete_enabled', ?)").run(enabled ? 'true' : 'false');
  return { enabled: !!enabled };
}

// ── Places Details ─────────────────────────────────────────────────────────

export function getPlacesDetails() {
  const row = db.prepare("SELECT value FROM app_settings WHERE key = 'places_details_enabled'").get() as { value: string } | undefined;
  return { enabled: row?.value !== 'false' };
}

export function updatePlacesDetails(enabled: boolean) {
  db.prepare("INSERT OR REPLACE INTO app_settings (key, value) VALUES ('places_details_enabled', ?)").run(enabled ? 'true' : 'false');
  return { enabled: !!enabled };
}

// ── Collab Features ───────────────────────────────────────────────────────

const COLLAB_FEATURE_KEYS = ['collab_chat_enabled', 'collab_notes_enabled', 'collab_polls_enabled', 'collab_whatsnext_enabled'] as const;

export function getCollabFeatures() {
  const rows = db.prepare("SELECT key, value FROM app_settings WHERE key IN ('collab_chat_enabled', 'collab_notes_enabled', 'collab_polls_enabled', 'collab_whatsnext_enabled')").all() as { key: string; value: string }[];
  const map: Record<string, string> = {};
  for (const r of rows) map[r.key] = r.value;
  return {
    chat: map['collab_chat_enabled'] !== 'false',
    notes: map['collab_notes_enabled'] !== 'false',
    polls: map['collab_polls_enabled'] !== 'false',
    whatsnext: map['collab_whatsnext_enabled'] !== 'false',
  };
}

export function updateCollabFeatures(features: { chat?: boolean; notes?: boolean; polls?: boolean; whatsnext?: boolean }) {
  const mapping: Record<string, string> = { chat: 'collab_chat_enabled', notes: 'collab_notes_enabled', polls: 'collab_polls_enabled', whatsnext: 'collab_whatsnext_enabled' };
  const stmt = db.prepare("INSERT OR REPLACE INTO app_settings (key, value) VALUES (?, ?)");
  for (const [feat, key] of Object.entries(mapping)) {
    if (features[feat] !== undefined) stmt.run(key, features[feat] ? 'true' : 'false');
  }
  return getCollabFeatures();
}

// ── MCP Tokens ─────────────────────────────────────────────────────────────

export function listMcpTokens() {
  return db.prepare(`
    SELECT t.id, t.name, t.token_prefix, t.created_at, t.last_used_at, t.user_id, u.username
    FROM mcp_tokens t
    JOIN users u ON u.id = t.user_id
    ORDER BY t.created_at DESC
  `).all();
}

export function deleteMcpToken(id: string) {
  const token = db.prepare('SELECT id, user_id FROM mcp_tokens WHERE id = ?').get(id) as { id: number; user_id: number } | undefined;
  if (!token) return { error: 'Token not found', status: 404 };
  db.prepare('DELETE FROM mcp_tokens WHERE id = ?').run(id);
  revokeUserSessions(token.user_id);
  return {};
}

// ── OAuth Sessions ─────────────────────────────────────────────────────────

export function listOAuthSessions() {
  const rows = db.prepare(`
    SELECT ot.id, ot.client_id, oc.name AS client_name, ot.user_id, u.username,
           ot.scopes, ot.access_token_expires_at, ot.refresh_token_expires_at, ot.created_at
    FROM oauth_tokens ot
    JOIN oauth_clients oc ON ot.client_id = oc.client_id
    JOIN users u ON u.id = ot.user_id
    WHERE ot.revoked_at IS NULL
      AND ot.refresh_token_expires_at > CURRENT_TIMESTAMP
    ORDER BY ot.created_at DESC
  `).all() as (Record<string, unknown> & { scopes: string })[];
  return rows.map(r => ({ ...r, scopes: JSON.parse(r.scopes) }));
}

export function revokeOAuthSession(id: string) {
  const row = db.prepare('SELECT id, user_id, client_id FROM oauth_tokens WHERE id = ?').get(id) as { id: number; user_id: number; client_id: string } | undefined;
  if (!row) return { error: 'Session not found', status: 404 };
  db.prepare('UPDATE oauth_tokens SET revoked_at = CURRENT_TIMESTAMP WHERE id = ?').run(id);
  revokeUserSessionsForClient(row.user_id, row.client_id);
  return {};
}

// ── PayPal Settings ────────────────────────────────────────────────────────

export function getPaypalSettings() {
  const get = (key: string) => (db.prepare("SELECT value FROM app_settings WHERE key = ?").get(key) as { value: string } | undefined)?.value || '';
  const clientId = get('paypal_client_id') || process.env.PAYPAL_CLIENT_ID || '';
  const secret = decrypt_api_key(get('paypal_secret')) || (process.env.PAYPAL_SECRET ? 'set-via-env' : '');
  const mode = get('paypal_mode') || process.env.PAYPAL_MODE || (process.env.NODE_ENV === 'production' ? 'live' : 'sandbox');
  return {
    clientId,
    secretIsSet: !!secret,
    mode: mode === 'live' ? 'live' : 'sandbox',
  };
}

export function updatePaypalSettings(data: { clientId?: string; secret?: string; mode?: string }): { error?: string; status?: number; success?: boolean } {
  if (data.mode !== undefined && !['sandbox', 'live'].includes(data.mode)) {
    return { error: 'mode must be sandbox or live', status: 400 };
  }
  const set = (key: string, val: string) => db.prepare("INSERT OR REPLACE INTO app_settings (key, value) VALUES (?, ?)").run(key, val || '');
  if (data.clientId !== undefined) set('paypal_client_id', data.clientId);
  if (data.secret !== undefined && data.secret !== '') set('paypal_secret', maybe_encrypt_api_key(data.secret) ?? '');
  if (data.mode !== undefined) set('paypal_mode', data.mode);
  return { success: true };
}

// ── JWT Rotation ───────────────────────────────────────────────────────────

export function rotateJwtSecret(): { error?: string; status?: number } {
  const newSecret = crypto.randomBytes(32).toString('hex');
  const dataDir = path.resolve(__dirname, '../../data');
  const secretFile = path.join(dataDir, '.jwt_secret');
  try {
    if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });
    fs.writeFileSync(secretFile, newSecret, { mode: 0o600 });
  } catch (err: unknown) {
    return { error: 'Failed to persist new JWT secret to disk', status: 500 };
  }
  updateJwtSecret(newSecret);
  return {};
}

import { randomBytes, createHash } from 'crypto';
import { db } from '../db/database';
import { revokeUserSessions } from '../mcp';
import { createEphemeralToken } from './ephemeralTokens';

// ---------------------------------------------------------------------------
// MCP tokens (long-lived bearer credentials)
// ---------------------------------------------------------------------------

export function listMcpTokens(userId: number) {
  return db.prepare(
    'SELECT id, name, token_prefix, created_at, last_used_at FROM mcp_tokens WHERE user_id = ? ORDER BY created_at DESC'
  ).all(userId);
}

export function createMcpToken(userId: number, name?: string): { error?: string; status?: number; token?: Record<string, unknown> } {
  if (!name?.trim()) return { error: 'Token name is required', status: 400 };
  if (name.trim().length > 100) return { error: 'Token name must be 100 characters or less', status: 400 };

  const tokenCount = (db.prepare('SELECT COUNT(*) as count FROM mcp_tokens WHERE user_id = ?').get(userId) as { count: number }).count;
  if (tokenCount >= 10) return { error: 'Maximum of 10 tokens per user reached', status: 400 };

  const rawToken = 'trek_' + randomBytes(24).toString('hex');
  const tokenHash = createHash('sha256').update(rawToken).digest('hex');
  const tokenPrefix = rawToken.slice(0, 13);

  const result = db.prepare(
    'INSERT INTO mcp_tokens (user_id, name, token_hash, token_prefix) VALUES (?, ?, ?, ?)'
  ).run(userId, name.trim(), tokenHash, tokenPrefix);

  const token = db.prepare(
    'SELECT id, name, token_prefix, created_at, last_used_at FROM mcp_tokens WHERE id = ?'
  ).get(result.lastInsertRowid);

  return { token: { ...(token as object), raw_token: rawToken } };
}

export function deleteMcpToken(userId: number, tokenId: string): { error?: string; status?: number; success?: boolean } {
  const token = db.prepare('SELECT id FROM mcp_tokens WHERE id = ? AND user_id = ?').get(tokenId, userId);
  if (!token) return { error: 'Token not found', status: 404 };
  db.prepare('DELETE FROM mcp_tokens WHERE id = ?').run(tokenId);
  revokeUserSessions(userId);
  return { success: true };
}

// ---------------------------------------------------------------------------
// Ephemeral tokens (short-lived purpose-bound credentials)
// ---------------------------------------------------------------------------

export function createWsToken(userId: number): { error?: string; status?: number; token?: string } {
  const token = createEphemeralToken(userId, 'ws');
  if (!token) return { error: 'Service unavailable', status: 503 };
  return { token };
}

export function createResourceToken(userId: number, purpose?: string): { error?: string; status?: number; token?: string } {
  if (purpose !== 'download') {
    return { error: 'Invalid purpose', status: 400 };
  }
  const token = createEphemeralToken(userId, purpose);
  if (!token) return { error: 'Service unavailable', status: 503 };
  return { token };
}

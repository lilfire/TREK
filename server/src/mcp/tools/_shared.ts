import { broadcast } from '../../websocket';
import { db } from '../../db/database';
import { checkPermission } from '../../services/permissions';

export function safeBroadcast(tripId: number, event: string, payload: Record<string, unknown>): void {
  try {
    broadcast(tripId, event, { ...payload, _source: 'mcp' });
  } catch (err) {
    console.error(`[MCP] broadcast failed for ${event}:`, err?.message ?? err);
  }
}

export const MAX_MCP_TRIP_DAYS = 90;

export const TOOL_ANNOTATIONS_READONLY = {
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: false,
} as const;

export const TOOL_ANNOTATIONS_WRITE = {
  readOnlyHint: false,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: false,
} as const;

export const TOOL_ANNOTATIONS_DELETE = {
  readOnlyHint: false,
  destructiveHint: true,
  idempotentHint: true,
  openWorldHint: false,
} as const;

export const TOOL_ANNOTATIONS_NON_IDEMPOTENT = {
  readOnlyHint: false,
  destructiveHint: false,
  idempotentHint: false,
  openWorldHint: false,
} as const;

export function demoDenied() {
  return { content: [{ type: 'text' as const, text: 'Write operations are disabled in demo mode.' }], isError: true };
}

export function noAccess() {
  return { content: [{ type: 'text' as const, text: 'Trip not found or access denied.' }], isError: true };
}

export function noPermission(text = 'No permission for this action.') {
  return { content: [{ type: 'text' as const, text }], isError: true };
}

/**
 * Mirrors the REST `checkPermission(actionKey, role, tripOwnerId, userId, isMember)` gate
 * for an MCP user, resolving role/owner/membership from the database.
 */
export function hasTripPermission(actionKey: string, tripId: number, userId: number): boolean {
  const user = db.prepare('SELECT role FROM users WHERE id = ?').get(userId) as { role: string } | undefined;
  const trip = db.prepare('SELECT user_id FROM trips WHERE id = ?').get(tripId) as { user_id: number } | undefined;
  if (!user || !trip) return false;
  const isMember = trip.user_id !== userId
    && !!db.prepare('SELECT 1 FROM trip_members WHERE trip_id = ? AND user_id = ?').get(tripId, userId);
  return checkPermission(actionKey, user.role, trip.user_id, userId, isMember);
}

export function ok(data: unknown) {
  return { content: [{ type: 'text' as const, text: JSON.stringify(data, null, 2) }] };
}

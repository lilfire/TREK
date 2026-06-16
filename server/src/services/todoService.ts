import { db, canAccessTrip, isOwner } from '../db/database';
import { avatarUrl } from './authService';

export function verifyTripAccess(tripId: string | number, userId: number) {
  return canAccessTrip(tripId, userId);
}

// ── Items ──────────────────────────────────────────────────────────────────

const ITEM_SELECT_WITH_USER = `
  SELECT ti.*,
         u.username AS checked_by_username,
         u.avatar   AS checked_by_avatar
  FROM todo_items ti
  LEFT JOIN users u ON u.id = ti.checked_by_user_id
`;

function decorateItem<T extends { checked_by_avatar?: string | null } | null | undefined>(item: T): T {
  if (!item) return item;
  return { ...item, checked_by_avatar: avatarUrl({ avatar: item.checked_by_avatar ?? null }) } as T;
}

function fetchItemById(id: string | number) {
  const row = db.prepare(`${ITEM_SELECT_WITH_USER} WHERE ti.id = ?`).get(id) as any;
  return decorateItem(row);
}

// Shared member-visibility predicate for todo items. A non-owner trip member
// can see an item when:
//   1. They are its direct `assigned_user_id`, OR
//   2. Its category lists them in `todo_category_assignees`, OR
//   3. A sibling item in the same category is assigned directly to them, OR
//   4. (Fallback) the category has no `tca` rows AND no sibling has an
//      `assigned_user_id` — preserves the pre-LSO-1652 default where every
//      member saw every item, OR
//   5. The item has no category AND no assignee at all.
const TODO_MEMBER_VISIBILITY_SQL = `
  ti.assigned_user_id = ?
  OR (
    ti.category IS NOT NULL AND (
      EXISTS (
        SELECT 1 FROM todo_category_assignees tca
        WHERE tca.trip_id = ti.trip_id
          AND tca.category_name = ti.category
          AND tca.user_id = ?
      )
      OR EXISTS (
        SELECT 1 FROM todo_items sib
        WHERE sib.trip_id = ti.trip_id
          AND sib.category = ti.category
          AND sib.assigned_user_id = ?
      )
    )
  )
  OR (
    ti.category IS NOT NULL
    AND NOT EXISTS (
      SELECT 1 FROM todo_category_assignees tca
      WHERE tca.trip_id = ti.trip_id
        AND tca.category_name = ti.category
    )
    AND NOT EXISTS (
      SELECT 1 FROM todo_items sib
      WHERE sib.trip_id = ti.trip_id
        AND sib.category = ti.category
        AND sib.assigned_user_id IS NOT NULL
    )
  )
  OR (ti.category IS NULL AND ti.assigned_user_id IS NULL)
`;

/**
 * Owner sees all items. Members see items where: the member is directly assigned,
 * OR the item's category is "visible" (member assigned to the category, or member
 * is `assigned_user_id` on any item in that category for this trip), with a
 * backwards-compatible fallback so unassigned categories remain visible to every
 * member.
 */
export function listItems(tripId: string | number, userId: number) {
  if (isOwner(tripId, userId)) {
    const rows = db.prepare(
      `${ITEM_SELECT_WITH_USER} WHERE ti.trip_id = ? ORDER BY ti.sort_order ASC, ti.created_at ASC`
    ).all(tripId) as any[];
    return rows.map(decorateItem);
  }
  const rows = db.prepare(`
    ${ITEM_SELECT_WITH_USER}
    WHERE ti.trip_id = ?
      AND (${TODO_MEMBER_VISIBILITY_SQL})
    ORDER BY ti.sort_order ASC, ti.created_at ASC
  `).all(tripId, userId, userId, userId) as any[];
  return rows.map(decorateItem);
}

/**
 * True iff the (non-owner) member is permitted to mutate this item.
 * Mirrors the visibility rules in `listItems`.
 */
export function canMemberAccessItem(tripId: string | number, itemId: string | number, userId: number): boolean {
  if (isOwner(tripId, userId)) return true;
  const row = db.prepare(`
    SELECT 1 FROM todo_items ti
    WHERE ti.id = ? AND ti.trip_id = ?
      AND (${TODO_MEMBER_VISIBILITY_SQL})
  `).get(itemId, tripId, userId, userId, userId);
  return !!row;
}

export function createItem(tripId: string | number, data: {
  name: string; category?: string; due_date?: string; description?: string; assigned_user_id?: number; priority?: number;
}) {
  const maxOrder = db.prepare('SELECT MAX(sort_order) as max FROM todo_items WHERE trip_id = ?').get(tripId) as { max: number | null };
  const sortOrder = (maxOrder.max !== null ? maxOrder.max : -1) + 1;

  const result = db.prepare(
    'INSERT INTO todo_items (trip_id, name, checked, category, sort_order, due_date, description, assigned_user_id, priority) VALUES (?, ?, 0, ?, ?, ?, ?, ?, ?)'
  ).run(
    tripId, data.name, data.category || null, sortOrder,
    data.due_date || null, data.description || null, data.assigned_user_id || null, data.priority || 0
  );

  return fetchItemById(result.lastInsertRowid as number);
}

export function updateItem(
  tripId: string | number,
  id: string | number,
  data: { name?: string; checked?: number; category?: string; due_date?: string | null; description?: string | null; assigned_user_id?: number | null; priority?: number | null },
  bodyKeys: string[],
  userId?: number
) {
  const item = db.prepare('SELECT * FROM todo_items WHERE id = ? AND trip_id = ?').get(id, tripId);
  if (!item) return null;

  const checkedProvided = data.checked !== undefined;
  const newChecked = data.checked ? 1 : 0;
  const checkedBy = checkedProvided
    ? (newChecked === 1 ? (userId ?? null) : null)
    : null;

  db.prepare(`
    UPDATE todo_items SET
      name = COALESCE(?, name),
      checked = CASE WHEN ? IS NOT NULL THEN ? ELSE checked END,
      checked_by_user_id = CASE WHEN ? THEN ? ELSE checked_by_user_id END,
      category = COALESCE(?, category),
      due_date = CASE WHEN ? THEN ? ELSE due_date END,
      description = CASE WHEN ? THEN ? ELSE description END,
      assigned_user_id = CASE WHEN ? THEN ? ELSE assigned_user_id END,
      priority = CASE WHEN ? THEN ? ELSE priority END
    WHERE id = ?
  `).run(
    data.name || null,
    checkedProvided ? 1 : null,
    newChecked,
    checkedProvided ? 1 : 0,
    checkedBy,
    data.category || null,
    bodyKeys.includes('due_date') ? 1 : 0,
    data.due_date ?? null,
    bodyKeys.includes('description') ? 1 : 0,
    data.description ?? null,
    bodyKeys.includes('assigned_user_id') ? 1 : 0,
    data.assigned_user_id ?? null,
    bodyKeys.includes('priority') ? 1 : 0,
    data.priority ?? 0,
    id
  );

  return fetchItemById(id);
}

export function deleteItem(tripId: string | number, id: string | number) {
  const item = db.prepare('SELECT id FROM todo_items WHERE id = ? AND trip_id = ?').get(id, tripId);
  if (!item) return false;

  db.prepare('DELETE FROM todo_items WHERE id = ?').run(id);
  return true;
}

// ── Category Assignees ─────────────────────────────────────────────────────

export function getCategoryAssignees(tripId: string | number) {
  const rows = db.prepare(`
    SELECT tca.category_name, tca.user_id, u.username, u.avatar
    FROM todo_category_assignees tca
    JOIN users u ON tca.user_id = u.id
    WHERE tca.trip_id = ?
  `).all(tripId);

  const assignees: Record<string, { user_id: number; username: string; avatar: string | null }[]> = {};
  for (const row of rows as any[]) {
    if (!assignees[row.category_name]) assignees[row.category_name] = [];
    assignees[row.category_name].push({ user_id: row.user_id, username: row.username, avatar: row.avatar });
  }

  return assignees;
}

export function updateCategoryAssignees(tripId: string | number, categoryName: string, userIds: number[] | undefined) {
  db.prepare('DELETE FROM todo_category_assignees WHERE trip_id = ? AND category_name = ?').run(tripId, categoryName);

  if (Array.isArray(userIds) && userIds.length > 0) {
    const insert = db.prepare('INSERT OR IGNORE INTO todo_category_assignees (trip_id, category_name, user_id) VALUES (?, ?, ?)');
    for (const uid of userIds) insert.run(tripId, categoryName, uid);
  }

  return db.prepare(`
    SELECT tca.user_id, u.username, u.avatar
    FROM todo_category_assignees tca
    JOIN users u ON tca.user_id = u.id
    WHERE tca.trip_id = ? AND tca.category_name = ?
  `).all(tripId, categoryName);
}

// ── Reorder ────────────────────────────────────────────────────────────────

export function reorderItems(tripId: string | number, orderedIds: number[]) {
  const update = db.prepare('UPDATE todo_items SET sort_order = ? WHERE id = ? AND trip_id = ?');
  const updateMany = db.transaction((ids: number[]) => {
    ids.forEach((id, index) => {
      update.run(index, id, tripId);
    });
  });
  updateMany(orderedIds);
}

import { db, canAccessTrip, isOwner } from '../db/database';
import { avatarUrl } from './authService';

const BAG_COLORS = ['#6366f1', '#ec4899', '#f97316', '#10b981', '#06b6d4', '#8b5cf6', '#ef4444', '#f59e0b'];

export function verifyTripAccess(tripId: string | number, userId: number) {
  return canAccessTrip(tripId, userId);
}

// ── Items ──────────────────────────────────────────────────────────────────

const ITEM_SELECT_WITH_USER = `
  SELECT pi.*,
         u.username AS checked_by_username,
         u.avatar   AS checked_by_avatar
  FROM packing_items pi
  LEFT JOIN users u ON u.id = pi.checked_by_user_id
`;

function decorateItem<T extends { checked_by_avatar?: string | null } | null | undefined>(item: T): T {
  if (!item) return item;
  return { ...item, checked_by_avatar: avatarUrl({ avatar: item.checked_by_avatar ?? null }) } as T;
}

function fetchItemById(id: string | number) {
  const row = db.prepare(`${ITEM_SELECT_WITH_USER} WHERE pi.id = ?`).get(id) as any;
  return decorateItem(row);
}

/**
 * Returns visible packing items for the requesting user.
 * Owner sees all items. Members see items whose category is in
 * `packing_category_assignees` OR whose bag is in `packing_bag_members`.
 */
export function listItems(tripId: string | number, userId: number) {
  const owner = isOwner(tripId, userId);
  if (owner) {
    const rows = db.prepare(
      `${ITEM_SELECT_WITH_USER} WHERE pi.trip_id = ? ORDER BY pi.sort_order ASC, pi.created_at ASC`
    ).all(tripId) as any[];
    return rows.map(decorateItem);
  }
  const rows = db.prepare(`
    ${ITEM_SELECT_WITH_USER}
    WHERE pi.trip_id = ?
      AND (
        EXISTS (
          SELECT 1 FROM packing_category_assignees pca
          WHERE pca.trip_id = pi.trip_id
            AND pca.category_name = pi.category
            AND pca.user_id = ?
        )
        OR (
          pi.bag_id IS NOT NULL AND EXISTS (
            SELECT 1 FROM packing_bag_members pbm
            WHERE pbm.bag_id = pi.bag_id AND pbm.user_id = ?
          )
        )
      )
    ORDER BY pi.sort_order ASC, pi.created_at ASC
  `).all(tripId, userId, userId) as any[];
  return rows.map(decorateItem);
}

/**
 * True iff the (non-owner) member is permitted to mutate this item.
 * Mirrors the visibility rules in `listItems` so a member can only modify
 * items they can see. Returns true for the owner.
 */
export function canMemberAccessItem(tripId: string | number, itemId: string | number, userId: number): boolean {
  if (isOwner(tripId, userId)) return true;
  const row = db.prepare(`
    SELECT 1 FROM packing_items pi
    WHERE pi.id = ? AND pi.trip_id = ?
      AND (
        EXISTS (
          SELECT 1 FROM packing_category_assignees pca
          WHERE pca.trip_id = pi.trip_id
            AND pca.category_name = pi.category
            AND pca.user_id = ?
        )
        OR (
          pi.bag_id IS NOT NULL AND EXISTS (
            SELECT 1 FROM packing_bag_members pbm
            WHERE pbm.bag_id = pi.bag_id AND pbm.user_id = ?
          )
        )
      )
  `).get(itemId, tripId, userId, userId);
  return !!row;
}

export function createItem(tripId: string | number, data: { name: string; category?: string; checked?: boolean; quantity?: number }, userId?: number) {
  const maxOrder = db.prepare('SELECT MAX(sort_order) as max FROM packing_items WHERE trip_id = ?').get(tripId) as { max: number | null };
  const sortOrder = (maxOrder.max !== null ? maxOrder.max : -1) + 1;
  const qty = Math.max(1, Math.min(999, Number(data.quantity) || 1));
  const checkedByUserId = data.checked && userId ? userId : null;

  const result = db.prepare(
    'INSERT INTO packing_items (trip_id, name, checked, category, sort_order, quantity, checked_by_user_id) VALUES (?, ?, ?, ?, ?, ?, ?)'
  ).run(tripId, data.name, data.checked ? 1 : 0, data.category || 'Allgemein', sortOrder, qty, checkedByUserId);

  return fetchItemById(result.lastInsertRowid as number);
}

export function updateItem(
  tripId: string | number,
  id: string | number,
  data: { name?: string; checked?: number; category?: string; weight_grams?: number | null; bag_id?: number | null; quantity?: number },
  bodyKeys: string[],
  userId?: number
) {
  const item = db.prepare('SELECT * FROM packing_items WHERE id = ? AND trip_id = ?').get(id, tripId);
  if (!item) return null;

  const checkedProvided = data.checked !== undefined;
  const newChecked = data.checked ? 1 : 0;
  // Set attribution only when checked toggles to 1 (and userId known); clear on uncheck.
  const checkedBy = checkedProvided
    ? (newChecked === 1 ? (userId ?? null) : null)
    : null;

  db.prepare(`
    UPDATE packing_items SET
      name = COALESCE(?, name),
      checked = CASE WHEN ? IS NOT NULL THEN ? ELSE checked END,
      checked_by_user_id = CASE WHEN ? THEN ? ELSE checked_by_user_id END,
      category = COALESCE(?, category),
      weight_grams = CASE WHEN ? THEN ? ELSE weight_grams END,
      bag_id = CASE WHEN ? THEN ? ELSE bag_id END,
      quantity = CASE WHEN ? THEN ? ELSE quantity END
    WHERE id = ?
  `).run(
    data.name || null,
    checkedProvided ? 1 : null,
    newChecked,
    checkedProvided ? 1 : 0,
    checkedBy,
    data.category || null,
    bodyKeys.includes('weight_grams') ? 1 : 0,
    data.weight_grams ?? null,
    bodyKeys.includes('bag_id') ? 1 : 0,
    data.bag_id ?? null,
    bodyKeys.includes('quantity') ? 1 : 0,
    data.quantity ? Math.max(1, Math.min(999, Number(data.quantity))) : 1,
    id
  );

  return fetchItemById(id);
}

export function deleteItem(tripId: string | number, id: string | number) {
  const item = db.prepare('SELECT id FROM packing_items WHERE id = ? AND trip_id = ?').get(id, tripId);
  if (!item) return false;

  db.prepare('DELETE FROM packing_items WHERE id = ?').run(id);
  return true;
}

// ── Bulk Import ────────────────────────────────────────────────────────────

interface ImportItem {
  name?: string;
  checked?: boolean;
  category?: string;
  weight_grams?: string | number;
  bag?: string;
}

export function bulkImport(tripId: string | number, items: ImportItem[]) {
  const maxOrder = db.prepare('SELECT MAX(sort_order) as max FROM packing_items WHERE trip_id = ?').get(tripId) as { max: number | null };
  let sortOrder = (maxOrder.max !== null ? maxOrder.max : -1) + 1;

  const stmt = db.prepare('INSERT INTO packing_items (trip_id, name, checked, category, weight_grams, bag_id, sort_order) VALUES (?, ?, ?, ?, ?, ?, ?)');
  const created: any[] = [];

  const insertAll = db.transaction(() => {
    for (const item of items) {
      if (!item.name?.trim()) continue;
      const checked = item.checked ? 1 : 0;
      const weight = item.weight_grams ? parseInt(String(item.weight_grams)) || null : null;

      // Resolve bag by name if provided
      let bagId = null;
      if (item.bag?.trim()) {
        const bagName = item.bag.trim();
        const existing = db.prepare('SELECT id FROM packing_bags WHERE trip_id = ? AND name = ?').get(tripId, bagName) as { id: number } | undefined;
        if (existing) {
          bagId = existing.id;
        } else {
          const bagCount = (db.prepare('SELECT COUNT(*) as c FROM packing_bags WHERE trip_id = ?').get(tripId) as { c: number }).c;
          const newBag = db.prepare('INSERT INTO packing_bags (trip_id, name, color) VALUES (?, ?, ?)').run(tripId, bagName, BAG_COLORS[bagCount % BAG_COLORS.length]);
          bagId = newBag.lastInsertRowid;
        }
      }

      const result = stmt.run(tripId, item.name.trim(), checked, item.category?.trim() || 'Other', weight, bagId, sortOrder++);
      created.push(fetchItemById(result.lastInsertRowid as number));
    }
  });

  insertAll();
  return created;
}

// ── Bags ───────────────────────────────────────────────────────────────────

export function listBags(tripId: string | number) {
  const bags = db.prepare('SELECT * FROM packing_bags WHERE trip_id = ? ORDER BY sort_order, id').all(tripId) as any[];
  const members = db.prepare(`
    SELECT bm.bag_id, bm.user_id, u.username, u.avatar
    FROM packing_bag_members bm
    JOIN users u ON bm.user_id = u.id
    JOIN packing_bags b ON bm.bag_id = b.id
    WHERE b.trip_id = ?
  `).all(tripId) as { bag_id: number; user_id: number; username: string; avatar: string | null }[];
  const membersByBag = new Map<number, typeof members>();
  for (const m of members) {
    if (!membersByBag.has(m.bag_id)) membersByBag.set(m.bag_id, []);
    membersByBag.get(m.bag_id)!.push(m);
  }
  return bags.map(b => ({
    ...b,
    members: (membersByBag.get(b.id) || []).map(m => ({ ...m, avatar: avatarUrl(m) })),
  }));
}

export function setBagMembers(tripId: string | number, bagId: string | number, userIds: number[]) {
  const bag = db.prepare('SELECT * FROM packing_bags WHERE id = ? AND trip_id = ?').get(bagId, tripId);
  if (!bag) return null;
  db.prepare('DELETE FROM packing_bag_members WHERE bag_id = ?').run(bagId);
  const ins = db.prepare('INSERT OR IGNORE INTO packing_bag_members (bag_id, user_id) VALUES (?, ?)');
  for (const uid of userIds) ins.run(bagId, uid);
  const rows = db.prepare(`
    SELECT bm.user_id, u.username, u.avatar
    FROM packing_bag_members bm JOIN users u ON bm.user_id = u.id
    WHERE bm.bag_id = ?
  `).all(bagId) as { user_id: number; username: string; avatar: string | null }[];
  return rows.map(m => ({ ...m, avatar: avatarUrl(m) }));
}

export function createBag(tripId: string | number, data: { name: string; color?: string }) {
  const maxOrder = db.prepare('SELECT MAX(sort_order) as max FROM packing_bags WHERE trip_id = ?').get(tripId) as { max: number | null };
  const result = db.prepare('INSERT INTO packing_bags (trip_id, name, color, sort_order) VALUES (?, ?, ?, ?)').run(
    tripId, data.name.trim(), data.color || '#6366f1', (maxOrder.max ?? -1) + 1
  );
  return db.prepare('SELECT * FROM packing_bags WHERE id = ?').get(result.lastInsertRowid);
}

export function updateBag(
  tripId: string | number,
  bagId: string | number,
  data: { name?: string; color?: string; weight_limit_grams?: number | null; user_id?: number | null },
  bodyKeys?: string[]
) {
  const bag = db.prepare('SELECT * FROM packing_bags WHERE id = ? AND trip_id = ?').get(bagId, tripId);
  if (!bag) return null;

  db.prepare(`UPDATE packing_bags SET
    name = COALESCE(?, name),
    color = COALESCE(?, color),
    weight_limit_grams = ?,
    user_id = CASE WHEN ? THEN ? ELSE user_id END
    WHERE id = ?`).run(
    data.name?.trim() || null,
    data.color || null,
    data.weight_limit_grams ?? (bag as any).weight_limit_grams ?? null,
    bodyKeys?.includes('user_id') ? 1 : 0,
    data.user_id ?? null,
    bagId
  );
  return db.prepare('SELECT b.*, u.username as assigned_username FROM packing_bags b LEFT JOIN users u ON b.user_id = u.id WHERE b.id = ?').get(bagId);
}

export function deleteBag(tripId: string | number, bagId: string | number) {
  const bag = db.prepare('SELECT * FROM packing_bags WHERE id = ? AND trip_id = ?').get(bagId, tripId);
  if (!bag) return false;

  db.prepare('DELETE FROM packing_bags WHERE id = ?').run(bagId);
  return true;
}

// ── Apply Template ─────────────────────────────────────────────────────────

export function applyTemplate(tripId: string | number, templateId: string | number) {
  const templateItems = db.prepare(`
    SELECT ti.name, tc.name as category
    FROM packing_template_items ti
    JOIN packing_template_categories tc ON ti.category_id = tc.id
    WHERE tc.template_id = ?
    ORDER BY tc.sort_order, ti.sort_order
  `).all(templateId) as { name: string; category: string }[];

  if (templateItems.length === 0) return null;

  const maxOrder = db.prepare('SELECT MAX(sort_order) as max FROM packing_items WHERE trip_id = ?').get(tripId) as { max: number | null };
  let sortOrder = (maxOrder.max !== null ? maxOrder.max : -1) + 1;

  const insert = db.prepare('INSERT INTO packing_items (trip_id, name, checked, category, sort_order) VALUES (?, ?, 0, ?, ?)');
  const added: any[] = [];
  for (const ti of templateItems) {
    const result = insert.run(tripId, ti.name, ti.category, sortOrder++);
    added.push(fetchItemById(result.lastInsertRowid as number));
  }

  return added;
}

// ── Save as Template ──────────────────────────────────────────────────────

export function saveAsTemplate(tripId: string | number, userId: number, templateName: string) {
  const items = db.prepare(
    'SELECT name, category FROM packing_items WHERE trip_id = ? ORDER BY sort_order ASC'
  ).all(tripId) as { name: string; category: string }[];

  if (items.length === 0) return null;

  const result = db.prepare('INSERT INTO packing_templates (name, created_by) VALUES (?, ?)').run(templateName, userId);
  const templateId = result.lastInsertRowid;

  const categories = [...new Set(items.map(i => i.category || 'Other'))];
  const catIdMap = new Map<string, number | bigint>();

  for (let i = 0; i < categories.length; i++) {
    const catResult = db.prepare('INSERT INTO packing_template_categories (template_id, name, sort_order) VALUES (?, ?, ?)').run(templateId, categories[i], i);
    catIdMap.set(categories[i], catResult.lastInsertRowid);
  }

  const itemsByCategory = new Map<string, number>();
  for (const item of items) {
    const catId = catIdMap.get(item.category || 'Other')!;
    const order = itemsByCategory.get(item.category || 'Other') || 0;
    db.prepare('INSERT INTO packing_template_items (category_id, name, sort_order) VALUES (?, ?, ?)').run(catId, item.name, order);
    itemsByCategory.set(item.category || 'Other', order + 1);
  }

  return { id: Number(templateId), name: templateName, categoryCount: categories.length, itemCount: items.length };
}

// ── Category Assignees ─────────────────────────────────────────────────────

export function getCategoryAssignees(tripId: string | number) {
  const rows = db.prepare(`
    SELECT pca.category_name, pca.user_id, u.username, u.avatar
    FROM packing_category_assignees pca
    JOIN users u ON pca.user_id = u.id
    WHERE pca.trip_id = ?
  `).all(tripId);

  // Group by category
  const assignees: Record<string, { user_id: number; username: string; avatar: string | null }[]> = {};
  for (const row of rows as any[]) {
    if (!assignees[row.category_name]) assignees[row.category_name] = [];
    assignees[row.category_name].push({ user_id: row.user_id, username: row.username, avatar: avatarUrl(row) });
  }

  return assignees;
}

export function updateCategoryAssignees(tripId: string | number, categoryName: string, userIds: number[] | undefined) {
  db.prepare('DELETE FROM packing_category_assignees WHERE trip_id = ? AND category_name = ?').run(tripId, categoryName);

  if (Array.isArray(userIds) && userIds.length > 0) {
    const insert = db.prepare('INSERT OR IGNORE INTO packing_category_assignees (trip_id, category_name, user_id) VALUES (?, ?, ?)');
    for (const uid of userIds) insert.run(tripId, categoryName, uid);
  }

  const updated = db.prepare(`
    SELECT pca.user_id, u.username, u.avatar
    FROM packing_category_assignees pca
    JOIN users u ON pca.user_id = u.id
    WHERE pca.trip_id = ? AND pca.category_name = ?
  `).all(tripId, categoryName) as { user_id: number; username: string; avatar: string | null }[];
  return updated.map(m => ({ ...m, avatar: avatarUrl(m) }));
}

// ── Reorder ────────────────────────────────────────────────────────────────

export function reorderItems(tripId: string | number, orderedIds: number[]) {
  const update = db.prepare('UPDATE packing_items SET sort_order = ? WHERE id = ? AND trip_id = ?');
  const updateMany = db.transaction((ids: number[]) => {
    ids.forEach((id, index) => {
      update.run(index, id, tripId);
    });
  });
  updateMany(orderedIds);
}

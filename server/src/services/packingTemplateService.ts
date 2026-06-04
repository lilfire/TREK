import { db } from '../db/database';

// ── Packing Templates ──────────────────────────────────────────────────────

export function listPackingTemplates() {
  return db.prepare(`
    SELECT pt.*, u.username as created_by_name,
      (SELECT COUNT(*) FROM packing_template_items ti JOIN packing_template_categories tc ON ti.category_id = tc.id WHERE tc.template_id = pt.id) as item_count,
      (SELECT COUNT(*) FROM packing_template_categories WHERE template_id = pt.id) as category_count
    FROM packing_templates pt
    JOIN users u ON pt.created_by = u.id
    ORDER BY pt.created_at DESC
  `).all();
}

export function getPackingTemplate(id: string) {
  const template = db.prepare('SELECT * FROM packing_templates WHERE id = ?').get(id);
  if (!template) return { error: 'Template not found', status: 404 };
  const categories = db.prepare('SELECT * FROM packing_template_categories WHERE template_id = ? ORDER BY sort_order, id').all(id) as any[];
  const items = db.prepare(`
    SELECT ti.* FROM packing_template_items ti
    JOIN packing_template_categories tc ON ti.category_id = tc.id
    WHERE tc.template_id = ? ORDER BY ti.sort_order, ti.id
  `).all(id);
  return { template, categories, items };
}

export function createPackingTemplate(name: string, createdBy: number) {
  if (!name?.trim()) return { error: 'Name is required', status: 400 };
  const result = db.prepare('INSERT INTO packing_templates (name, created_by) VALUES (?, ?)').run(name.trim(), createdBy);
  const template = db.prepare('SELECT * FROM packing_templates WHERE id = ?').get(result.lastInsertRowid);
  return { template };
}

export function updatePackingTemplate(id: string, data: { name?: string }) {
  const template = db.prepare('SELECT * FROM packing_templates WHERE id = ?').get(id);
  if (!template) return { error: 'Template not found', status: 404 };
  if (data.name?.trim()) db.prepare('UPDATE packing_templates SET name = ? WHERE id = ?').run(data.name.trim(), id);
  return { template: db.prepare('SELECT * FROM packing_templates WHERE id = ?').get(id) };
}

export function deletePackingTemplate(id: string) {
  const template = db.prepare('SELECT * FROM packing_templates WHERE id = ?').get(id) as { name?: string } | undefined;
  if (!template) return { error: 'Template not found', status: 404 };
  db.prepare('DELETE FROM packing_templates WHERE id = ?').run(id);
  return { name: template.name };
}

// Template categories

export function createTemplateCategory(templateId: string, name: string) {
  if (!name?.trim()) return { error: 'Category name is required', status: 400 };
  const template = db.prepare('SELECT * FROM packing_templates WHERE id = ?').get(templateId);
  if (!template) return { error: 'Template not found', status: 404 };
  const maxOrder = db.prepare('SELECT MAX(sort_order) as max FROM packing_template_categories WHERE template_id = ?').get(templateId) as { max: number | null };
  const result = db.prepare('INSERT INTO packing_template_categories (template_id, name, sort_order) VALUES (?, ?, ?)').run(templateId, name.trim(), (maxOrder.max ?? -1) + 1);
  return { category: db.prepare('SELECT * FROM packing_template_categories WHERE id = ?').get(result.lastInsertRowid) };
}

export function updateTemplateCategory(templateId: string, catId: string, data: { name?: string }) {
  const cat = db.prepare('SELECT * FROM packing_template_categories WHERE id = ? AND template_id = ?').get(catId, templateId);
  if (!cat) return { error: 'Category not found', status: 404 };
  if (data.name?.trim()) db.prepare('UPDATE packing_template_categories SET name = ? WHERE id = ?').run(data.name.trim(), catId);
  return { category: db.prepare('SELECT * FROM packing_template_categories WHERE id = ?').get(catId) };
}

export function deleteTemplateCategory(templateId: string, catId: string) {
  const cat = db.prepare('SELECT * FROM packing_template_categories WHERE id = ? AND template_id = ?').get(catId, templateId);
  if (!cat) return { error: 'Category not found', status: 404 };
  db.prepare('DELETE FROM packing_template_categories WHERE id = ?').run(catId);
  return {};
}

// Template items

export function createTemplateItem(templateId: string, catId: string, name: string) {
  if (!name?.trim()) return { error: 'Item name is required', status: 400 };
  const cat = db.prepare('SELECT * FROM packing_template_categories WHERE id = ? AND template_id = ?').get(catId, templateId);
  if (!cat) return { error: 'Category not found', status: 404 };
  const maxOrder = db.prepare('SELECT MAX(sort_order) as max FROM packing_template_items WHERE category_id = ?').get(catId) as { max: number | null };
  const result = db.prepare('INSERT INTO packing_template_items (category_id, name, sort_order) VALUES (?, ?, ?)').run(catId, name.trim(), (maxOrder.max ?? -1) + 1);
  return { item: db.prepare('SELECT * FROM packing_template_items WHERE id = ?').get(result.lastInsertRowid) };
}

export function updateTemplateItem(itemId: string, data: { name?: string }) {
  const item = db.prepare('SELECT * FROM packing_template_items WHERE id = ?').get(itemId);
  if (!item) return { error: 'Item not found', status: 404 };
  if (data.name?.trim()) db.prepare('UPDATE packing_template_items SET name = ? WHERE id = ?').run(data.name.trim(), itemId);
  return { item: db.prepare('SELECT * FROM packing_template_items WHERE id = ?').get(itemId) };
}

export function deleteTemplateItem(itemId: string) {
  const item = db.prepare('SELECT * FROM packing_template_items WHERE id = ?').get(itemId);
  if (!item) return { error: 'Item not found', status: 404 };
  db.prepare('DELETE FROM packing_template_items WHERE id = ?').run(itemId);
  return {};
}

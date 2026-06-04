import { db } from '../db/database';
import { Addon } from '../types';
import { getPhotoProviderConfig } from './memories/helpersService';

// ── Addons ─────────────────────────────────────────────────────────────────

export function isAddonEnabled(addonId: string): boolean {
  const addon = db.prepare('SELECT enabled FROM addons WHERE id = ?').get(addonId) as { enabled: number } | undefined;
  return !!addon?.enabled;
}

export function listAddons() {
  const addons = db.prepare('SELECT * FROM addons ORDER BY sort_order, id').all() as Addon[];
  const providers = db.prepare(`
    SELECT id, name, description, icon, enabled, sort_order
    FROM photo_providers
    ORDER BY sort_order, id
  `).all() as Array<{ id: string; name: string; description?: string | null; icon: string; enabled: number; sort_order: number }>;
  const fields = db.prepare(`
    SELECT provider_id, field_key, label, input_type, placeholder, required, secret, settings_key, payload_key, sort_order
    FROM photo_provider_fields
    ORDER BY sort_order, id
  `).all() as Array<{
    provider_id: string;
    field_key: string;
    label: string;
    input_type: string;
    placeholder?: string | null;
    required: number;
    secret: number;
    settings_key?: string | null;
    payload_key?: string | null;
    sort_order: number;
  }>;
  const fieldsByProvider = new Map<string, typeof fields>();
  for (const field of fields) {
    const arr = fieldsByProvider.get(field.provider_id) || [];
    arr.push(field);
    fieldsByProvider.set(field.provider_id, arr);
  }

  return [
    ...addons.map(a => ({ ...a, enabled: !!a.enabled, config: JSON.parse(a.config || '{}') })),
    ...providers.map(p => ({
      id: p.id,
      name: p.name,
      description: p.description,
      type: 'photo_provider',
      icon: p.icon,
      enabled: !!p.enabled,
      config: getPhotoProviderConfig(p.id),
      fields: (fieldsByProvider.get(p.id) || []).map(f => ({
        key: f.field_key,
        label: f.label,
        input_type: f.input_type,
        placeholder: f.placeholder || '',
        required: !!f.required,
        secret: !!f.secret,
        settings_key: f.settings_key || null,
        payload_key: f.payload_key || null,
        sort_order: f.sort_order,
      })),
      sort_order: p.sort_order,
    })),
  ];
}

export function updateAddon(id: string, data: { enabled?: boolean; config?: Record<string, unknown> }) {
  const addon = db.prepare('SELECT * FROM addons WHERE id = ?').get(id) as Addon | undefined;
  const provider = db.prepare('SELECT * FROM photo_providers WHERE id = ?').get(id) as { id: string; name: string; description?: string | null; icon: string; enabled: number; sort_order: number } | undefined;
  if (!addon && !provider) return { error: 'Addon not found', status: 404 };

  if (addon) {
    if (data.enabled !== undefined) db.prepare('UPDATE addons SET enabled = ? WHERE id = ?').run(data.enabled ? 1 : 0, id);
    if (data.config !== undefined) db.prepare('UPDATE addons SET config = ? WHERE id = ?').run(JSON.stringify(data.config), id);
  } else {
    if (data.enabled !== undefined) db.prepare('UPDATE photo_providers SET enabled = ? WHERE id = ?').run(data.enabled ? 1 : 0, id);
  }

  const updatedAddon = db.prepare('SELECT * FROM addons WHERE id = ?').get(id) as Addon | undefined;
  const updatedProvider = db.prepare('SELECT * FROM photo_providers WHERE id = ?').get(id) as { id: string; name: string; description?: string | null; icon: string; enabled: number; sort_order: number } | undefined;
  const updated = updatedAddon
    ? { ...updatedAddon, enabled: !!updatedAddon.enabled, config: JSON.parse(updatedAddon.config || '{}') }
    : updatedProvider
      ? {
        id: updatedProvider.id,
        name: updatedProvider.name,
        description: updatedProvider.description,
        type: 'photo_provider',
        icon: updatedProvider.icon,
        enabled: !!updatedProvider.enabled,
        config: getPhotoProviderConfig(updatedProvider.id),
        sort_order: updatedProvider.sort_order,
      }
      : null;

  return {
    addon: updated,
    auditDetails: { enabled: data.enabled !== undefined ? !!data.enabled : undefined, config_changed: data.config !== undefined },
  };
}

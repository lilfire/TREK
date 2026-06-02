import { db } from '../db/database';
import { decrypt_api_key } from './apiKeyCrypto';
import { logInfo, logDebug, logError } from './auditLog';
import { checkSsrf, createPinnedDispatcher } from '../utils/ssrfGuard';
import type { NotifEventType } from './notificationPreferencesService';

// ── Types ──────────────────────────────────────────────────────────────────

export interface NtfyConfig {
  server: string | null;
  topic: string | null;
  token: string | null;
}

// ── Helpers ────────────────────────────────────────────────────────────────

function getAppSetting(key: string): string | null {
  return (db.prepare('SELECT value FROM app_settings WHERE key = ?').get(key) as { value: string } | undefined)?.value || null;
}

function encodeHeaderValue(value: string): string {
  for (let i = 0; i < value.length; i++) {
    if (value.charCodeAt(i) > 0xFF) {
      return `=?UTF-8?B?${Buffer.from(value, 'utf8').toString('base64')}?=`;
    }
  }
  return value;
}

// ── Ntfy event metadata ────────────────────────────────────────────────────

const NTFY_EVENT_META: Partial<Record<NotifEventType, { priority: 1 | 2 | 3 | 4 | 5; tags: string[] }>> = {
  trip_invite:              { priority: 4, tags: ['loudspeaker'] },
  booking_change:           { priority: 3, tags: ['calendar'] },
  trip_reminder:            { priority: 4, tags: ['bell', 'alarm_clock'] },
  vacay_invite:             { priority: 4, tags: ['palm_tree'] },
  photos_shared:            { priority: 3, tags: ['camera'] },
  collab_message:           { priority: 3, tags: ['speech_balloon'] },
  packing_tagged:           { priority: 3, tags: ['luggage'] },
  version_available:        { priority: 4, tags: ['package'] },
  synology_session_cleared: { priority: 3, tags: ['warning'] },
};
const NTFY_DEFAULT_META = { priority: 3 as const, tags: [] as string[] };

// ── Ntfy config helpers ────────────────────────────────────────────────────

export function getUserNtfyConfig(userId: number): NtfyConfig | null {
  const rows = db.prepare(
    "SELECT key, value FROM settings WHERE user_id = ? AND key IN ('ntfy_topic', 'ntfy_server', 'ntfy_token')"
  ).all(userId) as { key: string; value: string }[];
  if (rows.length === 0) return null;
  const map: Record<string, string> = {};
  for (const r of rows) map[r.key] = r.value;
  return {
    topic: map['ntfy_topic'] || null,
    server: map['ntfy_server'] || null,
    token: map['ntfy_token'] ? decrypt_api_key(map['ntfy_token']) : null,
  };
}

export function getAdminNtfyConfig(): NtfyConfig {
  const topic = getAppSetting('admin_ntfy_topic') || null;
  const server = getAppSetting('admin_ntfy_server') || null;
  const rawToken = getAppSetting('admin_ntfy_token') || null;
  return {
    topic,
    server,
    token: rawToken ? decrypt_api_key(rawToken) : null,
  };
}

export function resolveNtfyUrl(adminCfg: NtfyConfig, userCfg: NtfyConfig | null): string | null {
  const topic = userCfg?.topic || adminCfg.topic;
  if (!topic) return null;
  const base = (userCfg?.server || adminCfg.server || 'https://ntfy.sh').replace(/\/+$/, '');
  return `${base}/${encodeURIComponent(topic)}`;
}

export function isNtfyConfiguredForUser(userId: number): boolean {
  const cfg = getUserNtfyConfig(userId);
  return !!(cfg?.topic);
}

export function isNtfyConfiguredAdmin(): boolean {
  return !!(getAppSetting('admin_ntfy_topic'));
}

// ── sendNtfy ──────────────────────────────────────────────────────────────

export async function sendNtfy(
  url: string,
  token: string | null,
  payload: { event: string; title: string; body: string; link?: string },
): Promise<boolean> {
  if (!url) return false;

  const ssrf = await checkSsrf(url);
  if (!ssrf.allowed) {
    logError(`Ntfy blocked by SSRF guard event=${payload.event} url=${url} reason=${ssrf.error}`);
    return false;
  }

  const meta = NTFY_EVENT_META[payload.event as NotifEventType] ?? NTFY_DEFAULT_META;

  const headers: Record<string, string> = {
    'Title': encodeHeaderValue(payload.title),
    'Priority': String(meta.priority),
  };
  if (meta.tags.length > 0) headers['Tags'] = meta.tags.join(',');
  if (payload.link) headers['Click'] = encodeHeaderValue(payload.link);
  if (token) headers['Authorization'] = `Bearer ${token}`;

  try {
    const res = await fetch(url, {
      method: 'POST',
      headers,
      body: payload.body,
      signal: AbortSignal.timeout(10000),
      dispatcher: createPinnedDispatcher(ssrf.resolvedIp!),
    } as any);

    if (!res.ok) {
      const errBody = await res.text().catch(() => '');
      logError(`Ntfy HTTP ${res.status}: ${errBody}`);
      return false;
    }

    logInfo(`Ntfy sent event=${payload.event}`);
    logDebug(`Ntfy url=${url} priority=${meta.priority} tags=${meta.tags.join(',')}`);
    return true;
  } catch (err) {
    logError(`Ntfy failed event=${payload.event}: ${err instanceof Error ? err.message : err}`);
    return false;
  }
}

export async function testNtfy(cfg: { topic: string; server?: string | null; token?: string | null }): Promise<{ success: boolean; error?: string }> {
  const adminCfg = getAdminNtfyConfig();
  const url = resolveNtfyUrl(adminCfg, { topic: cfg.topic, server: cfg.server ?? null, token: cfg.token ?? null });
  if (!url) return { success: false, error: 'Could not resolve ntfy URL — missing topic' };
  try {
    const sent = await sendNtfy(url, cfg.token ?? null, {
      event: 'test',
      title: 'Test Notification',
      body: 'This is a test notification from TREK. If you received this, your ntfy configuration is working correctly.',
    });
    return sent ? { success: true } : { success: false, error: 'Failed to send ntfy notification' };
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : 'Unknown error' };
  }
}

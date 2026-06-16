import { db } from '../db/database';
import { decrypt_api_key, maybe_encrypt_api_key, encrypt_api_key } from './apiKeyCrypto';
import { startTripReminders } from '../scheduler';
import { resolveAuthToggles } from './authShared';
import { User } from '../types';

const ADMIN_SETTINGS_KEYS = [
  'allow_registration', 'allowed_file_types', 'require_mfa',
  'smtp_host', 'smtp_port', 'smtp_user', 'smtp_pass', 'smtp_from', 'smtp_skip_tls_verify',
  'brevo_api_key', 'brevo_from', 'brevo_from_name',
  'notification_channels', 'admin_webhook_url', 'admin_ntfy_server', 'admin_ntfy_topic', 'admin_ntfy_token',
  'notify_trip_reminder',
  'password_login', 'password_registration', 'oidc_login', 'oidc_registration',
];

export function getAppSettings(userId: number): { error?: string; status?: number; data?: Record<string, string> } {
  const user = db.prepare('SELECT role FROM users WHERE id = ?').get(userId) as { role: string } | undefined;
  if (user?.role !== 'admin') return { error: 'Admin access required', status: 403 };

  const result: Record<string, string> = {};
  for (const key of ADMIN_SETTINGS_KEYS) {
    const row = db.prepare("SELECT value FROM app_settings WHERE key = ?").get(key) as { value: string } | undefined;
    if (row) result[key] = (key === 'smtp_pass' || key === 'admin_webhook_url' || key === 'admin_ntfy_token' || key === 'brevo_api_key') ? '••••••••' : row.value;
  }
  return { data: result };
}

export function updateAppSettings(
  userId: number,
  body: Record<string, unknown>
): {
  error?: string;
  status?: number;
  success?: boolean;
  auditSummary?: Record<string, unknown>;
  auditDebugDetails?: Record<string, unknown>;
  shouldRestartScheduler?: boolean;
} {
  const user = db.prepare('SELECT role FROM users WHERE id = ?').get(userId) as { role: string } | undefined;
  if (user?.role !== 'admin') return { error: 'Admin access required', status: 403 };

  const { require_mfa } = body;
  if (require_mfa === true || require_mfa === 'true') {
    const adminMfa = db.prepare('SELECT mfa_enabled FROM users WHERE id = ?').get(userId) as { mfa_enabled: number } | undefined;
    if (!(adminMfa?.mfa_enabled === 1)) {
      return {
        error: 'Enable two-factor authentication on your own account before requiring it for all users.',
        status: 400,
      };
    }
  }

  // Lockout prevention: can't disable all login methods
  if (body.password_login !== undefined || body.oidc_login !== undefined) {
    const current = resolveAuthToggles();
    const oidcConfigured = !!(
      (process.env.OIDC_ISSUER || (db.prepare("SELECT value FROM app_settings WHERE key = 'oidc_issuer'").get() as { value: string } | undefined)?.value) &&
      (process.env.OIDC_CLIENT_ID || (db.prepare("SELECT value FROM app_settings WHERE key = 'oidc_client_id'").get() as { value: string } | undefined)?.value)
    );
    const nextPasswordLogin = body.password_login !== undefined ? (String(body.password_login) === 'true') : current.password_login;
    const nextOidcLogin = body.oidc_login !== undefined ? (String(body.oidc_login) === 'true') : current.oidc_login;
    if (!nextPasswordLogin && (!nextOidcLogin || !oidcConfigured)) {
      return { error: 'Cannot disable all login methods. At least one must remain enabled.', status: 400 };
    }
  }

  for (const key of ADMIN_SETTINGS_KEYS) {
    if (body[key] !== undefined) {
      let val = String(body[key]);
      if (key === 'require_mfa') {
        val = body[key] === true || val === 'true' ? 'true' : 'false';
      }
      if (key === 'smtp_pass' && val === '••••••••') continue;
      if (key === 'smtp_pass') val = encrypt_api_key(val);
      if (key === 'brevo_api_key' && val === '••••••••') continue;
      if (key === 'brevo_api_key') val = encrypt_api_key(val);
      if (key === 'admin_webhook_url' && val === '••••••••') continue;
      if (key === 'admin_webhook_url' && val) val = maybe_encrypt_api_key(val) ?? val;
      if (key === 'admin_ntfy_token' && val === '••••••••') continue;
      if (key === 'admin_ntfy_token' && val) val = maybe_encrypt_api_key(val) ?? val;
      db.prepare("INSERT OR REPLACE INTO app_settings (key, value) VALUES (?, ?)").run(key, val);
    }
  }

  const changedKeys = ADMIN_SETTINGS_KEYS.filter(k => body[k] !== undefined && !((k === 'smtp_pass' || k === 'brevo_api_key') && String(body[k]) === '••••••••'));

  const summary: Record<string, unknown> = {};
  const smtpChanged = changedKeys.some(k => k.startsWith('smtp_'));
  if (changedKeys.includes('notification_channels')) summary.notification_channels = body.notification_channels;
  if (changedKeys.includes('admin_webhook_url')) summary.admin_webhook_url_updated = true;
  if (changedKeys.some(k => k.startsWith('admin_ntfy_'))) summary.admin_ntfy_updated = true;
  if (smtpChanged) summary.smtp_settings_updated = true;
  if (changedKeys.some(k => k.startsWith('brevo_'))) summary.brevo_settings_updated = true;
  if (changedKeys.includes('allow_registration')) summary.allow_registration = body.allow_registration;
  if (changedKeys.includes('allowed_file_types')) summary.allowed_file_types_updated = true;
  if (changedKeys.includes('require_mfa')) summary.require_mfa = body.require_mfa;

  const debugDetails: Record<string, unknown> = {};
  for (const k of changedKeys) {
    debugDetails[k] = (k === 'smtp_pass' || k === 'brevo_api_key') ? '***' : body[k];
  }

  const notifRelated = ['notification_channels', 'smtp_host'];
  const shouldRestartScheduler = changedKeys.some(k => notifRelated.includes(k));
  if (shouldRestartScheduler) {
    startTripReminders();
  }

  return { success: true, auditSummary: summary, auditDebugDetails: debugDetails, shouldRestartScheduler };
}

export async function validateKeys(userId: number): Promise<{ error?: string; status?: number; maps: boolean; weather: boolean; maps_details: null | { ok: boolean; status: number | null; status_text: string | null; error_message: string | null; error_status: string | null; error_raw: string | null } }> {
  const user = db.prepare('SELECT role, maps_api_key, openweather_api_key FROM users WHERE id = ?').get(userId) as Pick<User, 'role' | 'maps_api_key' | 'openweather_api_key'> | undefined;
  if (user?.role !== 'admin') return { error: 'Admin access required', status: 403, maps: false, weather: false, maps_details: null };

  const result: {
    maps: boolean;
    weather: boolean;
    maps_details: null | {
      ok: boolean;
      status: number | null;
      status_text: string | null;
      error_message: string | null;
      error_status: string | null;
      error_raw: string | null;
    };
  } = { maps: false, weather: false, maps_details: null };

  const maps_api_key = decrypt_api_key(user.maps_api_key);
  if (maps_api_key) {
    try {
      const mapsRes = await fetch(
        `https://places.googleapis.com/v1/places:searchText`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-Goog-Api-Key': maps_api_key,
            'X-Goog-FieldMask': 'places.displayName',
          },
          body: JSON.stringify({ textQuery: 'test' }),
        }
      );
      result.maps = mapsRes.status === 200;
      let error_text: string | null = null;
      let error_json: any = null;
      if (!result.maps) {
        try {
          error_text = await mapsRes.text();
          try { error_json = JSON.parse(error_text); } catch { error_json = null; }
        } catch { error_text = null; error_json = null; }
      }
      result.maps_details = {
        ok: result.maps,
        status: mapsRes.status,
        status_text: mapsRes.statusText || null,
        error_message: error_json?.error?.message || null,
        error_status: error_json?.error?.status || null,
        error_raw: error_text,
      };
    } catch (err: unknown) {
      result.maps = false;
      result.maps_details = {
        ok: false,
        status: null,
        status_text: null,
        error_message: err instanceof Error ? err.message : 'Request failed',
        error_status: 'FETCH_ERROR',
        error_raw: null,
      };
    }
  }

  const openweather_api_key = decrypt_api_key(user.openweather_api_key);
  if (openweather_api_key) {
    try {
      const weatherRes = await fetch(
        `https://api.openweathermap.org/data/2.5/weather?q=London&appid=${openweather_api_key}`
      );
      result.weather = weatherRes.status === 200;
    } catch {
      result.weather = false;
    }
  }

  return result;
}

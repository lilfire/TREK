import { db } from '../db/database';
import { GITHUB_REPO } from '../config';
import { getAllPermissions } from './permissions';
import { DEMO_EMAIL_PRIMARY } from './demo';
import { isEmailDeliveryAvailable } from './notificationPreferencesService';
import { resolveAuthToggles } from './authShared';

export function getAppConfig(authenticatedUser: { id: number } | null) {
  const userCount = (db.prepare('SELECT COUNT(*) as count FROM users').get() as { count: number }).count;
  const isDemo = process.env.DEMO_MODE?.toLowerCase() === 'true';
  const toggles = resolveAuthToggles();
  const version: string = process.env.APP_VERSION ?? require('../../package.json').version;
  const hasGoogleKey = !!db.prepare("SELECT maps_api_key FROM users WHERE role = 'admin' AND maps_api_key IS NOT NULL AND maps_api_key != '' LIMIT 1").get();
  const oidcDisplayName = process.env.OIDC_DISPLAY_NAME ||
    (db.prepare("SELECT value FROM app_settings WHERE key = 'oidc_display_name'").get() as { value: string } | undefined)?.value || null;
  const oidcConfigured = !!(
    (process.env.OIDC_ISSUER || (db.prepare("SELECT value FROM app_settings WHERE key = 'oidc_issuer'").get() as { value: string } | undefined)?.value) &&
    (process.env.OIDC_CLIENT_ID || (db.prepare("SELECT value FROM app_settings WHERE key = 'oidc_client_id'").get() as { value: string } | undefined)?.value)
  );
  const requireMfaRow = db.prepare("SELECT value FROM app_settings WHERE key = 'require_mfa'").get() as { value: string } | undefined;
  const notifChannel = (db.prepare("SELECT value FROM app_settings WHERE key = 'notification_channel'").get() as { value: string } | undefined)?.value || 'none';
  const tripReminderSetting = (db.prepare("SELECT value FROM app_settings WHERE key = 'notify_trip_reminder'").get() as { value: string } | undefined)?.value;
  const hasSmtpHost = isEmailDeliveryAvailable();
  const notifChannelsRaw = (db.prepare("SELECT value FROM app_settings WHERE key = 'notification_channels'").get() as { value: string } | undefined)?.value || notifChannel;
  const activeChannels = notifChannelsRaw === 'none' ? [] : notifChannelsRaw.split(',').map((c: string) => c.trim()).filter(Boolean);
  const hasWebhookEnabled = activeChannels.includes('webhook');
  const tripRemindersEnabled = tripReminderSetting !== 'false';
  const placesPhotosSetting = (db.prepare("SELECT value FROM app_settings WHERE key = 'places_photos_enabled'").get() as { value: string } | undefined)?.value;
  const placesPhotosEnabled = placesPhotosSetting !== 'false';
  const placesAutocompleteSetting = (db.prepare("SELECT value FROM app_settings WHERE key = 'places_autocomplete_enabled'").get() as { value: string } | undefined)?.value;
  const placesAutocompleteEnabled = placesAutocompleteSetting !== 'false';
  const placesDetailsSetting = (db.prepare("SELECT value FROM app_settings WHERE key = 'places_details_enabled'").get() as { value: string } | undefined)?.value;
  const placesDetailsEnabled = placesDetailsSetting !== 'false';
  const setupComplete = userCount > 0 && !(db.prepare("SELECT id FROM users WHERE role = 'admin' AND must_change_password = 1 LIMIT 1").get());

  return {
    // Legacy fields (backward compat)
    allow_registration: isDemo ? false : (toggles.password_registration || toggles.oidc_registration),
    oidc_only_mode: !toggles.password_login && !toggles.password_registration,
    // Granular toggles
    password_login: toggles.password_login,
    password_registration: isDemo ? false : toggles.password_registration,
    oidc_login: toggles.oidc_login,
    oidc_registration: isDemo ? false : toggles.oidc_registration,
    env_override_oidc_only: process.env.OIDC_ONLY === 'true',
    has_users: userCount > 0,
    setup_complete: setupComplete,
    version,
    is_prerelease: version.includes('-pre.'),
    github_repo: GITHUB_REPO,
    // Read straight from process.env (same evaluation as config.ts) so the
    // ~50 existing `vi.mock('../config')` test fixtures that pre-date this
    // export don't have to add GITHUB_VERSION_SOURCE just to keep passing.
    github_version_source: (process.env.GITHUB_VERSION_SOURCE === 'packages' ? 'packages' : 'releases') as 'releases' | 'packages',
    has_maps_key: hasGoogleKey,
    oidc_configured: oidcConfigured,
    oidc_display_name: oidcConfigured ? (oidcDisplayName || 'SSO') : undefined,
    require_mfa: requireMfaRow?.value === 'true',
    allowed_file_types: (db.prepare("SELECT value FROM app_settings WHERE key = 'allowed_file_types'").get() as { value: string } | undefined)?.value || 'jpg,jpeg,png,gif,webp,heic,pdf,doc,docx,xls,xlsx,txt,csv',
    demo_mode: isDemo,
    demo_email: isDemo ? DEMO_EMAIL_PRIMARY : undefined,
    demo_password: isDemo ? 'demo12345' : undefined,
    timezone: process.env.TZ || Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC',
    notification_channel: notifChannel,
    notification_channels: activeChannels,
    available_channels: { email: hasSmtpHost, webhook: hasWebhookEnabled, inapp: true },
    trip_reminders_enabled: tripRemindersEnabled,
    places_photos_enabled: placesPhotosEnabled,
    places_autocomplete_enabled: placesAutocompleteEnabled,
    places_details_enabled: placesDetailsEnabled,
    permissions: authenticatedUser ? getAllPermissions() : undefined,
    dev_mode: process.env.NODE_ENV === 'development',
  };
}

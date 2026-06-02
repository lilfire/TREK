import { logInfo, logDebug, logError } from './auditLog';
import { checkSsrf, createPinnedDispatcher } from '../utils/ssrfGuard';

// ── buildWebhookBody ───────────────────────────────────────────────────────

export function buildWebhookBody(url: string, payload: { event: string; title: string; body: string; tripName?: string; link?: string }): string {
  const isDiscord = /discord(?:app)?\.com\/api\/webhooks\//.test(url);
  const isSlack = /hooks\.slack\.com\//.test(url);

  if (isDiscord) {
    return JSON.stringify({
      embeds: [{
        title: `📍 ${payload.title}`,
        description: payload.body,
        url: payload.link,
        color: 0x3b82f6,
        footer: { text: payload.tripName ? `Trip: ${payload.tripName}` : 'TREK' },
        timestamp: new Date().toISOString(),
      }],
    });
  }

  if (isSlack) {
    const trip = payload.tripName ? `  •  _${payload.tripName}_` : '';
    const link = payload.link ? `\n<${payload.link}|Open in TREK>` : '';
    return JSON.stringify({
      text: `*${payload.title}*\n${payload.body}${trip}${link}`,
    });
  }

  return JSON.stringify({ ...payload, timestamp: new Date().toISOString(), source: 'TREK' });
}

// ── sendWebhook ────────────────────────────────────────────────────────────

export async function sendWebhook(url: string, payload: { event: string; title: string; body: string; tripName?: string; link?: string }): Promise<boolean> {
  if (!url) return false;

  const ssrf = await checkSsrf(url);
  if (!ssrf.allowed) {
    logError(`Webhook blocked by SSRF guard event=${payload.event} url=${url} reason=${ssrf.error}`);
    return false;
  }

  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: buildWebhookBody(url, payload),
      signal: AbortSignal.timeout(10000),
      dispatcher: createPinnedDispatcher(ssrf.resolvedIp!),
    } as any);

    if (!res.ok) {
      const errBody = await res.text().catch(() => '');
      logError(`Webhook HTTP ${res.status}: ${errBody}`);
      return false;
    }

    logInfo(`Webhook sent event=${payload.event} trip=${payload.tripName || '-'}`);
    logDebug(`Webhook url=${url} payload=${buildWebhookBody(url, payload).substring(0, 500)}`);
    return true;
  } catch (err) {
    logError(`Webhook failed event=${payload.event}: ${err instanceof Error ? err.message : err}`);
    return false;
  }
}

export async function testWebhook(url: string): Promise<{ success: boolean; error?: string }> {
  try {
    const sent = await sendWebhook(url, { event: 'test', title: 'Test Notification', body: 'This is a test webhook from TREK. If you received this, your webhook configuration is working correctly.' });
    return sent ? { success: true } : { success: false, error: 'Failed to send webhook' };
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : 'Unknown error' };
  }
}

import { db } from '../db/database';
import { decrypt_api_key } from './apiKeyCrypto';

const PAYPAL_SANDBOX_BASE = 'https://api-m.sandbox.paypal.com';
const PAYPAL_LIVE_BASE = 'https://api-m.paypal.com';

function getStoredSetting(key: string): string {
  return (db.prepare("SELECT value FROM app_settings WHERE key = ?").get(key) as { value: string } | undefined)?.value || '';
}

function getPaypalBase(): string {
  const mode = getStoredSetting('paypal_mode') || process.env.PAYPAL_MODE;
  if (mode === 'live') return PAYPAL_LIVE_BASE;
  if (mode === 'sandbox') return PAYPAL_SANDBOX_BASE;
  return process.env.NODE_ENV === 'production' ? PAYPAL_LIVE_BASE : PAYPAL_SANDBOX_BASE;
}

export function getPaypalClientId(): string | null {
  return getStoredSetting('paypal_client_id') || process.env.PAYPAL_CLIENT_ID || null;
}

function getPaypalSecret(): string | null {
  const stored = decrypt_api_key(getStoredSetting('paypal_secret'));
  return stored || process.env.PAYPAL_SECRET || null;
}

async function getAccessToken(): Promise<string> {
  const clientId = getPaypalClientId();
  const secret = getPaypalSecret();
  if (!clientId || !secret) throw new Error('PayPal credentials not configured');

  const credentials = Buffer.from(`${clientId}:${secret}`).toString('base64');
  const res = await fetch(`${getPaypalBase()}/v1/oauth2/token`, {
    method: 'POST',
    headers: {
      'Authorization': `Basic ${credentials}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: 'grant_type=client_credentials',
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`PayPal auth failed: ${res.status} ${text}`);
  }

  const data = await res.json() as { access_token: string };
  return data.access_token;
}

export async function createPaypalOrder(amount: number, currency: string): Promise<string> {
  const token = await getAccessToken();

  const res = await fetch(`${getPaypalBase()}/v2/checkout/orders`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      intent: 'CAPTURE',
      purchase_units: [{
        amount: {
          currency_code: currency.toUpperCase(),
          value: amount.toFixed(2),
        },
      }],
    }),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`PayPal create order failed: ${res.status} ${text}`);
  }

  const data = await res.json() as { id: string };
  return data.id;
}

export async function capturePaypalOrder(orderId: string): Promise<string> {
  const token = await getAccessToken();

  const res = await fetch(`${getPaypalBase()}/v2/checkout/orders/${orderId}/capture`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`PayPal capture failed: ${res.status} ${text}`);
  }

  const data = await res.json() as { purchase_units?: Array<{ payments?: { captures?: Array<{ id: string }> } }> };
  const captureId = data.purchase_units?.[0]?.payments?.captures?.[0]?.id;
  if (!captureId) throw new Error('PayPal capture response missing capture ID');
  return captureId;
}

export function recordPayment(params: {
  rsvpId: number;
  amount: number;
  currency: string;
  status: 'pending' | 'completed' | 'failed';
  providerOrderId?: string | null;
  providerCaptureId?: string | null;
}): number {
  const { rsvpId, amount, currency, status, providerOrderId = null, providerCaptureId = null } = params;
  const result = db.prepare(`
    INSERT INTO trip_rsvp_payments (rsvp_id, amount, currency, status, provider_order_id, provider_capture_id)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(rsvpId, amount, currency, status, providerOrderId, providerCaptureId);
  return Number(result.lastInsertRowid);
}

export function updatePaymentStatus(paymentId: number, status: 'completed' | 'failed', captureId?: string): void {
  db.prepare(`
    UPDATE trip_rsvp_payments SET status = ?, provider_capture_id = ?, updated_at = datetime('now') WHERE id = ?
  `).run(status, captureId ?? null, paymentId);
}

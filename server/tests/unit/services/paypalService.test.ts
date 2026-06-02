/**
 * Unit tests for paypalService — PAYPAL-SVC-001 through PAYPAL-SVC-010.
 * Mocks fetch to avoid real PayPal API calls.
 */
import { describe, it, expect, vi, beforeAll, beforeEach, afterAll, afterEach } from 'vitest';

// ── DB setup ──────────────────────────────────────────────────────────────────

const { testDb, dbMock } = vi.hoisted(() => {
  const Database = require('better-sqlite3');
  const db = new Database(':memory:');
  db.exec('PRAGMA journal_mode = WAL');
  db.exec('PRAGMA foreign_keys = ON');
  db.exec('PRAGMA busy_timeout = 5000');
  const mock = {
    db,
    closeDb: () => {},
    reinitialize: () => {},
    getPlaceWithTags: () => null,
    canAccessTrip: () => null,
    isOwner: () => false,
  };
  return { testDb: db, dbMock: mock };
});

vi.mock('../../../src/db/database', () => dbMock);
vi.mock('../../../src/config', () => ({
  JWT_SECRET: 'test-secret',
  ENCRYPTION_KEY: 'a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6a7b8c9d0e1f2a3b4c5d6a7b8c9d0e1f2',
  updateJwtSecret: () => {},
}));

import { createTables } from '../../../src/db/schema';
import { runMigrations } from '../../../src/db/migrations';
import { resetTestDb } from '../../helpers/test-db';
import { createUser, createTrip } from '../../helpers/factories';
import {
  getPaypalClientId,
  createPaypalOrder,
  capturePaypalOrder,
  recordPayment,
  updatePaymentStatus,
} from '../../../src/services/paypalService';

const originalFetch = global.fetch;
const originalEnv = { ...process.env };

beforeAll(() => {
  createTables(testDb);
  runMigrations(testDb);
});

beforeEach(() => {
  resetTestDb(testDb);
  process.env = { ...originalEnv };
});

afterEach(() => {
  global.fetch = originalFetch;
  process.env = { ...originalEnv };
});

afterAll(() => {
  testDb.close();
});

// ── Helper: seed an RSVP row ─────────────────────────────────────────────────

function seedRsvp(tripId: number, userId: number): number {
  const result = testDb.prepare(
    'INSERT INTO trip_rsvps (trip_id, user_id, name, email) VALUES (?, ?, ?, ?)'
  ).run(tripId, userId, 'Test User', 'test@example.com');
  return Number(result.lastInsertRowid);
}

// ── getPaypalClientId ─────────────────────────────────────────────────────────

describe('getPaypalClientId', () => {
  it('PAYPAL-SVC-001: returns null when PAYPAL_CLIENT_ID not set', () => {
    delete process.env.PAYPAL_CLIENT_ID;
    expect(getPaypalClientId()).toBeNull();
  });

  it('PAYPAL-SVC-002: returns the client ID when set', () => {
    process.env.PAYPAL_CLIENT_ID = 'test-client-id';
    expect(getPaypalClientId()).toBe('test-client-id');
  });
});

// ── createPaypalOrder ─────────────────────────────────────────────────────────

describe('createPaypalOrder', () => {
  it('PAYPAL-SVC-003: throws when credentials are not configured', async () => {
    delete process.env.PAYPAL_CLIENT_ID;
    delete process.env.PAYPAL_SECRET;
    await expect(createPaypalOrder(50, 'EUR')).rejects.toThrow('PayPal credentials not configured');
  });

  it('PAYPAL-SVC-004: returns orderId on success', async () => {
    process.env.PAYPAL_CLIENT_ID = 'client-id';
    process.env.PAYPAL_SECRET = 'secret';

    const mockFetch = vi.fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ access_token: 'tok123' }),
      } as Response)
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ id: 'ORDER-ABC-123' }),
      } as Response);

    global.fetch = mockFetch;

    const orderId = await createPaypalOrder(99.99, 'USD');
    expect(orderId).toBe('ORDER-ABC-123');
    expect(mockFetch).toHaveBeenCalledTimes(2);
  });

  it('PAYPAL-SVC-005: creates order with correct payload shape', async () => {
    process.env.PAYPAL_CLIENT_ID = 'client-id';
    process.env.PAYPAL_SECRET = 'secret';

    const capturedBodies: unknown[] = [];
    const mockFetch = vi.fn()
      .mockResolvedValueOnce({ ok: true, json: async () => ({ access_token: 'tok' }) } as Response)
      .mockImplementationOnce(async (_url: string, init: RequestInit) => {
        capturedBodies.push(JSON.parse(init.body as string));
        return { ok: true, json: async () => ({ id: 'ORDER-999' }) } as Response;
      });

    global.fetch = mockFetch;

    await createPaypalOrder(25.5, 'EUR');

    expect(capturedBodies[0]).toMatchObject({
      intent: 'CAPTURE',
      purchase_units: [{ amount: { currency_code: 'EUR', value: '25.50' } }],
    });
  });

  it('PAYPAL-SVC-006: throws on PayPal API error response', async () => {
    process.env.PAYPAL_CLIENT_ID = 'client-id';
    process.env.PAYPAL_SECRET = 'secret';

    const mockFetch = vi.fn()
      .mockResolvedValueOnce({ ok: true, json: async () => ({ access_token: 'tok' }) } as Response)
      .mockResolvedValueOnce({ ok: false, status: 422, text: async () => 'Unprocessable' } as Response);

    global.fetch = mockFetch;

    await expect(createPaypalOrder(10, 'EUR')).rejects.toThrow('PayPal create order failed');
  });
});

// ── capturePaypalOrder ────────────────────────────────────────────────────────

describe('capturePaypalOrder', () => {
  it('PAYPAL-SVC-007: returns captureId on success', async () => {
    process.env.PAYPAL_CLIENT_ID = 'client-id';
    process.env.PAYPAL_SECRET = 'secret';

    const mockFetch = vi.fn()
      .mockResolvedValueOnce({ ok: true, json: async () => ({ access_token: 'tok' }) } as Response)
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          purchase_units: [{ payments: { captures: [{ id: 'CAPTURE-XYZ-789' }] } }],
        }),
      } as Response);

    global.fetch = mockFetch;

    const captureId = await capturePaypalOrder('ORDER-ID');
    expect(captureId).toBe('CAPTURE-XYZ-789');
  });

  it('PAYPAL-SVC-008: throws on capture API error', async () => {
    process.env.PAYPAL_CLIENT_ID = 'client-id';
    process.env.PAYPAL_SECRET = 'secret';

    const mockFetch = vi.fn()
      .mockResolvedValueOnce({ ok: true, json: async () => ({ access_token: 'tok' }) } as Response)
      .mockResolvedValueOnce({ ok: false, status: 500, text: async () => 'Server error' } as Response);

    global.fetch = mockFetch;

    await expect(capturePaypalOrder('ORDER-ID')).rejects.toThrow('PayPal capture failed');
  });
});

// ── recordPayment / updatePaymentStatus ───────────────────────────────────────

describe('recordPayment and updatePaymentStatus', () => {
  it('PAYPAL-SVC-009: inserts pending payment row and returns ID', () => {
    const { user } = createUser(testDb);
    const trip = createTrip(testDb, user.id);
    const rsvpId = seedRsvp(trip.id, user.id);

    const paymentId = recordPayment({
      rsvpId,
      amount: 50,
      currency: 'EUR',
      status: 'pending',
      providerOrderId: 'ORDER-123',
    });

    expect(paymentId).toBeGreaterThan(0);

    const row = testDb.prepare('SELECT * FROM trip_rsvp_payments WHERE id = ?').get(paymentId) as any;
    expect(row.rsvp_id).toBe(rsvpId);
    expect(row.amount).toBe(50);
    expect(row.currency).toBe('EUR');
    expect(row.status).toBe('pending');
    expect(row.provider_order_id).toBe('ORDER-123');
    expect(row.provider_capture_id).toBeNull();
  });

  it('PAYPAL-SVC-010: updatePaymentStatus sets completed status with capture ID', () => {
    const { user } = createUser(testDb);
    const trip = createTrip(testDb, user.id);
    const rsvpId = seedRsvp(trip.id, user.id);

    const paymentId = recordPayment({ rsvpId, amount: 25, currency: 'USD', status: 'pending', providerOrderId: 'ORD' });
    updatePaymentStatus(paymentId, 'completed', 'CAPTURE-001');

    const row = testDb.prepare('SELECT * FROM trip_rsvp_payments WHERE id = ?').get(paymentId) as any;
    expect(row.status).toBe('completed');
    expect(row.provider_capture_id).toBe('CAPTURE-001');
  });

  it('PAYPAL-SVC-010b: updatePaymentStatus sets failed status', () => {
    const { user } = createUser(testDb);
    const trip = createTrip(testDb, user.id);
    const rsvpId = seedRsvp(trip.id, user.id);

    const paymentId = recordPayment({ rsvpId, amount: 25, currency: 'USD', status: 'pending' });
    updatePaymentStatus(paymentId, 'failed');

    const row = testDb.prepare('SELECT * FROM trip_rsvp_payments WHERE id = ?').get(paymentId) as any;
    expect(row.status).toBe('failed');
    expect(row.provider_capture_id).toBeNull();
  });
});

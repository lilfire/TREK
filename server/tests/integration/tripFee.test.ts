/**
 * Integration tests for trip registration fee feature.
 * Covers:
 *   - TRIPFEE-001..007: PATCH /api/trips/:id fee fields round-trip
 *   - TRIPFEE-008..009: GET /api/public-trips/:id fee fields + paypalClientId
 *   - TRIPFEE-010..014: POST /api/public/trips/:id/rsvp/payment-order
 *   - TRIPFEE-015..018: POST /api/public/trips/:id/rsvp/payment-capture
 */
import { describe, it, expect, vi, beforeAll, beforeEach, afterAll, afterEach } from 'vitest';
import request from 'supertest';
import type { Application } from 'express';

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
    canAccessTrip: (tripId: any, userId: number) =>
      db.prepare(`SELECT t.id, t.user_id FROM trips t LEFT JOIN trip_members m ON m.trip_id = t.id AND m.user_id = ? WHERE t.id = ? AND (t.user_id = ? OR m.user_id IS NOT NULL)`).get(userId, tripId, userId),
    isOwner: (tripId: any, userId: number) =>
      !!db.prepare('SELECT id FROM trips WHERE id = ? AND user_id = ?').get(tripId, userId),
  };
  return { testDb: db, dbMock: mock };
});

vi.mock('../../src/db/database', () => dbMock);
vi.mock('../../src/config', () => ({
  JWT_SECRET: 'test-jwt-secret-for-trek-testing-only',
  ENCRYPTION_KEY: 'a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6a7b8c9d0e1f2a3b4c5d6a7b8c9d0e1f2',
  updateJwtSecret: () => {},
  GITHUB_REPO: process.env.GITHUB_REPO || 'mauriceboe/TREK',
}));

const { mockSendRsvpEmail } = vi.hoisted(() => ({
  mockSendRsvpEmail: vi.fn().mockResolvedValue(true),
}));
vi.mock('../../src/services/rsvpEmailService', () => ({
  sendRsvpConfirmationEmail: mockSendRsvpEmail,
}));

const originalFetch = global.fetch;
const originalEnv = { ...process.env };

import { createApp } from '../../src/app';
import { createTables } from '../../src/db/schema';
import { runMigrations } from '../../src/db/migrations';
import { resetTestDb } from '../helpers/test-db';
import { createUser, createTrip } from '../helpers/factories';
import { authCookie } from '../helpers/auth';
import { loginAttempts, mfaAttempts } from '../../src/routes/auth';
import { rsvpAttempts } from '../../src/routes/publicTrips';
import { invalidatePermissionsCache } from '../../src/services/permissions';

const app: Application = createApp();

beforeAll(() => {
  createTables(testDb);
  runMigrations(testDb);
});

beforeEach(() => {
  resetTestDb(testDb);
  loginAttempts.clear();
  mfaAttempts.clear();
  rsvpAttempts.clear();
  invalidatePermissionsCache();
  process.env = { ...originalEnv };
  delete process.env.PAYPAL_CLIENT_ID;
  delete process.env.PAYPAL_SECRET;
});

afterEach(() => {
  global.fetch = originalFetch;
  process.env = { ...originalEnv };
});

afterAll(() => {
  testDb.close();
});

// ── Helpers ───────────────────────────────────────────────────────────────────

function makePublic(tripId: number) {
  testDb.prepare('UPDATE trips SET is_public = 1 WHERE id = ?').run(tripId);
}

function setFeeOnTrip(tripId: number, fee: number, mode: string, deadline?: string) {
  testDb.prepare(
    'UPDATE trips SET registration_fee = ?, fee_mode = ?, fee_deadline = ? WHERE id = ?'
  ).run(fee, mode, deadline ?? null, tripId);
}

function seedRsvp(tripId: number, userId: number): number {
  const r = testDb.prepare(
    'INSERT INTO trip_rsvps (trip_id, user_id, name, email) VALUES (?, ?, ?, ?)'
  ).run(tripId, userId, 'Test User', 'test@example.com');
  return Number(r.lastInsertRowid);
}

function mockPaypalSuccess(orderId = 'ORDER-MOCK-001', captureId = 'CAP-MOCK-001') {
  global.fetch = vi.fn()
    .mockResolvedValueOnce({ ok: true, json: async () => ({ access_token: 'mock-token' }) } as Response)
    .mockResolvedValueOnce({ ok: true, json: async () => ({ id: orderId }) } as Response) as any;
}

function mockPaypalCapture(captureId = 'CAP-MOCK-001') {
  global.fetch = vi.fn()
    .mockResolvedValueOnce({ ok: true, json: async () => ({ access_token: 'mock-token' }) } as Response)
    .mockResolvedValueOnce({
      ok: true,
      json: async () => ({ purchase_units: [{ payments: { captures: [{ id: captureId }] } }] }),
    } as Response) as any;
}

// ── PATCH /api/trips/:id — fee fields ─────────────────────────────────────────

describe('PATCH /api/trips/:id — registration fee fields', () => {
  it('TRIPFEE-001: stores registration_fee, fee_mode=deadline, fee_deadline', async () => {
    const { user } = createUser(testDb);
    const trip = createTrip(testDb, user.id);

    const res = await request(app)
      .put(`/api/trips/${trip.id}`)
      .set('Cookie', authCookie(user.id))
      .send({ registration_fee: 50, fee_mode: 'deadline', fee_deadline: '2027-01-15' });

    expect(res.status).toBe(200);
    expect(res.body.trip.registration_fee).toBe(50);
    expect(res.body.trip.fee_mode).toBe('deadline');
    expect(res.body.trip.fee_deadline).toBe('2027-01-15');
  });

  it('TRIPFEE-002: stores registration_fee with fee_mode=rsvp, deadline null', async () => {
    const { user } = createUser(testDb);
    const trip = createTrip(testDb, user.id);

    const res = await request(app)
      .put(`/api/trips/${trip.id}`)
      .set('Cookie', authCookie(user.id))
      .send({ registration_fee: 25.5, fee_mode: 'rsvp' });

    expect(res.status).toBe(200);
    expect(res.body.trip.registration_fee).toBe(25.5);
    expect(res.body.trip.fee_mode).toBe('rsvp');
    expect(res.body.trip.fee_deadline).toBeNull();
  });

  it('TRIPFEE-003: clears fee_mode and fee_deadline when fee set to null', async () => {
    const { user } = createUser(testDb);
    const trip = createTrip(testDb, user.id);
    setFeeOnTrip(trip.id, 50, 'deadline', '2027-01-15');

    const res = await request(app)
      .put(`/api/trips/${trip.id}`)
      .set('Cookie', authCookie(user.id))
      .send({ registration_fee: null });

    expect(res.status).toBe(200);
    expect(res.body.trip.registration_fee).toBeNull();
    expect(res.body.trip.fee_mode).toBeNull();
    expect(res.body.trip.fee_deadline).toBeNull();
  });

  it('TRIPFEE-004: returns 400 for negative registration_fee', async () => {
    const { user } = createUser(testDb);
    const trip = createTrip(testDb, user.id);

    const res = await request(app)
      .put(`/api/trips/${trip.id}`)
      .set('Cookie', authCookie(user.id))
      .send({ registration_fee: -10 });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/non-negative/);
  });

  it('TRIPFEE-005: returns 400 for invalid fee_mode', async () => {
    const { user } = createUser(testDb);
    const trip = createTrip(testDb, user.id);

    const res = await request(app)
      .put(`/api/trips/${trip.id}`)
      .set('Cookie', authCookie(user.id))
      .send({ registration_fee: 30, fee_mode: 'invalid' });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/fee_mode/);
  });

  it('TRIPFEE-006: returns 400 for invalid fee_deadline format', async () => {
    const { user } = createUser(testDb);
    const trip = createTrip(testDb, user.id);

    const res = await request(app)
      .put(`/api/trips/${trip.id}`)
      .set('Cookie', authCookie(user.id))
      .send({ registration_fee: 30, fee_mode: 'deadline', fee_deadline: 'not-a-date' });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/fee_deadline/);
  });

  it('TRIPFEE-007: persists and retrieves fee fields via GET /api/trips/:id', async () => {
    const { user } = createUser(testDb);
    const trip = createTrip(testDb, user.id);

    await request(app)
      .put(`/api/trips/${trip.id}`)
      .set('Cookie', authCookie(user.id))
      .send({ registration_fee: 75, fee_mode: 'rsvp' });

    const get = await request(app)
      .get(`/api/trips/${trip.id}`)
      .set('Cookie', authCookie(user.id));

    expect(get.status).toBe(200);
    expect(get.body.trip.registration_fee).toBe(75);
    expect(get.body.trip.fee_mode).toBe('rsvp');
  });
});

// ── GET /api/public/trips/:id — fee fields ────────────────────────────────────

describe('GET /api/public/trips/:id — fee fields', () => {
  it('TRIPFEE-008: includes registration_fee, fee_mode, fee_deadline in public trip response', async () => {
    const { user } = createUser(testDb);
    const trip = createTrip(testDb, user.id);
    makePublic(trip.id);
    setFeeOnTrip(trip.id, 40, 'deadline', '2027-06-30');

    const res = await request(app).get(`/api/public/trips/${trip.id}`);
    expect(res.status).toBe(200);
    expect(res.body.trip.registration_fee).toBe(40);
    expect(res.body.trip.fee_mode).toBe('deadline');
    expect(res.body.trip.fee_deadline).toBe('2027-06-30');
  });

  it('TRIPFEE-009: includes paypalClientId when PAYPAL_CLIENT_ID is set', async () => {
    process.env.PAYPAL_CLIENT_ID = 'paypal-test-client-123';

    const { user } = createUser(testDb);
    const trip = createTrip(testDb, user.id);
    makePublic(trip.id);

    const res = await request(app).get(`/api/public/trips/${trip.id}`);
    expect(res.status).toBe(200);
    expect(res.body.trip.paypalClientId).toBe('paypal-test-client-123');
  });
});

// ── POST /api/public/trips/:id/rsvp/payment-order ────────────────────────────

describe('POST /api/public/trips/:id/rsvp/payment-order', () => {
  it('TRIPFEE-010: returns 400 when trip has no fee', async () => {
    const { user } = createUser(testDb);
    const trip = createTrip(testDb, user.id);
    makePublic(trip.id);

    const res = await request(app)
      .post(`/api/public/trips/${trip.id}/rsvp/payment-order`)
      .send({ amount: 50, currency: 'EUR' });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/does not require/i);
  });

  it('TRIPFEE-011: returns 503 when PayPal not configured', async () => {
    const { user } = createUser(testDb);
    const trip = createTrip(testDb, user.id);
    makePublic(trip.id);
    setFeeOnTrip(trip.id, 50, 'rsvp');

    const res = await request(app)
      .post(`/api/public/trips/${trip.id}/rsvp/payment-order`)
      .send({ amount: 50, currency: 'EUR' });

    expect(res.status).toBe(503);
    expect(res.body.error).toMatch(/not configured/i);
  });

  it('TRIPFEE-012: returns 400 for missing/invalid amount', async () => {
    process.env.PAYPAL_CLIENT_ID = 'test-client';

    const { user } = createUser(testDb);
    const trip = createTrip(testDb, user.id);
    makePublic(trip.id);
    setFeeOnTrip(trip.id, 50, 'rsvp');

    const res = await request(app)
      .post(`/api/public/trips/${trip.id}/rsvp/payment-order`)
      .send({ currency: 'EUR' });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/amount/i);
  });

  it('TRIPFEE-013: returns orderId on success', async () => {
    process.env.PAYPAL_CLIENT_ID = 'test-client';
    process.env.PAYPAL_SECRET = 'test-secret';

    const { user } = createUser(testDb);
    const trip = createTrip(testDb, user.id);
    makePublic(trip.id);
    setFeeOnTrip(trip.id, 50, 'rsvp');

    global.fetch = vi.fn()
      .mockResolvedValueOnce({ ok: true, json: async () => ({ access_token: 'tok' }) } as Response)
      .mockResolvedValueOnce({ ok: true, json: async () => ({ id: 'ORDER-999' }) } as Response) as any;

    const res = await request(app)
      .post(`/api/public/trips/${trip.id}/rsvp/payment-order`)
      .send({ amount: 50, currency: 'EUR' });

    expect(res.status).toBe(200);
    expect(res.body.orderId).toBe('ORDER-999');
  });

  it('TRIPFEE-014: returns 404 for non-existent or private trip', async () => {
    const res = await request(app)
      .post('/api/public/trips/99999/rsvp/payment-order')
      .send({ amount: 50, currency: 'EUR' });

    expect(res.status).toBe(404);
  });
});

// ── POST /api/public/trips/:id/rsvp/payment-capture ──────────────────────────

describe('POST /api/public/trips/:id/rsvp/payment-capture', () => {
  it('TRIPFEE-015: returns 400 when orderId missing', async () => {
    const { user } = createUser(testDb);
    const trip = createTrip(testDb, user.id);
    makePublic(trip.id);
    const rsvpId = seedRsvp(trip.id, user.id);

    const res = await request(app)
      .post(`/api/public/trips/${trip.id}/rsvp/payment-capture`)
      .send({ rsvpId });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/orderId/i);
  });

  it('TRIPFEE-016: returns 404 when rsvp does not belong to trip', async () => {
    const { user } = createUser(testDb);
    const trip = createTrip(testDb, user.id);
    makePublic(trip.id);

    const res = await request(app)
      .post(`/api/public/trips/${trip.id}/rsvp/payment-capture`)
      .send({ orderId: 'ORD-001', rsvpId: 99999 });

    expect(res.status).toBe(404);
    expect(res.body.error).toMatch(/rsvp/i);
  });

  it('TRIPFEE-017: inserts completed payment row on successful capture', async () => {
    process.env.PAYPAL_CLIENT_ID = 'test-client';
    process.env.PAYPAL_SECRET = 'test-secret';

    const { user } = createUser(testDb);
    const trip = createTrip(testDb, user.id);
    makePublic(trip.id);
    setFeeOnTrip(trip.id, 30, 'rsvp');
    const rsvpId = seedRsvp(trip.id, user.id);

    mockPaypalCapture('CAP-XYZ-777');

    const res = await request(app)
      .post(`/api/public/trips/${trip.id}/rsvp/payment-capture`)
      .send({ orderId: 'ORDER-123', rsvpId });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.captureId).toBe('CAP-XYZ-777');

    const payments = testDb.prepare('SELECT * FROM trip_rsvp_payments WHERE rsvp_id = ?').all(rsvpId) as any[];
    expect(payments).toHaveLength(1);
    expect(payments[0].status).toBe('completed');
    expect(payments[0].provider_capture_id).toBe('CAP-XYZ-777');
  });

  it('TRIPFEE-018: inserts failed payment row when capture fails', async () => {
    process.env.PAYPAL_CLIENT_ID = 'test-client';
    process.env.PAYPAL_SECRET = 'test-secret';

    const { user } = createUser(testDb);
    const trip = createTrip(testDb, user.id);
    makePublic(trip.id);
    setFeeOnTrip(trip.id, 30, 'rsvp');
    const rsvpId = seedRsvp(trip.id, user.id);

    global.fetch = vi.fn()
      .mockResolvedValueOnce({ ok: true, json: async () => ({ access_token: 'tok' }) } as Response)
      .mockResolvedValueOnce({ ok: false, status: 422, text: async () => 'Unprocessable' } as Response) as any;

    const res = await request(app)
      .post(`/api/public/trips/${trip.id}/rsvp/payment-capture`)
      .send({ orderId: 'ORDER-FAIL', rsvpId });

    expect(res.status).toBe(502);
    expect(res.body.error).toMatch(/capture failed/i);

    const payments = testDb.prepare('SELECT * FROM trip_rsvp_payments WHERE rsvp_id = ?').all(rsvpId) as any[];
    expect(payments).toHaveLength(1);
    expect(payments[0].status).toBe('failed');
  });
});

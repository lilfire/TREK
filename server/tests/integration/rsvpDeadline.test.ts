/**
 * Integration tests for RSVP deadline feature (LSO-1443).
 * Covers:
 *   - RSVP-DL-001..003: PATCH /api/trips/:id rsvp_deadline validation
 *   - RSVP-DL-004..005: GET /api/public-trips/:id includes rsvp_deadline
 *   - RSVP-DL-006..009: POST /api/public/trips/:id/rsvp deadline enforcement
 */
import { describe, it, expect, vi, beforeAll, beforeEach, afterAll } from 'vitest';
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
}));

const { mockSendRsvpEmail } = vi.hoisted(() => ({
  mockSendRsvpEmail: vi.fn().mockResolvedValue(true),
}));
vi.mock('../../src/services/rsvpEmailService', () => ({
  sendRsvpConfirmationEmail: mockSendRsvpEmail,
}));

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
});

afterAll(() => {
  testDb.close();
});

// ── Helpers ───────────────────────────────────────────────────────────────────

function makePublic(tripId: number) {
  testDb.prepare('UPDATE trips SET is_public = 1 WHERE id = ?').run(tripId);
}

function setRsvpDeadline(tripId: number, deadline: string | null) {
  testDb.prepare('UPDATE trips SET rsvp_deadline = ? WHERE id = ?').run(deadline, tripId);
}

// ── Trip Service / Validation ─────────────────────────────────────────────────

describe('Trip update — rsvp_deadline field', () => {
  it('RSVP-DL-001: accepts a valid rsvp_deadline value', async () => {
    const { user } = createUser(testDb);
    const trip = createTrip(testDb, user.id);
    const cookie = authCookie(user.id);

    const res = await request(app)
      .put(`/api/trips/${trip.id}`)
      .set('Cookie', cookie)
      .send({ rsvp_deadline: '2027-06-01' });

    expect(res.status).toBe(200);
    const stored = testDb.prepare('SELECT rsvp_deadline FROM trips WHERE id = ?').get(trip.id) as { rsvp_deadline: string | null };
    expect(stored.rsvp_deadline).toBe('2027-06-01');
  });

  it('RSVP-DL-002: accepts rsvp_deadline: null (clears the field)', async () => {
    const { user } = createUser(testDb);
    const trip = createTrip(testDb, user.id);
    setRsvpDeadline(trip.id, '2027-01-01');
    const cookie = authCookie(user.id);

    const res = await request(app)
      .put(`/api/trips/${trip.id}`)
      .set('Cookie', cookie)
      .send({ rsvp_deadline: null });

    expect(res.status).toBe(200);
    const stored = testDb.prepare('SELECT rsvp_deadline FROM trips WHERE id = ?').get(trip.id) as { rsvp_deadline: string | null };
    expect(stored.rsvp_deadline).toBeNull();
  });

  it('RSVP-DL-003: rejects malformed rsvp_deadline with 400', async () => {
    const { user } = createUser(testDb);
    const trip = createTrip(testDb, user.id);
    const cookie = authCookie(user.id);

    const res = await request(app)
      .put(`/api/trips/${trip.id}`)
      .set('Cookie', cookie)
      .send({ rsvp_deadline: 'not-a-date' });

    expect(res.status).toBe(400);
    expect(res.body.error ?? res.body.message ?? '').toMatch(/rsvp_deadline/i);
  });
});

// ── Public Trip API ───────────────────────────────────────────────────────────

describe('GET /api/public-trips/:id — rsvp_deadline in response', () => {
  it('RSVP-DL-004: rsvp_deadline is included when set', async () => {
    const { user } = createUser(testDb);
    const trip = createTrip(testDb, user.id);
    makePublic(trip.id);
    setRsvpDeadline(trip.id, '2030-12-31');

    const res = await request(app).get(`/api/public/trips/${trip.id}`);

    expect(res.status).toBe(200);
    expect(res.body.trip.rsvp_deadline).toBe('2030-12-31');
  });

  it('RSVP-DL-005: rsvp_deadline is null when not set', async () => {
    const { user } = createUser(testDb);
    const trip = createTrip(testDb, user.id);
    makePublic(trip.id);

    const res = await request(app).get(`/api/public/trips/${trip.id}`);

    expect(res.status).toBe(200);
    expect(res.body.trip.rsvp_deadline).toBeNull();
  });
});

// ── POST /api/public/trips/:id/rsvp — deadline enforcement ───────────────────

describe('POST /api/public/trips/:id/rsvp — RSVP deadline enforcement', () => {
  it('RSVP-DL-006: accepts RSVP when rsvp_deadline is null', async () => {
    const { user } = createUser(testDb);
    const trip = createTrip(testDb, user.id);
    makePublic(trip.id);
    // rsvp_deadline is null by default

    const res = await request(app)
      .post(`/api/public/trips/${trip.id}/rsvp`)
      .send({ name: 'Alice', email: 'alice@example.com' });

    expect(res.status).toBe(201);
  });

  it('RSVP-DL-007: accepts RSVP when rsvp_deadline is today', async () => {
    const { user } = createUser(testDb);
    const trip = createTrip(testDb, user.id);
    makePublic(trip.id);
    const today = new Date().toISOString().split('T')[0];
    setRsvpDeadline(trip.id, today);

    const res = await request(app)
      .post(`/api/public/trips/${trip.id}/rsvp`)
      .send({ name: 'Bob', email: 'bob@example.com' });

    expect(res.status).toBe(201);
  });

  it('RSVP-DL-008: accepts RSVP when rsvp_deadline is in the future', async () => {
    const { user } = createUser(testDb);
    const trip = createTrip(testDb, user.id);
    makePublic(trip.id);
    setRsvpDeadline(trip.id, '2099-12-31');

    const res = await request(app)
      .post(`/api/public/trips/${trip.id}/rsvp`)
      .send({ name: 'Carol', email: 'carol@example.com' });

    expect(res.status).toBe(201);
  });

  it('RSVP-DL-009: rejects RSVP with 400 when rsvp_deadline is in the past', async () => {
    const { user } = createUser(testDb);
    const trip = createTrip(testDb, user.id);
    makePublic(trip.id);
    setRsvpDeadline(trip.id, '2000-01-01'); // past date

    const res = await request(app)
      .post(`/api/public/trips/${trip.id}/rsvp`)
      .send({ name: 'Dave', email: 'dave@example.com' });

    expect(res.status).toBe(400);
    expect(res.body.error).toBe('rsvp.error.registrationClosed');
  });
});

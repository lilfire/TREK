/**
 * Trips API integration tests.
 * Covers TRIP-001 through TRIP-022.
 */
import { describe, it, expect, vi, beforeAll, beforeEach, afterAll } from 'vitest';
import request from 'supertest';
import type { Application } from 'express';

// ─────────────────────────────────────────────────────────────────────────────
// Step 1: Bare in-memory DB — schema applied in beforeAll after mocks register
// ─────────────────────────────────────────────────────────────────────────────
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
    getPlaceWithTags: (placeId: number) => {
      const place: any = db.prepare(`
        SELECT p.*, c.name as category_name, c.color as category_color, c.icon as category_icon
        FROM places p LEFT JOIN categories c ON p.category_id = c.id WHERE p.id = ?
      `).get(placeId);
      if (!place) return null;
      const tags = db.prepare(`SELECT t.* FROM tags t JOIN place_tags pt ON t.id = pt.tag_id WHERE pt.place_id = ?`).all(placeId);
      return { ...place, category: place.category_id ? { id: place.category_id, name: place.category_name, color: place.category_color, icon: place.category_icon } : null, tags };
    },
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

import { createApp } from '../../src/app';
import { createTables } from '../../src/db/schema';
import { runMigrations } from '../../src/db/migrations';
import { resetTestDb } from '../helpers/test-db';
import { createUser, createAdmin, createTrip, addTripMember, createPlace, createReservation, createTag, createDayAccommodation, createBudgetItem, createPackingItem, createDayNote, createDayAssignment } from '../helpers/factories';
import { authCookie } from '../helpers/auth';
import { loginAttempts, mfaAttempts } from '../../src/routes/auth';
import { invalidatePermissionsCache } from '../../src/services/permissions';

const app: Application = createApp();

beforeAll(() => { createTables(testDb); runMigrations(testDb); });
beforeEach(() => {
  resetTestDb(testDb);
  loginAttempts.clear();
  mfaAttempts.clear();
  invalidatePermissionsCache();
});
afterAll(() => { testDb.close(); });


// ─────────────────────────────────────────────────────────────────────────────
// Trip public visibility (LSO-1299)
// ─────────────────────────────────────────────────────────────────────────────

describe('Trip public visibility (is_public)', () => {
  it('VIS-001 — owner can set is_public=true → 200 and response reflects new value', async () => {
    const { user } = createUser(testDb);
    const trip = createTrip(testDb, user.id, { title: 'Public Trip' });

    const res = await request(app)
      .put(`/api/trips/${trip.id}`)
      .set('Cookie', authCookie(user.id))
      .send({ is_public: true });

    expect(res.status).toBe(200);
    expect(res.body.trip.is_public).toBe(1);
  });

  it('VIS-002 — owner can set is_public=false → 200 and value is persisted', async () => {
    const { user } = createUser(testDb);
    const trip = createTrip(testDb, user.id, { title: 'Private Trip' });
    // First make it public
    testDb.prepare('UPDATE trips SET is_public = 1 WHERE id = ?').run(trip.id);

    const res = await request(app)
      .put(`/api/trips/${trip.id}`)
      .set('Cookie', authCookie(user.id))
      .send({ is_public: false });

    expect(res.status).toBe(200);
    expect(res.body.trip.is_public).toBe(0);
  });

  it('VIS-003 — trip member (non-owner) cannot change is_public → 403', async () => {
    const { user: owner } = createUser(testDb);
    const { user: member } = createUser(testDb);
    const trip = createTrip(testDb, owner.id, { title: 'Owner Trip' });
    addTripMember(testDb, trip.id, member.id);

    const res = await request(app)
      .put(`/api/trips/${trip.id}`)
      .set('Cookie', authCookie(member.id))
      .send({ is_public: true });

    expect(res.status).toBe(403);
    expect(res.body.error).toMatch(/owner/i);
  });

  it('VIS-004 — is_public defaults to 0 on new trip creation', async () => {
    const { user } = createUser(testDb);

    const res = await request(app)
      .post('/api/trips')
      .set('Cookie', authCookie(user.id))
      .send({ title: 'New Trip' });

    expect(res.status).toBe(201);
    expect(res.body.trip.is_public).toBe(0);
  });

  it('VIS-005 — GET /api/trips/:id returns is_public field', async () => {
    const { user } = createUser(testDb);
    const trip = createTrip(testDb, user.id, { title: 'Visibility Trip' });
    testDb.prepare('UPDATE trips SET is_public = 1 WHERE id = ?').run(trip.id);

    const res = await request(app)
      .get(`/api/trips/${trip.id}`)
      .set('Cookie', authCookie(user.id));

    expect(res.status).toBe(200);
    expect(res.body.trip.is_public).toBe(1);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Migration: is_public column schema (LSO-1291)
// ─────────────────────────────────────────────────────────────────────────────

describe('Migration: is_public column on trips table', () => {
  it('SCHEMA-001 — trips table has is_public column that is NOT NULL with default 0', () => {
    type ColInfo = { cid: number; name: string; type: string; notnull: number; dflt_value: string | null; pk: number };
    const cols = testDb.prepare("PRAGMA table_info('trips')").all() as ColInfo[];
    const col = cols.find(c => c.name === 'is_public');

    expect(col).toBeDefined();
    expect(col!.type.toUpperCase()).toBe('INTEGER');
    expect(col!.notnull).toBe(1);
    expect(col!.dflt_value).toBe('0');
  });

  it('SCHEMA-002 — new trips get is_public = 0 by default when inserted directly', () => {
    const { user } = createUser(testDb);
    const result = testDb.prepare(
      'INSERT INTO trips (user_id, title) VALUES (?, ?)'
    ).run(user.id, 'Direct Insert Trip');

    const row = testDb.prepare('SELECT is_public FROM trips WHERE id = ?').get(result.lastInsertRowid) as { is_public: number };
    expect(row.is_public).toBe(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Country field (LSO-1471)
// ─────────────────────────────────────────────────────────────────────────────

describe('Country field', () => {
  it('TRIP-COUNTRY-001 — POST /api/trips with country round-trips in GET /api/trips/:id', async () => {
    const { user } = createUser(testDb);

    const res = await request(app)
      .post('/api/trips')
      .set('Cookie', authCookie(user.id))
      .send({ title: 'Norway Explorer', country: 'NO' });

    expect(res.status).toBe(201);
    expect(res.body.trip.country).toBe('NO');

    const getRes = await request(app)
      .get(`/api/trips/${res.body.trip.id}`)
      .set('Cookie', authCookie(user.id));

    expect(getRes.status).toBe(200);
    expect(getRes.body.trip.country).toBe('NO');
  });

  it('TRIP-COUNTRY-002 — PUT /api/trips/:id with country updates and returns the value', async () => {
    const { user } = createUser(testDb);
    const trip = createTrip(testDb, user.id, { title: 'My Trip' });

    const res = await request(app)
      .put(`/api/trips/${trip.id}`)
      .set('Cookie', authCookie(user.id))
      .send({ country: 'DE' });

    expect(res.status).toBe(200);
    expect(res.body.trip.country).toBe('DE');

    const getRes = await request(app)
      .get(`/api/trips/${trip.id}`)
      .set('Cookie', authCookie(user.id));

    expect(getRes.status).toBe(200);
    expect(getRes.body.trip.country).toBe('DE');
  });

  it('TRIP-COUNTRY-003 — existing trips have country = null (no backfill)', () => {
    const { user } = createUser(testDb);
    const trip = createTrip(testDb, user.id, { title: 'Old Trip' });

    const row = testDb.prepare('SELECT country FROM trips WHERE id = ?').get(trip.id) as { country: string | null };
    expect(row.country).toBeNull();
  });

  it('TRIP-COUNTRY-004 — PUT /api/trips/:id can clear country by setting it to null', async () => {
    const { user } = createUser(testDb);
    const trip = createTrip(testDb, user.id, { title: 'Spain Trip' });
    testDb.prepare('UPDATE trips SET country = ? WHERE id = ?').run('ES', trip.id);

    const res = await request(app)
      .put(`/api/trips/${trip.id}`)
      .set('Cookie', authCookie(user.id))
      .send({ country: null });

    expect(res.status).toBe(200);
    expect(res.body.trip.country).toBeNull();
  });
});

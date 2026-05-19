/**
 * Integration tests for GET /api/public/trips/:id (LSO-1293).
 * Covers PTRIP-001 to PTRIP-006.
 */
import { describe, it, expect, vi, beforeAll, beforeEach, afterAll } from 'vitest';
import request from 'supertest';
import type { Application } from 'express';

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
      const place: any = db.prepare(`SELECT p.*, c.name as category_name, c.color as category_color, c.icon as category_icon FROM places p LEFT JOIN categories c ON p.category_id = c.id WHERE p.id = ?`).get(placeId);
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
import { createUser, createTrip, createDay, createPlace, createDayAssignment, createDayNote } from '../helpers/factories';
import { loginAttempts, mfaAttempts } from '../../src/routes/auth';

const app: Application = createApp();

beforeAll(() => {
  createTables(testDb);
  runMigrations(testDb);
});

beforeEach(() => {
  resetTestDb(testDb);
  loginAttempts.clear();
  mfaAttempts.clear();
});

afterAll(() => {
  testDb.close();
});

describe('GET /api/public/trips/:id', () => {
  it('PTRIP-001 — returns 404 for non-existent trip', async () => {
    const res = await request(app).get('/api/public/trips/999999');
    expect(res.status).toBe(404);
    expect(res.body.error).toBeDefined();
  });

  it('PTRIP-002 — returns 404 for private trip (is_public = 0)', async () => {
    const { user } = createUser(testDb);
    const trip = createTrip(testDb, user.id, { title: 'Secret Trip' });
    // Trip is private by default (is_public = 0)

    const res = await request(app).get(`/api/public/trips/${trip.id}`);
    expect(res.status).toBe(404);
    expect(res.body.error).toBeDefined();
  });

  it('PTRIP-003 — returns 200 with full trip data for public trip', async () => {
    const { user } = createUser(testDb);
    const trip = createTrip(testDb, user.id, { title: 'My Public Adventure' });
    testDb.prepare('UPDATE trips SET is_public = 1 WHERE id = ?').run(trip.id);

    const res = await request(app).get(`/api/public/trips/${trip.id}`);
    expect(res.status).toBe(200);
    expect(res.body.trip).toBeDefined();
    expect(res.body.trip.title).toBe('My Public Adventure');
    expect(res.body.days).toBeDefined();
    expect(res.body.assignments).toBeDefined();
    expect(res.body.dayNotes).toBeDefined();
    expect(res.body.places).toBeDefined();
    expect(res.body.reservations).toBeDefined();
    expect(Array.isArray(res.body.reservations)).toBe(true);
    expect(Array.isArray(res.body.accommodations)).toBe(true);
    expect(Array.isArray(res.body.categories)).toBe(true);
  });

  it('PTRIP-004 — requires no authentication', async () => {
    const { user } = createUser(testDb);
    const trip = createTrip(testDb, user.id, { title: 'Unauthenticated Access' });
    testDb.prepare('UPDATE trips SET is_public = 1 WHERE id = ?').run(trip.id);

    // No Cookie or Authorization header — should still succeed
    const res = await request(app).get(`/api/public/trips/${trip.id}`);
    expect(res.status).toBe(200);
    expect(res.body.trip.title).toBe('Unauthenticated Access');
  });

  it('PTRIP-005 — includes days and assignments in response', async () => {
    const { user } = createUser(testDb);
    const trip = createTrip(testDb, user.id, { title: 'Trip With Days' });
    testDb.prepare('UPDATE trips SET is_public = 1 WHERE id = ?').run(trip.id);
    const day = createDay(testDb, trip.id, { date: '2025-09-01' });
    const place = createPlace(testDb, trip.id, { name: 'Eiffel Tower', lat: 48.858, lng: 2.294 });
    createDayAssignment(testDb, day.id, place.id, { notes: 'Must see' });

    const res = await request(app).get(`/api/public/trips/${trip.id}`);
    expect(res.status).toBe(200);
    expect(res.body.days).toHaveLength(1);
    const dayAssignments = res.body.assignments[day.id];
    expect(Array.isArray(dayAssignments)).toBe(true);
    expect(dayAssignments).toHaveLength(1);
    expect(dayAssignments[0].place.name).toBe('Eiffel Tower');
    expect(dayAssignments[0].place.lat).toBe(48.858);
    expect(dayAssignments[0].notes).toBe('Must see');
  });

  it('PTRIP-006 — includes day notes in response', async () => {
    const { user } = createUser(testDb);
    const trip = createTrip(testDb, user.id, { title: 'Trip With Notes' });
    testDb.prepare('UPDATE trips SET is_public = 1 WHERE id = ?').run(trip.id);
    const day = createDay(testDb, trip.id, { date: '2025-10-01' });
    createDayNote(testDb, day.id, trip.id, { text: 'Arrive early' });

    const res = await request(app).get(`/api/public/trips/${trip.id}`);
    expect(res.status).toBe(200);
    const dayNotes = res.body.dayNotes[day.id];
    expect(Array.isArray(dayNotes)).toBe(true);
    expect(dayNotes).toHaveLength(1);
    expect(dayNotes[0].text).toBe('Arrive early');
  });
});

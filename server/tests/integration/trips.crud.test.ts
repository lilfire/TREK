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
  GITHUB_REPO: process.env.GITHUB_REPO || 'mauriceboe/TREK',
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
// Create trip (TRIP-001, TRIP-002, TRIP-003)
// ─────────────────────────────────────────────────────────────────────────────

describe('Create trip', () => {
  it('TRIP-001 — POST /api/trips with start_date/end_date returns 201 and auto-generates days', async () => {
    const { user } = createUser(testDb);

    const res = await request(app)
      .post('/api/trips')
      .set('Cookie', authCookie(user.id))
      .send({ title: 'Paris Adventure', start_date: '2026-06-01', end_date: '2026-06-05' });

    expect(res.status).toBe(201);
    expect(res.body.trip).toBeDefined();
    expect(res.body.trip.title).toBe('Paris Adventure');

    // Verify days were generated (5 days: Jun 1–5)
    const days = testDb.prepare('SELECT * FROM days WHERE trip_id = ? ORDER BY date').all(res.body.trip.id) as any[];
    expect(days).toHaveLength(5);
    expect(days[0].date).toBe('2026-06-01');
    expect(days[4].date).toBe('2026-06-05');
  });

  it('TRIP-002 — POST /api/trips without dates returns 201 and creates 7 dateless placeholder days', async () => {
    const { user } = createUser(testDb);

    const res = await request(app)
      .post('/api/trips')
      .set('Cookie', authCookie(user.id))
      .send({ title: 'Open-ended Trip' });

    expect(res.status).toBe(201);
    expect(res.body.trip).toBeDefined();
    expect(res.body.trip.start_date).toBeNull();
    expect(res.body.trip.end_date).toBeNull();

    // Should have 7 dateless placeholder days
    const days = testDb.prepare('SELECT * FROM days WHERE trip_id = ? ORDER BY day_number').all(res.body.trip.id) as any[];
    expect(days).toHaveLength(7);
    expect(days[0].date).toBeNull();
  });

  it('TRIP-002b — POST /api/trips with day_count creates correct number of dateless days', async () => {
    const { user } = createUser(testDb);

    const res = await request(app)
      .post('/api/trips')
      .set('Cookie', authCookie(user.id))
      .send({ title: 'Custom Days Trip', day_count: 20 });

    expect(res.status).toBe(201);
    expect(res.body.trip.start_date).toBeNull();
    expect(res.body.trip.day_count).toBe(20);

    const days = testDb.prepare('SELECT * FROM days WHERE trip_id = ?').all(res.body.trip.id) as any[];
    expect(days).toHaveLength(20);
  });

  it('TRIP-001 — POST /api/trips requires a title, returns 400 without one', async () => {
    const { user } = createUser(testDb);

    const res = await request(app)
      .post('/api/trips')
      .set('Cookie', authCookie(user.id))
      .send({ description: 'No title here' });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/title/i);
  });

  it('TRIP-001 — POST /api/trips rejects end_date before start_date with 400', async () => {
    const { user } = createUser(testDb);

    const res = await request(app)
      .post('/api/trips')
      .set('Cookie', authCookie(user.id))
      .send({ title: 'Bad Dates', start_date: '2026-06-10', end_date: '2026-06-05' });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/end date/i);
  });

  it('TRIP-003 — trip_create permission set to admin blocks regular user with 403', async () => {
    const { user } = createUser(testDb);

    // Restrict trip creation to admins only
    testDb.prepare("INSERT INTO app_settings (key, value) VALUES ('perm_trip_create', 'admin')").run();
    invalidatePermissionsCache();

    const res = await request(app)
      .post('/api/trips')
      .set('Cookie', authCookie(user.id))
      .send({ title: 'Forbidden Trip' });

    expect(res.status).toBe(403);
    expect(res.body.error).toMatch(/permission/i);
  });

  it('TRIP-003 — trip_create permission set to admin allows admin user', async () => {
    const { user: admin } = createAdmin(testDb);

    testDb.prepare("INSERT INTO app_settings (key, value) VALUES ('perm_trip_create', 'admin')").run();
    invalidatePermissionsCache();

    const res = await request(app)
      .post('/api/trips')
      .set('Cookie', authCookie(admin.id))
      .send({ title: 'Admin Trip' });

    expect(res.status).toBe(201);
  });

  it('TRIP-001 — unauthenticated POST /api/trips returns 401', async () => {
    const res = await request(app).post('/api/trips').send({ title: 'No Auth' });
    expect(res.status).toBe(401);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// List trips (TRIP-004, TRIP-005)
// ─────────────────────────────────────────────────────────────────────────────

describe('List trips', () => {
  it('TRIP-004 — GET /api/trips returns own trips and member trips, not other users trips', async () => {
    const { user: owner } = createUser(testDb);
    const { user: member } = createUser(testDb);
    const { user: stranger } = createUser(testDb);

    const ownTrip = createTrip(testDb, owner.id, { title: "Owner's Trip" });
    const memberTrip = createTrip(testDb, stranger.id, { title: "Stranger's Trip (member)" });
    createTrip(testDb, stranger.id, { title: "Stranger's Private Trip" });

    // Add member to one of stranger's trips
    addTripMember(testDb, memberTrip.id, member.id);

    const ownerRes = await request(app)
      .get('/api/trips')
      .set('Cookie', authCookie(owner.id));

    expect(ownerRes.status).toBe(200);
    const ownerTripIds = ownerRes.body.trips.map((t: any) => t.id);
    expect(ownerTripIds).toContain(ownTrip.id);
    expect(ownerTripIds).not.toContain(memberTrip.id);

    const memberRes = await request(app)
      .get('/api/trips')
      .set('Cookie', authCookie(member.id));

    expect(memberRes.status).toBe(200);
    const memberTripIds = memberRes.body.trips.map((t: any) => t.id);
    expect(memberTripIds).toContain(memberTrip.id);
    expect(memberTripIds).not.toContain(ownTrip.id);
  });

  it('TRIP-005 — GET /api/trips excludes archived trips by default', async () => {
    const { user } = createUser(testDb);

    const activeTrip = createTrip(testDb, user.id, { title: 'Active Trip' });
    const archivedTrip = createTrip(testDb, user.id, { title: 'Archived Trip' });

    // Archive the second trip directly in the DB
    testDb.prepare('UPDATE trips SET is_archived = 1 WHERE id = ?').run(archivedTrip.id);

    const res = await request(app)
      .get('/api/trips')
      .set('Cookie', authCookie(user.id));

    expect(res.status).toBe(200);
    const tripIds = res.body.trips.map((t: any) => t.id);
    expect(tripIds).toContain(activeTrip.id);
    expect(tripIds).not.toContain(archivedTrip.id);
  });

  it('TRIP-005 — GET /api/trips?archived=1 returns only archived trips', async () => {
    const { user } = createUser(testDb);

    const activeTrip = createTrip(testDb, user.id, { title: 'Active Trip' });
    const archivedTrip = createTrip(testDb, user.id, { title: 'Archived Trip' });

    testDb.prepare('UPDATE trips SET is_archived = 1 WHERE id = ?').run(archivedTrip.id);

    const res = await request(app)
      .get('/api/trips?archived=1')
      .set('Cookie', authCookie(user.id));

    expect(res.status).toBe(200);
    const tripIds = res.body.trips.map((t: any) => t.id);
    expect(tripIds).toContain(archivedTrip.id);
    expect(tripIds).not.toContain(activeTrip.id);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Get trip (TRIP-006, TRIP-007, TRIP-016, TRIP-017)
// ─────────────────────────────────────────────────────────────────────────────

describe('Get trip', () => {
  it('TRIP-006 — GET /api/trips/:id for own trip returns 200 with full trip object', async () => {
    const { user } = createUser(testDb);
    const trip = createTrip(testDb, user.id, { title: 'My Trip', description: 'A lovely trip' });

    const res = await request(app)
      .get(`/api/trips/${trip.id}`)
      .set('Cookie', authCookie(user.id));

    expect(res.status).toBe(200);
    expect(res.body.trip).toBeDefined();
    expect(res.body.trip.id).toBe(trip.id);
    expect(res.body.trip.title).toBe('My Trip');
    expect(res.body.trip.is_owner).toBe(1);
  });

  it('TRIP-007 — GET /api/trips/:id for another users trip returns 404', async () => {
    const { user: owner } = createUser(testDb);
    const { user: other } = createUser(testDb);
    const trip = createTrip(testDb, owner.id, { title: "Owner's Trip" });

    const res = await request(app)
      .get(`/api/trips/${trip.id}`)
      .set('Cookie', authCookie(other.id));

    expect(res.status).toBe(404);
    expect(res.body.error).toMatch(/not found/i);
  });


  it('TRIP-017 — Member can access trip → 200', async () => {
    const { user: owner } = createUser(testDb);
    const { user: member } = createUser(testDb);
    const trip = createTrip(testDb, owner.id, { title: 'Shared Trip' });
    addTripMember(testDb, trip.id, member.id);

    const res = await request(app)
      .get(`/api/trips/${trip.id}`)
      .set('Cookie', authCookie(member.id));

    expect(res.status).toBe(200);
    expect(res.body.trip.id).toBe(trip.id);
    expect(res.body.trip.is_owner).toBe(0);
  });

  it('TRIP-006 — GET /api/trips/:id for non-existent trip returns 404', async () => {
    const { user } = createUser(testDb);

    const res = await request(app)
      .get('/api/trips/999999')
      .set('Cookie', authCookie(user.id));

    expect(res.status).toBe(404);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Delete trip (TRIP-018, TRIP-019, TRIP-022)
// ─────────────────────────────────────────────────────────────────────────────

describe('Delete trip', () => {
  it('TRIP-018 — DELETE /api/trips/:id by owner returns 200 and trip is no longer accessible', async () => {
    const { user } = createUser(testDb);
    const trip = createTrip(testDb, user.id, { title: 'To Delete' });

    const deleteRes = await request(app)
      .delete(`/api/trips/${trip.id}`)
      .set('Cookie', authCookie(user.id));

    expect(deleteRes.status).toBe(200);
    expect(deleteRes.body.success).toBe(true);

    // Trip should no longer be accessible
    const getRes = await request(app)
      .get(`/api/trips/${trip.id}`)
      .set('Cookie', authCookie(user.id));

    expect(getRes.status).toBe(404);
  });

  it('TRIP-019 — Regular user cannot delete another users trip → 403', async () => {
    const { user: owner } = createUser(testDb);
    const { user: other } = createUser(testDb);
    const trip = createTrip(testDb, owner.id, { title: "Owner's Trip" });

    const res = await request(app)
      .delete(`/api/trips/${trip.id}`)
      .set('Cookie', authCookie(other.id));

    // getTripOwner finds the trip (it exists); checkPermission fails for non-members → 403
    expect(res.status).toBe(403);

    // Trip still exists
    const tripInDb = testDb.prepare('SELECT id FROM trips WHERE id = ?').get(trip.id);
    expect(tripInDb).toBeDefined();
  });

  it('TRIP-019 — Trip member cannot delete trip → 403', async () => {
    const { user: owner } = createUser(testDb);
    const { user: member } = createUser(testDb);
    const trip = createTrip(testDb, owner.id, { title: 'Shared Trip' });
    addTripMember(testDb, trip.id, member.id);

    const res = await request(app)
      .delete(`/api/trips/${trip.id}`)
      .set('Cookie', authCookie(member.id));

    expect(res.status).toBe(403);
    expect(res.body.error).toMatch(/permission/i);
  });

  it('TRIP-022 — Trip with places and reservations can be deleted (cascade)', async () => {
    const { user } = createUser(testDb);
    const trip = createTrip(testDb, user.id, { title: 'Trip With Data' });

    // Add associated data
    createPlace(testDb, trip.id, { name: 'Eiffel Tower' });
    createReservation(testDb, trip.id, { title: 'Hotel Booking', type: 'hotel' });

    const deleteRes = await request(app)
      .delete(`/api/trips/${trip.id}`)
      .set('Cookie', authCookie(user.id));

    expect(deleteRes.status).toBe(200);
    expect(deleteRes.body.success).toBe(true);

    // Verify cascade: places and reservations should be gone
    const places = testDb.prepare('SELECT id FROM places WHERE trip_id = ?').all(trip.id);
    expect(places).toHaveLength(0);

    const reservations = testDb.prepare('SELECT id FROM reservations WHERE trip_id = ?').all(trip.id);
    expect(reservations).toHaveLength(0);
  });

  it('TRIP-018 — Admin can delete another users trip', async () => {
    const { user: admin } = createAdmin(testDb);
    const { user: owner } = createUser(testDb);
    const trip = createTrip(testDb, owner.id, { title: "User's Trip" });

    const res = await request(app)
      .delete(`/api/trips/${trip.id}`)
      .set('Cookie', authCookie(admin.id));

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
  });

  it('TRIP-018 — DELETE /api/trips/:id for non-existent trip returns 404', async () => {
    const { user } = createUser(testDb);

    const res = await request(app)
      .delete('/api/trips/999999')
      .set('Cookie', authCookie(user.id));

    expect(res.status).toBe(404);
  });
});

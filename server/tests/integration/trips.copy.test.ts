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
// Copy trip (TRIP-023, TRIP-024)
// ─────────────────────────────────────────────────────────────────────────────

describe('Copy trip', () => {
  it('TRIP-023 — POST /api/trips/:id/copy creates a duplicate trip with 201', async () => {
    const { user } = createUser(testDb);
    const trip = createTrip(testDb, user.id, { title: 'Original Trip', description: 'Desc' });

    const res = await request(app)
      .post(`/api/trips/${trip.id}/copy`)
      .set('Cookie', authCookie(user.id))
      .send({});

    expect(res.status).toBe(201);
    expect(res.body.trip).toBeDefined();
    expect(res.body.trip.id).not.toBe(trip.id);
    expect(res.body.trip.title).toBe('Original Trip');
  });

  it('TRIP-023 — copy accepts a custom title for the new trip', async () => {
    const { user } = createUser(testDb);
    const trip = createTrip(testDb, user.id, { title: 'Source' });

    const res = await request(app)
      .post(`/api/trips/${trip.id}/copy`)
      .set('Cookie', authCookie(user.id))
      .send({ title: 'Custom Copy' });

    expect(res.status).toBe(201);
    expect(res.body.trip.title).toBe('Custom Copy');
  });

  it('TRIP-023 — copied trip belongs to the requesting user', async () => {
    const { user: owner } = createUser(testDb);
    const { user: member } = createUser(testDb);
    const trip = createTrip(testDb, owner.id, { title: 'Shared Trip' });
    addTripMember(testDb, trip.id, member.id);

    const res = await request(app)
      .post(`/api/trips/${trip.id}/copy`)
      .set('Cookie', authCookie(member.id))
      .send({});

    expect(res.status).toBe(201);
    const newTrip = testDb.prepare('SELECT * FROM trips WHERE id = ?').get(res.body.trip.id) as any;
    expect(newTrip.user_id).toBe(member.id);
  });

  it('TRIP-024 — non-member cannot copy a trip → 404', async () => {
    const { user: owner } = createUser(testDb);
    const { user: stranger } = createUser(testDb);
    const trip = createTrip(testDb, owner.id, { title: 'Private Trip' });

    const res = await request(app)
      .post(`/api/trips/${trip.id}/copy`)
      .set('Cookie', authCookie(stranger.id))
      .send({});

    expect(res.status).toBe(404);
  });

  it('TRIP-024 — copy of non-existent trip returns 404', async () => {
    const { user } = createUser(testDb);

    const res = await request(app)
      .post('/api/trips/999999/copy')
      .set('Cookie', authCookie(user.id))
      .send({});

    expect(res.status).toBe(404);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// ICS export (TRIP-025)
// ─────────────────────────────────────────────────────────────────────────────

describe('ICS export', () => {
  it('TRIP-025 — GET /api/trips/:id/export.ics returns text/calendar content', async () => {
    const { user } = createUser(testDb);
    const trip = createTrip(testDb, user.id, { title: 'Calendar Trip' });

    const res = await request(app)
      .get(`/api/trips/${trip.id}/export.ics`)
      .set('Cookie', authCookie(user.id));

    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/text\/calendar/);
    expect(res.text).toContain('BEGIN:VCALENDAR');
    expect(res.text).toContain('END:VCALENDAR');
  });

  it('TRIP-025 — non-member cannot export ICS → 404', async () => {
    const { user: owner } = createUser(testDb);
    const { user: stranger } = createUser(testDb);
    const trip = createTrip(testDb, owner.id, { title: 'Private Trip' });

    const res = await request(app)
      .get(`/api/trips/${trip.id}/export.ics`)
      .set('Cookie', authCookie(stranger.id));

    expect(res.status).toBe(404);
  });

  it('TRIP-025 — unauthenticated export returns 401', async () => {
    const { user } = createUser(testDb);
    const trip = createTrip(testDb, user.id, { title: 'Trip' });

    const res = await request(app).get(`/api/trips/${trip.id}/export.ics`);
    expect(res.status).toBe(401);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Copy trip with full data (covers loop bodies in the copy transaction)
// ─────────────────────────────────────────────────────────────────────────────

describe('Copy trip with data', () => {
  it('TRIP-026 — copy preserves days, places, tags, assignments, accommodations, reservations, budget, packing, notes', async () => {
    const { user } = createUser(testDb);
    const trip = createTrip(testDb, user.id, {
      title: 'Data-Rich Trip',
      start_date: '2025-09-01',
      end_date: '2025-09-03',
    });

    const days = testDb.prepare('SELECT * FROM days WHERE trip_id = ? ORDER BY day_number').all(trip.id) as any[];
    expect(days.length).toBe(3);

    // Place with a tag
    const place = createPlace(testDb, trip.id, { name: 'Tower Bridge' });
    const tag = createTag(testDb, user.id, { name: 'Landmark' });
    testDb.prepare('INSERT INTO place_tags (place_id, tag_id) VALUES (?, ?)').run(place.id, tag.id);

    // Day assignment
    testDb.prepare(
      'INSERT INTO day_assignments (day_id, place_id, order_index, notes) VALUES (?, ?, 0, ?)'
    ).run(days[0].id, place.id, 'Visit in morning');

    // Accommodation spanning days 0→1
    createDayAccommodation(testDb, trip.id, place.id, days[0].id, days[1].id);

    // Reservation on day 0
    createReservation(testDb, trip.id, { title: 'Flight Out', type: 'flight', day_id: days[0].id });

    // Budget item
    createBudgetItem(testDb, trip.id, { name: 'Flights', total_price: 400 });

    // Packing item
    createPackingItem(testDb, trip.id, { name: 'Toothbrush' });

    // Day note
    createDayNote(testDb, days[0].id, trip.id, { text: 'Pack early!' });

    const res = await request(app)
      .post(`/api/trips/${trip.id}/copy`)
      .set('Cookie', authCookie(user.id))
      .send({ title: 'Data-Rich Trip (Copy)' });

    expect(res.status).toBe(201);
    const newId = res.body.trip.id;
    expect(newId).not.toBe(trip.id);

    // Days copied
    const newDays = testDb.prepare('SELECT * FROM days WHERE trip_id = ? ORDER BY day_number').all(newId) as any[];
    expect(newDays).toHaveLength(3);

    // Place copied
    const newPlaces = testDb.prepare('SELECT * FROM places WHERE trip_id = ?').all(newId) as any[];
    expect(newPlaces).toHaveLength(1);
    expect(newPlaces[0].name).toBe('Tower Bridge');

    // Place tag copied
    const newTags = testDb.prepare(
      'SELECT pt.* FROM place_tags pt JOIN places p ON p.id = pt.place_id WHERE p.trip_id = ?'
    ).all(newId) as any[];
    expect(newTags).toHaveLength(1);

    // Assignment copied
    const newAssignments = testDb.prepare(
      'SELECT da.* FROM day_assignments da JOIN days d ON d.id = da.day_id WHERE d.trip_id = ?'
    ).all(newId) as any[];
    expect(newAssignments).toHaveLength(1);

    // Accommodation copied
    const newAccom = testDb.prepare('SELECT * FROM day_accommodations WHERE trip_id = ?').all(newId) as any[];
    expect(newAccom).toHaveLength(1);

    // Reservation copied
    const newResv = testDb.prepare('SELECT * FROM reservations WHERE trip_id = ?').all(newId) as any[];
    expect(newResv).toHaveLength(1);

    // Budget copied
    const newBudget = testDb.prepare('SELECT * FROM budget_items WHERE trip_id = ?').all(newId) as any[];
    expect(newBudget).toHaveLength(1);

    // Packing copied (checked reset to 0)
    const newPacking = testDb.prepare('SELECT * FROM packing_items WHERE trip_id = ?').all(newId) as any[];
    expect(newPacking).toHaveLength(1);
    expect(newPacking[0].checked).toBe(0);

    // Day note copied
    const newNotes = testDb.prepare('SELECT * FROM day_notes WHERE trip_id = ?').all(newId) as any[];
    expect(newNotes).toHaveLength(1);
    expect(newNotes[0].text).toBe('Pack early!');
  });

  it('TRIP-027 — copy preserves todos (unchecked, unassigned) and budget category order', async () => {
    const { user } = createUser(testDb);
    const trip = createTrip(testDb, user.id, { title: 'Todo Trip' });

    // Two todos: one checked and assigned — both should arrive unchecked and unassigned
    testDb.prepare(
      'INSERT INTO todo_items (trip_id, name, checked, category, sort_order, due_date, description, priority) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
    ).run(trip.id, 'Buy tickets', 0, 'Transport', 0, '2026-06-01', 'Check Ryanair', 1);
    testDb.prepare(
      'INSERT INTO todo_items (trip_id, name, checked, category, sort_order, assigned_user_id, priority) VALUES (?, ?, ?, ?, ?, ?, ?)'
    ).run(trip.id, 'Book hotel', 1, 'Accommodation', 1, user.id, 0);

    // Two budget category order rows
    const insOrder = testDb.prepare('INSERT INTO budget_category_order (trip_id, category, sort_order) VALUES (?, ?, ?)');
    insOrder.run(trip.id, 'Transport', 0);
    insOrder.run(trip.id, 'Accommodation', 1);

    const res = await request(app)
      .post(`/api/trips/${trip.id}/copy`)
      .set('Cookie', authCookie(user.id))
      .send({ title: 'Todo Trip (Copy)' });

    expect(res.status).toBe(201);
    const newId = res.body.trip.id;

    // Todos copied with checked reset and assigned_user_id nulled
    const newTodos = testDb.prepare('SELECT * FROM todo_items WHERE trip_id = ? ORDER BY sort_order').all(newId) as any[];
    expect(newTodos).toHaveLength(2);
    expect(newTodos[0].name).toBe('Buy tickets');
    expect(newTodos[0].category).toBe('Transport');
    expect(newTodos[0].checked).toBe(0);
    expect(newTodos[0].assigned_user_id).toBeNull();
    expect(newTodos[0].due_date).toBe('2026-06-01');
    expect(newTodos[0].description).toBe('Check Ryanair');
    expect(newTodos[0].priority).toBe(1);
    expect(newTodos[1].name).toBe('Book hotel');
    expect(newTodos[1].checked).toBe(0);
    expect(newTodos[1].assigned_user_id).toBeNull();

    // Budget category order copied
    const newOrder = testDb.prepare('SELECT category, sort_order FROM budget_category_order WHERE trip_id = ? ORDER BY sort_order').all(newId) as any[];
    expect(newOrder).toHaveLength(2);
    expect(newOrder[0]).toMatchObject({ category: 'Transport', sort_order: 0 });
    expect(newOrder[1]).toMatchObject({ category: 'Accommodation', sort_order: 1 });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Bundle endpoint — GET /api/trips/:id/bundle
// ─────────────────────────────────────────────────────────────────────────────

describe('Trip bundle', () => {
  it('BUNDLE-001 — returns all sub-collections for owned trip', async () => {
    const { user } = createUser(testDb);
    const trip = createTrip(testDb, user.id, { start_date: '2026-07-01', end_date: '2026-07-03' });

    const res = await request(app)
      .get(`/api/trips/${trip.id}/bundle`)
      .set('Cookie', authCookie(user.id));

    expect(res.status).toBe(200);
    expect(res.body.trip).toBeDefined();
    expect(res.body.trip.id).toBe(trip.id);
    expect(Array.isArray(res.body.days)).toBe(true);
    expect(res.body.days).toHaveLength(3);
    expect(Array.isArray(res.body.places)).toBe(true);
    expect(Array.isArray(res.body.packingItems)).toBe(true);
    expect(Array.isArray(res.body.todoItems)).toBe(true);
    expect(Array.isArray(res.body.budgetItems)).toBe(true);
    expect(Array.isArray(res.body.reservations)).toBe(true);
    expect(Array.isArray(res.body.files)).toBe(true);
  });

  it('BUNDLE-002 — returns 404 for trip that does not exist', async () => {
    const { user } = createUser(testDb);

    const res = await request(app)
      .get('/api/trips/999999/bundle')
      .set('Cookie', authCookie(user.id));

    expect(res.status).toBe(404);
  });

  it('BUNDLE-003 — returns 404 when user has no access to trip', async () => {
    const { user: owner } = createUser(testDb);
    const { user: other } = createUser(testDb);
    const trip = createTrip(testDb, owner.id);

    const res = await request(app)
      .get(`/api/trips/${trip.id}/bundle`)
      .set('Cookie', authCookie(other.id));

    expect(res.status).toBe(404);
  });

  it('BUNDLE-004 — members can fetch bundle', async () => {
    const { user: owner } = createUser(testDb);
    const { user: member } = createUser(testDb);
    const trip = createTrip(testDb, owner.id);
    testDb.prepare('INSERT INTO trip_members (trip_id, user_id) VALUES (?, ?)').run(trip.id, member.id);

    const res = await request(app)
      .get(`/api/trips/${trip.id}/bundle`)
      .set('Cookie', authCookie(member.id));

    expect(res.status).toBe(200);
    expect(res.body.trip.id).toBe(trip.id);
  });

  it('BUNDLE-005 — returns 401 when unauthenticated', async () => {
    const { user } = createUser(testDb);
    const trip = createTrip(testDb, user.id);

    const res = await request(app).get(`/api/trips/${trip.id}/bundle`);

    expect(res.status).toBe(401);
  });
});

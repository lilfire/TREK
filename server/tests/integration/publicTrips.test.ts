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
import { createUser, createTrip, createDay, createPlace, createDayAssignment, createDayNote } from '../helpers/factories';
import { loginAttempts, mfaAttempts } from '../../src/routes/auth';
import { rsvpAttempts } from '../../src/routes/publicTrips';

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
  mockSendRsvpEmail.mockReset().mockResolvedValue(true);
});

afterAll(() => {
  testDb.close();
});

describe('GET /api/public/trips', () => {
  it('PLIST-001 — returns 200 and empty array when no public trips exist', async () => {
    const res = await request(app).get('/api/public/trips');
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
    expect(res.body).toHaveLength(0);
  });

  it('PLIST-002 — returns only public trips, not private ones', async () => {
    const { user } = createUser(testDb);
    const publicTrip = createTrip(testDb, user.id, { title: 'Public Trip' });
    createTrip(testDb, user.id, { title: 'Private Trip' }); // is_public defaults to 0
    testDb.prepare('UPDATE trips SET is_public = 1 WHERE id = ?').run(publicTrip.id);

    const res = await request(app).get('/api/public/trips');
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
    expect(res.body).toHaveLength(1);
    expect(res.body[0].id).toBe(publicTrip.id);
    expect(res.body[0].name).toBe('Public Trip');
  });

  it('PLIST-003 — response includes required fields with correct values', async () => {
    const { user } = createUser(testDb);
    const trip = createTrip(testDb, user.id, {
      title: 'Field Check Trip',
      start_date: '2025-01-01',
      end_date: '2025-01-07',
      description: 'A great trip',
    });
    testDb.prepare('UPDATE trips SET is_public = 1 WHERE id = ?').run(trip.id);
    createPlace(testDb, trip.id, { name: 'Louvre' });

    const res = await request(app).get('/api/public/trips');
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(1);
    const t = res.body[0];
    expect(t.id).toBeDefined();
    expect(t.name).toBe('Field Check Trip');
    expect(t.start_date).toBe('2025-01-01');
    expect(t.end_date).toBe('2025-01-07');
    expect(t.description).toBe('A great trip');
    expect(t.cover_image_url).toBeNull();
    expect(t.place_count).toBe(1);
  });

  it('PLIST-004 — requires no authentication', async () => {
    const { user } = createUser(testDb);
    const trip = createTrip(testDb, user.id, { title: 'Open Trip' });
    testDb.prepare('UPDATE trips SET is_public = 1 WHERE id = ?').run(trip.id);

    const res = await request(app).get('/api/public/trips');
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(1);
  });
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

describe('POST /api/public/trips/:id/rsvp', () => {
  it('RSVP-001 — valid submission creates user + RSVP + trip member, returns 201 with rsvpId/userId/authToken', async () => {
    const { user: owner } = createUser(testDb);
    const trip = createTrip(testDb, owner.id, { title: 'My RSVP Trip' });
    testDb.prepare('UPDATE trips SET is_public = 1 WHERE id = ?').run(trip.id);

    const res = await request(app)
      .post(`/api/public/trips/${trip.id}/rsvp`)
      .send({ name: 'Alice Smith', email: 'alice@example.com' });

    expect(res.status).toBe(201);
    expect(typeof res.body.rsvpId).toBe('number');
    expect(typeof res.body.userId).toBe('number');
    expect(typeof res.body.authToken).toBe('string');
    expect(res.body.authToken.length).toBeGreaterThan(20);

    const newUser = testDb.prepare('SELECT * FROM users WHERE email = ?').get('alice@example.com') as any;
    expect(newUser).toBeDefined();
    expect(newUser.id).toBe(res.body.userId);

    const rsvp = testDb.prepare('SELECT * FROM trip_rsvps WHERE trip_id = ? AND user_id = ?').get(trip.id, res.body.userId) as any;
    expect(rsvp).toBeDefined();
    expect(rsvp.name).toBe('Alice Smith');
    expect(rsvp.email).toBe('alice@example.com');

    const member = testDb.prepare('SELECT * FROM trip_members WHERE trip_id = ? AND user_id = ?').get(trip.id, res.body.userId);
    expect(member).toBeDefined();
  });

  it('RSVP-002 — existing email reuses user without overwriting password', async () => {
    const { user: owner } = createUser(testDb);
    const trip = createTrip(testDb, owner.id, { title: 'RSVP Trip' });
    testDb.prepare('UPDATE trips SET is_public = 1 WHERE id = ?').run(trip.id);

    const { user: existingUser } = createUser(testDb, { email: 'existing@example.com' });
    const originalHash = (testDb.prepare('SELECT password_hash FROM users WHERE id = ?').get(existingUser.id) as any).password_hash;

    const res = await request(app)
      .post(`/api/public/trips/${trip.id}/rsvp`)
      .send({ name: 'Existing User', email: 'existing@example.com' });

    expect(res.status).toBe(201);
    expect(res.body.userId).toBe(existingUser.id);

    const currentHash = (testDb.prepare('SELECT password_hash FROM users WHERE id = ?').get(existingUser.id) as any).password_hash;
    expect(currentHash).toBe(originalHash);

    const userCount = (testDb.prepare('SELECT COUNT(*) as c FROM users WHERE LOWER(email) = ?').get('existing@example.com') as any).c;
    expect(userCount).toBe(1);
  });

  it('RSVP-003 — invalid email returns 400 with descriptive error', async () => {
    const { user: owner } = createUser(testDb);
    const trip = createTrip(testDb, owner.id);
    testDb.prepare('UPDATE trips SET is_public = 1 WHERE id = ?').run(trip.id);

    const res = await request(app)
      .post(`/api/public/trips/${trip.id}/rsvp`)
      .send({ name: 'Alice', email: 'not-an-email' });

    expect(res.status).toBe(400);
    expect(typeof res.body.error).toBe('string');
    expect(res.body.error.length).toBeGreaterThan(0);
  });

  it('RSVP-004 — private trip (is_public = 0) returns 404', async () => {
    const { user: owner } = createUser(testDb);
    const trip = createTrip(testDb, owner.id);
    // is_public defaults to 0

    const res = await request(app)
      .post(`/api/public/trips/${trip.id}/rsvp`)
      .send({ name: 'Alice', email: 'alice@example.com' });

    expect(res.status).toBe(404);
    expect(res.body.error).toBeDefined();
  });

  it('RSVP-005 — missing name returns 400', async () => {
    const { user: owner } = createUser(testDb);
    const trip = createTrip(testDb, owner.id);
    testDb.prepare('UPDATE trips SET is_public = 1 WHERE id = ?').run(trip.id);

    const res = await request(app)
      .post(`/api/public/trips/${trip.id}/rsvp`)
      .send({ email: 'alice@example.com' });

    expect(res.status).toBe(400);
    expect(res.body.error).toBeDefined();
  });

  it('RSVP-006 — non-existent trip returns 404', async () => {
    const res = await request(app)
      .post('/api/public/trips/999999/rsvp')
      .send({ name: 'Alice', email: 'alice@example.com' });

    expect(res.status).toBe(404);
    expect(res.body.error).toBeDefined();
  });

  it('RSVP-007 — trip owner RSVPs own trip creates RSVP record but does not add owner as trip_member', async () => {
    const { user: owner } = createUser(testDb, { email: 'owner@example.com' });
    const trip = createTrip(testDb, owner.id);
    testDb.prepare('UPDATE trips SET is_public = 1 WHERE id = ?').run(trip.id);

    const res = await request(app)
      .post(`/api/public/trips/${trip.id}/rsvp`)
      .send({ name: 'Owner Name', email: 'owner@example.com' });

    expect(res.status).toBe(201);
    expect(res.body.userId).toBe(owner.id);

    // Owner must NOT appear in trip_members (they own the trip, not a member)
    const member = testDb.prepare('SELECT * FROM trip_members WHERE trip_id = ? AND user_id = ?').get(trip.id, owner.id);
    expect(member).toBeUndefined();

    const rsvp = testDb.prepare('SELECT * FROM trip_rsvps WHERE trip_id = ? AND user_id = ?').get(trip.id, owner.id);
    expect(rsvp).toBeDefined();
  });

  it('RSVP-008 — existing member RSVPs creates RSVP without duplicating trip_member row', async () => {
    const { user: owner } = createUser(testDb);
    const { user: member } = createUser(testDb, { email: 'member@example.com' });
    const trip = createTrip(testDb, owner.id);
    testDb.prepare('UPDATE trips SET is_public = 1 WHERE id = ?').run(trip.id);
    testDb.prepare('INSERT INTO trip_members (trip_id, user_id, invited_by) VALUES (?, ?, ?)').run(trip.id, member.id, owner.id);

    const res = await request(app)
      .post(`/api/public/trips/${trip.id}/rsvp`)
      .send({ name: 'Member Name', email: 'member@example.com' });

    expect(res.status).toBe(201);

    const rows = testDb.prepare('SELECT * FROM trip_members WHERE trip_id = ? AND user_id = ?').all(trip.id, member.id) as any[];
    expect(rows).toHaveLength(1);
  });

  it('RSVP-009 — optional message is persisted in the RSVP record', async () => {
    const { user: owner } = createUser(testDb);
    const trip = createTrip(testDb, owner.id);
    testDb.prepare('UPDATE trips SET is_public = 1 WHERE id = ?').run(trip.id);

    const res = await request(app)
      .post(`/api/public/trips/${trip.id}/rsvp`)
      .send({ name: 'Alice', email: 'alice@example.com', message: "Can't wait!" });

    expect(res.status).toBe(201);
    const rsvp = testDb.prepare('SELECT * FROM trip_rsvps WHERE id = ?').get(res.body.rsvpId) as any;
    expect(rsvp.message).toBe("Can't wait!");
  });

  it('RSVP-010 — requires no authentication (unauthenticated request succeeds)', async () => {
    const { user: owner } = createUser(testDb);
    const trip = createTrip(testDb, owner.id);
    testDb.prepare('UPDATE trips SET is_public = 1 WHERE id = ?').run(trip.id);

    const res = await request(app)
      .post(`/api/public/trips/${trip.id}/rsvp`)
      .send({ name: 'Anonymous', email: 'anon@example.com' });

    expect(res.status).toBe(201);
  });

  it('RSVP-011 — returns 201 even when sendRsvpConfirmationEmail throws', async () => {
    const { user: owner } = createUser(testDb);
    const trip = createTrip(testDb, owner.id, { title: 'Error Trip' });
    testDb.prepare('UPDATE trips SET is_public = 1 WHERE id = ?').run(trip.id);

    mockSendRsvpEmail.mockRejectedValueOnce(new Error('Email service down'));

    const res = await request(app)
      .post(`/api/public/trips/${trip.id}/rsvp`)
      .send({ name: 'Bob', email: 'bob@example.com' });

    expect(res.status).toBe(201);
    expect(typeof res.body.rsvpId).toBe('number');
  });

  it('RSVP-012 — fires sendRsvpConfirmationEmail with correct trip title', async () => {
    const { user: owner } = createUser(testDb);
    const trip = createTrip(testDb, owner.id, { title: 'My Test Trip' });
    testDb.prepare('UPDATE trips SET is_public = 1 WHERE id = ?').run(trip.id);

    await request(app)
      .post(`/api/public/trips/${trip.id}/rsvp`)
      .send({ name: 'Carol', email: 'carol@example.com' });

    // Give the fire-and-forget promise time to settle
    await new Promise(r => setTimeout(r, 10));
    expect(mockSendRsvpEmail).toHaveBeenCalledWith(
      expect.any(String),
      'Carol',
      'My Test Trip',
      trip.id,
      expect.any(Number),
    );
  });
});

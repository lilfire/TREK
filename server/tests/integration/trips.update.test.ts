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
// Update trip (TRIP-008, TRIP-009, TRIP-010)
// ─────────────────────────────────────────────────────────────────────────────

describe('Update trip', () => {
  it('TRIP-008 — PUT /api/trips/:id updates title and description for owner → 200', async () => {
    const { user } = createUser(testDb);
    const trip = createTrip(testDb, user.id, { title: 'Original Title' });

    const res = await request(app)
      .put(`/api/trips/${trip.id}`)
      .set('Cookie', authCookie(user.id))
      .send({ title: 'Updated Title', description: 'New description' });

    expect(res.status).toBe(200);
    expect(res.body.trip.title).toBe('Updated Title');
    expect(res.body.trip.description).toBe('New description');
  });

  it('TRIP-009 — Archive trip (PUT with is_archived:true) removes it from normal list', async () => {
    const { user } = createUser(testDb);
    const trip = createTrip(testDb, user.id, { title: 'To Archive' });

    const archiveRes = await request(app)
      .put(`/api/trips/${trip.id}`)
      .set('Cookie', authCookie(user.id))
      .send({ is_archived: true });

    expect(archiveRes.status).toBe(200);
    expect(archiveRes.body.trip.is_archived).toBe(1);

    // Should not appear in the normal list
    const listRes = await request(app)
      .get('/api/trips')
      .set('Cookie', authCookie(user.id));

    const tripIds = listRes.body.trips.map((t: any) => t.id);
    expect(tripIds).not.toContain(trip.id);
  });

  it('TRIP-009 — Unarchive trip reappears in normal list', async () => {
    const { user } = createUser(testDb);
    const trip = createTrip(testDb, user.id, { title: 'Archived Trip' });

    // Archive it first
    testDb.prepare('UPDATE trips SET is_archived = 1 WHERE id = ?').run(trip.id);

    // Unarchive via API
    const unarchiveRes = await request(app)
      .put(`/api/trips/${trip.id}`)
      .set('Cookie', authCookie(user.id))
      .send({ is_archived: false });

    expect(unarchiveRes.status).toBe(200);
    expect(unarchiveRes.body.trip.is_archived).toBe(0);

    // Should appear in the normal list again
    const listRes = await request(app)
      .get('/api/trips')
      .set('Cookie', authCookie(user.id));

    const tripIds = listRes.body.trips.map((t: any) => t.id);
    expect(tripIds).toContain(trip.id);
  });

  it('TRIP-010 — Archive by trip member is denied when trip_archive is set to trip_owner', async () => {
    const { user: owner } = createUser(testDb);
    const { user: member } = createUser(testDb);
    const trip = createTrip(testDb, owner.id, { title: 'Members Trip' });
    addTripMember(testDb, trip.id, member.id);

    // Restrict archiving to trip_owner only (this is actually the default, but set explicitly)
    testDb.prepare("INSERT OR REPLACE INTO app_settings (key, value) VALUES ('perm_trip_archive', 'trip_owner')").run();
    invalidatePermissionsCache();

    const res = await request(app)
      .put(`/api/trips/${trip.id}`)
      .set('Cookie', authCookie(member.id))
      .send({ is_archived: true });

    expect(res.status).toBe(403);
    expect(res.body.error).toMatch(/permission/i);
  });

  it('TRIP-008 — Member cannot edit trip title when trip_edit is set to trip_owner', async () => {
    const { user: owner } = createUser(testDb);
    const { user: member } = createUser(testDb);
    const trip = createTrip(testDb, owner.id, { title: 'Original' });
    addTripMember(testDb, trip.id, member.id);

    // Default trip_edit is trip_owner — members should be blocked
    testDb.prepare("INSERT OR REPLACE INTO app_settings (key, value) VALUES ('perm_trip_edit', 'trip_owner')").run();
    invalidatePermissionsCache();

    const res = await request(app)
      .put(`/api/trips/${trip.id}`)
      .set('Cookie', authCookie(member.id))
      .send({ title: 'Hacked Title' });

    expect(res.status).toBe(403);
  });

  it('TRIP-008 — PUT /api/trips/:id returns 404 for non-existent trip', async () => {
    const { user } = createUser(testDb);

    const res = await request(app)
      .put('/api/trips/999999')
      .set('Cookie', authCookie(user.id))
      .send({ title: 'Ghost Update' });

    expect(res.status).toBe(404);
  });

  it('TRIP-023 — Shifting trip date range preserves day assignments positionally', async () => {
    const { user } = createUser(testDb);
    const trip = createTrip(testDb, user.id, { start_date: '2026-08-01', end_date: '2026-08-05' });

    const days = testDb.prepare('SELECT * FROM days WHERE trip_id = ? ORDER BY day_number').all(trip.id) as { id: number; date: string }[];
    expect(days).toHaveLength(5);

    const place = createPlace(testDb, trip.id);
    const assignment = createDayAssignment(testDb, days[0].id, place.id);
    const note = createDayNote(testDb, days[1].id, trip.id, { text: 'pack sunscreen' });

    // Shift forward 10 days (zero overlap with original range)
    const res = await request(app)
      .put(`/api/trips/${trip.id}`)
      .set('Cookie', authCookie(user.id))
      .send({ start_date: '2026-08-11', end_date: '2026-08-15' });

    expect(res.status).toBe(200);

    const daysAfter = testDb.prepare('SELECT * FROM days WHERE trip_id = ? ORDER BY day_number').all(trip.id) as { id: number; date: string | null }[];
    expect(daysAfter).toHaveLength(5);
    expect(daysAfter.map(d => d.date)).toEqual(['2026-08-11', '2026-08-12', '2026-08-13', '2026-08-14', '2026-08-15']);

    const assignmentsAfter = testDb.prepare('SELECT * FROM day_assignments WHERE id = ?').get(assignment.id) as { day_id: number } | undefined;
    expect(assignmentsAfter).toBeDefined();
    expect(assignmentsAfter!.day_id).toBe(daysAfter[0].id);

    const notesAfter = testDb.prepare('SELECT * FROM day_notes WHERE id = ?').get(note.id) as { day_id: number } | undefined;
    expect(notesAfter).toBeDefined();
    expect(notesAfter!.day_id).toBe(daysAfter[1].id);
  });

  it('TRIP-024 — Shrinking trip date range deletes overflow days and their content', async () => {
    const { user } = createUser(testDb);
    const trip = createTrip(testDb, user.id, { start_date: '2026-09-01', end_date: '2026-09-05' });

    const days = testDb.prepare('SELECT * FROM days WHERE trip_id = ? ORDER BY day_number').all(trip.id) as { id: number }[];
    const place = createPlace(testDb, trip.id);
    const a4 = createDayAssignment(testDb, days[3].id, place.id);
    const a5 = createDayAssignment(testDb, days[4].id, place.id);

    // Shrink from 5 to 3 days
    const res = await request(app)
      .put(`/api/trips/${trip.id}`)
      .set('Cookie', authCookie(user.id))
      .send({ start_date: '2026-09-01', end_date: '2026-09-03' });

    expect(res.status).toBe(200);

    const daysAfter = testDb.prepare('SELECT * FROM days WHERE trip_id = ? ORDER BY day_number').all(trip.id) as { id: number; date: string | null }[];
    expect(daysAfter).toHaveLength(3);
    expect(daysAfter.every(d => d.date !== null)).toBe(true);

    // Overflow days and their assignments deleted
    const all = testDb.prepare('SELECT * FROM day_assignments WHERE id IN (?, ?)').all(a4.id, a5.id) as { id: number }[];
    expect(all).toHaveLength(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Members (TRIP-013, TRIP-014, TRIP-015)
// ─────────────────────────────────────────────────────────────────────────────

describe('Trip members', () => {
  it('TRIP-015 — GET /api/trips/:id/members returns owner and members list', async () => {
    const { user: owner } = createUser(testDb);
    const { user: member } = createUser(testDb);
    const trip = createTrip(testDb, owner.id, { title: 'Team Trip' });
    addTripMember(testDb, trip.id, member.id);

    const res = await request(app)
      .get(`/api/trips/${trip.id}/members`)
      .set('Cookie', authCookie(owner.id));

    expect(res.status).toBe(200);
    expect(res.body.owner).toBeDefined();
    expect(res.body.owner.id).toBe(owner.id);
    expect(Array.isArray(res.body.members)).toBe(true);
    expect(res.body.members.some((m: any) => m.id === member.id)).toBe(true);
    expect(res.body.current_user_id).toBe(owner.id);
  });

  it('TRIP-013 — POST /api/trips/:id/members adds a member by email → 201', async () => {
    const { user: owner } = createUser(testDb);
    const { user: invitee } = createUser(testDb);
    const trip = createTrip(testDb, owner.id, { title: 'Team Trip' });

    const res = await request(app)
      .post(`/api/trips/${trip.id}/members`)
      .set('Cookie', authCookie(owner.id))
      .send({ identifier: invitee.email });

    expect(res.status).toBe(201);
    expect(res.body.member).toBeDefined();
    expect(res.body.member.email).toBe(invitee.email);
    expect(res.body.member.role).toBe('member');

    // Verify in DB
    const dbEntry = testDb.prepare('SELECT * FROM trip_members WHERE trip_id = ? AND user_id = ?').get(trip.id, invitee.id);
    expect(dbEntry).toBeDefined();
  });

  it('TRIP-013 — POST /api/trips/:id/members adds a member by username → 201', async () => {
    const { user: owner } = createUser(testDb);
    const { user: invitee } = createUser(testDb);
    const trip = createTrip(testDb, owner.id, { title: 'Team Trip' });

    const res = await request(app)
      .post(`/api/trips/${trip.id}/members`)
      .set('Cookie', authCookie(owner.id))
      .send({ identifier: invitee.username });

    expect(res.status).toBe(201);
    expect(res.body.member.id).toBe(invitee.id);
  });

  it('TRIP-013 — Adding a non-existent user returns 404', async () => {
    const { user: owner } = createUser(testDb);
    const trip = createTrip(testDb, owner.id, { title: 'Team Trip' });

    const res = await request(app)
      .post(`/api/trips/${trip.id}/members`)
      .set('Cookie', authCookie(owner.id))
      .send({ identifier: 'nobody@nowhere.example.com' });

    expect(res.status).toBe(404);
    expect(res.body.error).toMatch(/user not found/i);
  });

  it('TRIP-013 — Adding a user who is already a member returns 400', async () => {
    const { user: owner } = createUser(testDb);
    const { user: member } = createUser(testDb);
    const trip = createTrip(testDb, owner.id, { title: 'Team Trip' });
    addTripMember(testDb, trip.id, member.id);

    const res = await request(app)
      .post(`/api/trips/${trip.id}/members`)
      .set('Cookie', authCookie(owner.id))
      .send({ identifier: member.email });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/already/i);
  });

  it('TRIP-013 — Adding a member by whitespace-padded username resolves correctly → 201', async () => {
    const { user: owner } = createUser(testDb);
    const { user: invitee } = createUser(testDb, { username: 'paddeduser' });
    const trip = createTrip(testDb, owner.id, { title: 'Padded Trip' });

    const res = await request(app)
      .post(`/api/trips/${trip.id}/members`)
      .set('Cookie', authCookie(owner.id))
      .send({ identifier: '  paddeduser  ' });

    expect(res.status).toBe(201);
    expect(res.body.member.id).toBe(invitee.id);
  });

  it('TRIP-014 — DELETE /api/trips/:id/members/:userId removes a member → 200', async () => {
    const { user: owner } = createUser(testDb);
    const { user: member } = createUser(testDb);
    const trip = createTrip(testDb, owner.id, { title: 'Team Trip' });
    addTripMember(testDb, trip.id, member.id);

    const res = await request(app)
      .delete(`/api/trips/${trip.id}/members/${member.id}`)
      .set('Cookie', authCookie(owner.id));

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);

    // Verify removal in DB
    const dbEntry = testDb.prepare('SELECT * FROM trip_members WHERE trip_id = ? AND user_id = ?').get(trip.id, member.id);
    expect(dbEntry).toBeUndefined();
  });

  it('TRIP-014 — Member can remove themselves from a trip → 200', async () => {
    const { user: owner } = createUser(testDb);
    const { user: member } = createUser(testDb);
    const trip = createTrip(testDb, owner.id, { title: 'Team Trip' });
    addTripMember(testDb, trip.id, member.id);

    const res = await request(app)
      .delete(`/api/trips/${trip.id}/members/${member.id}`)
      .set('Cookie', authCookie(member.id));

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
  });

  it('TRIP-013 — Non-owner member cannot add other members when member_manage is trip_owner', async () => {
    const { user: owner } = createUser(testDb);
    const { user: member } = createUser(testDb);
    const { user: invitee } = createUser(testDb);
    const trip = createTrip(testDb, owner.id, { title: 'Team Trip' });
    addTripMember(testDb, trip.id, member.id);

    // Restrict member management to trip_owner (default)
    testDb.prepare("INSERT OR REPLACE INTO app_settings (key, value) VALUES ('perm_member_manage', 'trip_owner')").run();
    invalidatePermissionsCache();

    const res = await request(app)
      .post(`/api/trips/${trip.id}/members`)
      .set('Cookie', authCookie(member.id))
      .send({ identifier: invitee.email });

    expect(res.status).toBe(403);
    expect(res.body.error).toMatch(/permission/i);
  });

  it('TRIP-015 — Non-member cannot list trip members → 404', async () => {
    const { user: owner } = createUser(testDb);
    const { user: stranger } = createUser(testDb);
    const trip = createTrip(testDb, owner.id, { title: 'Private Trip' });

    const res = await request(app)
      .get(`/api/trips/${trip.id}/members`)
      .set('Cookie', authCookie(stranger.id));

    expect(res.status).toBe(404);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// fee_currency (LSO-1519)
// ─────────────────────────────────────────────────────────────────────────────

describe('fee_currency', () => {
  it('LSO-1519-A — saving fee_currency=USD with trip currency=NOK persists and returns correctly', async () => {
    const { user } = createUser(testDb);
    const trip = createTrip(testDb, user.id, { title: 'Fee Trip', currency: 'NOK' });

    const res = await request(app)
      .put(`/api/trips/${trip.id}`)
      .set('Cookie', authCookie(user.id))
      .send({ registration_fee: 150, fee_mode: 'rsvp', fee_currency: 'USD' });

    expect(res.status).toBe(200);
    expect(res.body.trip.fee_currency).toBe('USD');
    expect(res.body.trip.registration_fee).toBe(150);

    const row = testDb.prepare('SELECT fee_currency FROM trips WHERE id = ?').get(trip.id) as { fee_currency: string };
    expect(row.fee_currency).toBe('USD');
  });

  it('LSO-1519-B — clearing registration_fee to null also clears fee_currency', async () => {
    const { user } = createUser(testDb);
    const trip = createTrip(testDb, user.id, { title: 'Fee Trip' });
    testDb.prepare("UPDATE trips SET registration_fee=100, fee_mode='rsvp', fee_currency='EUR' WHERE id=?").run(trip.id);

    const res = await request(app)
      .put(`/api/trips/${trip.id}`)
      .set('Cookie', authCookie(user.id))
      .send({ registration_fee: null });

    expect(res.status).toBe(200);
    expect(res.body.trip.registration_fee).toBeNull();
    expect(res.body.trip.fee_currency).toBeNull();

    const row = testDb.prepare('SELECT fee_currency, registration_fee FROM trips WHERE id = ?').get(trip.id) as { fee_currency: string | null; registration_fee: number | null };
    expect(row.registration_fee).toBeNull();
    expect(row.fee_currency).toBeNull();
  });

  it('LSO-1519-C — clearing registration_fee to 0 also clears fee_currency', async () => {
    const { user } = createUser(testDb);
    const trip = createTrip(testDb, user.id, { title: 'Fee Trip' });
    testDb.prepare("UPDATE trips SET registration_fee=50, fee_mode='rsvp', fee_currency='GBP' WHERE id=?").run(trip.id);

    const res = await request(app)
      .put(`/api/trips/${trip.id}`)
      .set('Cookie', authCookie(user.id))
      .send({ registration_fee: 0 });

    expect(res.status).toBe(200);
    expect(res.body.trip.fee_currency).toBeNull();
  });

  it('LSO-1519-D — existing trips without fee_currency continue to work (backwards compat)', async () => {
    const { user } = createUser(testDb);
    const trip = createTrip(testDb, user.id, { title: 'Old Trip' });

    const res = await request(app)
      .get(`/api/trips/${trip.id}`)
      .set('Cookie', authCookie(user.id));

    expect(res.status).toBe(200);
    expect(res.body.trip).toBeDefined();
    // fee_currency is null/undefined for trips that never set it — both are valid
    expect(res.body.trip.fee_currency ?? null).toBeNull();
  });

  it('LSO-1519-E — invalid fee_currency "us" returns 400', async () => {
    const { user } = createUser(testDb);
    const trip = createTrip(testDb, user.id, { title: 'Fee Trip' });

    const res = await request(app)
      .put(`/api/trips/${trip.id}`)
      .set('Cookie', authCookie(user.id))
      .send({ registration_fee: 100, fee_currency: 'us' });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/fee_currency/i);
  });

  it('LSO-1519-F — invalid fee_currency "USDX" returns 400', async () => {
    const { user } = createUser(testDb);
    const trip = createTrip(testDb, user.id, { title: 'Fee Trip' });

    const res = await request(app)
      .put(`/api/trips/${trip.id}`)
      .set('Cookie', authCookie(user.id))
      .send({ registration_fee: 100, fee_currency: 'USDX' });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/fee_currency/i);
  });

  it('LSO-1519-G — invalid fee_currency "123" returns 400', async () => {
    const { user } = createUser(testDb);
    const trip = createTrip(testDb, user.id, { title: 'Fee Trip' });

    const res = await request(app)
      .put(`/api/trips/${trip.id}`)
      .set('Cookie', authCookie(user.id))
      .send({ registration_fee: 100, fee_currency: '123' });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/fee_currency/i);
  });

  it('LSO-1519-H — null fee_currency is valid (omitted)', async () => {
    const { user } = createUser(testDb);
    const trip = createTrip(testDb, user.id, { title: 'Fee Trip' });

    const res = await request(app)
      .put(`/api/trips/${trip.id}`)
      .set('Cookie', authCookie(user.id))
      .send({ registration_fee: 100, fee_mode: 'rsvp', fee_currency: null });

    expect(res.status).toBe(200);
    expect(res.body.trip.fee_currency).toBeNull();
  });
});

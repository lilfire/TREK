/**
 * Integration tests for GET /api/public/trips/:id (LSO-1293).
 * Covers PTRIP-001 to PTRIP-006 and PFILE-001 to PFILE-005.
 */
import { describe, it, expect, vi, beforeAll, beforeEach, afterAll } from 'vitest';
import request from 'supertest';
import type { Application } from 'express';
import path from 'path';
import fs from 'fs';

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
  GITHUB_REPO: process.env.GITHUB_REPO || 'mauriceboe/TREK',
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
import { createUser, createTrip, createDay, createPlace, createDayAssignment, createDayNote, createBudgetItem } from '../helpers/factories';
import { authHeader } from '../helpers/auth';
import { loginAttempts, mfaAttempts } from '../../src/routes/auth';
import { rsvpAttempts } from '../../src/routes/publicTrips';

const app: Application = createApp();

const uploadsDir = path.join(__dirname, '../../uploads/files');

beforeAll(() => {
  createTables(testDb);
  runMigrations(testDb);
  if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir, { recursive: true });
});

beforeEach(() => {
  // Recreate uploads dir if another test suite's afterAll removed it (parallel fork race)
  if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir, { recursive: true });
  resetTestDb(testDb);
  loginAttempts.clear();
  mfaAttempts.clear();
  rsvpAttempts.clear();
  mockSendRsvpEmail.mockReset().mockResolvedValue(true);
});

afterAll(() => {
  testDb.close();
  // Clean up any test files created in uploads dir by this suite
  const testFiles = fs.existsSync(uploadsDir)
    ? fs.readdirSync(uploadsDir).filter(f => f.startsWith('ptrip-test-'))
    : [];
  for (const f of testFiles) {
    try { fs.unlinkSync(path.join(uploadsDir, f)); } catch { /* ignore */ }
  }
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

  function insertTripFileLinked(
    tripId: number,
    placeId: number,
    opts: { starred?: number; created_at?: string; originalName?: string; mimeType?: string } = {}
  ): number {
    const r = testDb.prepare(
      `INSERT INTO trip_files (trip_id, filename, original_name, file_size, mime_type, starred, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    ).run(
      tripId,
      `ptrip-test-linked-${Date.now()}-${Math.random()}`,
      opts.originalName ?? 'doc.pdf',
      100,
      opts.mimeType ?? 'application/pdf',
      opts.starred ?? 0,
      opts.created_at ?? new Date().toISOString(),
    );
    const fileId = r.lastInsertRowid as number;
    testDb.prepare(
      `INSERT INTO file_links (file_id, place_id) VALUES (?, ?)`
    ).run(fileId, placeId);
    return fileId;
  }

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

  it('PTRIP-007 — place object includes duration_minutes', async () => {
    const { user } = createUser(testDb);
    const trip = createTrip(testDb, user.id, { title: 'Duration Trip' });
    testDb.prepare('UPDATE trips SET is_public = 1 WHERE id = ?').run(trip.id);
    const day = createDay(testDb, trip.id, { date: '2025-11-01' });
    const place = createPlace(testDb, trip.id, { name: 'Museum' });
    testDb.prepare('UPDATE places SET duration_minutes = 90 WHERE id = ?').run(place.id);
    createDayAssignment(testDb, day.id, place.id, {});

    const res = await request(app).get(`/api/public/trips/${trip.id}`);
    expect(res.status).toBe(200);
    const assignments = res.body.assignments[day.id];
    expect(Array.isArray(assignments)).toBe(true);
    expect(assignments).toHaveLength(1);
    expect(assignments[0].place.duration_minutes).toBe(90);
  });

  it('PTRIP-008 — place files include starred (boolean) and url', async () => {
    const { user } = createUser(testDb);
    const trip = createTrip(testDb, user.id, { title: 'Files Trip' });
    testDb.prepare('UPDATE trips SET is_public = 1 WHERE id = ?').run(trip.id);
    const day = createDay(testDb, trip.id, { date: '2025-11-02' });
    const place = createPlace(testDb, trip.id, { name: 'Gallery' });
    createDayAssignment(testDb, day.id, place.id, {});
    const fileId = insertTripFileLinked(trip.id, place.id, { starred: 1, originalName: 'starred.pdf' });

    const res = await request(app).get(`/api/public/trips/${trip.id}`);
    expect(res.status).toBe(200);
    const assignments = res.body.assignments[day.id];
    expect(assignments).toHaveLength(1);
    const files = assignments[0].place.files;
    expect(Array.isArray(files)).toBe(true);
    expect(files).toHaveLength(1);
    expect(typeof files[0].starred).toBe('boolean');
    expect(files[0].starred).toBe(true);
    expect(files[0].url).toBe(`/api/public/trips/${trip.id}/files/${fileId}`);
    expect(files[0].original_name).toBe('starred.pdf');
  });

  it('PTRIP-009 — files are ordered starred-first, then created_at ASC', async () => {
    const { user } = createUser(testDb);
    const trip = createTrip(testDb, user.id, { title: 'Sort Files Trip' });
    testDb.prepare('UPDATE trips SET is_public = 1 WHERE id = ?').run(trip.id);
    const day = createDay(testDb, trip.id, { date: '2025-11-03' });
    const place = createPlace(testDb, trip.id, { name: 'Library' });
    createDayAssignment(testDb, day.id, place.id, {});

    // Insert three files: not-starred (older), starred (middle), not-starred (newer)
    insertTripFileLinked(trip.id, place.id, { starred: 0, created_at: '2025-01-01T10:00:00Z', originalName: 'c_unstarred_old.pdf' });
    insertTripFileLinked(trip.id, place.id, { starred: 1, created_at: '2025-01-01T11:00:00Z', originalName: 'b_starred.pdf' });
    insertTripFileLinked(trip.id, place.id, { starred: 0, created_at: '2025-01-01T12:00:00Z', originalName: 'a_unstarred_new.pdf' });

    const res = await request(app).get(`/api/public/trips/${trip.id}`);
    expect(res.status).toBe(200);
    const assignments = res.body.assignments[day.id];
    expect(assignments).toHaveLength(1);
    const files = assignments[0].place.files;
    expect(files).toHaveLength(3);
    // starred file must come first
    expect(files[0].starred).toBe(true);
    expect(files[0].original_name).toBe('b_starred.pdf');
    // then unstarred files ordered by created_at ASC
    expect(files[1].starred).toBe(false);
    expect(files[1].original_name).toBe('c_unstarred_old.pdf');
    expect(files[2].starred).toBe(false);
    expect(files[2].original_name).toBe('a_unstarred_new.pdf');
  });

  it('PTRIP-009b — file uploaded directly via trip_files.place_id (no file_links row) appears in public response', async () => {
    const { user } = createUser(testDb);
    const trip = createTrip(testDb, user.id, { title: 'Direct Upload Trip' });
    testDb.prepare('UPDATE trips SET is_public = 1 WHERE id = ?').run(trip.id);
    const day = createDay(testDb, trip.id, { date: '2025-12-01' });
    const place = createPlace(testDb, trip.id, { name: 'Gallery' });
    createDayAssignment(testDb, day.id, place.id, {});

    const r = testDb.prepare(
      `INSERT INTO trip_files (trip_id, filename, original_name, file_size, mime_type, place_id, starred, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(trip.id, `direct-${Date.now()}`, 'brochure.pdf', 512, 'application/pdf', place.id, 0, new Date().toISOString());
    const fileId = r.lastInsertRowid as number;

    const res = await request(app).get(`/api/public/trips/${trip.id}`);
    expect(res.status).toBe(200);
    const files = res.body.assignments[day.id][0].place.files;
    expect(files).toHaveLength(1);
    expect(files[0].id).toBe(fileId);
    expect(files[0].original_name).toBe('brochure.pdf');
    expect(files[0].url).toBe(`/api/public/trips/${trip.id}/files/${fileId}`);
  });

  it('PTRIP-009c — file with both trip_files.place_id and file_links entry appears exactly once', async () => {
    const { user } = createUser(testDb);
    const trip = createTrip(testDb, user.id, { title: 'Dedup Trip' });
    testDb.prepare('UPDATE trips SET is_public = 1 WHERE id = ?').run(trip.id);
    const day = createDay(testDb, trip.id, { date: '2025-12-02' });
    const place = createPlace(testDb, trip.id, { name: 'Theatre' });
    createDayAssignment(testDb, day.id, place.id, {});

    const r = testDb.prepare(
      `INSERT INTO trip_files (trip_id, filename, original_name, file_size, mime_type, place_id, starred, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(trip.id, `dedup-${Date.now()}`, 'ticket.pdf', 256, 'application/pdf', place.id, 0, new Date().toISOString());
    const fileId = r.lastInsertRowid as number;
    testDb.prepare(`INSERT INTO file_links (file_id, place_id) VALUES (?, ?)`).run(fileId, place.id);

    const res = await request(app).get(`/api/public/trips/${trip.id}`);
    expect(res.status).toBe(200);
    const files = res.body.assignments[day.id][0].place.files;
    expect(files).toHaveLength(1);
    expect(files[0].id).toBe(fileId);
  });

  it('PTRIP-009d — assignment place object includes budget_category field', async () => {
    const { user } = createUser(testDb);
    const trip = createTrip(testDb, user.id, { title: 'Budget Category Trip' });
    testDb.prepare('UPDATE trips SET is_public = 1 WHERE id = ?').run(trip.id);
    const day = createDay(testDb, trip.id, { date: '2025-12-03' });
    const place = createPlace(testDb, trip.id, { name: 'shooting-range' });
    testDb.prepare('UPDATE places SET budget_category = ? WHERE id = ?').run('Fun Activities', place.id);
    createDayAssignment(testDb, day.id, place.id, {});

    const res = await request(app).get(`/api/public/trips/${trip.id}`);
    expect(res.status).toBe(200);
    const p = res.body.assignments[day.id][0].place;
    expect(p.budget_category).toBe('Fun Activities');
  });

  it('PTRIP-010 — budgetItems and budgetSummary included in response with seeded items', async () => {
    const { user } = createUser(testDb);
    const trip = createTrip(testDb, user.id, { title: 'Budget Trip' });
    testDb.prepare('UPDATE trips SET is_public = 1, currency = ? WHERE id = ?').run('EUR', trip.id);

    const item1 = createBudgetItem(testDb, trip.id, { name: 'Flights', category: 'Transport', total_price: 450 });
    const item2 = createBudgetItem(testDb, trip.id, { name: 'Hotel', category: 'Accommodation', total_price: 300 });

    const res = await request(app).get(`/api/public/trips/${trip.id}`);
    expect(res.status).toBe(200);

    const { budgetItems, budgetSummary } = res.body;
    expect(Array.isArray(budgetItems)).toBe(true);
    expect(budgetItems).toHaveLength(2);

    const titles = budgetItems.map((i: any) => i.title);
    expect(titles).toContain('Flights');
    expect(titles).toContain('Hotel');

    const flights = budgetItems.find((i: any) => i.title === 'Flights');
    expect(flights.amount).toBe(450);
    expect(flights.category).toBe('Transport');
    expect(flights.id).toBe(item1.id);

    const hotel = budgetItems.find((i: any) => i.title === 'Hotel');
    expect(hotel.amount).toBe(300);
    expect(hotel.category).toBe('Accommodation');
    expect(hotel.id).toBe(item2.id);

    expect(budgetSummary).toBeDefined();
    expect(budgetSummary.totalBudget).toBe(750);
    expect(budgetSummary.currency).toBe('EUR');
  });

  it('PTRIP-011 — budgetItems is empty array and budgetSummary.totalBudget is 0 when no items seeded', async () => {
    const { user } = createUser(testDb);
    const trip = createTrip(testDb, user.id, { title: 'Empty Budget Trip' });
    testDb.prepare('UPDATE trips SET is_public = 1, currency = ? WHERE id = ?').run('USD', trip.id);

    const res = await request(app).get(`/api/public/trips/${trip.id}`);
    expect(res.status).toBe(200);

    const { budgetItems, budgetSummary } = res.body;
    expect(Array.isArray(budgetItems)).toBe(true);
    expect(budgetItems).toHaveLength(0);

    expect(budgetSummary).toBeDefined();
    expect(budgetSummary.totalBudget).toBe(0);
    expect(budgetSummary.currency).toBe('USD');
  });

  it('PTRIP-012 — fee_currency is returned in trip response when set (LSO-1537: was missing, caused HUF shown instead of NOK)', async () => {
    const { user } = createUser(testDb);
    const trip = createTrip(testDb, user.id, { title: 'NOK Fee Trip' });
    testDb.prepare('UPDATE trips SET is_public = 1, currency = ?, registration_fee = ?, fee_mode = ?, fee_currency = ? WHERE id = ?')
      .run('HUF', 1000, 'rsvp', 'NOK', trip.id);

    const res = await request(app).get(`/api/public/trips/${trip.id}`);
    expect(res.status).toBe(200);
    expect(res.body.trip.fee_currency).toBe('NOK');
    expect(res.body.trip.currency).toBe('HUF');
  });

  it('PTRIP-013 — fee_currency is null when not explicitly set (client falls back to base currency)', async () => {
    const { user } = createUser(testDb);
    const trip = createTrip(testDb, user.id, { title: 'No Fee Currency Trip' });
    testDb.prepare('UPDATE trips SET is_public = 1, currency = ? WHERE id = ?').run('EUR', trip.id);

    const res = await request(app).get(`/api/public/trips/${trip.id}`);
    expect(res.status).toBe(200);
    expect(res.body.trip.currency).toBe('EUR');
    expect(res.body.trip.fee_currency).toBeNull();
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

    expect(mockSendRsvpEmail).toHaveBeenCalledWith(
      expect.any(String),
      'Carol',
      'My Test Trip',
      trip.id,
      expect.any(Number),
      expect.stringContaining('/reset-password?token='),
    );
  });

  it('RSVP-012c — new user RSVP creates a single account-setup token expiring in ~7 days', async () => {
    const { user: owner } = createUser(testDb);
    const trip = createTrip(testDb, owner.id, { title: 'Token TTL Trip' });
    testDb.prepare('UPDATE trips SET is_public = 1 WHERE id = ?').run(trip.id);

    await request(app)
      .post(`/api/public/trips/${trip.id}/rsvp`)
      .send({ name: 'Erin', email: 'erin@example.com' });

    const newUser = testDb.prepare('SELECT id FROM users WHERE email = ?').get('erin@example.com') as { id: number };
    const tokens = testDb.prepare(
      'SELECT expires_at FROM password_reset_tokens WHERE user_id = ? AND consumed_at IS NULL',
    ).all(newUser.id) as { expires_at: string }[];

    expect(tokens).toHaveLength(1);
    const ttlMs = new Date(tokens[0].expires_at).getTime() - Date.now();
    const sixDays = 6 * 24 * 60 * 60 * 1000;
    const eightDays = 8 * 24 * 60 * 60 * 1000;
    expect(ttlMs).toBeGreaterThan(sixDays);
    expect(ttlMs).toBeLessThan(eightDays);
  });

  it('RSVP-012b — does not include a set-password link for an existing user', async () => {
    const { user: owner } = createUser(testDb);
    const trip = createTrip(testDb, owner.id, { title: 'Existing User Trip' });
    testDb.prepare('UPDATE trips SET is_public = 1 WHERE id = ?').run(trip.id);

    const { user: existing } = createUser(testDb, { email: 'dave@example.com' });

    await request(app)
      .post(`/api/public/trips/${trip.id}/rsvp`)
      .send({ name: 'Dave', email: 'dave@example.com' });

    expect(mockSendRsvpEmail).toHaveBeenCalledWith(
      'dave@example.com',
      'Dave',
      'Existing User Trip',
      trip.id,
      existing.id,
      undefined,
    );
    const tokenCount = testDb.prepare(
      'SELECT COUNT(*) AS c FROM password_reset_tokens WHERE user_id = ?',
    ).get(existing.id) as { c: number };
    expect(tokenCount.c).toBe(0);
  });

  it('RSVP-018 — unauthenticated 201 response body includes emailSent: true on successful delivery', async () => {
    const { user: owner } = createUser(testDb);
    const trip = createTrip(testDb, owner.id, { title: 'Unauth Send OK' });
    testDb.prepare('UPDATE trips SET is_public = 1 WHERE id = ?').run(trip.id);

    mockSendRsvpEmail.mockResolvedValueOnce(true);

    const res = await request(app)
      .post(`/api/public/trips/${trip.id}/rsvp`)
      .send({ name: 'Dora', email: 'dora@example.com' });

    expect(res.status).toBe(201);
    expect(res.body.emailSent).toBe(true);
  });

  it('RSVP-019 — unauthenticated 201 response body includes emailSent: false when sendRsvpConfirmationEmail throws', async () => {
    const { user: owner } = createUser(testDb);
    const trip = createTrip(testDb, owner.id, { title: 'Unauth Send Throws' });
    testDb.prepare('UPDATE trips SET is_public = 1 WHERE id = ?').run(trip.id);

    mockSendRsvpEmail.mockRejectedValueOnce(new Error('SMTP timeout'));

    const res = await request(app)
      .post(`/api/public/trips/${trip.id}/rsvp`)
      .send({ name: 'Eve', email: 'eve@example.com' });

    expect(res.status).toBe(201);
    expect(res.body.emailSent).toBe(false);
    expect(typeof res.body.rsvpId).toBe('number');
  });

  it('RSVP-020 — unauthenticated 201 response body includes emailSent: false when sendRsvpConfirmationEmail resolves false', async () => {
    const { user: owner } = createUser(testDb);
    const trip = createTrip(testDb, owner.id, { title: 'Unauth Send Returns False' });
    testDb.prepare('UPDATE trips SET is_public = 1 WHERE id = ?').run(trip.id);

    mockSendRsvpEmail.mockResolvedValueOnce(false);

    const res = await request(app)
      .post(`/api/public/trips/${trip.id}/rsvp`)
      .send({ name: 'Frank', email: 'frank@example.com' });

    expect(res.status).toBe(201);
    expect(res.body.emailSent).toBe(false);
  });

  it('RSVP-021 — authenticated 201 response body includes emailSent: true on successful delivery', async () => {
    const { user: owner } = createUser(testDb);
    const { user: rsvpUser } = createUser(testDb, { email: 'auth-ok@example.com' });
    const trip = createTrip(testDb, owner.id, { title: 'Auth Send OK' });
    testDb.prepare('UPDATE trips SET is_public = 1 WHERE id = ?').run(trip.id);

    mockSendRsvpEmail.mockResolvedValueOnce(true);

    const res = await request(app)
      .post(`/api/public/trips/${trip.id}/rsvp`)
      .set(authHeader(rsvpUser.id));

    expect(res.status).toBe(201);
    expect(res.body.emailSent).toBe(true);
    expect(res.body.userId).toBe(rsvpUser.id);
  });

  it('RSVP-022 — authenticated 201 response body includes emailSent: false when sendRsvpConfirmationEmail throws', async () => {
    const { user: owner } = createUser(testDb);
    const { user: rsvpUser } = createUser(testDb, { email: 'auth-fail@example.com' });
    const trip = createTrip(testDb, owner.id, { title: 'Auth Send Throws' });
    testDb.prepare('UPDATE trips SET is_public = 1 WHERE id = ?').run(trip.id);

    mockSendRsvpEmail.mockRejectedValueOnce(new Error('SMTP down'));

    const res = await request(app)
      .post(`/api/public/trips/${trip.id}/rsvp`)
      .set(authHeader(rsvpUser.id));

    expect(res.status).toBe(201);
    expect(res.body.emailSent).toBe(false);
    expect(res.body.userId).toBe(rsvpUser.id);
  });

  it('RSVP-013 — duplicate RSVP (same email + trip) returns 409 with duplicate_rsvp error code', async () => {
    const { user: owner } = createUser(testDb);
    const trip = createTrip(testDb, owner.id);
    testDb.prepare('UPDATE trips SET is_public = 1 WHERE id = ?').run(trip.id);

    await request(app)
      .post(`/api/public/trips/${trip.id}/rsvp`)
      .send({ name: 'Alice', email: 'alice@example.com' });

    const res = await request(app)
      .post(`/api/public/trips/${trip.id}/rsvp`)
      .send({ name: 'Alice', email: 'alice@example.com' });

    expect(res.status).toBe(409);
    expect(res.body.error).toBe('duplicate_rsvp');
    expect(typeof res.body.message).toBe('string');
  });

  // AC1: authenticated RSVP creates record using user's own details
  it('RSVP-014 — authenticated user RSVPs without body, uses their account details', async () => {
    const { user: owner } = createUser(testDb);
    const { user: rsvpUser } = createUser(testDb, { email: 'auth-rsvp@example.com' });
    const trip = createTrip(testDb, owner.id, { title: 'Auth RSVP Trip' });
    testDb.prepare('UPDATE trips SET is_public = 1 WHERE id = ?').run(trip.id);

    const res = await request(app)
      .post(`/api/public/trips/${trip.id}/rsvp`)
      .set(authHeader(rsvpUser.id));

    expect(res.status).toBe(201);
    expect(typeof res.body.rsvpId).toBe('number');
    expect(res.body.userId).toBe(rsvpUser.id);
    expect(typeof res.body.authToken).toBe('string');

    const rsvp = testDb.prepare('SELECT * FROM trip_rsvps WHERE trip_id = ? AND user_id = ?').get(trip.id, rsvpUser.id) as any;
    expect(rsvp).toBeDefined();
    expect(rsvp.email).toBe('auth-rsvp@example.com');

    const member = testDb.prepare('SELECT * FROM trip_members WHERE trip_id = ? AND user_id = ?').get(trip.id, rsvpUser.id);
    expect(member).toBeDefined();
  });

  // AC2: authenticated user who already RSVP'd gets 200 { alreadyMember: true }
  it('RSVP-015 — authenticated user who already RSVPd returns 200 alreadyMember', async () => {
    const { user: owner } = createUser(testDb);
    const { user: rsvpUser } = createUser(testDb, { email: 'repeat@example.com' });
    const trip = createTrip(testDb, owner.id);
    testDb.prepare('UPDATE trips SET is_public = 1 WHERE id = ?').run(trip.id);

    // First RSVP
    const first = await request(app)
      .post(`/api/public/trips/${trip.id}/rsvp`)
      .set(authHeader(rsvpUser.id));
    expect(first.status).toBe(201);

    // Second RSVP — same user
    const second = await request(app)
      .post(`/api/public/trips/${trip.id}/rsvp`)
      .set(authHeader(rsvpUser.id));
    expect(second.status).toBe(200);
    expect(second.body.alreadyMember).toBe(true);

    // Only one RSVP row should exist
    const rows = testDb.prepare('SELECT * FROM trip_rsvps WHERE trip_id = ? AND user_id = ?').all(trip.id, rsvpUser.id) as any[];
    expect(rows).toHaveLength(1);
  });

  // AC3: unauthenticated RSVP with valid name+email body still works
  it('RSVP-016 — unauthenticated RSVP with valid name+email body succeeds (existing flow unchanged)', async () => {
    const { user: owner } = createUser(testDb);
    const trip = createTrip(testDb, owner.id);
    testDb.prepare('UPDATE trips SET is_public = 1 WHERE id = ?').run(trip.id);

    const res = await request(app)
      .post(`/api/public/trips/${trip.id}/rsvp`)
      .send({ name: 'Unauth User', email: 'unauth@example.com' });

    expect(res.status).toBe(201);
    expect(typeof res.body.rsvpId).toBe('number');
    expect(typeof res.body.authToken).toBe('string');
    const rsvp = testDb.prepare('SELECT * FROM trip_rsvps WHERE trip_id = ? AND email = ?').get(trip.id, 'unauth@example.com') as any;
    expect(rsvp).toBeDefined();
  });

  // AC4: unauthenticated RSVP with no body returns validation error
  it('RSVP-017 — unauthenticated RSVP with no body returns 400 validation error', async () => {
    const { user: owner } = createUser(testDb);
    const trip = createTrip(testDb, owner.id);
    testDb.prepare('UPDATE trips SET is_public = 1 WHERE id = ?').run(trip.id);

    const res = await request(app)
      .post(`/api/public/trips/${trip.id}/rsvp`);

    expect(res.status).toBe(400);
    expect(typeof res.body.error).toBe('string');
    expect(res.body.error.length).toBeGreaterThan(0);
  });
});

describe('GET /api/public/trips/:tripId/files/:fileId', () => {
  function createTestFile(filename: string, content = 'test file content'): string {
    const filePath = path.join(uploadsDir, filename);
    fs.writeFileSync(filePath, content);
    return filePath;
  }

  function insertTripFile(tripId: number, filename: string, originalName = 'document.pdf', mimeType = 'application/pdf'): number {
    const r = testDb.prepare(
      `INSERT INTO trip_files (trip_id, filename, original_name, file_size, mime_type)
       VALUES (?, ?, ?, ?, ?)`
    ).run(tripId, filename, originalName, 100, mimeType);
    return r.lastInsertRowid as number;
  }

  it('PFILE-001 — returns 200 and streams file with correct Content-Type for public trip', async () => {
    const { user } = createUser(testDb);
    const trip = createTrip(testDb, user.id);
    testDb.prepare('UPDATE trips SET is_public = 1 WHERE id = ?').run(trip.id);

    const filename = 'ptrip-test-001.pdf';
    createTestFile(filename, '%PDF-1.4 test content');
    const fileId = insertTripFile(trip.id, filename, 'my-doc.pdf', 'application/pdf');

    const res = await request(app)
      .get(`/api/public/trips/${trip.id}/files/${fileId}`);

    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/application\/pdf/);
    expect(res.headers['content-disposition']).toContain('my-doc.pdf');
  });

  it('PFILE-002 — returns 404 when trip is not public (is_public = 0)', async () => {
    const { user } = createUser(testDb);
    const trip = createTrip(testDb, user.id);
    // trip.is_public = 0 by default

    const filename = 'ptrip-test-002.pdf';
    createTestFile(filename);
    const fileId = insertTripFile(trip.id, filename);

    const res = await request(app)
      .get(`/api/public/trips/${trip.id}/files/${fileId}`);

    expect(res.status).toBe(404);
    expect(res.body.error).toBeDefined();
  });

  it('PFILE-003 — returns 404 when file does not belong to the trip', async () => {
    const { user } = createUser(testDb);
    const tripA = createTrip(testDb, user.id);
    const tripB = createTrip(testDb, user.id);
    testDb.prepare('UPDATE trips SET is_public = 1 WHERE id = ?').run(tripA.id);
    testDb.prepare('UPDATE trips SET is_public = 1 WHERE id = ?').run(tripB.id);

    const filename = 'ptrip-test-003.pdf';
    createTestFile(filename);
    // file belongs to tripB
    const fileId = insertTripFile(tripB.id, filename);

    // request via tripA
    const res = await request(app)
      .get(`/api/public/trips/${tripA.id}/files/${fileId}`);

    expect(res.status).toBe(404);
    expect(res.body.error).toBeDefined();
  });

  it('PFILE-004 — returns 404 when file has deleted_at set', async () => {
    const { user } = createUser(testDb);
    const trip = createTrip(testDb, user.id);
    testDb.prepare('UPDATE trips SET is_public = 1 WHERE id = ?').run(trip.id);

    const filename = 'ptrip-test-004.pdf';
    createTestFile(filename);
    const r = testDb.prepare(
      `INSERT INTO trip_files (trip_id, filename, original_name, mime_type, deleted_at)
       VALUES (?, ?, ?, ?, ?)`
    ).run(trip.id, filename, 'deleted.pdf', 'application/pdf', '2026-01-01T00:00:00Z');
    const fileId = r.lastInsertRowid as number;

    const res = await request(app)
      .get(`/api/public/trips/${trip.id}/files/${fileId}`);

    expect(res.status).toBe(404);
    expect(res.body.error).toBeDefined();
  });

  it('PFILE-005 — returns 404 for non-existent trip', async () => {
    const res = await request(app)
      .get('/api/public/trips/999999/files/1');

    expect(res.status).toBe(404);
    expect(res.body.error).toBeDefined();
  });
});

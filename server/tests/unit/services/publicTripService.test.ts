/**
 * Unit tests for publicTripService — getPublicTripData place fields.
 * Covers PTRSVC-001 to PTRSVC-006.
 */
import { describe, it, expect, vi, beforeAll, beforeEach, afterAll } from 'vitest';

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

vi.mock('../../../src/db/database', () => dbMock);
vi.mock('../../../src/config', () => ({
  JWT_SECRET: 'test-secret',
  ENCRYPTION_KEY: 'a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6a7b8c9d0e1f2a3b4c5d6a7b8c9d0e1f2',
  updateJwtSecret: () => {},
}));

import { createTables } from '../../../src/db/schema';
import { runMigrations } from '../../../src/db/migrations';
import { resetTestDb } from '../../helpers/test-db';
import { createUser, createTrip, createDay, createPlace, createDayAssignment } from '../../helpers/factories';
import { getPublicTripData } from '../../../src/services/publicTripService';

beforeAll(() => {
  createTables(testDb);
  runMigrations(testDb);
});

beforeEach(() => {
  resetTestDb(testDb);
});

afterAll(() => {
  testDb.close();
});

describe('getPublicTripData — place fields', () => {
  it('PTRSVC-001 — place objects include website, phone, notes, currency, files', () => {
    const { user } = createUser(testDb);
    const trip = createTrip(testDb, user.id, { title: 'Field Test Trip' });
    testDb.prepare('UPDATE trips SET is_public = 1 WHERE id = ?').run(trip.id);

    const day = createDay(testDb, trip.id, { date: '2026-01-01' });
    const place = createPlace(testDb, trip.id, { name: 'Eiffel Tower' });
    testDb.prepare(
      'UPDATE places SET website = ?, phone = ?, notes = ?, currency = ? WHERE id = ?'
    ).run('https://example.com', '+1-555-1234', 'Bring camera', 'EUR', place.id);

    createDayAssignment(testDb, day.id, place.id);

    const data = getPublicTripData(trip.id);
    expect(data).not.toBeNull();

    const dayAssignments = data!.assignments[day.id];
    expect(Array.isArray(dayAssignments)).toBe(true);
    expect(dayAssignments).toHaveLength(1);

    const p = dayAssignments[0].place;
    expect(p.website).toBe('https://example.com');
    expect(p.phone).toBe('+1-555-1234');
    expect(p.notes).toBe('Bring camera');
    expect(p.currency).toBe('EUR');
    expect(Array.isArray(p.files)).toBe(true);
  });

  it('PTRSVC-002 — place with no files has empty files array', () => {
    const { user } = createUser(testDb);
    const trip = createTrip(testDb, user.id);
    testDb.prepare('UPDATE trips SET is_public = 1 WHERE id = ?').run(trip.id);

    const day = createDay(testDb, trip.id);
    const place = createPlace(testDb, trip.id);
    createDayAssignment(testDb, day.id, place.id);

    const data = getPublicTripData(trip.id);
    expect(data).not.toBeNull();

    const p = data!.assignments[day.id][0].place;
    expect(p.files).toEqual([]);
  });

  it('PTRSVC-003 — place with linked file has populated files array', () => {
    const { user } = createUser(testDb);
    const trip = createTrip(testDb, user.id, { title: 'File Test Trip' });
    testDb.prepare('UPDATE trips SET is_public = 1 WHERE id = ?').run(trip.id);

    const day = createDay(testDb, trip.id);
    const place = createPlace(testDb, trip.id, { name: 'Louvre' });
    createDayAssignment(testDb, day.id, place.id);

    const fileResult = testDb.prepare(
      `INSERT INTO trip_files (trip_id, filename, original_name, file_size, mime_type, description)
       VALUES (?, ?, ?, ?, ?, ?)`
    ).run(trip.id, 'abc123.pdf', 'ticket.pdf', 12345, 'application/pdf', 'Museum ticket');
    const fileId = fileResult.lastInsertRowid as number;

    testDb.prepare(
      'INSERT INTO file_links (file_id, place_id) VALUES (?, ?)'
    ).run(fileId, place.id);

    const data = getPublicTripData(trip.id);
    expect(data).not.toBeNull();

    const p = data!.assignments[day.id][0].place;
    expect(p.files).toHaveLength(1);
    expect(p.files[0].id).toBe(fileId);
    expect(p.files[0].original_name).toBe('ticket.pdf');
    expect(p.files[0].file_size).toBe(12345);
    expect(p.files[0].mime_type).toBe('application/pdf');
    expect(p.files[0].description).toBe('Museum ticket');
    expect(p.files[0].url).toBe(`/api/public/trips/${trip.id}/files/${fileId}`);
  });

  it('PTRSVC-004 — soft-deleted files are excluded from files array', () => {
    const { user } = createUser(testDb);
    const trip = createTrip(testDb, user.id);
    testDb.prepare('UPDATE trips SET is_public = 1 WHERE id = ?').run(trip.id);

    const day = createDay(testDb, trip.id);
    const place = createPlace(testDb, trip.id);
    createDayAssignment(testDb, day.id, place.id);

    const fileResult = testDb.prepare(
      `INSERT INTO trip_files (trip_id, filename, original_name, mime_type, deleted_at)
       VALUES (?, ?, ?, ?, ?)`
    ).run(trip.id, 'deleted.pdf', 'deleted.pdf', 'application/pdf', '2026-01-01T00:00:00Z');
    const fileId = fileResult.lastInsertRowid as number;

    testDb.prepare(
      'INSERT INTO file_links (file_id, place_id) VALUES (?, ?)'
    ).run(fileId, place.id);

    const data = getPublicTripData(trip.id);
    expect(data).not.toBeNull();

    const p = data!.assignments[day.id][0].place;
    expect(p.files).toHaveLength(0);
  });

  it('PTRSVC-005 — multiple files attached to a place all appear', () => {
    const { user } = createUser(testDb);
    const trip = createTrip(testDb, user.id);
    testDb.prepare('UPDATE trips SET is_public = 1 WHERE id = ?').run(trip.id);

    const day = createDay(testDb, trip.id);
    const place = createPlace(testDb, trip.id);
    createDayAssignment(testDb, day.id, place.id);

    for (let i = 1; i <= 3; i++) {
      const r = testDb.prepare(
        `INSERT INTO trip_files (trip_id, filename, original_name, mime_type)
         VALUES (?, ?, ?, ?)`
      ).run(trip.id, `file${i}.pdf`, `doc${i}.pdf`, 'application/pdf');
      testDb.prepare(
        'INSERT INTO file_links (file_id, place_id) VALUES (?, ?)'
      ).run(r.lastInsertRowid, place.id);
    }

    const data = getPublicTripData(trip.id);
    expect(data).not.toBeNull();

    const p = data!.assignments[day.id][0].place;
    expect(p.files).toHaveLength(3);
  });

  it('PTRSVC-006 — place fields default to null when not set', () => {
    const { user } = createUser(testDb);
    const trip = createTrip(testDb, user.id);
    testDb.prepare('UPDATE trips SET is_public = 1 WHERE id = ?').run(trip.id);

    const day = createDay(testDb, trip.id);
    const place = createPlace(testDb, trip.id);
    createDayAssignment(testDb, day.id, place.id);

    const data = getPublicTripData(trip.id);
    const p = data!.assignments[day.id][0].place;

    expect(p.website).toBeNull();
    expect(p.phone).toBeNull();
    expect(p.notes).toBeNull();
    expect(p.currency).toBeNull();
    expect(p.files).toEqual([]);
  });
});

/**
 * LSO-1495 / LSO-1502: places.budget_category integration tests.
 *
 * Companion file to places.test.ts (kept separate to honour the 500-line
 * monolith cap). Covers the negative/edge/auth gaps the LSO-1505 spec called
 * out on top of the happy-path PLACE-024..028 in places.test.ts:
 *
 *  - PLACE-030: POST with unknown budget_category persists value, leaves
 *               unrelated budget_items untouched, creates no phantom rows.
 *  - PLACE-031: unauthenticated POST returns 401 (Rule 16 auth coverage).
 *  - PLACE-032: POST with 0 matching budget_items is a no-op (Rule 16 — N=0).
 *  - PLACE-033: POST with N=3 matching budget_items updates every line in the
 *               category and only that category (Rule 16 — N>1, isolation).
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
  GITHUB_REPO: process.env.GITHUB_REPO || 'mauriceboe/TREK',
}));

import { createApp } from '../../src/app';
import { createTables } from '../../src/db/schema';
import { runMigrations } from '../../src/db/migrations';
import { resetTestDb } from '../helpers/test-db';
import { createUser, createTrip, createBudgetItem } from '../helpers/factories';
import { authCookie } from '../helpers/auth';
import { loginAttempts, mfaAttempts } from '../../src/routes/auth';
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
  invalidatePermissionsCache();
});

afterAll(() => {
  testDb.close();
});

describe('budget_category — negative & auth coverage (LSO-1505)', () => {
  it('PLACE-030 — POST with unknown budget_category persists value and does not affect budget_items', async () => {
    const { user } = createUser(testDb);
    const trip = createTrip(testDb, user.id);
    createBudgetItem(testDb, trip.id, { name: 'Existing', category: 'Food', total_price: 42 });

    const res = await request(app)
      .post(`/api/trips/${trip.id}/places`)
      .set('Cookie', authCookie(user.id))
      .send({ name: 'Mystery Spot', budget_category: 'NonExistentGroup', price: 99 });

    expect(res.status).toBe(201);
    expect(res.body.place.budget_category).toBe('NonExistentGroup');

    // Existing budget_items in unrelated categories must be untouched
    const foodItem = testDb.prepare(
      "SELECT total_price FROM budget_items WHERE trip_id = ? AND category = 'Food'"
    ).get(trip.id) as { total_price: number };
    expect(foodItem.total_price).toBe(42);

    // No phantom rows were created in the unknown category
    const unknownItems = testDb.prepare(
      "SELECT id FROM budget_items WHERE trip_id = ? AND category = 'NonExistentGroup'"
    ).all(trip.id);
    expect(unknownItems).toHaveLength(0);
  });

  it('PLACE-031 — unauthenticated POST with budget_category returns 401 and creates nothing', async () => {
    const { user } = createUser(testDb);
    const trip = createTrip(testDb, user.id);

    const res = await request(app)
      .post(`/api/trips/${trip.id}/places`)
      .send({ name: 'Anon Place', budget_category: 'Activities', price: 50 });

    expect(res.status).toBe(401);
    const created = testDb.prepare('SELECT id FROM places WHERE trip_id = ?').all(trip.id);
    expect(created).toHaveLength(0);
  });

  it('PLACE-032 — POST with budget_category and 0 matching budget_items is a safe no-op', async () => {
    const { user } = createUser(testDb);
    const trip = createTrip(testDb, user.id);
    // Realistic N=0 fixture: no budget_items exist yet. Propagation must not crash.

    const res = await request(app)
      .post(`/api/trips/${trip.id}/places`)
      .set('Cookie', authCookie(user.id))
      .send({ name: 'Empty Group Spot', budget_category: 'Beergarden', price: 80 });

    expect(res.status).toBe(201);
    expect(res.body.place.budget_category).toBe('Beergarden');

    const allItems = testDb.prepare('SELECT id FROM budget_items WHERE trip_id = ?').all(trip.id);
    expect(allItems).toHaveLength(0);
  });

  it('PLACE-033 — POST with budget_category and N=3 matching items updates every item in category, leaves others untouched', async () => {
    const { user } = createUser(testDb);
    const trip = createTrip(testDb, user.id);
    // Realistic N=3 fixture: a Beergarden group with 3 lines (Rule 16: 0, 1, N coverage)
    createBudgetItem(testDb, trip.id, { name: 'Augustiner', category: 'Beergarden', total_price: 0 });
    createBudgetItem(testDb, trip.id, { name: 'Hofbräu', category: 'Beergarden', total_price: 0 });
    createBudgetItem(testDb, trip.id, { name: 'Paulaner', category: 'Beergarden', total_price: 0 });
    // Unrelated item that must NOT change
    createBudgetItem(testDb, trip.id, { name: 'Bus ticket', category: 'Transport', total_price: 15 });

    const res = await request(app)
      .post(`/api/trips/${trip.id}/places`)
      .set('Cookie', authCookie(user.id))
      .send({ name: 'Beer crawl', budget_category: 'Beergarden', price: 33 });

    expect(res.status).toBe(201);
    expect(res.body.place.budget_category).toBe('Beergarden');

    const beerItems = testDb.prepare(
      "SELECT name, total_price FROM budget_items WHERE trip_id = ? AND category = 'Beergarden' ORDER BY name"
    ).all(trip.id) as { name: string; total_price: number }[];
    expect(beerItems).toHaveLength(3);
    beerItems.forEach(item => expect(item.total_price).toBe(33));

    const transport = testDb.prepare(
      "SELECT total_price FROM budget_items WHERE trip_id = ? AND category = 'Transport'"
    ).get(trip.id) as { total_price: number };
    expect(transport.total_price).toBe(15);
  });
});

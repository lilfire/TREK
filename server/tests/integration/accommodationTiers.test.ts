/**
 * Accommodation tier API integration tests (/api/trips/:id/accommodation-tiers).
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
  GITHUB_REPO: process.env.GITHUB_REPO || 'lilfire/TREK',
  USER_AGENT: `TREK Travel Planner (https://github.com/${process.env.GITHUB_REPO || 'lilfire/TREK'})`,
}));

import { createApp } from '../../src/app';
import { createTables } from '../../src/db/schema';
import { runMigrations } from '../../src/db/migrations';
import { resetTestDb } from '../helpers/test-db';
import { createUser, createTrip, addTripMember, createPlace } from '../helpers/factories';
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

const base = (tripId: number) => `/api/trips/${tripId}/accommodation-tiers`;

describe('Accommodation tiers API', () => {
  it('TIER-API-001 — owner creates, updates, lists and deletes tiers', async () => {
    const { user } = createUser(testDb);
    const trip = createTrip(testDb, user.id);
    const place = createPlace(testDb, trip.id, { name: 'Fjellro' });

    const created = await request(app).post(base(trip.id)).set('Cookie', authCookie(user.id))
      .send({ name: 'Cabin', min_participants: 1, place_id: place.id, price_per_person: 900 });
    expect(created.status).toBe(201);
    expect(created.body.tier).toMatchObject({ name: 'Cabin', place_name: 'Fjellro', price_per_person: 900 });
    expect(created.body.status.active_tier_id).toBe(created.body.tier.id);

    const second = await request(app).post(base(trip.id)).set('Cookie', authCookie(user.id))
      .send({ name: 'Hotel', min_participants: 10 });
    expect(second.status).toBe(201);

    const updated = await request(app).put(`${base(trip.id)}/${created.body.tier.id}`).set('Cookie', authCookie(user.id))
      .send({ place_id: null, description: 'Sauna' });
    expect(updated.status).toBe(200);
    expect(updated.body.tier).toMatchObject({ place_id: null, description: 'Sauna', price_per_person: 900 });

    const list = await request(app).get(base(trip.id)).set('Cookie', authCookie(user.id));
    expect(list.status).toBe(200);
    expect(list.body.tiers).toHaveLength(2);
    expect(list.body.next_tier).toMatchObject({ name: 'Hotel', participants_needed: 9 });

    const del = await request(app).delete(`${base(trip.id)}/${second.body.tier.id}`).set('Cookie', authCookie(user.id));
    expect(del.status).toBe(200);
    expect(del.body.status.tiers).toHaveLength(1);
  });

  it('TIER-API-002 — validation errors return 400', async () => {
    const { user } = createUser(testDb);
    const trip = createTrip(testDb, user.id);
    await request(app).post(base(trip.id)).set('Cookie', authCookie(user.id)).send({ name: 'A', min_participants: 5 });

    const dup = await request(app).post(base(trip.id)).set('Cookie', authCookie(user.id)).send({ name: 'B', min_participants: 5 });
    expect(dup.status).toBe(400);
    const bad = await request(app).post(base(trip.id)).set('Cookie', authCookie(user.id)).send({ name: '', min_participants: 0 });
    expect(bad.status).toBe(400);
    const missing = await request(app).put(`${base(trip.id)}/999999`).set('Cookie', authCookie(user.id)).send({ name: 'X' });
    expect(missing.status).toBe(404);
  });

  it('TIER-API-003 — member without trip_edit can read but not write', async () => {
    const { user: owner } = createUser(testDb);
    const { user: member } = createUser(testDb);
    const trip = createTrip(testDb, owner.id);
    addTripMember(testDb, trip.id, member.id);

    const list = await request(app).get(base(trip.id)).set('Cookie', authCookie(member.id));
    expect(list.status).toBe(200);
    const res = await request(app).post(base(trip.id)).set('Cookie', authCookie(member.id)).send({ name: 'A', min_participants: 1 });
    expect(res.status).toBe(403);
  });

  it('TIER-API-004 — non-member gets 404', async () => {
    const { user: owner } = createUser(testDb);
    const { user: stranger } = createUser(testDb);
    const trip = createTrip(testDb, owner.id);
    const res = await request(app).get(base(trip.id)).set('Cookie', authCookie(stranger.id));
    expect(res.status).toBe(404);
  });
});

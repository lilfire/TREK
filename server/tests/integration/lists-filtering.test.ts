/**
 * LSO-1652 — Improved packing/todo lists: server-side filtering,
 * 403 enforcement on hidden items, and checked_by_user_id attribution.
 *
 * Covers both packing and todo lists in one suite because they share the
 * same access-control model (owner sees all, member sees assigned only).
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
    getPlaceWithTags: () => null,
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
import { createUser, createTrip, addTripMember, createPackingItem, createTodoItem } from '../helpers/factories';
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

// ─────────────────────────────────────────────────────────────────────────────
// Packing — owner-vs-member visibility
// ─────────────────────────────────────────────────────────────────────────────

describe('LSO-1652 packing — list filtering by membership role', () => {
  it('owner sees all packing items regardless of category assignment', async () => {
    const { user: owner } = createUser(testDb);
    const trip = createTrip(testDb, owner.id);
    createPackingItem(testDb, trip.id, { name: 'A', category: 'Clothing' });
    createPackingItem(testDb, trip.id, { name: 'B', category: 'Toiletries' });
    createPackingItem(testDb, trip.id, { name: 'C', category: 'Electronics' });

    const res = await request(app)
      .get(`/api/trips/${trip.id}/packing`)
      .set('Cookie', authCookie(owner.id));
    expect(res.status).toBe(200);
    expect(res.body.items).toHaveLength(3);
  });

  it('member with no assignments sees empty list', async () => {
    const { user: owner } = createUser(testDb);
    const { user: member } = createUser(testDb);
    const trip = createTrip(testDb, owner.id);
    addTripMember(testDb, trip.id, member.id);
    createPackingItem(testDb, trip.id, { name: 'Toothbrush', category: 'Toiletries' });
    createPackingItem(testDb, trip.id, { name: 'Shirt', category: 'Clothing' });

    const res = await request(app)
      .get(`/api/trips/${trip.id}/packing`)
      .set('Cookie', authCookie(member.id));
    expect(res.status).toBe(200);
    expect(res.body.items).toHaveLength(0);
  });

  it('member sees only items in categories they are assigned to', async () => {
    const { user: owner } = createUser(testDb);
    const { user: member } = createUser(testDb);
    const trip = createTrip(testDb, owner.id);
    addTripMember(testDb, trip.id, member.id);
    createPackingItem(testDb, trip.id, { name: 'Toothbrush', category: 'Toiletries' });
    createPackingItem(testDb, trip.id, { name: 'Shirt', category: 'Clothing' });
    createPackingItem(testDb, trip.id, { name: 'Camera', category: 'Electronics' });

    // Assign member to only "Clothing"
    await request(app)
      .put(`/api/trips/${trip.id}/packing/category-assignees/Clothing`)
      .set('Cookie', authCookie(owner.id))
      .send({ user_ids: [member.id] });

    const res = await request(app)
      .get(`/api/trips/${trip.id}/packing`)
      .set('Cookie', authCookie(member.id));
    expect(res.status).toBe(200);
    expect(res.body.items).toHaveLength(1);
    expect(res.body.items[0].name).toBe('Shirt');
  });

  it('member sees items whose bag they are a member of', async () => {
    const { user: owner } = createUser(testDb);
    const { user: member } = createUser(testDb);
    const trip = createTrip(testDb, owner.id);
    addTripMember(testDb, trip.id, member.id);

    // Bag with member assigned
    const bagRes = await request(app)
      .post(`/api/trips/${trip.id}/packing/bags`)
      .set('Cookie', authCookie(owner.id))
      .send({ name: 'Member Bag' });
    const bagId = bagRes.body.bag.id;
    await request(app)
      .put(`/api/trips/${trip.id}/packing/bags/${bagId}/members`)
      .set('Cookie', authCookie(owner.id))
      .send({ user_ids: [member.id] });

    // Item in member's bag (but a category they're NOT assigned to)
    testDb.prepare(
      'INSERT INTO packing_items (trip_id, name, category, bag_id, checked) VALUES (?, ?, ?, ?, 0)'
    ).run(trip.id, 'Bagged Item', 'Misc', bagId);

    // Another item NOT in the bag and NOT in member's category
    createPackingItem(testDb, trip.id, { name: 'Hidden', category: 'Misc' });

    const res = await request(app)
      .get(`/api/trips/${trip.id}/packing`)
      .set('Cookie', authCookie(member.id));
    expect(res.status).toBe(200);
    expect(res.body.items).toHaveLength(1);
    expect(res.body.items[0].name).toBe('Bagged Item');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Packing — 403 on hidden items
// ─────────────────────────────────────────────────────────────────────────────

describe('LSO-1652 packing — 403 enforcement on PUT', () => {
  it('member gets 403 when toggling an item in a category they are not assigned to', async () => {
    const { user: owner } = createUser(testDb);
    const { user: member } = createUser(testDb);
    const trip = createTrip(testDb, owner.id);
    addTripMember(testDb, trip.id, member.id);
    const hidden = createPackingItem(testDb, trip.id, { name: 'Hidden', category: 'Toiletries' });

    const res = await request(app)
      .put(`/api/trips/${trip.id}/packing/${hidden.id}`)
      .set('Cookie', authCookie(member.id))
      .send({ checked: true });
    expect(res.status).toBe(403);
  });

  it('member can toggle visible item; owner always can', async () => {
    const { user: owner } = createUser(testDb);
    const { user: member } = createUser(testDb);
    const trip = createTrip(testDb, owner.id);
    addTripMember(testDb, trip.id, member.id);
    const visible = createPackingItem(testDb, trip.id, { name: 'Shirt', category: 'Clothing' });

    await request(app)
      .put(`/api/trips/${trip.id}/packing/category-assignees/Clothing`)
      .set('Cookie', authCookie(owner.id))
      .send({ user_ids: [member.id] });

    const memberRes = await request(app)
      .put(`/api/trips/${trip.id}/packing/${visible.id}`)
      .set('Cookie', authCookie(member.id))
      .send({ checked: true });
    expect(memberRes.status).toBe(200);
    expect(memberRes.body.item.checked).toBe(1);

    const ownerRes = await request(app)
      .put(`/api/trips/${trip.id}/packing/${visible.id}`)
      .set('Cookie', authCookie(owner.id))
      .send({ checked: false });
    expect(ownerRes.status).toBe(200);
    expect(ownerRes.body.item.checked).toBe(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Packing — checked_by attribution
// ─────────────────────────────────────────────────────────────────────────────

describe('LSO-1652 packing — checked_by_user_id attribution', () => {
  it('sets checked_by_user_id to actor on check and clears it on uncheck', async () => {
    const { user: owner } = createUser(testDb);
    const trip = createTrip(testDb, owner.id);
    const item = createPackingItem(testDb, trip.id, { name: 'Passport', category: 'Documents' });

    const checkRes = await request(app)
      .put(`/api/trips/${trip.id}/packing/${item.id}`)
      .set('Cookie', authCookie(owner.id))
      .send({ checked: true });
    expect(checkRes.status).toBe(200);
    expect(checkRes.body.item.checked).toBe(1);
    expect(checkRes.body.item.checked_by_user_id).toBe(owner.id);
    expect(checkRes.body.item.checked_by_username).toBe(owner.username);

    const uncheckRes = await request(app)
      .put(`/api/trips/${trip.id}/packing/${item.id}`)
      .set('Cookie', authCookie(owner.id))
      .send({ checked: false });
    expect(uncheckRes.status).toBe(200);
    expect(uncheckRes.body.item.checked).toBe(0);
    expect(uncheckRes.body.item.checked_by_user_id).toBeNull();
    expect(uncheckRes.body.item.checked_by_username).toBeNull();
  });

  it('GET returns checked_by_username and avatar URL for the checker', async () => {
    const { user: owner } = createUser(testDb);
    const trip = createTrip(testDb, owner.id);
    const item = createPackingItem(testDb, trip.id, { name: 'Sunglasses', category: 'Misc' });

    // Set an avatar so we can verify URL formatting
    testDb.prepare('UPDATE users SET avatar = ? WHERE id = ?').run('owner.jpg', owner.id);

    await request(app)
      .put(`/api/trips/${trip.id}/packing/${item.id}`)
      .set('Cookie', authCookie(owner.id))
      .send({ checked: true });

    const list = await request(app)
      .get(`/api/trips/${trip.id}/packing`)
      .set('Cookie', authCookie(owner.id));
    expect(list.status).toBe(200);
    const found = list.body.items.find((x: any) => x.id === item.id);
    expect(found.checked_by_user_id).toBe(owner.id);
    expect(found.checked_by_username).toBe(owner.username);
    expect(found.checked_by_avatar).toBe('/uploads/avatars/owner.jpg');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Todo — owner-vs-member visibility
// ─────────────────────────────────────────────────────────────────────────────

describe('LSO-1652 todo — list filtering by membership role', () => {
  it('owner sees all todo items', async () => {
    const { user: owner } = createUser(testDb);
    const trip = createTrip(testDb, owner.id);
    createTodoItem(testDb, trip.id, { name: 'Book hotel', category: 'Prep' });
    createTodoItem(testDb, trip.id, { name: 'Print tickets', category: 'Logistics' });

    const res = await request(app)
      .get(`/api/trips/${trip.id}/todo`)
      .set('Cookie', authCookie(owner.id));
    expect(res.status).toBe(200);
    expect(res.body.items).toHaveLength(2);
  });

  it('member with no assignments sees empty todo list', async () => {
    const { user: owner } = createUser(testDb);
    const { user: member } = createUser(testDb);
    const trip = createTrip(testDb, owner.id);
    addTripMember(testDb, trip.id, member.id);
    createTodoItem(testDb, trip.id, { name: 'Book hotel', category: 'Prep' });

    const res = await request(app)
      .get(`/api/trips/${trip.id}/todo`)
      .set('Cookie', authCookie(member.id));
    expect(res.status).toBe(200);
    expect(res.body.items).toHaveLength(0);
  });

  it('member sees items in categories they are assigned to', async () => {
    const { user: owner } = createUser(testDb);
    const { user: member } = createUser(testDb);
    const trip = createTrip(testDb, owner.id);
    addTripMember(testDb, trip.id, member.id);
    createTodoItem(testDb, trip.id, { name: 'Book hotel', category: 'Prep' });
    createTodoItem(testDb, trip.id, { name: 'Pack', category: 'Logistics' });

    await request(app)
      .put(`/api/trips/${trip.id}/todo/category-assignees/Prep`)
      .set('Cookie', authCookie(owner.id))
      .send({ user_ids: [member.id] });

    const res = await request(app)
      .get(`/api/trips/${trip.id}/todo`)
      .set('Cookie', authCookie(member.id));
    expect(res.status).toBe(200);
    expect(res.body.items).toHaveLength(1);
    expect(res.body.items[0].name).toBe('Book hotel');
  });

  it('member sees items directly assigned to them even outside their categories', async () => {
    const { user: owner } = createUser(testDb);
    const { user: member } = createUser(testDb);
    const trip = createTrip(testDb, owner.id);
    addTripMember(testDb, trip.id, member.id);

    testDb.prepare(
      'INSERT INTO todo_items (trip_id, name, category, assigned_user_id, checked, sort_order) VALUES (?, ?, ?, ?, 0, 0)'
    ).run(trip.id, 'Personal item', 'Logistics', member.id);

    const res = await request(app)
      .get(`/api/trips/${trip.id}/todo`)
      .set('Cookie', authCookie(member.id));
    expect(res.status).toBe(200);
    expect(res.body.items).toHaveLength(1);
    expect(res.body.items[0].name).toBe('Personal item');
  });

  it('member sees all items in a category if they are assigned to any item in that category', async () => {
    const { user: owner } = createUser(testDb);
    const { user: member } = createUser(testDb);
    const trip = createTrip(testDb, owner.id);
    addTripMember(testDb, trip.id, member.id);

    // member is assigned to one item in "Prep"
    testDb.prepare(
      'INSERT INTO todo_items (trip_id, name, category, assigned_user_id, checked, sort_order) VALUES (?, ?, ?, ?, 0, 0)'
    ).run(trip.id, 'My prep task', 'Prep', member.id);

    // other items in "Prep" — visible to member because they are assigned in this category
    createTodoItem(testDb, trip.id, { name: 'Sibling prep', category: 'Prep' });

    // unrelated category — hidden
    createTodoItem(testDb, trip.id, { name: 'Hidden', category: 'Logistics' });

    const res = await request(app)
      .get(`/api/trips/${trip.id}/todo`)
      .set('Cookie', authCookie(member.id));
    expect(res.status).toBe(200);
    const names = res.body.items.map((x: any) => x.name).sort();
    expect(names).toEqual(['My prep task', 'Sibling prep']);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Todo — 403 enforcement
// ─────────────────────────────────────────────────────────────────────────────

describe('LSO-1652 todo — 403 enforcement on PUT', () => {
  it('member gets 403 when toggling a hidden todo item', async () => {
    const { user: owner } = createUser(testDb);
    const { user: member } = createUser(testDb);
    const trip = createTrip(testDb, owner.id);
    addTripMember(testDb, trip.id, member.id);
    const hidden = createTodoItem(testDb, trip.id, { name: 'Owner-only', category: 'Logistics' });

    const res = await request(app)
      .put(`/api/trips/${trip.id}/todo/${hidden.id}`)
      .set('Cookie', authCookie(member.id))
      .send({ checked: 1 });
    expect(res.status).toBe(403);
  });

  it('member with category assignment can toggle visible todo', async () => {
    const { user: owner } = createUser(testDb);
    const { user: member } = createUser(testDb);
    const trip = createTrip(testDb, owner.id);
    addTripMember(testDb, trip.id, member.id);
    const visible = createTodoItem(testDb, trip.id, { name: 'Prep task', category: 'Prep' });

    await request(app)
      .put(`/api/trips/${trip.id}/todo/category-assignees/Prep`)
      .set('Cookie', authCookie(owner.id))
      .send({ user_ids: [member.id] });

    const res = await request(app)
      .put(`/api/trips/${trip.id}/todo/${visible.id}`)
      .set('Cookie', authCookie(member.id))
      .send({ checked: 1 });
    expect(res.status).toBe(200);
    expect(res.body.item.checked).toBe(1);
    expect(res.body.item.checked_by_user_id).toBe(member.id);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Todo — checked_by attribution
// ─────────────────────────────────────────────────────────────────────────────

describe('LSO-1652 todo — checked_by_user_id attribution', () => {
  it('attribution is set on check, cleared on uncheck, and includes username on GET', async () => {
    const { user: owner } = createUser(testDb);
    const trip = createTrip(testDb, owner.id);
    const item = createTodoItem(testDb, trip.id, { name: 'Book taxi', category: 'Logistics' });

    const checkRes = await request(app)
      .put(`/api/trips/${trip.id}/todo/${item.id}`)
      .set('Cookie', authCookie(owner.id))
      .send({ checked: 1 });
    expect(checkRes.status).toBe(200);
    expect(checkRes.body.item.checked_by_user_id).toBe(owner.id);
    expect(checkRes.body.item.checked_by_username).toBe(owner.username);

    const list = await request(app)
      .get(`/api/trips/${trip.id}/todo`)
      .set('Cookie', authCookie(owner.id));
    const found = list.body.items.find((x: any) => x.id === item.id);
    expect(found.checked_by_user_id).toBe(owner.id);
    expect(found.checked_by_username).toBe(owner.username);

    const uncheckRes = await request(app)
      .put(`/api/trips/${trip.id}/todo/${item.id}`)
      .set('Cookie', authCookie(owner.id))
      .send({ checked: 0 });
    expect(uncheckRes.status).toBe(200);
    expect(uncheckRes.body.item.checked_by_user_id).toBeNull();
  });
});

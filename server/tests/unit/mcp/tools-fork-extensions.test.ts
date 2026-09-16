/**
 * Unit tests for MCP parity with fork-specific features:
 * trip fee/RSVP/visibility fields, list_public_trips, list_trip_rsvps,
 * budget category currency tools, place budget_category, and
 * packing/to-do item-level access + packing_check permission.
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
    getPlaceWithTags: (placeId: number) => db.prepare('SELECT * FROM places WHERE id = ?').get(placeId),
    canAccessTrip: (tripId: any, userId: number) =>
      db.prepare(`SELECT t.id, t.user_id FROM trips t LEFT JOIN trip_members m ON m.trip_id = t.id AND m.user_id = ? WHERE t.id = ? AND (t.user_id = ? OR m.user_id IS NOT NULL)`).get(userId, tripId, userId),
    isOwner: (tripId: any, userId: number) =>
      !!db.prepare('SELECT id FROM trips WHERE id = ? AND user_id = ?').get(tripId, userId),
  };
  return { testDb: db, dbMock: mock };
});

vi.mock('../../../src/db/database', () => dbMock);
vi.mock('../../../src/config', () => ({
  JWT_SECRET: 'test-jwt-secret-for-trek-testing-only',
  ENCRYPTION_KEY: 'a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6a7b8c9d0e1f2a3b4c5d6a7b8c9d0e1f2',
  updateJwtSecret: () => {},
  GITHUB_REPO: 'lilfire/TREK',
  USER_AGENT: `TREK Travel Planner (https://github.com/${'lilfire/TREK'})`,
}));

const { broadcastMock } = vi.hoisted(() => ({ broadcastMock: vi.fn() }));
vi.mock('../../../src/websocket', () => ({ broadcast: broadcastMock }));

const { safeFetchMock } = vi.hoisted(() => ({ safeFetchMock: vi.fn() }));
vi.mock('../../../src/utils/ssrfGuard', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../src/utils/ssrfGuard')>();
  return { ...actual, safeFetch: safeFetchMock };
});

import { createTables } from '../../../src/db/schema';
import { runMigrations } from '../../../src/db/migrations';
import { resetTestDb } from '../../helpers/test-db';
import {
  createUser, createAdmin, createTrip, addTripMember, createPlace,
  createBudgetItem, createPackingItem, createTodoItem,
} from '../../helpers/factories';
import { createMcpHarness, parseToolResult, type McpHarness } from '../../helpers/mcp-harness';
import { invalidatePermissionsCache } from '../../../src/services/permissions';

beforeAll(() => {
  createTables(testDb);
  runMigrations(testDb);
});

beforeEach(() => {
  resetTestDb(testDb);
  testDb.prepare("DELETE FROM app_settings WHERE key LIKE 'perm_%'").run();
  invalidatePermissionsCache();
  broadcastMock.mockClear();
  delete process.env.DEMO_MODE;
});

afterAll(() => {
  testDb.close();
});

async function withHarness(userId: number, fn: (h: McpHarness) => Promise<void>) {
  const h = await createMcpHarness({ userId, withResources: false });
  try { await fn(h); } finally { await h.cleanup(); }
}

function setPerm(key: string, level: string) {
  testDb.prepare('INSERT OR REPLACE INTO app_settings (key, value) VALUES (?, ?)').run(`perm_${key}`, level);
  invalidatePermissionsCache();
}

function textOf(result: any): string {
  return result.content[0].text as string;
}

// ---------------------------------------------------------------------------
// create_trip / update_trip — fork fields
// ---------------------------------------------------------------------------

describe('Tool: create_trip (fork fields)', () => {
  it('creates a public trip with country, fee and RSVP deadline in one call', async () => {
    const { user } = createUser(testDb);
    await withHarness(user.id, async (h) => {
      const result = await h.client.callTool({
        name: 'create_trip',
        arguments: {
          title: 'Bruges Beer Festival', start_date: '2027-09-10', end_date: '2027-09-13', currency: 'EUR',
          country: 'BE', is_public: true, registration_fee: 25, fee_mode: 'rsvp', fee_currency: 'EUR',
          rsvp_deadline: '2027-08-31',
        },
      });
      const { trip } = parseToolResult(result) as any;
      expect(trip.country).toBe('BE');
      expect(trip.is_public).toBe(1);
      expect(trip.registration_fee).toBe(25);
      expect(trip.fee_mode).toBe('rsvp');
      expect(trip.fee_currency).toBe('EUR');
      expect(trip.rsvp_deadline).toBe('2027-08-31');
      const days = testDb.prepare('SELECT COUNT(*) as c FROM days WHERE trip_id = ?').get(trip.id) as { c: number };
      expect(days.c).toBe(4);
    });
  });

  it('does not create a trip when a fork field is invalid', async () => {
    const { user } = createUser(testDb);
    await withHarness(user.id, async (h) => {
      const result = await h.client.callTool({
        name: 'create_trip',
        arguments: { title: 'Bad fee', registration_fee: 10, fee_mode: 'deadline', fee_deadline: '2027-02-30x' },
      });
      expect(result.isError).toBe(true);
      const count = testDb.prepare('SELECT COUNT(*) as c FROM trips').get() as { c: number };
      expect(count.c).toBe(0);
    });
  });
});

describe('Tool: update_trip (fork fields)', () => {
  it('updates fee fields without touching fields that were omitted', async () => {
    const { user } = createUser(testDb);
    const trip = createTrip(testDb, user.id);
    testDb.prepare("UPDATE trips SET registration_fee = 50, fee_mode = 'deadline', fee_deadline = '2027-01-01', fee_currency = 'NOK', country = 'NO' WHERE id = ?").run(trip.id);
    await withHarness(user.id, async (h) => {
      const result = await h.client.callTool({
        name: 'update_trip',
        arguments: { tripId: trip.id, rsvp_deadline: '2026-12-15' },
      });
      const { trip: updated } = parseToolResult(result) as any;
      expect(updated.rsvp_deadline).toBe('2026-12-15');
      expect(updated.registration_fee).toBe(50);
      expect(updated.fee_mode).toBe('deadline');
      expect(updated.fee_deadline).toBe('2027-01-01');
      expect(updated.fee_currency).toBe('NOK');
      expect(updated.country).toBe('NO');
    });
  });

  it('clears fee mode, deadline and currency when the fee is removed', async () => {
    const { user } = createUser(testDb);
    const trip = createTrip(testDb, user.id);
    testDb.prepare("UPDATE trips SET registration_fee = 50, fee_mode = 'deadline', fee_deadline = '2027-01-01', fee_currency = 'NOK' WHERE id = ?").run(trip.id);
    await withHarness(user.id, async (h) => {
      const result = await h.client.callTool({ name: 'update_trip', arguments: { tripId: trip.id, registration_fee: null } });
      const { trip: updated } = parseToolResult(result) as any;
      expect(updated.registration_fee).toBeNull();
      expect(updated.fee_mode).toBeNull();
      expect(updated.fee_deadline).toBeNull();
      expect(updated.fee_currency).toBeNull();
    });
  });

  it('rejects a lowercase fee_currency via schema validation', async () => {
    const { user } = createUser(testDb);
    const trip = createTrip(testDb, user.id);
    await withHarness(user.id, async (h) => {
      const result = await h.client.callTool({ name: 'update_trip', arguments: { tripId: trip.id, fee_currency: 'eur' } });
      expect(result.isError).toBe(true);
    });
  });

  it('lets the owner publish the trip and broadcasts trip:updated', async () => {
    const { user } = createUser(testDb);
    const trip = createTrip(testDb, user.id);
    await withHarness(user.id, async (h) => {
      const result = await h.client.callTool({ name: 'update_trip', arguments: { tripId: trip.id, is_public: true } });
      const { trip: updated } = parseToolResult(result) as any;
      expect(updated.is_public).toBe(1);
      expect(broadcastMock).toHaveBeenCalledWith(trip.id, 'trip:updated', expect.any(Object));
    });
  });

  it('blocks a member from changing visibility', async () => {
    const { user: owner } = createUser(testDb);
    const { user: member } = createUser(testDb);
    const trip = createTrip(testDb, owner.id);
    addTripMember(testDb, trip.id, member.id);
    await withHarness(member.id, async (h) => {
      const result = await h.client.callTool({ name: 'update_trip', arguments: { tripId: trip.id, is_public: true } });
      expect(result.isError).toBe(true);
      expect(textOf(result)).toContain('Only the trip owner');
      const row = testDb.prepare('SELECT is_public FROM trips WHERE id = ?').get(trip.id) as { is_public: number };
      expect(row.is_public).toBe(0);
    });
  });
});

// ---------------------------------------------------------------------------
// list_public_trips / list_trip_rsvps
// ---------------------------------------------------------------------------

describe('Tool: list_public_trips', () => {
  it('lists only public trips with a public URL', async () => {
    const { user } = createUser(testDb);
    const { user: other } = createUser(testDb);
    const pub = createTrip(testDb, other.id, { title: 'Public one' });
    createTrip(testDb, other.id, { title: 'Private one' });
    testDb.prepare('UPDATE trips SET is_public = 1 WHERE id = ?').run(pub.id);
    await withHarness(user.id, async (h) => {
      const { trips } = parseToolResult(await h.client.callTool({ name: 'list_public_trips', arguments: {} })) as any;
      expect(trips).toHaveLength(1);
      expect(trips[0].name).toBe('Public one');
      expect(trips[0].public_url).toMatch(new RegExp(`/public/trips/${pub.id}$`));
    });
  });
});

describe('Tool: list_trip_rsvps', () => {
  function seedRsvp(tripId: number, userId: number, name: string) {
    const r = testDb.prepare('INSERT INTO trip_rsvps (trip_id, user_id, name, email) VALUES (?, ?, ?, ?)')
      .run(tripId, userId, name, `${name.toLowerCase()}@example.com`);
    return Number(r.lastInsertRowid);
  }

  it('returns RSVPs with the latest payment status for the owner', async () => {
    const { user: owner } = createUser(testDb);
    const { user: guestA } = createUser(testDb);
    const { user: guestB } = createUser(testDb);
    const trip = createTrip(testDb, owner.id);
    const rsvpA = seedRsvp(trip.id, guestA.id, 'Anna');
    seedRsvp(trip.id, guestB.id, 'Bo');
    const insertPayment = testDb.prepare('INSERT INTO trip_rsvp_payments (rsvp_id, amount, currency, status, provider_order_id) VALUES (?, ?, ?, ?, ?)');
    insertPayment.run(rsvpA, 25, 'EUR', 'failed', 'ORDER-1');
    insertPayment.run(rsvpA, 25, 'EUR', 'completed', 'ORDER-2');

    await withHarness(owner.id, async (h) => {
      const data = parseToolResult(await h.client.callTool({ name: 'list_trip_rsvps', arguments: { tripId: trip.id } })) as any;
      expect(data.count).toBe(2);
      const anna = data.rsvps.find((r: any) => r.name === 'Anna');
      const bo = data.rsvps.find((r: any) => r.name === 'Bo');
      expect(anna.payment).toMatchObject({ amount: 25, currency: 'EUR', status: 'completed' });
      expect(anna.payment.provider_order_id).toBeUndefined();
      expect(bo.payment).toBeNull();
    });
  });

  it('denies a non-owner member', async () => {
    const { user: owner } = createUser(testDb);
    const { user: member } = createUser(testDb);
    const trip = createTrip(testDb, owner.id);
    addTripMember(testDb, trip.id, member.id);
    await withHarness(member.id, async (h) => {
      const result = await h.client.callTool({ name: 'list_trip_rsvps', arguments: { tripId: trip.id } });
      expect(result.isError).toBe(true);
      expect(textOf(result)).toContain('Only the trip owner');
    });
  });
});

// ---------------------------------------------------------------------------
// Accommodation tiers
// ---------------------------------------------------------------------------

describe('Tools: accommodation tiers', () => {
  it('owner can create, update, list and delete tiers', async () => {
    const { user: owner } = createUser(testDb);
    const { user: guest } = createUser(testDb);
    const trip = createTrip(testDb, owner.id);
    const place = createPlace(testDb, trip.id, { name: 'Fjellro' });
    testDb.prepare('INSERT INTO trip_rsvps (trip_id, user_id, name, email) VALUES (?, ?, ?, ?)').run(trip.id, guest.id, 'Guest', 'g@example.com');

    await withHarness(owner.id, async (h) => {
      const created = parseToolResult(await h.client.callTool({
        name: 'create_accommodation_tier',
        arguments: { tripId: trip.id, name: 'Cabin', min_participants: 2, place_id: place.id, price_per_person: 500 },
      })) as any;
      expect(created.tier).toMatchObject({ name: 'Cabin', min_participants: 2, place_name: 'Fjellro' });
      expect(created.status.active_tier_id).toBe(created.tier.id);

      const second = parseToolResult(await h.client.callTool({
        name: 'create_accommodation_tier',
        arguments: { tripId: trip.id, name: 'Hotel', min_participants: 10 },
      })) as any;

      const dup = await h.client.callTool({
        name: 'update_accommodation_tier',
        arguments: { tripId: trip.id, tierId: second.tier.id, min_participants: 2 },
      });
      expect(dup.isError).toBe(true);

      const updated = parseToolResult(await h.client.callTool({
        name: 'update_accommodation_tier',
        arguments: { tripId: trip.id, tierId: created.tier.id, place_id: null },
      })) as any;
      expect(updated.tier.place_id).toBeNull();

      const status = parseToolResult(await h.client.callTool({ name: 'list_accommodation_tiers', arguments: { tripId: trip.id } })) as any;
      expect(status.participant_count).toBe(2);
      expect(status.tiers).toHaveLength(2);
      expect(status.next_tier).toMatchObject({ id: second.tier.id, participants_needed: 8 });

      const deleted = parseToolResult(await h.client.callTool({
        name: 'delete_accommodation_tier', arguments: { tripId: trip.id, tierId: second.tier.id },
      })) as any;
      expect(deleted.status.tiers).toHaveLength(1);
    });
  });

  it('member without trip_edit can list but not create', async () => {
    const { user: owner } = createUser(testDb);
    const { user: member } = createUser(testDb);
    const trip = createTrip(testDb, owner.id);
    addTripMember(testDb, trip.id, member.id);
    await withHarness(member.id, async (h) => {
      const list = await h.client.callTool({ name: 'list_accommodation_tiers', arguments: { tripId: trip.id } });
      expect(list.isError).toBeFalsy();
      const result = await h.client.callTool({
        name: 'create_accommodation_tier', arguments: { tripId: trip.id, name: 'Cabin', min_participants: 1 },
      });
      expect(result.isError).toBe(true);
      expect(testDb.prepare('SELECT COUNT(*) AS n FROM trip_accommodation_tiers').get().n).toBe(0);
    });
  });

  it('non-member gets no access', async () => {
    const { user: owner } = createUser(testDb);
    const { user: stranger } = createUser(testDb);
    const trip = createTrip(testDb, owner.id);
    await withHarness(stranger.id, async (h) => {
      const result = await h.client.callTool({ name: 'list_accommodation_tiers', arguments: { tripId: trip.id } });
      expect(result.isError).toBe(true);
    });
  });
});

// ---------------------------------------------------------------------------
// Budget category currency
// ---------------------------------------------------------------------------

describe('Tools: list_budget_categories / set_budget_category_currency', () => {
  it('sets a category currency and lists categories with effective currency and subtotal', async () => {
    const { user } = createUser(testDb);
    const trip = createTrip(testDb, user.id);
    testDb.prepare("UPDATE trips SET currency = 'NOK' WHERE id = ?").run(trip.id);
    createBudgetItem(testDb, trip.id, { name: 'Tickets', category: 'Festival', total_price: 40 });
    createBudgetItem(testDb, trip.id, { name: 'Beer tokens', category: 'Festival', total_price: 30 });
    createBudgetItem(testDb, trip.id, { name: 'Ferry', category: 'Transport', total_price: 900 });

    await withHarness(user.id, async (h) => {
      const set = await h.client.callTool({
        name: 'set_budget_category_currency',
        arguments: { tripId: trip.id, category: 'Festival', currency: 'EUR' },
      });
      expect(set.isError).toBeFalsy();
      expect(broadcastMock).toHaveBeenCalledWith(trip.id, 'budget:category-currency-updated', expect.objectContaining({ category: 'Festival', currency: 'EUR' }));

      const data = parseToolResult(await h.client.callTool({ name: 'list_budget_categories', arguments: { tripId: trip.id } })) as any;
      expect(data.trip_currency).toBe('NOK');
      const festival = data.categories.find((c: any) => c.category === 'Festival');
      const transport = data.categories.find((c: any) => c.category === 'Transport');
      expect(festival).toMatchObject({ currency: 'EUR', effective_currency: 'EUR', item_count: 2, total: 70 });
      expect(transport).toMatchObject({ currency: null, effective_currency: 'NOK', item_count: 1, total: 900 });
    });
  });

  it('respects budget_edit permission', async () => {
    setPerm('budget_edit', 'trip_owner');
    const { user: owner } = createUser(testDb);
    const { user: member } = createUser(testDb);
    const trip = createTrip(testDb, owner.id);
    addTripMember(testDb, trip.id, member.id);
    await withHarness(member.id, async (h) => {
      const result = await h.client.callTool({
        name: 'set_budget_category_currency',
        arguments: { tripId: trip.id, category: 'Food', currency: 'EUR' },
      });
      expect(result.isError).toBe(true);
    });
  });
});

// ---------------------------------------------------------------------------
// Place budget_category
// ---------------------------------------------------------------------------

describe('Tools: place budget_category', () => {
  it('create_place stores budget_category and update_place can clear it', async () => {
    const { user } = createUser(testDb);
    const trip = createTrip(testDb, user.id);
    await withHarness(user.id, async (h) => {
      const created = parseToolResult(await h.client.callTool({
        name: 'create_place',
        arguments: { tripId: trip.id, name: 'Beurshalle', budget_category: 'Festival' },
      })) as any;
      expect(created.place.budget_category).toBe('Festival');

      const updated = parseToolResult(await h.client.callTool({
        name: 'update_place',
        arguments: { tripId: trip.id, placeId: created.place.id, budget_category: null },
      })) as any;
      expect(updated.place.budget_category).toBeNull();
    });
  });

  it('update_place leaves budget_category untouched when omitted', async () => {
    const { user } = createUser(testDb);
    const trip = createTrip(testDb, user.id);
    const place = createPlace(testDb, trip.id, { name: 'Brewery' });
    testDb.prepare("UPDATE places SET budget_category = 'Food' WHERE id = ?").run(place.id);
    await withHarness(user.id, async (h) => {
      const updated = parseToolResult(await h.client.callTool({
        name: 'update_place',
        arguments: { tripId: trip.id, placeId: place.id, name: 'De Halve Maan' },
      })) as any;
      expect(updated.place.budget_category).toBe('Food');
    });
  });
});

// ---------------------------------------------------------------------------
// Packing / to-do item-level access
// ---------------------------------------------------------------------------

describe('Packing tools: item access and packing_check', () => {
  function hideCategoryFromMember(tripId: number, category: string, ownerId: number) {
    testDb.prepare('INSERT INTO packing_category_assignees (trip_id, category_name, user_id) VALUES (?, ?, ?)').run(tripId, category, ownerId);
  }

  it('denies toggling an item in a category assigned to someone else', async () => {
    const { user: owner } = createUser(testDb);
    const { user: member } = createUser(testDb);
    const trip = createTrip(testDb, owner.id);
    addTripMember(testDb, trip.id, member.id);
    const item = createPackingItem(testDb, trip.id, { name: 'Camera', category: 'Electronics' });
    hideCategoryFromMember(trip.id, 'Electronics', owner.id);
    await withHarness(member.id, async (h) => {
      const result = await h.client.callTool({ name: 'toggle_packing_item', arguments: { tripId: trip.id, itemId: item.id, checked: true } });
      expect(result.isError).toBe(true);
      expect(textOf(result)).toContain('No permission for this item');
      const row = testDb.prepare('SELECT checked FROM packing_items WHERE id = ?').get(item.id) as { checked: number };
      expect(row.checked).toBe(0);
    });
  });

  it('still reports not found for a missing item', async () => {
    const { user: owner } = createUser(testDb);
    const { user: member } = createUser(testDb);
    const trip = createTrip(testDb, owner.id);
    addTripMember(testDb, trip.id, member.id);
    await withHarness(member.id, async (h) => {
      const result = await h.client.callTool({ name: 'update_packing_item', arguments: { tripId: trip.id, itemId: 99999, name: 'X' } });
      expect(result.isError).toBe(true);
      expect(textOf(result)).toContain('not found');
    });
  });

  it('lets a member toggle but not rename when packing_edit is locked to the owner', async () => {
    setPerm('packing_edit', 'trip_owner');
    const { user: owner } = createUser(testDb);
    const { user: member } = createUser(testDb);
    const trip = createTrip(testDb, owner.id);
    addTripMember(testDb, trip.id, member.id);
    const item = createPackingItem(testDb, trip.id, { name: 'Socks', category: 'Clothing' });
    await withHarness(member.id, async (h) => {
      const toggled = parseToolResult(await h.client.callTool({ name: 'toggle_packing_item', arguments: { tripId: trip.id, itemId: item.id, checked: true } })) as any;
      expect(toggled.item.checked).toBe(1);
      expect(toggled.item.checked_by_user_id).toBe(member.id);

      const renamed = await h.client.callTool({ name: 'update_packing_item', arguments: { tripId: trip.id, itemId: item.id, name: 'Wool socks' } });
      expect(renamed.isError).toBe(true);
    });
  });

  it('lets an admin member bypass a locked packing_check level', async () => {
    setPerm('packing_check', 'trip_owner');
    const { user: owner } = createUser(testDb);
    const { user: admin } = createAdmin(testDb);
    const trip = createTrip(testDb, owner.id);
    addTripMember(testDb, trip.id, admin.id);
    const item = createPackingItem(testDb, trip.id);
    await withHarness(admin.id, async (h) => {
      const result = await h.client.callTool({ name: 'toggle_packing_item', arguments: { tripId: trip.id, itemId: item.id, checked: true } });
      expect(result.isError).toBeFalsy();
    });
  });
});

describe('To-do tools: item access', () => {
  it('denies a member updating a to-do in a category assigned to someone else', async () => {
    const { user: owner } = createUser(testDb);
    const { user: member } = createUser(testDb);
    const trip = createTrip(testDb, owner.id);
    addTripMember(testDb, trip.id, member.id);
    const item = createTodoItem(testDb, trip.id, { name: 'Book tickets', category: 'Admin' });
    testDb.prepare('INSERT INTO todo_category_assignees (trip_id, category_name, user_id) VALUES (?, ?, ?)').run(trip.id, 'Admin', owner.id);
    await withHarness(member.id, async (h) => {
      const toggle = await h.client.callTool({ name: 'toggle_todo', arguments: { tripId: trip.id, itemId: item.id, checked: true } });
      expect(toggle.isError).toBe(true);
      const update = await h.client.callTool({ name: 'update_todo', arguments: { tripId: trip.id, itemId: item.id, name: 'Hijacked' } });
      expect(update.isError).toBe(true);
      const row = testDb.prepare('SELECT name, checked FROM todo_items WHERE id = ?').get(item.id) as { name: string; checked: number };
      expect(row).toEqual({ name: 'Book tickets', checked: 0 });
    });
  });

  it('denies to-do edits when packing_edit is locked to the owner', async () => {
    setPerm('packing_edit', 'trip_owner');
    const { user: owner } = createUser(testDb);
    const { user: member } = createUser(testDb);
    const trip = createTrip(testDb, owner.id);
    addTripMember(testDb, trip.id, member.id);
    const item = createTodoItem(testDb, trip.id, { name: 'Pack' });
    await withHarness(member.id, async (h) => {
      const result = await h.client.callTool({ name: 'toggle_todo', arguments: { tripId: trip.id, itemId: item.id, checked: true } });
      expect(result.isError).toBe(true);
    });
  });
});

// ---------------------------------------------------------------------------
// set_trip_cover
// ---------------------------------------------------------------------------

describe('Tool: set_trip_cover', () => {
  const fs = require('fs') as typeof import('fs');
  const path = require('path') as typeof import('path');
  const PNG_BYTES = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]);

  function coverFile(coverUrl: string) {
    return path.join(__dirname, '../../../', coverUrl.replace(/^\//, ''));
  }

  beforeEach(() => safeFetchMock.mockReset());

  it('downloads the image, stores it as the cover and broadcasts trip:updated', async () => {
    const { user } = createUser(testDb);
    const trip = createTrip(testDb, user.id);
    safeFetchMock.mockResolvedValueOnce(new Response(PNG_BYTES, { status: 200, headers: { 'content-type': 'image/png' } }));
    await withHarness(user.id, async (h) => {
      const data = parseToolResult(await h.client.callTool({
        name: 'set_trip_cover',
        arguments: { tripId: trip.id, image_url: 'https://upload.example.org/bruges.png' },
      })) as any;
      try {
        expect(data.cover_image).toMatch(/^\/uploads\/covers\/[0-9a-f-]+\.png$/);
        expect(data.trip.cover_image).toBe(data.cover_image);
        expect(fs.readFileSync(coverFile(data.cover_image)).equals(PNG_BYTES)).toBe(true);
        expect(broadcastMock).toHaveBeenCalledWith(trip.id, 'trip:updated', expect.any(Object));
      } finally {
        fs.rmSync(coverFile(data.cover_image), { force: true });
      }
    });
  });

  it('follows a redirect through safeFetch again', async () => {
    const { user } = createUser(testDb);
    const trip = createTrip(testDb, user.id);
    safeFetchMock
      .mockResolvedValueOnce(new Response(null, { status: 302, headers: { location: 'https://cdn.example.org/real.png' } }))
      .mockResolvedValueOnce(new Response(PNG_BYTES, { status: 200 }));
    await withHarness(user.id, async (h) => {
      const data = parseToolResult(await h.client.callTool({
        name: 'set_trip_cover',
        arguments: { tripId: trip.id, image_url: 'https://example.org/file/bruges' },
      })) as any;
      fs.rmSync(coverFile(data.cover_image), { force: true });
      expect(safeFetchMock).toHaveBeenCalledTimes(2);
      expect(safeFetchMock.mock.calls[1][0]).toBe('https://cdn.example.org/real.png');
    });
  });

  it('rejects content that is not an allowed image type', async () => {
    const { user } = createUser(testDb);
    const trip = createTrip(testDb, user.id);
    safeFetchMock.mockResolvedValueOnce(new Response('<svg xmlns="http://www.w3.org/2000/svg"/>', { status: 200, headers: { 'content-type': 'image/svg+xml' } }));
    await withHarness(user.id, async (h) => {
      const result = await h.client.callTool({ name: 'set_trip_cover', arguments: { tripId: trip.id, image_url: 'https://example.org/x.svg' } });
      expect(result.isError).toBe(true);
      expect(textOf(result)).toContain('Only jpg, png, gif, webp');
      const row = testDb.prepare('SELECT cover_image FROM trips WHERE id = ?').get(trip.id) as { cover_image: string | null };
      expect(row.cover_image).toBeNull();
    });
  });

  it('surfaces SSRF-blocked URLs as a tool error', async () => {
    const { SsrfBlockedError } = await import('../../../src/utils/ssrfGuard');
    const { user } = createUser(testDb);
    const trip = createTrip(testDb, user.id);
    safeFetchMock.mockRejectedValueOnce(new SsrfBlockedError('Requests to loopback and link-local addresses are not allowed'));
    await withHarness(user.id, async (h) => {
      const result = await h.client.callTool({ name: 'set_trip_cover', arguments: { tripId: trip.id, image_url: 'http://169.254.169.254/latest' } });
      expect(result.isError).toBe(true);
      expect(textOf(result)).toContain('not allowed');
    });
  });

  it('denies a member when trip_cover_upload is owner-only (default)', async () => {
    const { user: owner } = createUser(testDb);
    const { user: member } = createUser(testDb);
    const trip = createTrip(testDb, owner.id);
    addTripMember(testDb, trip.id, member.id);
    await withHarness(member.id, async (h) => {
      const result = await h.client.callTool({ name: 'set_trip_cover', arguments: { tripId: trip.id, image_url: 'https://example.org/x.png' } });
      expect(result.isError).toBe(true);
      expect(safeFetchMock).not.toHaveBeenCalled();
    });
  });
});

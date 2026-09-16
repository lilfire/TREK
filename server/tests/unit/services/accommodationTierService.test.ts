/**
 * Unit tests for accommodationTierService — participant counting, active/next tier
 * resolution and tier validation.
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
    getPlaceWithTags: () => null,
    canAccessTrip: () => null,
    isOwner: () => false,
  };
  return { testDb: db, dbMock: mock };
});

vi.mock('../../../src/db/database', () => dbMock);
vi.mock('../../../src/config', () => ({
  USER_AGENT: 'TREK Travel Planner (https://github.com/lilfire/TREK)',
  JWT_SECRET: 'test-secret',
  ENCRYPTION_KEY: 'a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6a7b8c9d0e1f2a3b4c5d6a7b8c9d0e1f2',
  updateJwtSecret: () => {},
}));

import { createTables } from '../../../src/db/schema';
import { runMigrations } from '../../../src/db/migrations';
import { resetTestDb } from '../../helpers/test-db';
import { createUser, createTrip, createPlace } from '../../helpers/factories';
import {
  countConfirmedParticipants, getTierStatus, createTier, updateTier, deleteTier, listTiers,
} from '../../../src/services/accommodationTierService';
import { NotFoundError, ValidationError } from '../../../src/services/tripErrors';

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

function seedRsvp(tripId: number, userId: number): number {
  const r = testDb.prepare('INSERT INTO trip_rsvps (trip_id, user_id, name, email) VALUES (?, ?, ?, ?)')
    .run(tripId, userId, `guest${userId}`, `guest${userId}@example.com`);
  return Number(r.lastInsertRowid);
}

function seedPayment(rsvpId: number, status: 'pending' | 'completed' | 'failed') {
  testDb.prepare('INSERT INTO trip_rsvp_payments (rsvp_id, amount, currency, status) VALUES (?, ?, ?, ?)')
    .run(rsvpId, 100, 'NOK', status);
}

function newGuest(tripId: number): number {
  const { user } = createUser(testDb);
  return seedRsvp(tripId, user.id);
}

describe('countConfirmedParticipants', () => {
  it('ACCT-001 — counts owner + all RSVPs when the trip has no fee', () => {
    const { user: owner } = createUser(testDb);
    const trip = createTrip(testDb, owner.id);
    newGuest(trip.id);
    newGuest(trip.id);
    expect(countConfirmedParticipants(trip.id)).toBe(3);
  });

  it('ACCT-002 — does not double count an RSVP from the owner', () => {
    const { user: owner } = createUser(testDb);
    const trip = createTrip(testDb, owner.id);
    seedRsvp(trip.id, owner.id);
    expect(countConfirmedParticipants(trip.id)).toBe(1);
  });

  it('ACCT-003 — counts only RSVPs with a completed payment when a fee applies', () => {
    const { user: owner } = createUser(testDb);
    const trip = createTrip(testDb, owner.id);
    testDb.prepare("UPDATE trips SET registration_fee = 100, fee_mode = 'rsvp' WHERE id = ?").run(trip.id);
    const paid = newGuest(trip.id);
    seedPayment(paid, 'failed');
    seedPayment(paid, 'completed');
    seedPayment(newGuest(trip.id), 'pending');
    seedPayment(newGuest(trip.id), 'failed');
    newGuest(trip.id); // no payment attempt
    expect(countConfirmedParticipants(trip.id)).toBe(2);
  });
});

describe('getTierStatus', () => {
  function setup(guests: number) {
    const { user: owner } = createUser(testDb);
    const trip = createTrip(testDb, owner.id);
    for (let i = 0; i < guests; i++) newGuest(trip.id);
    return trip;
  }

  it('ACCT-010 — no tiers → empty list, no active or next tier', () => {
    const trip = setup(0);
    expect(getTierStatus(trip.id)).toEqual({ participant_count: 1, active_tier_id: null, next_tier: null, tiers: [] });
  });

  it('ACCT-011 — resolves active tier, ranges and next tier', () => {
    const trip = setup(9); // 10 participants
    const small = createTier(trip.id, { name: 'Cabin', min_participants: 1 });
    const mid = createTier(trip.id, { name: 'Hotel', min_participants: 10 });
    const big = createTier(trip.id, { name: 'Lodge', min_participants: 21 });

    const status = getTierStatus(trip.id);
    expect(status.participant_count).toBe(10);
    expect(status.active_tier_id).toBe(mid.id);
    expect(status.next_tier).toEqual({ id: big.id, name: 'Lodge', min_participants: 21, participants_needed: 11 });
    expect(status.tiers.map(t => [t.id, t.max_participants, t.is_active, t.is_reached])).toEqual([
      [small.id, 9, false, true],
      [mid.id, 20, true, true],
      [big.id, null, false, false],
    ]);
  });

  it('ACCT-012 — no active tier when the lowest threshold is not reached', () => {
    const trip = setup(1); // 2 participants
    const first = createTier(trip.id, { name: 'Bus trip', min_participants: 5 });
    const status = getTierStatus(trip.id);
    expect(status.active_tier_id).toBeNull();
    expect(status.next_tier).toMatchObject({ id: first.id, participants_needed: 3 });
  });

  it('ACCT-013 — highest tier reached → no next tier', () => {
    const trip = setup(4);
    const only = createTier(trip.id, { name: 'Cabin', min_participants: 5 });
    const status = getTierStatus(trip.id);
    expect(status.active_tier_id).toBe(only.id);
    expect(status.next_tier).toBeNull();
  });
});

describe('tier CRUD', () => {
  it('ACCT-020 — creates a tier with a linked place', () => {
    const { user: owner } = createUser(testDb);
    const trip = createTrip(testDb, owner.id);
    const place = createPlace(testDb, trip.id, { name: 'Fjellro' });
    const tier = createTier(trip.id, { name: ' Cabin ', min_participants: 4, place_id: place.id, price_per_person: 750, description: 'Sauna' });
    expect(tier).toMatchObject({ name: 'Cabin', min_participants: 4, place_id: place.id, place_name: 'Fjellro', price_per_person: 750, description: 'Sauna' });
  });

  it('ACCT-021 — rejects duplicate min_participants', () => {
    const { user: owner } = createUser(testDb);
    const trip = createTrip(testDb, owner.id);
    createTier(trip.id, { name: 'A', min_participants: 4 });
    expect(() => createTier(trip.id, { name: 'B', min_participants: 4 })).toThrow(ValidationError);
  });

  it('ACCT-022 — rejects a place from another trip', () => {
    const { user: owner } = createUser(testDb);
    const trip = createTrip(testDb, owner.id);
    const other = createTrip(testDb, owner.id);
    const place = createPlace(testDb, other.id);
    expect(() => createTier(trip.id, { name: 'A', min_participants: 1, place_id: place.id })).toThrow(ValidationError);
  });

  it('ACCT-023 — rejects invalid name and min_participants', () => {
    const { user: owner } = createUser(testDb);
    const trip = createTrip(testDb, owner.id);
    expect(() => createTier(trip.id, { name: '  ', min_participants: 1 })).toThrow(ValidationError);
    expect(() => createTier(trip.id, { name: 'A', min_participants: 0 })).toThrow(ValidationError);
    expect(() => createTier(trip.id, { name: 'A', min_participants: 2.5 })).toThrow(ValidationError);
  });

  it('ACCT-024 — update changes only provided fields and null clears', () => {
    const { user: owner } = createUser(testDb);
    const trip = createTrip(testDb, owner.id);
    const tier = createTier(trip.id, { name: 'A', min_participants: 1, price_per_person: 500, description: 'x' });
    const updated = updateTier(trip.id, tier.id, { min_participants: 3, price_per_person: null });
    expect(updated).toMatchObject({ name: 'A', min_participants: 3, price_per_person: null, description: 'x' });
  });

  it('ACCT-025 — update of a tier in another trip throws NotFoundError; duplicate threshold throws ValidationError', () => {
    const { user: owner } = createUser(testDb);
    const trip = createTrip(testDb, owner.id);
    const other = createTrip(testDb, owner.id);
    const a = createTier(trip.id, { name: 'A', min_participants: 1 });
    createTier(trip.id, { name: 'B', min_participants: 5 });
    expect(() => updateTier(other.id, a.id, { name: 'X' })).toThrow(NotFoundError);
    expect(() => updateTier(trip.id, a.id, { min_participants: 5 })).toThrow(ValidationError);
  });

  it('ACCT-026 — delete is scoped to the trip', () => {
    const { user: owner } = createUser(testDb);
    const trip = createTrip(testDb, owner.id);
    const other = createTrip(testDb, owner.id);
    const a = createTier(trip.id, { name: 'A', min_participants: 1 });
    expect(deleteTier(other.id, a.id)).toBe(false);
    expect(deleteTier(trip.id, a.id)).toBe(true);
    expect(listTiers(trip.id)).toHaveLength(0);
  });
});

import { db } from '../db/database';
import { NotFoundError, ValidationError } from './tripErrors';

export interface AccommodationTier {
  id: number;
  trip_id: number;
  name: string;
  min_participants: number;
  place_id: number | null;
  price_per_person: number | null;
  description: string | null;
  created_at: string;
  updated_at: string;
  place_name: string | null;
  place_address: string | null;
  place_lat: number | null;
  place_lng: number | null;
  place_image_url: string | null;
  place_website: string | null;
}

export interface AccommodationTierWithState extends AccommodationTier {
  /** Upper bound (inclusive) — next tier's min − 1; null for the open-ended last tier. */
  max_participants: number | null;
  is_active: boolean;
  is_reached: boolean;
}

export interface AccommodationTierStatus {
  participant_count: number;
  active_tier_id: number | null;
  next_tier: { id: number; name: string; min_participants: number; participants_needed: number } | null;
  tiers: AccommodationTierWithState[];
}

export interface TierInput {
  name?: string;
  min_participants?: number;
  place_id?: number | null;
  price_per_person?: number | null;
  description?: string | null;
}

/**
 * Confirmed participants = the trip owner (always 1) + RSVPs from other users.
 * Only RSVPs with a completed payment count when the fee is collected at
 * registration ("rsvp" mode) — that is the only mode that ever writes a
 * trip_rsvp_payments row. In "deadline" mode the organiser collects the fee
 * outside TREK, so every RSVP counts.
 */
export function countConfirmedParticipants(tripId: number): number {
  const trip = db.prepare('SELECT user_id, registration_fee, fee_mode FROM trips WHERE id = ?')
    .get(tripId) as { user_id: number; registration_fee: number | null; fee_mode: string | null } | undefined;
  if (!trip) return 0;

  const requiresPayment = (trip.registration_fee ?? 0) > 0 && trip.fee_mode === 'rsvp';
  const row = db.prepare(`
    SELECT COUNT(*) AS n FROM trip_rsvps r
    WHERE r.trip_id = ? AND r.user_id != ?
    ${requiresPayment
      ? "AND EXISTS (SELECT 1 FROM trip_rsvp_payments p WHERE p.rsvp_id = r.id AND p.status = 'completed')"
      : ''}
  `).get(tripId, trip.user_id) as { n: number };

  return 1 + row.n;
}

export function listTiers(tripId: number): AccommodationTier[] {
  return db.prepare(`
    SELECT t.*, p.name AS place_name, p.address AS place_address, p.lat AS place_lat,
           p.lng AS place_lng, p.image_url AS place_image_url, p.website AS place_website
    FROM trip_accommodation_tiers t
    LEFT JOIN places p ON p.id = t.place_id
    WHERE t.trip_id = ?
    ORDER BY t.min_participants ASC, t.id ASC
  `).all(tripId) as AccommodationTier[];
}

function getTier(tripId: number, tierId: number): AccommodationTier | undefined {
  return listTiers(tripId).find(t => t.id === tierId);
}

export function getTierStatus(tripId: number): AccommodationTierStatus {
  const participantCount = countConfirmedParticipants(tripId);
  const tiers = listTiers(tripId);

  let activeIndex = -1;
  tiers.forEach((t, i) => { if (t.min_participants <= participantCount) activeIndex = i; });

  const withState = tiers.map((t, i) => ({
    ...t,
    max_participants: i < tiers.length - 1 ? tiers[i + 1].min_participants - 1 : null,
    is_active: i === activeIndex,
    is_reached: t.min_participants <= participantCount,
  }));

  const next = tiers[activeIndex + 1];
  return {
    participant_count: participantCount,
    active_tier_id: activeIndex >= 0 ? tiers[activeIndex].id : null,
    next_tier: next
      ? { id: next.id, name: next.name, min_participants: next.min_participants, participants_needed: next.min_participants - participantCount }
      : null,
    tiers: withState,
  };
}

function validate(tripId: number, input: TierInput, isCreate: boolean): void {
  if (isCreate || input.name !== undefined) {
    const name = input.name?.trim();
    if (!name || name.length > 200) throw new ValidationError('name must be 1–200 characters');
  }
  if (isCreate || input.min_participants !== undefined) {
    const min = input.min_participants;
    if (typeof min !== 'number' || !Number.isInteger(min) || min < 1)
      throw new ValidationError('min_participants must be an integer ≥ 1');
  }
  if (input.place_id !== undefined && input.place_id !== null) {
    const place = db.prepare('SELECT id FROM places WHERE id = ? AND trip_id = ?').get(input.place_id, tripId);
    if (!place) throw new ValidationError('place_id must reference a place in this trip');
  }
  if (input.price_per_person !== undefined && input.price_per_person !== null) {
    if (!Number.isFinite(input.price_per_person) || input.price_per_person < 0)
      throw new ValidationError('price_per_person must be ≥ 0');
  }
  if (input.description !== undefined && input.description !== null && input.description.length > 2000)
    throw new ValidationError('description must be at most 2000 characters');
}

function rethrowUnique(err: unknown): never {
  if (err instanceof Error && (err as any).code === 'SQLITE_CONSTRAINT_UNIQUE')
    throw new ValidationError('Another tier already starts at this min_participants');
  throw err;
}

export function createTier(tripId: number, input: TierInput): AccommodationTier {
  validate(tripId, input, true);
  try {
    const result = db.prepare(`
      INSERT INTO trip_accommodation_tiers (trip_id, name, min_participants, place_id, price_per_person, description)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(
      tripId, input.name!.trim(), input.min_participants,
      input.place_id ?? null, input.price_per_person ?? null, input.description ?? null,
    );
    return getTier(tripId, Number(result.lastInsertRowid))!;
  } catch (err) {
    rethrowUnique(err);
  }
}

/** Only provided fields are changed; null clears nullable fields. */
export function updateTier(tripId: number, tierId: number, input: TierInput): AccommodationTier {
  if (!getTier(tripId, tierId)) throw new NotFoundError('Accommodation tier not found');
  validate(tripId, input, false);

  const sets: string[] = [];
  const values: unknown[] = [];
  if (input.name !== undefined) { sets.push('name = ?'); values.push(input.name.trim()); }
  if (input.min_participants !== undefined) { sets.push('min_participants = ?'); values.push(input.min_participants); }
  if (input.place_id !== undefined) { sets.push('place_id = ?'); values.push(input.place_id); }
  if (input.price_per_person !== undefined) { sets.push('price_per_person = ?'); values.push(input.price_per_person); }
  if (input.description !== undefined) { sets.push('description = ?'); values.push(input.description); }

  if (sets.length > 0) {
    try {
      db.prepare(`
        UPDATE trip_accommodation_tiers SET ${sets.join(', ')}, updated_at = datetime('now')
        WHERE id = ? AND trip_id = ?
      `).run(...values, tierId, tripId);
    } catch (err) {
      rethrowUnique(err);
    }
  }
  return getTier(tripId, tierId)!;
}

export function deleteTier(tripId: number, tierId: number): boolean {
  const result = db.prepare('DELETE FROM trip_accommodation_tiers WHERE id = ? AND trip_id = ?').run(tierId, tripId);
  return result.changes > 0;
}

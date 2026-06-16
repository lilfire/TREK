import { db } from '../db/database';
import { listDays, listAccommodations } from './dayService';
import { listBudgetItems } from './budgetService';
import { listItems as listPackingItems } from './packingService';
import { listReservations } from './reservationService';
import { listNotes as listCollabNotes } from './collabService';
import { getTripOwner } from './tripCrudService';
import { listMembers as listTripMembers } from './tripMemberService';
import { NotFoundError } from './tripErrors';

export function copyTripById(sourceTripId: string | number, newOwnerId: number, title?: string): number {
  const src = db.prepare('SELECT * FROM trips WHERE id = ?').get(sourceTripId) as any;
  if (!src) throw new NotFoundError('Trip not found');

  const newTitle = title || src.title;

  const fn = db.transaction(() => {
    const tripResult = db.prepare(`
      INSERT INTO trips (user_id, title, description, start_date, end_date, currency, cover_image, is_archived, reminder_days)
      VALUES (?, ?, ?, ?, ?, ?, ?, 0, ?)
    `).run(newOwnerId, newTitle, src.description, src.start_date, src.end_date, src.currency, src.cover_image, src.reminder_days ?? 3);
    const newTripId = tripResult.lastInsertRowid;

    const oldDays = db.prepare('SELECT * FROM days WHERE trip_id = ? ORDER BY day_number').all(sourceTripId) as any[];
    const dayMap = new Map<number, number | bigint>();
    const insertDay = db.prepare('INSERT INTO days (trip_id, day_number, date, notes, title) VALUES (?, ?, ?, ?, ?)');
    for (const d of oldDays) {
      const r = insertDay.run(newTripId, d.day_number, d.date, d.notes, d.title);
      dayMap.set(d.id, r.lastInsertRowid);
    }

    const oldPlaces = db.prepare('SELECT * FROM places WHERE trip_id = ?').all(sourceTripId) as any[];
    const placeMap = new Map<number, number | bigint>();
    const insertPlace = db.prepare(`
      INSERT INTO places (trip_id, name, description, lat, lng, address, category_id, price, currency,
        reservation_status, reservation_notes, reservation_datetime, place_time, end_time,
        duration_minutes, notes, image_url, google_place_id, website, phone, transport_mode, osm_id)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    for (const p of oldPlaces) {
      const r = insertPlace.run(newTripId, p.name, p.description, p.lat, p.lng, p.address, p.category_id,
        p.price, p.currency, p.reservation_status, p.reservation_notes, p.reservation_datetime,
        p.place_time, p.end_time, p.duration_minutes, p.notes, p.image_url, p.google_place_id,
        p.website, p.phone, p.transport_mode, p.osm_id);
      placeMap.set(p.id, r.lastInsertRowid);
    }

    const oldTags = db.prepare(`
      SELECT pt.* FROM place_tags pt JOIN places p ON p.id = pt.place_id WHERE p.trip_id = ?
    `).all(sourceTripId) as any[];
    const insertTag = db.prepare('INSERT OR IGNORE INTO place_tags (place_id, tag_id) VALUES (?, ?)');
    for (const t of oldTags) {
      const newPlaceId = placeMap.get(t.place_id);
      if (newPlaceId) insertTag.run(newPlaceId, t.tag_id);
    }

    const oldAssignments = db.prepare(`
      SELECT da.* FROM day_assignments da JOIN days d ON d.id = da.day_id WHERE d.trip_id = ?
    `).all(sourceTripId) as any[];
    const assignmentMap = new Map<number, number | bigint>();
    const insertAssignment = db.prepare(`
      INSERT INTO day_assignments (day_id, place_id, order_index, notes, reservation_status, reservation_notes, reservation_datetime, assignment_time, assignment_end_time)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    for (const a of oldAssignments) {
      const newDayId = dayMap.get(a.day_id);
      const newPlaceId = placeMap.get(a.place_id);
      if (newDayId && newPlaceId) {
        const r = insertAssignment.run(newDayId, newPlaceId, a.order_index, a.notes,
          a.reservation_status, a.reservation_notes, a.reservation_datetime,
          a.assignment_time, a.assignment_end_time);
        assignmentMap.set(a.id, r.lastInsertRowid);
      }
    }

    const oldAccom = db.prepare('SELECT * FROM day_accommodations WHERE trip_id = ?').all(sourceTripId) as any[];
    const accomMap = new Map<number, number | bigint>();
    const insertAccom = db.prepare(`
      INSERT INTO day_accommodations (trip_id, place_id, start_day_id, end_day_id, check_in, check_out, confirmation, notes)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);
    for (const a of oldAccom) {
      const newPlaceId = placeMap.get(a.place_id);
      const newStartDay = dayMap.get(a.start_day_id);
      const newEndDay = dayMap.get(a.end_day_id);
      if (newPlaceId && newStartDay && newEndDay) {
        const r = insertAccom.run(newTripId, newPlaceId, newStartDay, newEndDay, a.check_in, a.check_out, a.confirmation, a.notes);
        accomMap.set(a.id, r.lastInsertRowid);
      }
    }

    const oldReservations = db.prepare('SELECT * FROM reservations WHERE trip_id = ?').all(sourceTripId) as any[];
    const insertReservation = db.prepare(`
      INSERT INTO reservations (trip_id, day_id, place_id, assignment_id, accommodation_id, title, reservation_time, reservation_end_time,
        location, confirmation_number, notes, status, type, metadata, day_plan_position)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    for (const r of oldReservations) {
      insertReservation.run(newTripId,
        r.day_id ? (dayMap.get(r.day_id) ?? null) : null,
        r.place_id ? (placeMap.get(r.place_id) ?? null) : null,
        r.assignment_id ? (assignmentMap.get(r.assignment_id) ?? null) : null,
        r.accommodation_id ? (accomMap.get(r.accommodation_id) ?? null) : null,
        r.title, r.reservation_time, r.reservation_end_time,
        r.location, r.confirmation_number, r.notes, r.status, r.type,
        r.metadata, r.day_plan_position);
    }

    const oldBudget = db.prepare('SELECT * FROM budget_items WHERE trip_id = ?').all(sourceTripId) as any[];
    const insertBudget = db.prepare(`
      INSERT INTO budget_items (trip_id, category, name, total_price, persons, days, note, sort_order)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);
    for (const b of oldBudget) {
      insertBudget.run(newTripId, b.category, b.name, b.total_price, b.persons, b.days, b.note, b.sort_order);
    }

    const oldBags = db.prepare('SELECT * FROM packing_bags WHERE trip_id = ?').all(sourceTripId) as any[];
    const bagMap = new Map<number, number | bigint>();
    const insertBag = db.prepare(`
      INSERT INTO packing_bags (trip_id, name, color, weight_limit_grams, sort_order)
      VALUES (?, ?, ?, ?, ?)
    `);
    for (const bag of oldBags) {
      const r = insertBag.run(newTripId, bag.name, bag.color, bag.weight_limit_grams, bag.sort_order);
      bagMap.set(bag.id, r.lastInsertRowid);
    }

    const oldPacking = db.prepare('SELECT * FROM packing_items WHERE trip_id = ?').all(sourceTripId) as any[];
    const insertPacking = db.prepare(`
      INSERT INTO packing_items (trip_id, name, checked, category, sort_order, weight_grams, bag_id)
      VALUES (?, ?, 0, ?, ?, ?, ?)
    `);
    for (const p of oldPacking) {
      insertPacking.run(newTripId, p.name, p.category, p.sort_order, p.weight_grams,
        p.bag_id ? (bagMap.get(p.bag_id) ?? null) : null);
    }

    const oldNotes = db.prepare('SELECT * FROM day_notes WHERE trip_id = ?').all(sourceTripId) as any[];
    const insertNote = db.prepare(`
      INSERT INTO day_notes (day_id, trip_id, text, time, icon, sort_order)
      VALUES (?, ?, ?, ?, ?, ?)
    `);
    for (const n of oldNotes) {
      const newDayId = dayMap.get(n.day_id);
      if (newDayId) insertNote.run(newDayId, newTripId, n.text, n.time, n.icon, n.sort_order);
    }

    const oldTodos = db.prepare('SELECT * FROM todo_items WHERE trip_id = ?').all(sourceTripId) as any[];
    const insertTodo = db.prepare(`
      INSERT INTO todo_items (trip_id, name, checked, category, sort_order, due_date, description, assigned_user_id, priority)
      VALUES (?, ?, 0, ?, ?, ?, ?, NULL, ?)
    `);
    for (const t of oldTodos) {
      insertTodo.run(newTripId, t.name, t.category, t.sort_order, t.due_date, t.description, t.priority);
    }

    const oldCategoryOrder = db.prepare('SELECT category, sort_order, currency FROM budget_category_order WHERE trip_id = ?').all(sourceTripId) as any[];
    const insertCategoryOrder = db.prepare(`
      INSERT INTO budget_category_order (trip_id, category, sort_order, currency)
      VALUES (?, ?, ?, ?)
    `);
    for (const o of oldCategoryOrder) {
      insertCategoryOrder.run(newTripId, o.category, o.sort_order, o.currency ?? null);
    }

    return Number(newTripId);
  });

  return fn();
}

export function getTripSummary(tripId: number, userId: number) {
  const trip = db.prepare('SELECT * FROM trips WHERE id = ?').get(tripId) as Record<string, unknown> | undefined;
  if (!trip) return null;

  const ownerRow = getTripOwner(tripId);
  if (!ownerRow) return null;
  const { owner, members } = listTripMembers(tripId, ownerRow.user_id);

  const { days: rawDays } = listDays(tripId);
  const days = rawDays.map(({ notes_items, ...day }) => ({ ...day, notes: notes_items }));

  const accommodations = listAccommodations(tripId);

  const budgetItems = listBudgetItems(tripId);
  const budget = {
    items: budgetItems,
    item_count: budgetItems.length,
    total: budgetItems.reduce((sum, i) => sum + (i.total_price || 0), 0),
    currency: trip.currency,
  };

  const packingItems = listPackingItems(tripId, userId);
  const packing = {
    items: packingItems,
    total: packingItems.length,
    checked: (packingItems as { checked: number }[]).filter(i => i.checked).length,
  };

  const reservations = listReservations(tripId);
  const collab_notes = listCollabNotes(tripId);

  return {
    trip,
    members: { owner, collaborators: members },
    days,
    accommodations,
    budget,
    packing,
    reservations,
    collab_notes,
  };
}

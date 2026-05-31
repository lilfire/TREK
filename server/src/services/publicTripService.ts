import { db } from '../db/database';
import { loadTagsByPlaceIds } from './queryHelpers';
import { getPaypalClientId } from './paypalService';

export interface PublicTripSummary {
  id: number;
  name: string;
  start_date: string | null;
  end_date: string | null;
  cover_image_url: string | null;
  description: string | null;
  place_count: number;
}

export function getPublicTripsList(): PublicTripSummary[] {
  return db.prepare(`
    SELECT
      t.id,
      t.title AS name,
      t.start_date,
      t.end_date,
      t.cover_image AS cover_image_url,
      t.description,
      COUNT(p.id) AS place_count
    FROM trips t
    LEFT JOIN places p ON p.trip_id = t.id
    WHERE t.is_public = 1
    GROUP BY t.id
    ORDER BY t.created_at DESC
  `).all() as PublicTripSummary[];
}

/**
 * Loads the full read-only trip data for a publicly-listed trip (is_public = 1).
 * Returns null if the trip does not exist or is not public.
 *
 * Response shape mirrors shareService.getSharedTripData so the same client
 * rendering path works for both shared links and the public detail page.
 */
export function getPublicTripData(tripId: string | number): Record<string, any> | null {
  const trip = db.prepare(
    'SELECT id, title, description, start_date, end_date, cover_image, currency, registration_fee, fee_mode, fee_deadline, rsvp_deadline, fee_currency FROM trips WHERE id = ? AND is_public = 1'
  ).get(tripId) as any;
  if (!trip) return null;

  const paypalClientId = getPaypalClientId();
  if (paypalClientId) (trip as any).paypalClientId = paypalClientId;

  const days = db.prepare(
    'SELECT * FROM days WHERE trip_id = ? ORDER BY day_number ASC'
  ).all(tripId) as any[];
  const dayIds = days.map((d: any) => d.id);

  let assignments: Record<number, any[]> = {};
  let dayNotes: Record<number, any[]> = {};

  if (dayIds.length > 0) {
    const ph = dayIds.map(() => '?').join(',');
    const allAssignments = db.prepare(`
      SELECT da.*, p.id as place_id, p.name as place_name, p.description as place_description,
        p.lat, p.lng, p.address, p.category_id, p.price, p.currency as place_currency,
        p.website, p.phone,
        COALESCE(da.assignment_time, p.place_time) as place_time,
        COALESCE(da.assignment_end_time, p.end_time) as end_time,
        p.duration_minutes, p.notes as place_notes, p.image_url, p.transport_mode,
        c.name as category_name, c.color as category_color, c.icon as category_icon
      FROM day_assignments da
      JOIN places p ON da.place_id = p.id
      LEFT JOIN categories c ON p.category_id = c.id
      WHERE da.day_id IN (${ph})
      ORDER BY da.order_index ASC, da.created_at ASC
    `).all(...dayIds);

    const placeIds = [...new Set(allAssignments.map((a: any) => a.place_id))];
    const tagsByPlace = loadTagsByPlaceIds(placeIds, { compact: true });

    const byDay: Record<number, any[]> = {};
    for (const a of allAssignments as any[]) {
      if (!byDay[a.day_id]) byDay[a.day_id] = [];
      byDay[a.day_id].push({
        id: a.id, day_id: a.day_id, order_index: a.order_index, notes: a.notes,
        place: {
          id: a.place_id, name: a.place_name, description: a.place_description,
          lat: a.lat, lng: a.lng, address: a.address, category_id: a.category_id,
          price: a.price, place_time: a.place_time, end_time: a.end_time,
          duration_minutes: a.duration_minutes,
          image_url: a.image_url, transport_mode: a.transport_mode,
          website: a.website, phone: a.phone, notes: a.place_notes, currency: a.place_currency,
          category: a.category_id
            ? { id: a.category_id, name: a.category_name, color: a.category_color, icon: a.category_icon }
            : null,
          tags: tagsByPlace[a.place_id] || [],
          files: [],
        },
      });
    }
    if (placeIds.length > 0) {
      const fph = placeIds.map(() => '?').join(',');
      const fileRows = db.prepare(`
        SELECT tf.id, tf.original_name, tf.file_size, tf.mime_type, tf.description, tf.starred,
               tf.created_at, fl.place_id
        FROM trip_files tf
        JOIN file_links fl ON fl.file_id = tf.id
        WHERE fl.place_id IN (${fph})
          AND tf.deleted_at IS NULL
        ORDER BY tf.starred DESC, tf.created_at ASC
      `).all(...placeIds) as any[];

      for (const f of fileRows) {
        for (const dayArr of Object.values(byDay)) {
          for (const entry of dayArr) {
            if (entry.place.id === f.place_id) {
              entry.place.files.push({
                id: f.id, original_name: f.original_name,
                file_size: f.file_size, mime_type: f.mime_type,
                description: f.description, starred: f.starred ? true : false,
                url: `/api/public/trips/${tripId}/files/${f.id}`,
              });
            }
          }
        }
      }
    }

    assignments = byDay;

    const allNotes = db.prepare(
      `SELECT * FROM day_notes WHERE day_id IN (${ph}) ORDER BY sort_order ASC, created_at ASC`
    ).all(...dayIds);
    const notesByDay: Record<number, any[]> = {};
    for (const n of allNotes as any[]) {
      if (!notesByDay[n.day_id]) notesByDay[n.day_id] = [];
      notesByDay[n.day_id].push(n);
    }
    dayNotes = notesByDay;
  }

  const places = db.prepare(`
    SELECT p.*, c.name as category_name, c.color as category_color, c.icon as category_icon
    FROM places p LEFT JOIN categories c ON p.category_id = c.id
    WHERE p.trip_id = ? ORDER BY p.created_at DESC
  `).all(tripId);

  const reservations = db.prepare(
    'SELECT * FROM reservations WHERE trip_id = ? ORDER BY reservation_time ASC'
  ).all(tripId) as any[];

  const dayPositions = db.prepare(`
    SELECT rdp.reservation_id, rdp.day_id, rdp.position
    FROM reservation_day_positions rdp
    JOIN reservations r ON rdp.reservation_id = r.id
    WHERE r.trip_id = ?
  `).all(tripId) as { reservation_id: number; day_id: number; position: number }[];

  const posMap = new Map<number, Record<number, number>>();
  for (const dp of dayPositions) {
    if (!posMap.has(dp.reservation_id)) posMap.set(dp.reservation_id, {});
    posMap.get(dp.reservation_id)![dp.day_id] = dp.position;
  }
  for (const r of reservations) {
    r.day_positions = posMap.get(r.id) || null;
  }

  const accommodations = db.prepare(`
    SELECT a.*, p.name as place_name, p.address as place_address, p.lat as place_lat, p.lng as place_lng
    FROM day_accommodations a JOIN places p ON a.place_id = p.id
    WHERE a.trip_id = ?
  `).all(tripId);

  const categories = db.prepare('SELECT * FROM categories').all();

  const budgetItemRows = db.prepare(`
    SELECT id, name, category, total_price, note, persons, days, sort_order
    FROM budget_items
    WHERE trip_id = ?
    ORDER BY sort_order ASC, created_at ASC
  `).all(tripId) as any[];

  const budgetItems = budgetItemRows.map((row: any) => ({
    id: row.id,
    title: row.name,
    category: row.category,
    amount: row.total_price,
    note: row.note,
    persons: row.persons,
    days: row.days,
  }));

  const budgetSummary = {
    totalBudget: budgetItemRows.reduce((sum: number, row: any) => sum + (row.total_price || 0), 0),
    currency: trip.currency,
  };

  return {
    trip,
    days,
    assignments,
    dayNotes,
    places,
    categories,
    reservations,
    accommodations,
    budgetItems,
    budgetSummary,
  };
}

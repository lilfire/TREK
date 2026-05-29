import path from 'path';
import fs from 'fs';
import { db, canAccessTrip, isOwner } from '../db/database';
import { Trip } from '../types';
import { shiftOwnerEntriesForTripWindow } from './vacayService';
import { NotFoundError, ValidationError } from './tripErrors';

export { isOwner };

export const MS_PER_DAY = 86400000;
export const MAX_TRIP_DAYS = 365;

export const TRIP_SELECT = `
  SELECT t.*,
    (SELECT COUNT(*) FROM days d WHERE d.trip_id = t.id) as day_count,
    (SELECT COUNT(*) FROM places p WHERE p.trip_id = t.id) as place_count,
    CASE WHEN t.user_id = :userId THEN 1 ELSE 0 END as is_owner,
    u.username as owner_username,
    (SELECT COUNT(*) FROM trip_members tm WHERE tm.trip_id = t.id) as shared_count
  FROM trips t
  JOIN users u ON u.id = t.user_id
`;

export function verifyTripAccess(tripId: string | number, userId: number) {
  return canAccessTrip(tripId, userId);
}

export function generateDays(tripId: number | bigint | string, startDate: string | null, endDate: string | null, maxDays?: number, dayCount?: number) {
  const existing = db.prepare('SELECT id, day_number, date FROM days WHERE trip_id = ?').all(tripId) as { id: number; day_number: number; date: string | null }[];
  const setDayNumber = db.prepare('UPDATE days SET day_number = ? WHERE id = ?');

  function renumber(days: { id: number }[]) {
    days.forEach((d, i) => setDayNumber.run(-(i + 1), d.id));
    days.forEach((d, i) => setDayNumber.run(i + 1, d.id));
  }

  if (!startDate || !endDate) {
    const withDates = existing.filter(d => d.date);
    if (withDates.length > 0) {
      const nullify = db.prepare('UPDATE days SET date = NULL WHERE id = ?');
      for (const d of withDates) nullify.run(d.id);
    }
    const allDays = db.prepare('SELECT id FROM days WHERE trip_id = ? ORDER BY day_number').all(tripId) as { id: number }[];
    const targetCount = Math.min(Math.max(dayCount ?? (allDays.length || 7), 1), MAX_TRIP_DAYS);
    const needed = targetCount - allDays.length;
    if (needed > 0) {
      const insert = db.prepare('INSERT INTO days (trip_id, day_number, date) VALUES (?, ?, NULL)');
      for (let i = 0; i < needed; i++) insert.run(tripId, allDays.length + i + 1);
    } else if (needed < 0) {
      const candidates = db.prepare(
        `SELECT d.id FROM days d
         WHERE d.trip_id = ?
           AND NOT EXISTS (SELECT 1 FROM day_assignments da WHERE da.day_id = d.id)
           AND NOT EXISTS (SELECT 1 FROM day_notes dn WHERE dn.day_id = d.id)
           AND NOT EXISTS (SELECT 1 FROM day_accommodations dac WHERE dac.start_day_id = d.id OR dac.end_day_id = d.id)
         ORDER BY d.day_number DESC
         LIMIT ?`
      ).all(tripId, -needed) as { id: number }[];
      const del = db.prepare('DELETE FROM days WHERE id = ?');
      for (const d of candidates) del.run(d.id);
    }
    const remaining = db.prepare('SELECT id FROM days WHERE trip_id = ? ORDER BY day_number').all(tripId) as { id: number }[];
    renumber(remaining);
    return;
  }

  const [sy, sm, sd] = startDate.split('-').map(Number);
  const [ey, em, ed] = endDate.split('-').map(Number);
  const startMs = Date.UTC(sy, sm - 1, sd);
  const endMs = Date.UTC(ey, em - 1, ed);
  const numDays = Math.min(Math.floor((endMs - startMs) / MS_PER_DAY) + 1, maxDays ?? MAX_TRIP_DAYS);

  const targetDates: string[] = [];
  for (let i = 0; i < numDays; i++) {
    const d = new Date(startMs + i * MS_PER_DAY);
    const yyyy = d.getUTCFullYear();
    const mm = String(d.getUTCMonth() + 1).padStart(2, '0');
    const dd = String(d.getUTCDate()).padStart(2, '0');
    targetDates.push(`${yyyy}-${mm}-${dd}`);
  }

  const dated = existing.filter(d => d.date).sort((a, b) => a.day_number - b.day_number);
  const dateless = existing.filter(d => !d.date).sort((a, b) => a.day_number - b.day_number);

  const allExisting = [...dated, ...dateless];
  allExisting.forEach((d, i) => setDayNumber.run(-(i + 1), d.id));

  const assignDay = db.prepare('UPDATE days SET date = ?, day_number = ? WHERE id = ?');
  const insert = db.prepare('INSERT INTO days (trip_id, day_number, date) VALUES (?, ?, ?)');

  let datelessIdx = 0;

  for (let i = 0; i < targetDates.length; i++) {
    const date = targetDates[i];
    if (i < dated.length) {
      assignDay.run(date, i + 1, dated[i].id);
    } else if (datelessIdx < dateless.length) {
      assignDay.run(date, i + 1, dateless[datelessIdx].id);
      datelessIdx++;
    } else {
      insert.run(tripId, i + 1, date);
    }
  }

  const del = db.prepare('DELETE FROM days WHERE id = ?');
  for (let i = targetDates.length; i < dated.length; i++) {
    del.run(dated[i].id);
  }

  const maxAssigned = Math.max(targetDates.length, dated.length);
  for (let i = datelessIdx; i < dateless.length; i++) {
    setDayNumber.run(maxAssigned + (i - datelessIdx) + 1, dateless[i].id);
  }

  const remaining = db.prepare('SELECT id FROM days WHERE trip_id = ? ORDER BY day_number').all(tripId) as { id: number }[];
  renumber(remaining);
}

export function listTrips(userId: number, archived: number | null) {
  if (archived === null) {
    return db.prepare(`
      ${TRIP_SELECT}
      LEFT JOIN trip_members m ON m.trip_id = t.id AND m.user_id = :userId
      WHERE (t.user_id = :userId OR m.user_id IS NOT NULL)
      ORDER BY t.created_at DESC
    `).all({ userId });
  }
  return db.prepare(`
    ${TRIP_SELECT}
    LEFT JOIN trip_members m ON m.trip_id = t.id AND m.user_id = :userId
    WHERE (t.user_id = :userId OR m.user_id IS NOT NULL) AND t.is_archived = :archived
    ORDER BY t.created_at DESC
  `).all({ userId, archived });
}

interface CreateTripData {
  title: string;
  description?: string | null;
  start_date?: string | null;
  end_date?: string | null;
  currency?: string;
  reminder_days?: number;
  day_count?: number;
  country?: string | null;
}

export function createTrip(userId: number, data: CreateTripData, maxDays?: number) {
  const rd = data.reminder_days !== undefined
    ? (Number(data.reminder_days) >= 0 && Number(data.reminder_days) <= 30 ? Number(data.reminder_days) : 3)
    : 3;

  const result = db.prepare(`
    INSERT INTO trips (user_id, title, description, start_date, end_date, currency, reminder_days, country)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(userId, data.title, data.description || null, data.start_date || null, data.end_date || null, data.currency || 'NOK', rd, data.country ?? null);

  const tripId = result.lastInsertRowid;
  generateDays(tripId, data.start_date || null, data.end_date || null, maxDays, data.day_count);

  const trip = db.prepare(`${TRIP_SELECT} WHERE t.id = :tripId`).get({ userId, tripId });
  return { trip, tripId: Number(tripId), reminderDays: rd };
}

export function getTrip(tripId: string | number, userId: number) {
  return db.prepare(`
    ${TRIP_SELECT}
    LEFT JOIN trip_members m ON m.trip_id = t.id AND m.user_id = :userId
    WHERE t.id = :tripId AND (t.user_id = :userId OR m.user_id IS NOT NULL)
  `).get({ userId, tripId });
}

interface UpdateTripData {
  title?: string;
  description?: string;
  start_date?: string;
  end_date?: string;
  currency?: string;
  is_archived?: boolean | number;
  is_public?: boolean | number;
  cover_image?: string;
  reminder_days?: number;
  day_count?: number;
  registration_fee?: number | null;
  fee_mode?: 'deadline' | 'rsvp' | null;
  fee_deadline?: string | null;
  rsvp_deadline?: string | null;
  country?: string | null;
}

export interface UpdateTripResult {
  updatedTrip: any;
  changes: Record<string, unknown>;
  isAdminEdit: boolean;
  ownerEmail?: string;
  newTitle: string;
  newReminder: number;
  oldReminder: number;
}

export function updateTrip(tripId: string | number, userId: number, data: UpdateTripData, userRole: string): UpdateTripResult {
  const trip = db.prepare('SELECT * FROM trips WHERE id = ?').get(tripId) as Trip & { reminder_days?: number } | undefined;
  if (!trip) throw new NotFoundError('Trip not found');

  const { title, description, start_date, end_date, currency, is_archived, is_public, cover_image, reminder_days } = data;

  if (start_date && end_date && new Date(end_date) < new Date(start_date))
    throw new ValidationError('End date must be after start date');

  if (data.registration_fee !== undefined && data.registration_fee !== null && (typeof data.registration_fee !== 'number' || data.registration_fee < 0))
    throw new ValidationError('registration_fee must be a non-negative number');
  if (data.fee_mode !== undefined && data.fee_mode !== null && !['deadline', 'rsvp'].includes(data.fee_mode))
    throw new ValidationError("fee_mode must be 'deadline' or 'rsvp'");
  if (data.fee_deadline !== undefined && data.fee_deadline !== null && !/^\d{4}-\d{2}-\d{2}$/.test(data.fee_deadline))
    throw new ValidationError('fee_deadline must be an ISO-8601 date string (YYYY-MM-DD)');
  if (data.rsvp_deadline !== undefined && data.rsvp_deadline !== null && !/^\d{4}-\d{2}-\d{2}$/.test(data.rsvp_deadline))
    throw new ValidationError('rsvp_deadline must be an ISO-8601 date string (YYYY-MM-DD)');

  const newTitle = title || trip.title;
  const newDesc = description !== undefined ? description : trip.description;
  const newStart = start_date !== undefined ? start_date : trip.start_date;
  const newEnd = end_date !== undefined ? end_date : trip.end_date;
  const newCurrency = currency || trip.currency;
  const newArchived = is_archived !== undefined ? (is_archived ? 1 : 0) : trip.is_archived;
  const newPublic = is_public !== undefined ? (is_public ? 1 : 0) : (trip.is_public ?? 0);
  const newCover = cover_image !== undefined ? cover_image : trip.cover_image;
  const oldReminder = (trip as any).reminder_days ?? 3;
  const newReminder = reminder_days !== undefined
    ? (Number(reminder_days) >= 0 && Number(reminder_days) <= 30 ? Number(reminder_days) : oldReminder)
    : oldReminder;

  const hasFeeUpdate = 'registration_fee' in data;
  const rawFee = hasFeeUpdate ? data.registration_fee : (trip as any).registration_fee;
  const effectiveFee = (rawFee === null || rawFee === 0) ? null : rawFee;
  const newFee = effectiveFee ?? null;
  const newFeeMode = newFee === null ? null : ('fee_mode' in data ? (data.fee_mode ?? null) : ((trip as any).fee_mode ?? null));
  const newFeeDeadline = (newFee === null || newFeeMode !== 'deadline') ? null : ('fee_deadline' in data ? (data.fee_deadline ?? null) : ((trip as any).fee_deadline ?? null));
  const newRsvpDeadline = 'rsvp_deadline' in data ? (data.rsvp_deadline ?? null) : ((trip as any).rsvp_deadline ?? null);
  const newCountry = 'country' in data ? (data.country ?? null) : ((trip as any).country ?? null);

  db.prepare(`
    UPDATE trips SET title=?, description=?, start_date=?, end_date=?,
      currency=?, is_archived=?, is_public=?, cover_image=?, reminder_days=?,
      registration_fee=?, fee_mode=?, fee_deadline=?, rsvp_deadline=?, country=?, updated_at=CURRENT_TIMESTAMP
    WHERE id=?
  `).run(newTitle, newDesc, newStart || null, newEnd || null, newCurrency, newArchived, newPublic, newCover, newReminder, newFee, newFeeMode, newFeeDeadline, newRsvpDeadline, newCountry, tripId);

  if (trip.start_date && trip.end_date && newStart && newStart !== trip.start_date)
    shiftOwnerEntriesForTripWindow(trip.user_id, trip.start_date, trip.end_date, newStart);

  const dayCount = data.day_count ? Math.min(Math.max(Number(data.day_count) || 7, 1), MAX_TRIP_DAYS) : undefined;
  if (newStart !== trip.start_date || newEnd !== trip.end_date || dayCount)
    generateDays(tripId, newStart || null, newEnd || null, undefined, dayCount);

  const changes: Record<string, unknown> = {};
  if (title && title !== trip.title) changes.title = title;
  if (newStart !== trip.start_date) changes.start_date = newStart;
  if (newEnd !== trip.end_date) changes.end_date = newEnd;
  if (newReminder !== oldReminder) changes.reminder_days = newReminder === 0 ? 'none' : `${newReminder} days`;
  if (is_archived !== undefined && newArchived !== trip.is_archived) changes.archived = !!newArchived;
  if (is_public !== undefined && newPublic !== (trip.is_public ?? 0)) changes.is_public = !!newPublic;

  const isAdminEdit = userRole === 'admin' && trip.user_id !== userId;
  let ownerEmail: string | undefined;
  if (Object.keys(changes).length > 0 && isAdminEdit) {
    ownerEmail = (db.prepare('SELECT email FROM users WHERE id = ?').get(trip.user_id) as { email: string } | undefined)?.email;
  }

  const updatedTrip = db.prepare(`${TRIP_SELECT} WHERE t.id = :tripId`).get({ userId, tripId });

  return { updatedTrip, changes, isAdminEdit, ownerEmail, newTitle, newReminder, oldReminder };
}

export interface DeleteTripInfo {
  tripId: number;
  title: string;
  ownerId: number;
  isAdminDelete: boolean;
  ownerEmail?: string;
}

export function deleteTrip(tripId: string | number, userId: number, userRole: string): DeleteTripInfo {
  const trip = db.prepare('SELECT title, user_id FROM trips WHERE id = ?').get(tripId) as { title: string; user_id: number } | undefined;
  if (!trip) throw new NotFoundError('Trip not found');

  const isAdminDelete = userRole === 'admin' && trip.user_id !== userId;
  let ownerEmail: string | undefined;
  if (isAdminDelete) {
    ownerEmail = (db.prepare('SELECT email FROM users WHERE id = ?').get(trip.user_id) as { email: string } | undefined)?.email;
  }

  db.prepare(`
    DELETE FROM journey_entries
    WHERE source_trip_id = ? AND type = 'skeleton'
  `).run(tripId);
  db.prepare(`
    UPDATE journey_entries SET source_trip_id = NULL, source_place_id = NULL
    WHERE source_trip_id = ?
  `).run(tripId);

  db.prepare('DELETE FROM trips WHERE id = ?').run(tripId);

  return { tripId: Number(tripId), title: trip.title, ownerId: trip.user_id, isAdminDelete, ownerEmail };
}

export function deleteOldCover(coverImage: string | null | undefined) {
  if (!coverImage) return;
  const oldPath = path.join(__dirname, '../../', coverImage.replace(/^\//, ''));
  const resolvedPath = path.resolve(oldPath);
  const uploadsDir = path.resolve(__dirname, '../../uploads');
  if (resolvedPath.startsWith(uploadsDir) && fs.existsSync(resolvedPath)) {
    fs.unlinkSync(resolvedPath);
  }
}

export function updateCoverImage(tripId: string | number, coverUrl: string) {
  db.prepare('UPDATE trips SET cover_image=?, updated_at=CURRENT_TIMESTAMP WHERE id=?').run(coverUrl, tripId);
}

export function getTripRaw(tripId: string | number): Trip | undefined {
  return db.prepare('SELECT * FROM trips WHERE id = ?').get(tripId) as Trip | undefined;
}

export function getTripOwner(tripId: string | number): { user_id: number } | undefined {
  return db.prepare('SELECT user_id FROM trips WHERE id = ?').get(tripId) as { user_id: number } | undefined;
}

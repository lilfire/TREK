import { db } from '../db/database';
import { NotFoundError } from './tripErrors';

export function exportICS(tripId: string | number): { ics: string; filename: string } {
  const trip = db.prepare('SELECT * FROM trips WHERE id = ?').get(tripId) as any;
  if (!trip) throw new NotFoundError('Trip not found');

  const reservations = db.prepare('SELECT * FROM reservations WHERE trip_id = ?').all(tripId) as any[];

  const esc = (s: string) => s
    .replace(/\\/g, '\\\\')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,')
    .replace(/\r?\n/g, '\\n')
    .replace(/\r/g, '');
  const fmtDate = (d: string) => d.replace(/-/g, '');
  const now = new Date().toISOString().replace(/[-:]/g, '').split('.')[0] + 'Z';
  const uid = (id: number, type: string) => `trek-${type}-${id}@trek`;

  const fmtDateTime = (d: string, refDate?: string) => {
    if (d.includes('T')) {
      const raw = d.replace(/[-:]/g, '').split('.')[0];
      return raw.length === 13 ? raw + '00' : raw;
    }
    if (refDate && d.match(/^\d{2}:\d{2}/)) {
      const datePart = refDate.split('T')[0];
      return `${datePart}T${d.replace(/:/g, '')}00`.replace(/-/g, '');
    }
    return d.replace(/[-:]/g, '');
  };

  let ics = 'BEGIN:VCALENDAR\r\nVERSION:2.0\r\nPRODID:-//TREK//Travel Planner//EN\r\nCALSCALE:GREGORIAN\r\nMETHOD:PUBLISH\r\n';
  ics += `X-WR-CALNAME:${esc(trip.title || 'TREK Trip')}\r\n`;

  if (trip.start_date && trip.end_date) {
    const endNext = new Date(trip.end_date + 'T00:00:00');
    endNext.setDate(endNext.getDate() + 1);
    const endStr = endNext.toISOString().split('T')[0].replace(/-/g, '');
    ics += `BEGIN:VEVENT\r\nUID:${uid(trip.id, 'trip')}\r\nDTSTAMP:${now}\r\nDTSTART;VALUE=DATE:${fmtDate(trip.start_date)}\r\nDTEND;VALUE=DATE:${endStr}\r\nSUMMARY:${esc(trip.title || 'Trip')}\r\n`;
    if (trip.description) ics += `DESCRIPTION:${esc(trip.description)}\r\n`;
    ics += `END:VEVENT\r\n`;
  }

  const days = db.prepare('SELECT * FROM days WHERE trip_id = ? ORDER BY day_number ASC').all(tripId) as any[];
  for (const day of days) {
    if (!day.date) continue;

    const assignments = db.prepare(`
      SELECT da.*, p.name as place_name, p.address as place_address,
        COALESCE(da.assignment_time, p.place_time) as effective_time,
        COALESCE(da.assignment_end_time, p.end_time) as effective_end_time
      FROM day_assignments da
      JOIN places p ON da.place_id = p.id
      WHERE da.day_id = ?
      ORDER BY da.order_index ASC, da.created_at ASC
    `).all(day.id) as any[];

    const notes = db.prepare(
      'SELECT * FROM day_notes WHERE day_id = ? ORDER BY sort_order ASC, created_at ASC'
    ).all(day.id) as any[];

    const timed = assignments.filter(a => a.effective_time);
    const untimed = assignments.filter(a => !a.effective_time);

    for (const a of timed) {
      ics += `BEGIN:VEVENT\r\nUID:${uid(a.id, 'assign')}\r\nDTSTAMP:${now}\r\n`;
      ics += `DTSTART:${fmtDateTime(a.effective_time, day.date + 'T00:00')}\r\n`;
      if (a.effective_end_time) {
        ics += `DTEND:${fmtDateTime(a.effective_end_time, day.date + 'T00:00')}\r\n`;
      }
      ics += `SUMMARY:${esc(a.place_name)}\r\n`;
      let desc = '';
      if (a.notes) desc += a.notes;
      if (a.place_address) desc += (desc ? '\n' : '') + a.place_address;
      if (desc) ics += `DESCRIPTION:${esc(desc)}\r\n`;
      if (a.place_address) ics += `LOCATION:${esc(a.place_address)}\r\n`;
      ics += `END:VEVENT\r\n`;
    }

    if (untimed.length > 0 || notes.length > 0) {
      const dayTitle = day.title || `Day ${day.day_number}`;
      const endNext = new Date(day.date + 'T00:00:00');
      endNext.setDate(endNext.getDate() + 1);
      const endStr = endNext.toISOString().split('T')[0].replace(/-/g, '');

      ics += `BEGIN:VEVENT\r\nUID:${uid(day.id, 'day')}\r\nDTSTAMP:${now}\r\n`;
      ics += `DTSTART;VALUE=DATE:${fmtDate(day.date)}\r\nDTEND;VALUE=DATE:${endStr}\r\n`;
      ics += `SUMMARY:${esc(dayTitle)}\r\n`;

      let desc = '';
      if (untimed.length > 0) {
        desc += untimed.map(a => {
          let line = `• ${a.place_name}`;
          if (a.place_address) line += ` (${a.place_address})`;
          if (a.notes) line += ` — ${a.notes}`;
          return line;
        }).join('\n');
      }
      if (notes.length > 0) {
        if (desc) desc += '\n\n';
        desc += 'Notes:\n' + notes.map(n => {
          let line = n.time ? `${n.time} — ${n.text}` : `• ${n.text}`;
          return line;
        }).join('\n');
      }
      if (desc) ics += `DESCRIPTION:${esc(desc)}\r\n`;
      ics += `END:VEVENT\r\n`;
    }
  }

  for (const r of reservations) {
    if (!r.reservation_time) continue;
    const hasTime = r.reservation_time.includes('T');
    const meta = r.metadata ? (typeof r.metadata === 'string' ? JSON.parse(r.metadata) : r.metadata) : {};

    ics += `BEGIN:VEVENT\r\nUID:${uid(r.id, 'res')}\r\nDTSTAMP:${now}\r\n`;
    if (hasTime) {
      ics += `DTSTART:${fmtDateTime(r.reservation_time)}\r\n`;
      if (r.reservation_end_time) {
        const endDt = fmtDateTime(r.reservation_end_time, r.reservation_time);
        if (endDt.length >= 15) ics += `DTEND:${endDt}\r\n`;
      }
    } else {
      ics += `DTSTART;VALUE=DATE:${fmtDate(r.reservation_time)}\r\n`;
    }
    ics += `SUMMARY:${esc(r.title)}\r\n`;

    let desc = r.type ? `Type: ${r.type}` : '';
    if (r.confirmation_number) desc += `\nConfirmation: ${r.confirmation_number}`;
    if (meta.airline) desc += `\nAirline: ${meta.airline}`;
    if (meta.flight_number) desc += `\nFlight: ${meta.flight_number}`;
    if (meta.departure_airport) desc += `\nFrom: ${meta.departure_airport}`;
    if (meta.arrival_airport) desc += `\nTo: ${meta.arrival_airport}`;
    if (meta.train_number) desc += `\nTrain: ${meta.train_number}`;
    if (r.notes) desc += `\n${r.notes}`;
    if (desc) ics += `DESCRIPTION:${esc(desc)}\r\n`;
    if (r.location) ics += `LOCATION:${esc(r.location)}\r\n`;
    ics += `END:VEVENT\r\n`;
  }

  ics += 'END:VCALENDAR\r\n';

  const safeFilename = (trip.title || 'trek-trip').replace(/["\r\n]/g, '').replace(/[^\w\s.-]/g, '_');
  return { ics, filename: `${safeFilename}.ics` };
}

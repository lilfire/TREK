import crypto from 'crypto';
import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';
import { db } from '../db/database';
import { JWT_SECRET } from '../config';
import type { TripRsvp } from '../types';

export interface CreateRsvpResult {
  rsvpId: number;
  userId: number;
  authToken: string;
}

/**
 * Returns the user ID and stored email for an existing user matching the given
 * email (case-insensitive), or creates a new account with a securely generated
 * random password and returns the new user's ID and stored email.
 */
export function findOrCreateUserForRsvp(
  name: string,
  email: string,
): { userId: number; storedEmail: string } {
  const normalizedEmail = email.toLowerCase();
  const existing = db.prepare(
    'SELECT id, email FROM users WHERE LOWER(email) = ?',
  ).get(normalizedEmail) as { id: number; email: string } | undefined;

  if (existing) return { userId: existing.id, storedEmail: existing.email };

  // Derive a unique username from the submitted name
  const base = name.trim()
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_|_$/g, '')
    .slice(0, 40) || 'user';

  let username = base;
  let attempt = 0;
  for (;;) {
    const conflict = db.prepare('SELECT id FROM users WHERE LOWER(username) = LOWER(?)').get(username);
    if (!conflict) break;
    attempt++;
    username = `${base}_${attempt}`;
  }

  const password = crypto.randomBytes(24).toString('base64');
  const password_hash = bcrypt.hashSync(password, 12);

  const result = db.prepare(
    'INSERT INTO users (username, email, password_hash, role) VALUES (?, ?, ?, ?)',
  ).run(username, normalizedEmail, password_hash, 'user');

  return { userId: Number(result.lastInsertRowid), storedEmail: normalizedEmail };
}

export function createRsvp(params: {
  tripId: number;
  userId: number;
  name: string;
  email: string;
  message?: string;
}): CreateRsvpResult {
  const { tripId, userId, name, email, message } = params;

  const result = db.prepare(
    'INSERT INTO trip_rsvps (trip_id, user_id, name, email, message) VALUES (?, ?, ?, ?, ?)',
  ).run(tripId, userId, name, email, message ?? null);

  const rsvpId = Number(result.lastInsertRowid);

  const pv = (
    db.prepare('SELECT password_version FROM users WHERE id = ?').get(userId) as
      | { password_version?: number }
      | undefined
  )?.password_version ?? 0;

  const authToken = jwt.sign(
    { id: userId, pv },
    JWT_SECRET,
    { expiresIn: '1h', algorithm: 'HS256' },
  );

  return { rsvpId, userId, authToken };
}

export function listRsvpsForTrip(tripId: number): TripRsvp[] {
  return db.prepare(
    'SELECT * FROM trip_rsvps WHERE trip_id = ? ORDER BY created_at ASC',
  ).all(tripId) as TripRsvp[];
}

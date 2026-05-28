import express, { Request, Response, NextFunction } from 'express';
import { db } from '../db/database';
import { getPublicTripData, getPublicTripsList } from '../services/publicTripService';
import { findOrCreateUserForRsvp, createRsvp, CreateRsvpResult } from '../services/rsvpService';
import { addMember } from '../services/tripService';
import { sendRsvpConfirmationEmail } from '../services/rsvpEmailService';
import { logError } from '../services/auditLog';

const router = express.Router();

// Rate limiter — matches the per-IP pattern used on the auth login route
const RATE_LIMIT_WINDOW = 15 * 60 * 1000;
const RATE_LIMIT_CLEANUP = 5 * 60 * 1000;

const rsvpAttempts = new Map<string, { count: number; first: number }>();
setInterval(() => {
  const now = Date.now();
  for (const [key, record] of rsvpAttempts) {
    if (now - record.first >= RATE_LIMIT_WINDOW) rsvpAttempts.delete(key);
  }
}, RATE_LIMIT_CLEANUP).unref?.();

function rsvpRateLimiter(req: Request, res: Response, next: NextFunction) {
  const key = req.ip || 'unknown';
  const now = Date.now();
  const record = rsvpAttempts.get(key);
  if (record && record.count >= 10 && now - record.first < RATE_LIMIT_WINDOW) {
    return res.status(429).json({ error: 'Too many attempts. Please try again later.' });
  }
  if (!record || now - record.first >= RATE_LIMIT_WINDOW) {
    rsvpAttempts.set(key, { count: 1, first: now });
  } else {
    record.count++;
  }
  next();
}

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

router.get('/', (_req: Request, res: Response) => {
  res.json(getPublicTripsList());
});

router.get('/:id', (req: Request, res: Response) => {
  const data = getPublicTripData(req.params.id);
  if (!data) return res.status(404).json({ error: 'Trip not found' });
  res.json(data);
});

router.post('/:id/rsvp', rsvpRateLimiter, (req: Request, res: Response) => {
  const tripId = Number(req.params.id);
  if (!Number.isFinite(tripId)) return res.status(404).json({ error: 'Trip not found' });

  const trip = db.prepare(
    'SELECT id, user_id, title FROM trips WHERE id = ? AND is_public = 1',
  ).get(tripId) as { id: number; user_id: number; title: string } | undefined;
  if (!trip) return res.status(404).json({ error: 'Trip not found' });

  const { name, email, message } = req.body;

  if (!name || typeof name !== 'string' || !name.trim()) {
    return res.status(400).json({ error: 'Name is required' });
  }
  if (!email || typeof email !== 'string' || !EMAIL_REGEX.test(email.trim())) {
    return res.status(400).json({ error: 'A valid email address is required' });
  }

  const trimmedName = name.trim();
  const { userId, storedEmail } = findOrCreateUserForRsvp(trimmedName, email.trim());

  // Skip addMember if submitter is the trip owner; catch "already a member" gracefully
  if (userId !== trip.user_id) {
    try {
      addMember(tripId, storedEmail, trip.user_id, trip.user_id);
    } catch (err: unknown) {
      if (!(err instanceof Error && err.message === 'User already has access')) {
        throw err;
      }
    }
  }

  let result: CreateRsvpResult;
  try {
    result = createRsvp({
      tripId,
      userId,
      name: trimmedName,
      email: storedEmail,
      message: typeof message === 'string' && message.trim() ? message.trim() : undefined,
    });
  } catch (err: unknown) {
    if (err instanceof Error && (err as any).code === 'SQLITE_CONSTRAINT_UNIQUE') {
      return res.status(409).json({
        error: 'duplicate_rsvp',
        message: 'This email already has an RSVP for this trip.',
      });
    }
    throw err;
  }

  res.status(201).json(result);

  sendRsvpConfirmationEmail(storedEmail, trimmedName, trip.title, trip.id, userId)
    .catch((err) => logError(`RSVP confirmation email failed: ${err}`));
});

export default router;
export { rsvpAttempts };

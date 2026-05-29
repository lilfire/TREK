import express, { Request, Response, NextFunction } from 'express';
import { db } from '../db/database';
import { getPublicTripData, getPublicTripsList } from '../services/publicTripService';
import { findOrCreateUserForRsvp, createRsvp, CreateRsvpResult } from '../services/rsvpService';
import { addMember } from '../services/tripService';
import { sendRsvpConfirmationEmail } from '../services/rsvpEmailService';
import { logError } from '../services/auditLog';
import { optionalAuth } from '../middleware/auth';
import { createPaypalOrder, capturePaypalOrder, recordPayment, updatePaymentStatus, getPaypalClientId } from '../services/paypalService';
import type { OptionalAuthRequest } from '../types';

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

router.post('/:id/rsvp', rsvpRateLimiter, optionalAuth, (req: Request, res: Response) => {
  const tripId = Number(req.params.id);
  if (!Number.isFinite(tripId)) return res.status(404).json({ error: 'Trip not found' });

  const trip = db.prepare(
    'SELECT id, user_id, title, rsvp_deadline FROM trips WHERE id = ? AND is_public = 1',
  ).get(tripId) as { id: number; user_id: number; title: string; rsvp_deadline: string | null } | undefined;
  if (!trip) return res.status(404).json({ error: 'Trip not found' });

  if (trip.rsvp_deadline) {
    const today = new Date().toISOString().split('T')[0];
    if (today > trip.rsvp_deadline) {
      return res.status(400).json({ error: 'rsvp.error.registrationClosed' });
    }
  }

  const authReq = req as OptionalAuthRequest;

  if (authReq.user) {
    const { id: userId, username: name, email } = authReq.user;

    const existingRsvp = db.prepare('SELECT id FROM trip_rsvps WHERE trip_id = ? AND user_id = ?').get(tripId, userId);
    if (existingRsvp) {
      return res.status(200).json({ alreadyMember: true });
    }

    if (userId !== trip.user_id) {
      try {
        addMember(tripId, email, trip.user_id, trip.user_id);
      } catch (err: unknown) {
        if (!(err instanceof Error && err.message === 'User already has access')) {
          throw err;
        }
      }
    }

    const result = createRsvp({ tripId, userId, name, email });
    res.status(201).json(result);

    sendRsvpConfirmationEmail(email, name, trip.title, trip.id, userId)
      .catch((err) => logError(`RSVP confirmation email failed: ${err}`));
    return;
  }

  // Unauthenticated path — validate name + email from body
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

// ── PayPal: create order ──────────────────────────────────────────────────

router.post('/:id/rsvp/payment-order', rsvpRateLimiter, async (req: Request, res: Response) => {
  const tripId = Number(req.params.id);
  if (!Number.isFinite(tripId)) return res.status(404).json({ error: 'Trip not found' });

  const trip = db.prepare(
    'SELECT id, registration_fee, fee_mode, currency FROM trips WHERE id = ? AND is_public = 1',
  ).get(tripId) as { id: number; registration_fee: number | null; fee_mode: string | null; currency: string } | undefined;
  if (!trip) return res.status(404).json({ error: 'Trip not found' });
  if (!trip.registration_fee || trip.fee_mode !== 'rsvp') {
    return res.status(400).json({ error: 'This trip does not require a PayPal payment' });
  }
  if (!getPaypalClientId()) {
    return res.status(503).json({ error: 'PayPal is not configured' });
  }

  const { amount, currency } = req.body;
  if (typeof amount !== 'number' || amount <= 0) return res.status(400).json({ error: 'amount must be a positive number' });
  if (typeof currency !== 'string' || !currency.trim()) return res.status(400).json({ error: 'currency is required' });

  try {
    const orderId = await createPaypalOrder(amount, currency.trim().toUpperCase());
    res.json({ orderId });
  } catch (err: unknown) {
    logError(`PayPal create order error: ${err}`);
    res.status(502).json({ error: 'Failed to create PayPal order' });
  }
});

// ── PayPal: capture order ─────────────────────────────────────────────────

router.post('/:id/rsvp/payment-capture', rsvpRateLimiter, async (req: Request, res: Response) => {
  const tripId = Number(req.params.id);
  if (!Number.isFinite(tripId)) return res.status(404).json({ error: 'Trip not found' });

  const trip = db.prepare(
    'SELECT id, registration_fee, currency FROM trips WHERE id = ? AND is_public = 1',
  ).get(tripId) as { id: number; registration_fee: number | null; currency: string } | undefined;
  if (!trip) return res.status(404).json({ error: 'Trip not found' });

  const { orderId, rsvpId } = req.body;
  if (!orderId || typeof orderId !== 'string') return res.status(400).json({ error: 'orderId is required' });
  if (!rsvpId || !Number.isFinite(Number(rsvpId))) return res.status(400).json({ error: 'rsvpId is required' });

  const rsvp = db.prepare('SELECT id FROM trip_rsvps WHERE id = ? AND trip_id = ?').get(Number(rsvpId), tripId);
  if (!rsvp) return res.status(404).json({ error: 'RSVP not found' });

  const amount = trip.registration_fee ?? 0;
  const currency = trip.currency;

  const paymentId = recordPayment({ rsvpId: Number(rsvpId), amount, currency, status: 'pending', providerOrderId: orderId });

  try {
    const captureId = await capturePaypalOrder(orderId);
    updatePaymentStatus(paymentId, 'completed', captureId);
    res.json({ success: true, captureId });
  } catch (err: unknown) {
    updatePaymentStatus(paymentId, 'failed');
    logError(`PayPal capture error: ${err}`);
    res.status(502).json({ error: 'Payment capture failed. Please try again.' });
  }
});

export default router;
export { rsvpAttempts };

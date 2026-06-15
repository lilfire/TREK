/**
 * Unit tests for rsvpEmailService.ts (LSO-1375).
 * Covers sendRsvpConfirmationEmail — all branches.
 */
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';

// ── Mocks ──────────────────────────────────────────────────────────────────

const { mockSendEmail } = vi.hoisted(() => ({
  mockSendEmail: vi.fn(),
}));

vi.mock('../../../src/services/notifications', () => ({
  sendEmail: mockSendEmail,
  getUserLanguage: vi.fn(() => 'en'),
  getAppUrl: vi.fn(() => 'https://trek.example.com'),
  buildEmailHtml: vi.fn((s: string, b: string) => `<html>${s}${b}</html>`),
}));

vi.mock('../../../src/db/database', () => ({
  db: { prepare: () => ({ get: vi.fn(() => undefined) }) },
}));

import { sendRsvpConfirmationEmail } from '../../../src/services/rsvpEmailService';
import { getUserLanguage } from '../../../src/services/notifications';

afterEach(() => {
  mockSendEmail.mockReset();
  vi.mocked(getUserLanguage).mockReset().mockReturnValue('en');
});

// ── sendRsvpConfirmationEmail ─────────────────────────────────────────────

describe('sendRsvpConfirmationEmail', () => {
  beforeEach(() => {
    mockSendEmail.mockResolvedValue(true);
  });

  it('RSVP-EMAIL-001 — calls sendEmail with correct to address', async () => {
    await sendRsvpConfirmationEmail('alice@example.com', 'Alice', 'Tokyo Trip', 42);
    expect(mockSendEmail).toHaveBeenCalledOnce();
    expect(mockSendEmail.mock.calls[0][0]).toBe('alice@example.com');
  });

  it('RSVP-EMAIL-002 — subject contains trip title', async () => {
    await sendRsvpConfirmationEmail('alice@example.com', 'Alice', 'Tokyo Trip', 42);
    const subject: string = mockSendEmail.mock.calls[0][1];
    expect(subject).toContain('Tokyo Trip');
  });

  it('RSVP-EMAIL-003 — body contains recipient name and trip title', async () => {
    await sendRsvpConfirmationEmail('alice@example.com', 'Alice Smith', 'Tokyo Trip', 42);
    const body: string = mockSendEmail.mock.calls[0][2];
    expect(body).toContain('Alice Smith');
    expect(body).toContain('Tokyo Trip');
  });

  it('RSVP-EMAIL-004 — body contains a link to /trips/public/:id', async () => {
    await sendRsvpConfirmationEmail('alice@example.com', 'Alice', 'Tokyo Trip', 42);
    const body: string = mockSendEmail.mock.calls[0][2];
    expect(body).toContain('/trips/public/42');
  });

  it('RSVP-EMAIL-005 — returns true when sendEmail succeeds', async () => {
    mockSendEmail.mockResolvedValue(true);
    const result = await sendRsvpConfirmationEmail('alice@example.com', 'Alice', 'Trip', 1);
    expect(result).toBe(true);
  });

  it('RSVP-EMAIL-006 — returns false when sendEmail returns false', async () => {
    mockSendEmail.mockResolvedValue(false);
    const result = await sendRsvpConfirmationEmail('alice@example.com', 'Alice', 'Trip', 1);
    expect(result).toBe(false);
  });

  it('RSVP-EMAIL-007 — uses getUserLanguage when userId provided', async () => {
    vi.mocked(getUserLanguage).mockReturnValue('de');
    await sendRsvpConfirmationEmail('alice@example.com', 'Alice', 'Reise', 10, 99);
    expect(getUserLanguage).toHaveBeenCalledWith(99);
    const subject: string = mockSendEmail.mock.calls[0][1];
    expect(subject).toContain('bestätigt');
  });

  it('RSVP-EMAIL-008 — defaults to English when no userId', async () => {
    await sendRsvpConfirmationEmail('alice@example.com', 'Alice', 'My Trip', 5);
    expect(getUserLanguage).not.toHaveBeenCalled();
    const subject: string = mockSendEmail.mock.calls[0][1];
    expect(subject).toContain('confirmed');
  });

  it('RSVP-EMAIL-009 — passes userId to sendEmail', async () => {
    await sendRsvpConfirmationEmail('alice@example.com', 'Alice', 'Trip', 1, 42);
    expect(mockSendEmail.mock.calls[0][3]).toBe(42);
  });

  it('RSVP-EMAIL-010 — French subject when lang=fr', async () => {
    vi.mocked(getUserLanguage).mockReturnValue('fr');
    await sendRsvpConfirmationEmail('alice@example.com', 'Alice', 'Voyage', 1, 5);
    const subject: string = mockSendEmail.mock.calls[0][1];
    expect(subject).toContain('confirmé');
  });

  it('RSVP-EMAIL-011 — Spanish subject when lang=es', async () => {
    vi.mocked(getUserLanguage).mockReturnValue('es');
    await sendRsvpConfirmationEmail('alice@example.com', 'Alice', 'Viaje', 1, 5);
    const subject: string = mockSendEmail.mock.calls[0][1];
    expect(subject).toContain('confirmado');
  });

  it('RSVP-EMAIL-012 — unknown lang falls back gracefully (subject still contains tripTitle)', async () => {
    vi.mocked(getUserLanguage).mockReturnValue('xx');
    await sendRsvpConfirmationEmail('alice@example.com', 'Alice', 'My Trip', 7, 5);
    const subject: string = mockSendEmail.mock.calls[0][1];
    expect(subject).toContain('My Trip');
  });

  it('RSVP-EMAIL-013 — body includes the set-password link when setPasswordUrl is provided', async () => {
    const url = 'https://trek.example.com/reset-password?token=abc123';
    await sendRsvpConfirmationEmail('alice@example.com', 'Alice', 'My Trip', 7, 5, url);
    const body: string = mockSendEmail.mock.calls[0][2];
    expect(body).toContain(url);
    expect(body).toContain('Set your password');
    expect(body).toContain('7 days');
  });

  it('RSVP-EMAIL-014 — body has no set-password section when setPasswordUrl is omitted', async () => {
    await sendRsvpConfirmationEmail('alice@example.com', 'Alice', 'My Trip', 7, 5);
    const body: string = mockSendEmail.mock.calls[0][2];
    expect(body).not.toContain('reset-password');
    expect(body).not.toContain('Set your password');
  });

  it('RSVP-EMAIL-015 — set-password section is localized (German) when lang=de', async () => {
    vi.mocked(getUserLanguage).mockReturnValue('de');
    const url = 'https://trek.example.com/reset-password?token=de1';
    await sendRsvpConfirmationEmail('alice@example.com', 'Alice', 'Reise', 7, 5, url);
    const body: string = mockSendEmail.mock.calls[0][2];
    expect(body).toContain(url);
    expect(body).toContain('Passwort');
  });
});

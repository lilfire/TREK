/**
 * Unit tests for notifications.ts — sendEmail three-tier logic,
 * resolveFromAddress, sendViaSMTP, sendViaDirect (LSO-1375).
 */
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';

// ── Module mocks (must be hoisted above imports) ──────────────────────────

vi.mock('../../../src/db/database', () => ({
  db: {
    prepare: () => ({
      get: vi.fn(() => undefined),
      all: vi.fn(() => []),
    }),
  },
}));

vi.mock('../../../src/services/apiKeyCrypto', () => ({
  decrypt_api_key: vi.fn((v: string | null) => v),
}));

vi.mock('../../../src/services/auditLog', () => ({
  logInfo: vi.fn(),
  logDebug: vi.fn(),
  logError: vi.fn(),
  logWarn: vi.fn(),
}));

const mockSendMail = vi.fn();
vi.mock('nodemailer', () => ({
  default: {
    createTransport: vi.fn(() => ({ sendMail: mockSendMail })),
  },
}));

import { sendEmail } from '../../../src/services/notifications';
import { logInfo, logError, logWarn } from '../../../src/services/auditLog';
import nodemailer from 'nodemailer';

// ── Helpers ────────────────────────────────────────────────────────────────

function setSmtpEnv() {
  process.env.SMTP_HOST = 'smtp.example.com';
  process.env.SMTP_PORT = '587';
  process.env.SMTP_FROM = 'noreply@example.com';
  process.env.SMTP_USER = 'user@example.com';
  process.env.SMTP_PASS = 'secret';
}

function clearSmtpEnv() {
  delete process.env.SMTP_HOST;
  delete process.env.SMTP_PORT;
  delete process.env.SMTP_FROM;
  delete process.env.SMTP_USER;
  delete process.env.SMTP_PASS;
}

afterEach(() => {
  vi.unstubAllEnvs();
  clearSmtpEnv();
  mockSendMail.mockReset();
  vi.mocked(logInfo).mockClear();
  vi.mocked(logError).mockClear();
  vi.mocked(logWarn).mockClear();
  vi.mocked(nodemailer.createTransport).mockClear();
});

// ── sendEmail — SMTP path ─────────────────────────────────────────────────

describe('sendEmail — SMTP path', () => {
  beforeEach(() => {
    setSmtpEnv();
    mockSendMail.mockResolvedValue({});
  });

  it('EMAIL-SMTP-001 — returns true and calls sendMail when SMTP is configured', async () => {
    const result = await sendEmail('alice@example.com', 'Hello', 'World');
    expect(result).toBe(true);
    expect(mockSendMail).toHaveBeenCalledOnce();
  });

  it('EMAIL-SMTP-002 — passes correct to/subject/from to sendMail', async () => {
    await sendEmail('bob@example.com', 'My Subject', 'My body');
    const call = mockSendMail.mock.calls[0][0];
    expect(call.to).toBe('bob@example.com');
    expect(call.subject).toBe('TREK — My Subject');
    expect(call.from).toBe('noreply@example.com');
  });

  it('EMAIL-SMTP-003 — logs success via logInfo', async () => {
    await sendEmail('alice@example.com', 'Test', 'Body');
    expect(vi.mocked(logInfo)).toHaveBeenCalledWith(expect.stringContaining('alice@example.com'));
  });

  it('EMAIL-SMTP-004 — returns false and logs error when sendMail throws', async () => {
    mockSendMail.mockRejectedValueOnce(new Error('SMTP connection refused'));
    const result = await sendEmail('alice@example.com', 'Test', 'Body');
    expect(result).toBe(false);
    expect(vi.mocked(logError)).toHaveBeenCalledWith(expect.stringContaining('SMTP connection refused'));
  });

  it('EMAIL-SMTP-005 — uses nodemailer.createTransport with SMTP host/port', async () => {
    await sendEmail('alice@example.com', 'Test', 'Body');
    expect(nodemailer.createTransport).toHaveBeenCalledWith(
      expect.objectContaining({ host: 'smtp.example.com', port: 587 }),
    );
  });
});

// ── sendEmail — direct transport path ─────────────────────────────────────

describe('sendEmail — direct transport path (no SMTP config)', () => {
  beforeEach(() => {
    process.env.APP_URL = 'https://trek.myserver.com';
    mockSendMail.mockResolvedValue({});
  });

  afterEach(() => {
    delete process.env.APP_URL;
  });

  it('EMAIL-DIRECT-001 — returns true via direct transport when no SMTP configured', async () => {
    const result = await sendEmail('alice@example.com', 'Test', 'Body');
    expect(result).toBe(true);
    expect(mockSendMail).toHaveBeenCalledOnce();
  });

  it('EMAIL-DIRECT-002 — uses { direct: true } transport option', async () => {
    await sendEmail('alice@example.com', 'Test', 'Body');
    expect(nodemailer.createTransport).toHaveBeenCalledWith(
      expect.objectContaining({ direct: true }),
    );
  });

  it('EMAIL-DIRECT-003 — logs success via logInfo with (direct) marker', async () => {
    await sendEmail('alice@example.com', 'Test', 'Body');
    expect(vi.mocked(logInfo)).toHaveBeenCalledWith(expect.stringContaining('direct'));
  });

  it('EMAIL-DIRECT-004 — returns false and logs error when direct sendMail throws', async () => {
    mockSendMail.mockRejectedValueOnce(new Error('Network unreachable'));
    const result = await sendEmail('alice@example.com', 'Test', 'Body');
    expect(result).toBe(false);
    expect(vi.mocked(logError)).toHaveBeenCalledWith(expect.stringContaining('Network unreachable'));
  });

  it('EMAIL-DIRECT-005 — from address derived from APP_URL hostname', async () => {
    await sendEmail('alice@example.com', 'Test', 'Body');
    const call = mockSendMail.mock.calls[0][0];
    expect(call.from).toBe('noreply@trek.myserver.com');
  });
});

// ── sendEmail — localhost URL drops email ─────────────────────────────────

describe('sendEmail — localhost URL (no-op)', () => {
  afterEach(() => {
    delete process.env.APP_URL;
    delete process.env.PORT;
  });

  it('EMAIL-LOCAL-001 — returns false when APP_URL is localhost', async () => {
    process.env.APP_URL = 'http://localhost:3001';
    const result = await sendEmail('alice@example.com', 'Test', 'Body');
    expect(result).toBe(false);
    expect(mockSendMail).not.toHaveBeenCalled();
  });

  it('EMAIL-LOCAL-002 — returns false when APP_URL is 127.0.0.1', async () => {
    process.env.APP_URL = 'http://127.0.0.1:3001';
    const result = await sendEmail('alice@example.com', 'Test', 'Body');
    expect(result).toBe(false);
    expect(mockSendMail).not.toHaveBeenCalled();
  });

  it('EMAIL-LOCAL-003 — logs a warning when dropping email due to localhost', async () => {
    process.env.APP_URL = 'http://localhost:3001';
    await sendEmail('alice@example.com', 'Test', 'Body');
    expect(vi.mocked(logWarn)).toHaveBeenCalledWith(expect.stringContaining('localhost'));
  });

  it('EMAIL-LOCAL-004 — does not crash; returns false cleanly', async () => {
    process.env.APP_URL = 'http://localhost:3001';
    await expect(sendEmail('alice@example.com', 'Test', 'Body')).resolves.toBe(false);
  });

  it('EMAIL-LOCAL-005 — no SMTP env + no APP_URL defaults to localhost, returns false', async () => {
    // Default getAppUrl() returns http://localhost:{PORT}
    const result = await sendEmail('alice@example.com', 'Test', 'Body');
    expect(result).toBe(false);
    expect(mockSendMail).not.toHaveBeenCalled();
  });
});

// ── resolveFromAddress (tested indirectly through sendEmail) ──────────────

describe('resolveFromAddress — via sendEmail from address', () => {
  afterEach(() => {
    delete process.env.APP_URL;
    delete process.env.SMTP_FROM;
  });

  it('EMAIL-FROM-001 — uses SMTP_FROM env var when set (SMTP path)', async () => {
    setSmtpEnv();
    process.env.SMTP_FROM = 'custom@example.com';
    mockSendMail.mockResolvedValue({});
    await sendEmail('alice@example.com', 'Test', 'Body');
    const call = mockSendMail.mock.calls[0][0];
    // SMTP config already overrides from with config.from, so both point to SMTP_FROM
    expect(call.from).toBe('custom@example.com');
    clearSmtpEnv();
  });

  it('EMAIL-FROM-002 — derives noreply@host from APP_URL in direct path', async () => {
    process.env.APP_URL = 'https://myapp.example.org';
    mockSendMail.mockResolvedValue({});
    await sendEmail('alice@example.com', 'Test', 'Body');
    const call = mockSendMail.mock.calls[0][0];
    expect(call.from).toBe('noreply@myapp.example.org');
    delete process.env.APP_URL;
  });
});

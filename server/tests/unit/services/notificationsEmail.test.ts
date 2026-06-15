/**
 * Unit tests for notifications.ts — sendEmail three-tier logic,
 * resolveFromAddress, sendViaSMTP, sendViaDirect (LSO-1375).
 */
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';

// ── Module mocks (must be hoisted above imports) ──────────────────────────

const { appSettings } = vi.hoisted(() => ({ appSettings: new Map<string, string>() }));
vi.mock('../../../src/db/database', () => ({
  db: {
    prepare: () => ({
      get: (key?: string) => (key !== undefined && appSettings.has(key)) ? { value: appSettings.get(key) } : undefined,
      all: () => [],
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

const { resolveMxMock } = vi.hoisted(() => ({ resolveMxMock: vi.fn() }));
vi.mock('dns/promises', () => ({ resolveMx: resolveMxMock }));

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

  it('EMAIL-SMTP-006 — logs structured transport=smtp line before dispatch', async () => {
    await sendEmail('alice@example.com', 'Test', 'Body');
    expect(vi.mocked(logInfo)).toHaveBeenCalledWith(
      expect.stringContaining('transport=smtp'),
    );
    // Verify the transport log line precedes the SMTP-specific dispatch log
    const calls = vi.mocked(logInfo).mock.calls.map((c) => String(c[0]));
    const transportLogIdx = calls.findIndex((m) => m.includes('transport=smtp'));
    const sendLogIdx = calls.findIndex((m) => m.startsWith('Email sent to='));
    expect(transportLogIdx).toBeGreaterThanOrEqual(0);
    expect(sendLogIdx).toBeGreaterThanOrEqual(0);
    expect(transportLogIdx).toBeLessThan(sendLogIdx);
  });
});

// ── sendEmail — direct transport path ─────────────────────────────────────

describe('sendEmail — direct transport path (no SMTP config)', () => {
  beforeEach(() => {
    process.env.APP_URL = 'https://trek.myserver.com';
    mockSendMail.mockResolvedValue({});
    resolveMxMock.mockReset();
    resolveMxMock.mockResolvedValue([{ exchange: 'mx.example.com', priority: 10 }]);
  });

  afterEach(() => {
    delete process.env.APP_URL;
  });

  it('EMAIL-DIRECT-001 — returns true via direct transport when no SMTP configured', async () => {
    const result = await sendEmail('alice@example.com', 'Test', 'Body');
    expect(result).toBe(true);
    expect(mockSendMail).toHaveBeenCalledOnce();
  });

  it('EMAIL-DIRECT-002 — connects to the resolved MX host on port 25', async () => {
    await sendEmail('alice@example.com', 'Test', 'Body');
    expect(resolveMxMock).toHaveBeenCalledWith('example.com');
    expect(nodemailer.createTransport).toHaveBeenCalledWith(
      expect.objectContaining({ host: 'mx.example.com', port: 25 }),
    );
  });

  it('EMAIL-DIRECT-002b — falls back to the next MX host when the first refuses the connection', async () => {
    resolveMxMock.mockResolvedValue([
      { exchange: 'mx1.example.com', priority: 10 },
      { exchange: 'mx2.example.com', priority: 20 },
    ]);
    mockSendMail.mockReset();
    mockSendMail.mockRejectedValueOnce(new Error('ECONNREFUSED'));
    mockSendMail.mockResolvedValueOnce({});

    const result = await sendEmail('alice@example.com', 'Test', 'Body');

    expect(result).toBe(true);
    const hosts = vi.mocked(nodemailer.createTransport).mock.calls.map((c) => (c[0] as any).host);
    expect(hosts).toEqual(['mx1.example.com', 'mx2.example.com']);
  });

  it('EMAIL-DIRECT-002c — sorts MX hosts by ascending priority', async () => {
    resolveMxMock.mockResolvedValue([
      { exchange: 'low.example.com', priority: 50 },
      { exchange: 'high.example.com', priority: 5 },
    ]);
    await sendEmail('alice@example.com', 'Test', 'Body');
    expect((vi.mocked(nodemailer.createTransport).mock.calls[0][0] as any).host).toBe('high.example.com');
  });

  it('EMAIL-DIRECT-002d — falls back to the recipient domain when no MX records exist', async () => {
    resolveMxMock.mockResolvedValue([]);
    await sendEmail('alice@example.com', 'Test', 'Body');
    expect((vi.mocked(nodemailer.createTransport).mock.calls[0][0] as any).host).toBe('example.com');
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

  it('EMAIL-DIRECT-006 — logs structured transport=direct line before dispatch', async () => {
    await sendEmail('alice@example.com', 'Test', 'Body');
    expect(vi.mocked(logInfo)).toHaveBeenCalledWith(
      expect.stringContaining('transport=direct'),
    );
    const infoCalls = vi.mocked(logInfo).mock.calls.map((c) => String(c[0]));
    const transportLogIdx = infoCalls.findIndex((m) => m.includes('transport=direct'));
    const sendLogIdx = infoCalls.findIndex((m) => m.startsWith('Email sent (direct) to='));
    expect(transportLogIdx).toBeGreaterThanOrEqual(0);
    expect(sendLogIdx).toBeGreaterThanOrEqual(0);
    expect(transportLogIdx).toBeLessThan(sendLogIdx);
  });
});

// ── sendEmail — Brevo HTTP transport ──────────────────────────────────────

describe('sendEmail — Brevo HTTP transport', () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    appSettings.set('brevo_api_key', 'xkeysib-test');
    appSettings.set('brevo_from', 'noreply@brevo-sender.com');
    fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 201, text: async () => '' });
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    appSettings.delete('brevo_api_key');
    appSettings.delete('brevo_from');
    appSettings.delete('brevo_from_name');
    vi.unstubAllGlobals();
  });

  it('EMAIL-BREVO-001 — posts to the Brevo API with api-key header and recipient', async () => {
    const result = await sendEmail('alice@gmail.com', 'Test', 'Body');
    expect(result).toBe(true);
    expect(fetchMock).toHaveBeenCalledOnce();
    const [url, opts] = fetchMock.mock.calls[0];
    expect(url).toBe('https://api.brevo.com/v3/smtp/email');
    expect(opts.method).toBe('POST');
    expect((opts.headers as Record<string, string>)['api-key']).toBe('xkeysib-test');
    const payload = JSON.parse(opts.body as string);
    expect(payload.to).toEqual([{ email: 'alice@gmail.com' }]);
    expect(payload.sender.email).toBe('noreply@brevo-sender.com');
    expect(payload.subject).toContain('Test');
  });

  it('EMAIL-BREVO-002 — logs success with (brevo) marker on 2xx', async () => {
    await sendEmail('alice@gmail.com', 'Test', 'Body');
    expect(vi.mocked(logInfo)).toHaveBeenCalledWith(expect.stringContaining('(brevo)'));
  });

  it('EMAIL-BREVO-003 — returns false and logs error on non-2xx response', async () => {
    fetchMock.mockResolvedValue({ ok: false, status: 401, text: async () => 'Unauthorized' });
    const result = await sendEmail('alice@gmail.com', 'Test', 'Body');
    expect(result).toBe(false);
    expect(vi.mocked(logError)).toHaveBeenCalledWith(expect.stringContaining('401'));
  });

  it('EMAIL-BREVO-004 — takes precedence over SMTP when both are configured', async () => {
    setSmtpEnv();
    try {
      await sendEmail('alice@gmail.com', 'Test', 'Body');
      expect(fetchMock).toHaveBeenCalledOnce();
      expect(mockSendMail).not.toHaveBeenCalled();
    } finally {
      clearSmtpEnv();
    }
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

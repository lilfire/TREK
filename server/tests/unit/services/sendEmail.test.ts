/**
 * Unit tests for sendEmail() in notifications.ts — LSO-1608.
 *
 * Verifies that when no SMTP is configured and APP_URL is localhost,
 * the function surfaces a visible warning (logWarn) rather than silently
 * dropping the email via logInfo. Also verifies the unchanged behavior
 * of the SMTP and non-localhost direct-transport paths.
 */
import { describe, it, expect, vi, beforeAll, beforeEach, afterEach, afterAll } from 'vitest';

const { testDb, dbMock } = vi.hoisted(() => {
  const Database = require('better-sqlite3');
  const db = new Database(':memory:');
  db.exec('PRAGMA journal_mode = WAL');
  db.exec('PRAGMA foreign_keys = ON');
  const mock = {
    db,
    closeDb: () => {},
    reinitialize: () => {},
    getPlaceWithTags: () => null,
    canAccessTrip: () => null,
    isOwner: () => false,
  };
  return { testDb: db, dbMock: mock };
});

vi.mock('../../../src/db/database', () => dbMock);
vi.mock('../../../src/config', () => ({
  JWT_SECRET: 'test-jwt-secret-for-trek-testing-only',
  ENCRYPTION_KEY: 'a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6a7b8c9d0e1f2a3b4c5d6a7b8c9d0e1f2',
  updateJwtSecret: () => {},
}));
vi.mock('../../../src/services/apiKeyCrypto', () => ({
  decrypt_api_key: (v: string | null) => v,
  maybe_encrypt_api_key: (v: string) => v,
  encrypt_api_key: (v: string) => v,
}));

const { sendMailMock, logInfoMock, logDebugMock, logErrorMock, logWarnMock } = vi.hoisted(() => ({
  sendMailMock: vi.fn().mockResolvedValue({ accepted: ['to@example.com'] }),
  logInfoMock: vi.fn(),
  logDebugMock: vi.fn(),
  logErrorMock: vi.fn(),
  logWarnMock: vi.fn(),
}));

vi.mock('nodemailer', () => ({
  default: {
    createTransport: vi.fn(() => ({
      sendMail: sendMailMock,
      verify: vi.fn().mockResolvedValue(true),
    })),
  },
}));

vi.mock('../../../src/services/auditLog', () => ({
  logInfo: logInfoMock,
  logDebug: logDebugMock,
  logError: logErrorMock,
  logWarn: logWarnMock,
  LOG_LEVEL: 'info',
  writeAudit: vi.fn(),
  getClientIp: vi.fn(),
}));

import { createTables } from '../../../src/db/schema';
import { runMigrations } from '../../../src/db/migrations';
import { resetTestDb } from '../../helpers/test-db';
import { setAppSetting } from '../../helpers/factories';
import { sendEmail } from '../../../src/services/notifications';

const ORIGINAL_ENV = { ...process.env };

function clearEmailEnv(): void {
  delete process.env.APP_URL;
  delete process.env.ALLOWED_ORIGINS;
  delete process.env.PORT;
  delete process.env.SMTP_HOST;
  delete process.env.SMTP_PORT;
  delete process.env.SMTP_USER;
  delete process.env.SMTP_PASS;
  delete process.env.SMTP_FROM;
}

function configureSmtp(): void {
  setAppSetting(testDb, 'smtp_host', 'smtp.example.com');
  setAppSetting(testDb, 'smtp_port', '587');
  setAppSetting(testDb, 'smtp_from', 'trek@example.com');
}

beforeAll(() => {
  createTables(testDb);
  runMigrations(testDb);
});

beforeEach(() => {
  resetTestDb(testDb);
  sendMailMock.mockClear();
  sendMailMock.mockResolvedValue({ accepted: ['to@example.com'] });
  logInfoMock.mockClear();
  logDebugMock.mockClear();
  logErrorMock.mockClear();
  logWarnMock.mockClear();
  clearEmailEnv();
});

afterEach(() => {
  clearEmailEnv();
});

afterAll(() => {
  testDb.close();
  process.env = { ...ORIGINAL_ENV };
});

describe('sendEmail() — LSO-1608 localhost surfacing', () => {
  it('SE-001 — SMTP configured + APP_URL=localhost: sends via SMTP, localhost guard never reached', async () => {
    configureSmtp();
    process.env.APP_URL = 'http://localhost:3000';

    const result = await sendEmail('user@example.com', 'Hello', 'Body');

    expect(result).toBe(true);
    expect(sendMailMock).toHaveBeenCalledTimes(1);
    // The localhost-drop warning must never be emitted on the SMTP path.
    const localhostDropCalls = logWarnMock.mock.calls.filter(
      ([msg]) => typeof msg === 'string' && msg.includes('sendEmail: email NOT sent')
    );
    expect(localhostDropCalls).toHaveLength(0);
  });

  it('SE-002 — no SMTP + APP_URL=localhost: returns false and logWarn surfaces the actionable warning', async () => {
    process.env.APP_URL = 'http://localhost:3000';

    const result = await sendEmail('user@example.com', 'Hello', 'Body');

    expect(result).toBe(false);
    expect(sendMailMock).not.toHaveBeenCalled();

    const dropWarnings = logWarnMock.mock.calls
      .map(([msg]) => (typeof msg === 'string' ? msg : ''))
      .filter(msg => msg.includes('sendEmail: email NOT sent'));
    expect(dropWarnings.length).toBe(1);
    const warning = dropWarnings[0];
    expect(warning).toContain('no SMTP configured');
    expect(warning).toContain('localhost');
    expect(warning).toContain('user@example.com');
    expect(warning).toContain('Hello');
  });

  it('SE-003 — no SMTP + APP_URL=https domain: attempts direct transport, no localhost warning', async () => {
    process.env.APP_URL = 'https://trek.example.com';

    const result = await sendEmail('user@example.com', 'Hello', 'Body');

    expect(result).toBe(true);
    expect(sendMailMock).toHaveBeenCalledTimes(1);
    // Direct transport carries a derived from address from the APP_URL hostname.
    expect(sendMailMock.mock.calls[0][0].from).toBe('noreply@trek.example.com');

    // No localhost-drop warning should be emitted on a real-domain APP_URL.
    const localhostDropCalls = logWarnMock.mock.calls.filter(
      ([msg]) => typeof msg === 'string' && msg.includes('sendEmail: email NOT sent')
    );
    expect(localhostDropCalls).toHaveLength(0);
    const resolveLocalhostCalls = logWarnMock.mock.calls.filter(
      ([msg]) => typeof msg === 'string' && msg.includes('resolveFromAddress: APP_URL is')
    );
    expect(resolveLocalhostCalls).toHaveLength(0);
  });

  it('SE-004 — SMTP configured + APP_URL=https domain: sends via SMTP', async () => {
    configureSmtp();
    process.env.APP_URL = 'https://trek.example.com';

    const result = await sendEmail('user@example.com', 'Hello', 'Body');

    expect(result).toBe(true);
    expect(sendMailMock).toHaveBeenCalledTimes(1);
    const mail = sendMailMock.mock.calls[0][0];
    expect(mail.to).toBe('user@example.com');
    expect(mail.subject).toBe('TREK — Hello');
    expect(mail.from).toBe('trek@example.com');
    // SMTP path bypasses the localhost guard entirely.
    const localhostDropCalls = logWarnMock.mock.calls.filter(
      ([msg]) => typeof msg === 'string' && msg.includes('sendEmail: email NOT sent')
    );
    expect(localhostDropCalls).toHaveLength(0);
  });

  it('SE-005 — unparseable URL with no SMTP returns false early via the new URL() catch', async () => {
    // The try/catch around `new URL(getAppUrl()).hostname` in sendEmail() is defensive:
    // it protects against a getAppUrl() that returns something the URL constructor rejects.
    // To exercise the catch deterministically we stub the URL constructor to throw for the
    // duration of this single test, then restore.
    process.env.APP_URL = 'https://trek.example.com';
    const realURL = global.URL;
    vi.stubGlobal(
      'URL',
      vi.fn(() => {
        throw new TypeError('Invalid URL');
      })
    );

    try {
      const result = await sendEmail('user@example.com', 'Hello', 'Body');
      expect(result).toBe(false);
      expect(sendMailMock).not.toHaveBeenCalled();
      // The localhost-drop logWarn must NOT be invoked when the URL parse itself fails —
      // the function returns false from the catch before reaching the localhost branch.
      const dropWarnings = logWarnMock.mock.calls.filter(
        ([msg]) => typeof msg === 'string' && msg.includes('sendEmail: email NOT sent')
      );
      expect(dropWarnings).toHaveLength(0);
    } finally {
      vi.stubGlobal('URL', realURL);
    }
  });
});

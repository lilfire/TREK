/**
 * Unit tests for passwordResetService.ts (LSO-1624).
 *
 * Verifies that sendPasswordResetEmail() delegates transport to sendEmail()
 * — exercising SMTP, direct-MX, and console-fallback paths end-to-end
 * through the real notifications module — and returns the right
 * { delivered } payload for each.
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
  GITHUB_REPO: 'mauriceboe/TREK',
  updateJwtSecret: () => {},
}));
vi.mock('../../../src/services/apiKeyCrypto', () => ({
  decrypt_api_key: (v: string | null) => v,
  maybe_encrypt_api_key: (v: string) => v,
  encrypt_api_key: (v: string) => v,
}));

const { sendMailMock, logInfoMock, logDebugMock, logErrorMock, logWarnMock } = vi.hoisted(() => ({
  sendMailMock: vi.fn().mockResolvedValue({ accepted: ['user@example.com'] }),
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

const { resolveMxMock } = vi.hoisted(() => ({ resolveMxMock: vi.fn() }));
vi.mock('dns/promises', () => ({ resolveMx: resolveMxMock }));

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
import { sendPasswordResetEmail } from '../../../src/services/passwordResetService';

const ORIGINAL_ENV = { ...process.env };
const RESET_URL_REAL = 'https://trek.example.com/reset-password?token=abc123';
const RESET_URL_LOCAL = 'http://localhost:3001/reset-password?token=abc123';

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

let consoleLogSpy: ReturnType<typeof vi.spyOn>;

beforeAll(() => {
  createTables(testDb);
  runMigrations(testDb);
});

beforeEach(() => {
  resetTestDb(testDb);
  sendMailMock.mockClear();
  sendMailMock.mockResolvedValue({ accepted: ['user@example.com'] });
  logInfoMock.mockClear();
  logDebugMock.mockClear();
  logErrorMock.mockClear();
  logWarnMock.mockClear();
  resolveMxMock.mockReset();
  resolveMxMock.mockResolvedValue([{ exchange: 'mx.example.com', priority: 10 }]);
  clearEmailEnv();
  consoleLogSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
});

afterEach(() => {
  clearEmailEnv();
  consoleLogSpy.mockRestore();
});

afterAll(() => {
  testDb.close();
  process.env = { ...ORIGINAL_ENV };
});

describe('sendPasswordResetEmail() — LSO-1624 sendEmail routing', () => {
  it('PR-001 — SMTP configured: delivers via SMTP and returns delivered=email', async () => {
    configureSmtp();
    process.env.APP_URL = 'https://trek.example.com';

    const result = await sendPasswordResetEmail('user@example.com', RESET_URL_REAL, null);

    expect(result).toEqual({ delivered: 'email' });
    expect(sendMailMock).toHaveBeenCalledTimes(1);
    const mail = sendMailMock.mock.calls[0][0];
    expect(mail.to).toBe('user@example.com');
    expect(mail.subject).toBe('TREK — Reset your password');
    expect(mail.from).toBe('trek@example.com');
    // Plain-text body must carry the reset link so users can click it inline.
    expect(mail.text).toContain(RESET_URL_REAL);
    // No console fallback on the success path.
    expect(consoleLogSpy).not.toHaveBeenCalled();
    // Success audit log line is emitted.
    const sentLogs = logInfoMock.mock.calls
      .map(([msg]) => (typeof msg === 'string' ? msg : ''))
      .filter(msg => msg.includes('Password reset email sent to=user@example.com'));
    expect(sentLogs).toHaveLength(1);
    // The localhost-drop warning must never be emitted on the SMTP path.
    const localhostDropCalls = logWarnMock.mock.calls.filter(
      ([msg]) => typeof msg === 'string' && msg.includes('sendEmail: email NOT sent')
    );
    expect(localhostDropCalls).toHaveLength(0);
  });

  it('PR-002 — no SMTP + real-domain APP_URL: delivers via direct transport and returns delivered=email', async () => {
    process.env.APP_URL = 'https://trek.example.com';

    const result = await sendPasswordResetEmail('user@example.com', RESET_URL_REAL, null);

    expect(result).toEqual({ delivered: 'email' });
    expect(sendMailMock).toHaveBeenCalledTimes(1);
    const mail = sendMailMock.mock.calls[0][0];
    expect(mail.to).toBe('user@example.com');
    expect(mail.subject).toBe('TREK — Reset your password');
    // Direct transport uses an APP_URL-derived from address.
    expect(mail.from).toBe('noreply@trek.example.com');
    expect(mail.text).toContain(RESET_URL_REAL);
    // Direct-MX path must surface its reliability warning.
    const directWarnings = logWarnMock.mock.calls.filter(
      ([msg]) => typeof msg === 'string' && msg.includes('sendViaDirect: attempting direct MX transport')
    );
    expect(directWarnings).toHaveLength(1);
    // No console fallback on the success path.
    expect(consoleLogSpy).not.toHaveBeenCalled();
    const sentLogs = logInfoMock.mock.calls
      .map(([msg]) => (typeof msg === 'string' ? msg : ''))
      .filter(msg => msg.includes('Password reset email sent to=user@example.com'));
    expect(sentLogs).toHaveLength(1);
  });

  it('PR-003 — no SMTP + localhost APP_URL: console fallback fires and returns delivered=log', async () => {
    process.env.APP_URL = 'http://localhost:3001';

    const result = await sendPasswordResetEmail('user@example.com', RESET_URL_LOCAL, null);

    expect(result).toEqual({ delivered: 'log' });
    // No mail send was attempted because sendEmail() bailed on localhost.
    expect(sendMailMock).not.toHaveBeenCalled();
    // sendEmail() must have surfaced the actionable localhost-drop warning.
    const dropWarnings = logWarnMock.mock.calls
      .map(([msg]) => (typeof msg === 'string' ? msg : ''))
      .filter(msg => msg.includes('sendEmail: email NOT sent'));
    expect(dropWarnings).toHaveLength(1);
    // Console fallback was emitted with the reset URL so the admin can hand-deliver it.
    expect(consoleLogSpy).toHaveBeenCalledTimes(1);
    const consoleArg = consoleLogSpy.mock.calls[0][0];
    expect(typeof consoleArg).toBe('string');
    expect(consoleArg as string).toContain('PASSWORD RESET LINK');
    expect(consoleArg as string).toContain('user@example.com');
    expect(consoleArg as string).toContain(RESET_URL_LOCAL);
    // Fallback audit log line is emitted (and the "sent" line is NOT).
    const sentLogs = logInfoMock.mock.calls
      .map(([msg]) => (typeof msg === 'string' ? msg : ''))
      .filter(msg => msg.includes('Password reset email sent to='));
    expect(sentLogs).toHaveLength(0);
    const fallbackLogs = logInfoMock.mock.calls
      .map(([msg]) => (typeof msg === 'string' ? msg : ''))
      .filter(msg => msg.includes('Password reset link issued (fallback log) for=user@example.com'));
    expect(fallbackLogs).toHaveLength(1);
  });

  it('PR-004 — no SMTP + no APP_URL: same console fallback, returns delivered=log', async () => {
    // No APP_URL and no ALLOWED_ORIGINS → getAppUrl() defaults to http://localhost:<PORT>,
    // which sendEmail() treats as the localhost-drop branch.

    const result = await sendPasswordResetEmail('user@example.com', RESET_URL_LOCAL, null);

    expect(result).toEqual({ delivered: 'log' });
    expect(sendMailMock).not.toHaveBeenCalled();
    const dropWarnings = logWarnMock.mock.calls
      .map(([msg]) => (typeof msg === 'string' ? msg : ''))
      .filter(msg => msg.includes('sendEmail: email NOT sent'));
    expect(dropWarnings).toHaveLength(1);
    expect(consoleLogSpy).toHaveBeenCalledTimes(1);
    const consoleArg = consoleLogSpy.mock.calls[0][0];
    expect(consoleArg as string).toContain('PASSWORD RESET LINK');
    expect(consoleArg as string).toContain(RESET_URL_LOCAL);
    const fallbackLogs = logInfoMock.mock.calls
      .map(([msg]) => (typeof msg === 'string' ? msg : ''))
      .filter(msg => msg.includes('Password reset link issued (fallback log) for=user@example.com'));
    expect(fallbackLogs).toHaveLength(1);
  });
});

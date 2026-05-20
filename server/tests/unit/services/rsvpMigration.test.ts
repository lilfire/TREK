/**
 * Integration tests for LSO-1296 migration — trip_rsvps table.
 * Verifies table structure, indexes, constraints, and data integrity.
 */
import { describe, it, expect } from 'vitest';
import Database from 'better-sqlite3';

function buildPreMigrationDb() {
  const db = new Database(':memory:');
  db.exec('PRAGMA foreign_keys = ON');
  db.exec(`
    CREATE TABLE IF NOT EXISTS schema_version (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      version INTEGER NOT NULL
    );
    INSERT INTO schema_version (version) VALUES (0);

    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT NOT NULL UNIQUE,
      password_hash TEXT,
      email TEXT,
      role TEXT NOT NULL DEFAULT 'user'
    );

    CREATE TABLE IF NOT EXISTS trips (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      title TEXT NOT NULL,
      is_archived INTEGER NOT NULL DEFAULT 0,
      is_public INTEGER NOT NULL DEFAULT 0,
      reminder_days INTEGER NOT NULL DEFAULT 7,
      currency TEXT NOT NULL DEFAULT 'USD'
    );
  `);
  return db;
}

function runMigrationLSO1296(db: ReturnType<typeof Database>) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS trip_rsvps (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      trip_id INTEGER NOT NULL REFERENCES trips(id) ON DELETE CASCADE,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      email TEXT NOT NULL,
      message TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(trip_id, user_id)
    )
  `);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_trip_rsvps_trip ON trip_rsvps(trip_id)`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_trip_rsvps_user ON trip_rsvps(user_id)`);
}

describe('Migration LSO-1296 — trip_rsvps table', () => {
  it('MIGR-LSO1296-001 — trip_rsvps table exists after migration', () => {
    const db = buildPreMigrationDb();
    runMigrationLSO1296(db);

    const table = db.prepare(
      `SELECT name FROM sqlite_master WHERE type='table' AND name='trip_rsvps'`,
    ).get();
    expect(table).toBeDefined();
    db.close();
  });

  it('MIGR-LSO1296-002 — trip_rsvps has all required columns', () => {
    const db = buildPreMigrationDb();
    runMigrationLSO1296(db);

    const cols = db.prepare(`PRAGMA table_info(trip_rsvps)`).all() as Array<{ name: string }>;
    const names = cols.map(c => c.name);

    expect(names).toContain('id');
    expect(names).toContain('trip_id');
    expect(names).toContain('user_id');
    expect(names).toContain('name');
    expect(names).toContain('email');
    expect(names).toContain('message');
    expect(names).toContain('created_at');
    db.close();
  });

  it('MIGR-LSO1296-003 — idx_trip_rsvps_trip index exists on (trip_id)', () => {
    const db = buildPreMigrationDb();
    runMigrationLSO1296(db);

    const idx = db.prepare(
      `SELECT name FROM sqlite_master WHERE type='index' AND name='idx_trip_rsvps_trip'`,
    ).get();
    expect(idx).toBeDefined();
    db.close();
  });

  it('MIGR-LSO1296-004 — idx_trip_rsvps_user index exists on (user_id)', () => {
    const db = buildPreMigrationDb();
    runMigrationLSO1296(db);

    const idx = db.prepare(
      `SELECT name FROM sqlite_master WHERE type='index' AND name='idx_trip_rsvps_user'`,
    ).get();
    expect(idx).toBeDefined();
    db.close();
  });

  it('MIGR-LSO1296-005 — can insert and retrieve an RSVP row', () => {
    const db = buildPreMigrationDb();
    runMigrationLSO1296(db);

    const userId = Number(
      db.prepare('INSERT INTO users (username, role) VALUES (?, ?)').run('alice', 'user').lastInsertRowid,
    );
    const tripId = Number(
      db.prepare('INSERT INTO trips (user_id, title, currency) VALUES (?, ?, ?)').run(userId, 'Paris Trip', 'EUR').lastInsertRowid,
    );
    db.prepare(
      'INSERT INTO trip_rsvps (trip_id, user_id, name, email, message) VALUES (?, ?, ?, ?, ?)',
    ).run(tripId, userId, 'Alice Smith', 'alice@example.com', 'Looking forward!');

    const row = db.prepare('SELECT * FROM trip_rsvps WHERE trip_id = ?').get(tripId) as Record<string, unknown>;
    expect(row).toBeDefined();
    expect(row.name).toBe('Alice Smith');
    expect(row.email).toBe('alice@example.com');
    expect(row.message).toBe('Looking forward!');
    expect(row.trip_id).toBe(tripId);
    expect(row.user_id).toBe(userId);
    db.close();
  });

  it('MIGR-LSO1296-006 — message column is nullable', () => {
    const db = buildPreMigrationDb();
    runMigrationLSO1296(db);

    const userId = Number(
      db.prepare('INSERT INTO users (username, role) VALUES (?, ?)').run('bob', 'user').lastInsertRowid,
    );
    const tripId = Number(
      db.prepare('INSERT INTO trips (user_id, title, currency) VALUES (?, ?, ?)').run(userId, 'Rome Trip', 'EUR').lastInsertRowid,
    );
    db.prepare(
      'INSERT INTO trip_rsvps (trip_id, user_id, name, email) VALUES (?, ?, ?, ?)',
    ).run(tripId, userId, 'Bob Jones', 'bob@example.com');

    const row = db.prepare('SELECT * FROM trip_rsvps WHERE trip_id = ?').get(tripId) as Record<string, unknown>;
    expect(row).toBeDefined();
    expect(row.message).toBeNull();
    db.close();
  });

  it('MIGR-LSO1296-007 — ON DELETE CASCADE removes rsvp when trip is deleted', () => {
    const db = buildPreMigrationDb();
    runMigrationLSO1296(db);

    const userId = Number(
      db.prepare('INSERT INTO users (username, role) VALUES (?, ?)').run('carol', 'user').lastInsertRowid,
    );
    const tripId = Number(
      db.prepare('INSERT INTO trips (user_id, title, currency) VALUES (?, ?, ?)').run(userId, 'Tokyo Trip', 'JPY').lastInsertRowid,
    );
    db.prepare(
      'INSERT INTO trip_rsvps (trip_id, user_id, name, email) VALUES (?, ?, ?, ?)',
    ).run(tripId, userId, 'Carol Green', 'carol@example.com');

    db.prepare('DELETE FROM trips WHERE id = ?').run(tripId);

    const row = db.prepare('SELECT * FROM trip_rsvps WHERE trip_id = ?').get(tripId);
    expect(row).toBeUndefined();
    db.close();
  });

  it('MIGR-LSO1296-008 — UNIQUE(trip_id, user_id) prevents duplicate RSVPs', () => {
    const db = buildPreMigrationDb();
    runMigrationLSO1296(db);

    const userId = Number(
      db.prepare('INSERT INTO users (username, role) VALUES (?, ?)').run('dave', 'user').lastInsertRowid,
    );
    const tripId = Number(
      db.prepare('INSERT INTO trips (user_id, title, currency) VALUES (?, ?, ?)').run(userId, 'Berlin Trip', 'EUR').lastInsertRowid,
    );
    db.prepare(
      'INSERT INTO trip_rsvps (trip_id, user_id, name, email) VALUES (?, ?, ?, ?)',
    ).run(tripId, userId, 'Dave Brown', 'dave@example.com');

    expect(() =>
      db.prepare(
        'INSERT INTO trip_rsvps (trip_id, user_id, name, email) VALUES (?, ?, ?, ?)',
      ).run(tripId, userId, 'Dave Brown', 'dave@example.com'),
    ).toThrow();
    db.close();
  });

  it('MIGR-LSO1296-009 — migration is idempotent (CREATE TABLE IF NOT EXISTS)', () => {
    const db = buildPreMigrationDb();
    runMigrationLSO1296(db);
    expect(() => runMigrationLSO1296(db)).not.toThrow();
    db.close();
  });
});

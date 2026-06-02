/**
 * LSO-1502 — places.budget_item_id → places.budget_category backfill migration.
 *
 * Verifies the migration body in server/src/db/migrations.ts (last index) handles:
 *  - Adds budget_category column to places
 *  - Drops budget_item_id column from places
 *  - Backfills budget_category from the linked budget_items.category
 *  - Leaves NULL when budget_item_id is NULL or its FK target is gone
 *  - Is idempotent (safe to re-run)
 *
 * The migration body is inlined here for isolation — the same pattern used by
 * migration.test.ts. Drift between this copy and the real migration body is
 * caught by PLACE-029 in places.test.ts, which runs the real runMigrations()
 * twice and asserts it does not throw.
 */
import { describe, it, expect } from 'vitest';
import Database from 'better-sqlite3';

/**
 * Build a pre-LSO-1502 database snapshot:
 *  - budget_items has the (id, trip_id, name, category, total_price) shape
 *  - places has budget_item_id REFERENCES budget_items(id) but NOT budget_category
 *
 * Mirrors the schema state on `development` right before the LSO-1502 migration.
 */
function setupPreBudgetCategoryDb() {
  const db = new Database(':memory:');
  db.exec('PRAGMA journal_mode = WAL');
  db.exec('PRAGMA foreign_keys = ON');

  db.exec(`
    CREATE TABLE users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT NOT NULL UNIQUE,
      password TEXT NOT NULL
    );
    CREATE TABLE trips (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      title TEXT NOT NULL
    );
    CREATE TABLE budget_items (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      trip_id INTEGER NOT NULL REFERENCES trips(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      category TEXT,
      total_price REAL DEFAULT 0
    );
    CREATE TABLE places (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      trip_id INTEGER NOT NULL REFERENCES trips(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      price REAL DEFAULT 0,
      budget_item_id INTEGER REFERENCES budget_items(id) ON DELETE SET NULL
    );
  `);

  return db;
}

/**
 * Inline copy of the LSO-1502 migration body (server/src/db/migrations.ts).
 * Keep in sync if the real migration body changes.
 */
function runBudgetCategoryMigration(db: ReturnType<typeof Database>): void {
  try {
    db.exec('ALTER TABLE places ADD COLUMN budget_category TEXT');
  } catch (err: any) {
    if (!err.message?.includes('duplicate column name')) throw err;
  }
  const cols = db.prepare('PRAGMA table_info(places)').all() as { name: string }[];
  if (cols.some(c => c.name === 'budget_item_id')) {
    db.exec(`
      UPDATE places
      SET budget_category = (SELECT bi.category FROM budget_items bi WHERE bi.id = places.budget_item_id)
      WHERE places.budget_item_id IS NOT NULL
    `);
    db.exec('ALTER TABLE places DROP COLUMN budget_item_id');
  }
}

describe('LSO-1502 — places.budget_item_id → places.budget_category backfill', () => {
  it('MIGR-BC-001 — adds budget_category column to places', () => {
    const db = setupPreBudgetCategoryDb();
    const beforeCols = (db.prepare('PRAGMA table_info(places)').all() as { name: string }[]).map(c => c.name);
    expect(beforeCols).not.toContain('budget_category');

    runBudgetCategoryMigration(db);

    const afterCols = (db.prepare('PRAGMA table_info(places)').all() as { name: string }[]).map(c => c.name);
    expect(afterCols).toContain('budget_category');
    db.close();
  });

  it('MIGR-BC-002 — drops budget_item_id column from places', () => {
    const db = setupPreBudgetCategoryDb();
    const beforeCols = (db.prepare('PRAGMA table_info(places)').all() as { name: string }[]).map(c => c.name);
    expect(beforeCols).toContain('budget_item_id');

    runBudgetCategoryMigration(db);

    const afterCols = (db.prepare('PRAGMA table_info(places)').all() as { name: string }[]).map(c => c.name);
    expect(afterCols).not.toContain('budget_item_id');
    db.close();
  });

  it('MIGR-BC-003 — backfills budget_category from the linked budget_items.category', () => {
    const db = setupPreBudgetCategoryDb();
    const userId = Number(db.prepare('INSERT INTO users (username, password) VALUES (?, ?)').run('owner', 'hash').lastInsertRowid);
    const tripId = Number(db.prepare('INSERT INTO trips (user_id, title) VALUES (?, ?)').run(userId, 'Trip A').lastInsertRowid);

    const beerId = Number(db.prepare('INSERT INTO budget_items (trip_id, name, category, total_price) VALUES (?, ?, ?, ?)').run(tripId, 'Augustiner', 'Beergarden', 0).lastInsertRowid);
    const foodId = Number(db.prepare('INSERT INTO budget_items (trip_id, name, category, total_price) VALUES (?, ?, ?, ?)').run(tripId, 'Lunch', 'Food', 25).lastInsertRowid);

    // Realistic mix: linked to Beergarden, linked to Food, and unlinked (NULL).
    db.prepare('INSERT INTO places (trip_id, name, price, budget_item_id) VALUES (?, ?, ?, ?)').run(tripId, 'Beer crawl', 33, beerId);
    db.prepare('INSERT INTO places (trip_id, name, price, budget_item_id) VALUES (?, ?, ?, ?)').run(tripId, 'Restaurant', 25, foodId);
    db.prepare('INSERT INTO places (trip_id, name, price, budget_item_id) VALUES (?, ?, ?, ?)').run(tripId, 'Free Museum', 0, null);

    runBudgetCategoryMigration(db);

    const rows = db.prepare('SELECT name, budget_category FROM places ORDER BY name').all() as { name: string; budget_category: string | null }[];
    const byName = Object.fromEntries(rows.map(r => [r.name, r.budget_category]));
    expect(byName['Beer crawl']).toBe('Beergarden');
    expect(byName['Restaurant']).toBe('Food');
    expect(byName['Free Museum']).toBeNull();
    db.close();
  });

  it('MIGR-BC-004 — places with NULL budget_item_id keep budget_category=NULL', () => {
    const db = setupPreBudgetCategoryDb();
    const userId = Number(db.prepare('INSERT INTO users (username, password) VALUES (?, ?)').run('owner', 'hash').lastInsertRowid);
    const tripId = Number(db.prepare('INSERT INTO trips (user_id, title) VALUES (?, ?)').run(userId, 'Trip B').lastInsertRowid);

    db.prepare('INSERT INTO places (trip_id, name, price, budget_item_id) VALUES (?, ?, ?, NULL)').run(tripId, 'A', 10);
    db.prepare('INSERT INTO places (trip_id, name, price, budget_item_id) VALUES (?, ?, ?, NULL)').run(tripId, 'B', 20);

    runBudgetCategoryMigration(db);

    const rows = db.prepare('SELECT budget_category FROM places').all() as { budget_category: string | null }[];
    expect(rows).toHaveLength(2);
    rows.forEach(r => expect(r.budget_category).toBeNull());
    db.close();
  });

  it('MIGR-BC-005 — orphaned budget_item_id (FK target gone) results in NULL budget_category', () => {
    const db = setupPreBudgetCategoryDb();
    db.exec('PRAGMA foreign_keys = OFF'); // seed a dangling FK to simulate stale prod data
    const userId = Number(db.prepare('INSERT INTO users (username, password) VALUES (?, ?)').run('owner', 'hash').lastInsertRowid);
    const tripId = Number(db.prepare('INSERT INTO trips (user_id, title) VALUES (?, ?)').run(userId, 'Trip C').lastInsertRowid);

    db.prepare('INSERT INTO places (trip_id, name, price, budget_item_id) VALUES (?, ?, ?, ?)').run(tripId, 'Orphan', 5, 9999);

    runBudgetCategoryMigration(db);

    const row = db.prepare('SELECT budget_category FROM places WHERE name = ?').get('Orphan') as { budget_category: string | null };
    expect(row.budget_category).toBeNull();
    db.close();
  });

  it('MIGR-BC-006 — idempotent: re-running migration does not throw and preserves state', () => {
    const db = setupPreBudgetCategoryDb();
    const userId = Number(db.prepare('INSERT INTO users (username, password) VALUES (?, ?)').run('owner', 'hash').lastInsertRowid);
    const tripId = Number(db.prepare('INSERT INTO trips (user_id, title) VALUES (?, ?)').run(userId, 'Trip D').lastInsertRowid);
    const biId = Number(db.prepare('INSERT INTO budget_items (trip_id, name, category, total_price) VALUES (?, ?, ?, ?)').run(tripId, 'Item', 'Activities', 0).lastInsertRowid);
    db.prepare('INSERT INTO places (trip_id, name, price, budget_item_id) VALUES (?, ?, ?, ?)').run(tripId, 'Zoo', 10, biId);

    runBudgetCategoryMigration(db);
    expect(() => runBudgetCategoryMigration(db)).not.toThrow();

    const cols = (db.prepare('PRAGMA table_info(places)').all() as { name: string }[]).map(c => c.name);
    expect(cols).toContain('budget_category');
    expect(cols).not.toContain('budget_item_id');
    const row = db.prepare('SELECT budget_category FROM places WHERE name = ?').get('Zoo') as { budget_category: string };
    expect(row.budget_category).toBe('Activities');
    db.close();
  });
});

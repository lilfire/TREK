/**
 * Unit tests for versionCheckService — VERSION-001 onwards.
 *
 * Covers both update sources: GitHub Releases (default) and GHCR Container
 * Registry (GITHUB_VERSION_SOURCE=packages). Loaded with `vi.doMock` so each
 * test can swap config without leaking state to the next.
 */
import { describe, it, expect, vi, beforeAll, beforeEach, afterEach, afterAll } from 'vitest';

const { testDb, dbMock } = vi.hoisted(() => {
  const Database = require('better-sqlite3');
  const db = new Database(':memory:');
  db.exec('PRAGMA journal_mode = WAL');
  db.exec('PRAGMA foreign_keys = ON');
  return {
    testDb: db,
    dbMock: {
      db,
      closeDb: () => {},
      reinitialize: () => {},
    },
  };
});

vi.mock('../../../src/db/database', () => dbMock);
vi.mock('../../../src/services/notificationService', () => ({
  send: vi.fn().mockResolvedValue(undefined),
}));

import { createTables } from '../../../src/db/schema';
import { runMigrations } from '../../../src/db/migrations';
import { resetTestDb } from '../../helpers/test-db';

async function loadService(opts: {
  source?: 'releases' | 'packages';
  repo?: string;
  token?: string;
}) {
  // GITHUB_VERSION_SOURCE and GITHUB_TOKEN are read directly from process.env
  // by versionCheckService (see comment in the source), so stub them there.
  // Only GITHUB_REPO comes through the config-module mock.
  vi.stubEnv('GITHUB_VERSION_SOURCE', opts.source ?? '');
  vi.stubEnv('GITHUB_TOKEN', opts.token ?? '');
  vi.doMock('../../../src/config', () => ({
    JWT_SECRET: 'test-secret',
    ENCRYPTION_KEY: 'a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6a7b8c9d0e1f2a3b4c5d6a7b8c9d0e1f2',
    updateJwtSecret: () => {},
    GITHUB_REPO: opts.repo ?? 'lilfire/TREK',
  }));
  vi.resetModules();
  return import('../../../src/services/versionCheckService');
}

beforeAll(() => {
  createTables(testDb);
  runMigrations(testDb);
});

beforeEach(() => {
  resetTestDb(testDb);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.doUnmock('../../../src/config');
  vi.resetModules();
});

afterAll(() => {
  testDb.close();
});

// ── Releases path (default) ──────────────────────────────────────────────────

describe('versionCheckService — releases source', () => {
  it('VERSION-001 — checkVersion (stable) calls releases/latest URL with the configured repo', async () => {
    vi.stubEnv('APP_VERSION', '1.0.0');
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ tag_name: 'v1.0.0', html_url: 'https://example.com/r' }),
    });
    vi.stubGlobal('fetch', fetchMock);
    const { checkVersion, __clearVersionCacheForTests } = await loadService({ source: 'releases', repo: 'myfork/TREK' });
    __clearVersionCacheForTests();
    const result = await checkVersion();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][0]).toBe('https://api.github.com/repos/myfork/TREK/releases/latest');
    expect(result.is_prerelease).toBe(false);
    expect(result.latest).toBe('1.0.0');
  });

  it('VERSION-002 — getGithubReleases hits the releases endpoint and returns the response array', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => [
        { tag_name: 'v2.0.0', html_url: 'https://example.com/2' },
        { tag_name: 'v1.9.0', html_url: 'https://example.com/1.9' },
      ],
    });
    vi.stubGlobal('fetch', fetchMock);
    const { getGithubReleases } = await loadService({ source: 'releases', repo: 'lilfire/TREK' });
    const result = await getGithubReleases('5', '1') as Array<{ tag_name: string }>;
    expect(fetchMock.mock.calls[0][0]).toContain('https://api.github.com/repos/lilfire/TREK/releases?per_page=5&page=1');
    expect(result).toHaveLength(2);
    expect(result[0].tag_name).toBe('v2.0.0');
  });
});

// ── Packages path (GHCR) ─────────────────────────────────────────────────────

const ghcrFixture = [
  {
    id: 1,
    updated_at: '2026-01-10T12:00:00Z',
    metadata: { container: { tags: ['v2.0.0', 'latest'] } },
  },
  {
    id: 2,
    updated_at: '2026-01-09T12:00:00Z',
    metadata: { container: { tags: ['v1.9.0'] } },
  },
  {
    id: 3,
    updated_at: '2026-01-08T12:00:00Z',
    metadata: { container: { tags: ['sha-abc123'] } },
  },
  {
    id: 4,
    updated_at: '2026-01-07T12:00:00Z',
    metadata: { container: { tags: ['2.1.0-pre.3'] } },
  },
];

describe('versionCheckService — packages source', () => {
  it('VERSION-010 — checkVersion (stable) calls the GHCR versions endpoint when source=packages', async () => {
    vi.stubEnv('APP_VERSION', '1.0.0');
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ghcrFixture });
    vi.stubGlobal('fetch', fetchMock);
    const { checkVersion, __clearVersionCacheForTests } = await loadService({ source: 'packages', repo: 'lilfire/TREK' });
    __clearVersionCacheForTests();
    await checkVersion();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][0]).toBe(
      'https://api.github.com/users/lilfire/packages/container/trek/versions',
    );
  });

  it('VERSION-011 — checkVersion (stable) excludes `latest` and `sha-*` tags and reports the highest stable as latest', async () => {
    vi.stubEnv('APP_VERSION', '1.0.0');
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => ghcrFixture }));
    const { checkVersion, __clearVersionCacheForTests } = await loadService({ source: 'packages', repo: 'lilfire/TREK' });
    __clearVersionCacheForTests();
    const result = await checkVersion();
    expect(result.latest).toBe('2.0.0');
    expect(result.update_available).toBe(true);
    expect(result.is_prerelease).toBe(false);
    expect(result.release_url).toBe('https://github.com/lilfire/TREK/pkgs/container/trek/versions');
  });

  it('VERSION-012 — checkVersion (prerelease) picks the highest prerelease tag', async () => {
    vi.stubEnv('APP_VERSION', '2.0.0-pre.1');
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => ghcrFixture }));
    const { checkVersion, __clearVersionCacheForTests } = await loadService({ source: 'packages', repo: 'lilfire/TREK' });
    __clearVersionCacheForTests();
    const result = await checkVersion();
    expect(result.is_prerelease).toBe(true);
    expect(result.latest).toBe('2.1.0-pre.3');
    expect(result.update_available).toBe(true);
  });

  it('VERSION-013 — GITHUB_TOKEN is sent as a Bearer authorization header on the GHCR request when set', async () => {
    vi.stubEnv('APP_VERSION', '1.0.0');
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ghcrFixture });
    vi.stubGlobal('fetch', fetchMock);
    const { checkVersion, __clearVersionCacheForTests } = await loadService({
      source: 'packages',
      repo: 'lilfire/TREK',
      token: 'ghp_secret',
    });
    __clearVersionCacheForTests();
    await checkVersion();
    const init = fetchMock.mock.calls[0][1] as { headers: Record<string, string> };
    expect(init.headers['Authorization']).toBe('Bearer ghp_secret');
  });

  it('VERSION-014 — no Authorization header is sent when GITHUB_TOKEN is empty', async () => {
    vi.stubEnv('APP_VERSION', '1.0.0');
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ghcrFixture });
    vi.stubGlobal('fetch', fetchMock);
    const { checkVersion, __clearVersionCacheForTests } = await loadService({ source: 'packages', repo: 'lilfire/TREK', token: '' });
    __clearVersionCacheForTests();
    await checkVersion();
    const init = fetchMock.mock.calls[0][1] as { headers: Record<string, string> };
    expect(init.headers).not.toHaveProperty('Authorization');
  });

  it('VERSION-015 — checkVersion falls back to no-update when GHCR returns no usable tags', async () => {
    vi.stubEnv('APP_VERSION', '1.0.0');
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: async () => [
        { id: 1, updated_at: '2026-01-01T12:00:00Z', metadata: { container: { tags: ['latest', 'sha-deadbeef'] } } },
      ],
    }));
    const { checkVersion, __clearVersionCacheForTests } = await loadService({ source: 'packages', repo: 'lilfire/TREK' });
    __clearVersionCacheForTests();
    const result = await checkVersion();
    expect(result.update_available).toBe(false);
    expect(result.latest).toBe(result.current);
  });

  it('VERSION-016 — checkVersion returns the no-update fallback when the GHCR fetch fails', async () => {
    vi.stubEnv('APP_VERSION', '1.0.0');
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('boom')));
    const { checkVersion, __clearVersionCacheForTests } = await loadService({ source: 'packages', repo: 'lilfire/TREK' });
    __clearVersionCacheForTests();
    const result = await checkVersion();
    expect(result.update_available).toBe(false);
  });

  it('VERSION-020 — getGithubReleases returns release-shaped objects mapped from GHCR tags', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => ghcrFixture }));
    const { getGithubReleases } = await loadService({ source: 'packages', repo: 'lilfire/TREK' });
    const result = await getGithubReleases('10', '1') as Array<{ tag_name: string; name: string; published_at?: string; html_url: string; prerelease: boolean }>;
    // latest + sha-abc123 dropped → 3 tags remain (v2.0.0, v1.9.0, 2.1.0-pre.3)
    expect(result).toHaveLength(3);
    expect(result[0]).toMatchObject({
      tag_name: '2.1.0-pre.3',
      name: '2.1.0-pre.3',
      html_url: 'https://github.com/lilfire/TREK/pkgs/container/trek/versions',
      prerelease: true,
    });
    const tagNames = result.map(r => r.tag_name);
    expect(tagNames).not.toContain('latest');
    expect(tagNames).not.toContain('sha-abc123');
    expect(result.find(r => r.tag_name === 'v2.0.0')?.prerelease).toBe(false);
  });

  it('VERSION-021 — getGithubReleases respects perPage by slicing the sorted result', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => ghcrFixture }));
    const { getGithubReleases } = await loadService({ source: 'packages', repo: 'lilfire/TREK' });
    const result = await getGithubReleases('1', '1') as Array<{ tag_name: string }>;
    expect(result).toHaveLength(1);
    // Highest version (the prerelease 2.1.0-pre.3) wins descending sort.
    expect(result[0].tag_name).toBe('2.1.0-pre.3');
  });

  it('VERSION-022 — getGithubReleases returns an empty array when the GHCR fetch is non-OK', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, json: async () => [] }));
    const { getGithubReleases } = await loadService({ source: 'packages', repo: 'lilfire/TREK' });
    const result = await getGithubReleases('10', '1') as Array<unknown>;
    expect(Array.isArray(result)).toBe(true);
    expect(result).toHaveLength(0);
  });
});

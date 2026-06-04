import fs from 'fs';
import { db } from '../db/database';
import { GITHUB_REPO } from '../config';
import { send as sendNotification } from './notificationService';

// GITHUB_VERSION_SOURCE and GITHUB_TOKEN are also exported from ../config so
// callers like the /auth/app-config endpoint can surface them to the client.
// Inside this service we read straight from process.env to avoid breaking
// the ~50 service tests whose `vi.mock('../config', () => ({ ... }))` factory
// pre-dates these exports — Vitest's mock proxy throws on missing properties.
const GITHUB_VERSION_SOURCE: 'releases' | 'packages' =
  process.env.GITHUB_VERSION_SOURCE === 'packages' ? 'packages' : 'releases';
const GITHUB_TOKEN: string = process.env.GITHUB_TOKEN || '';

// Semver-ish comparator used both for picking the latest tag and for ordering
// results returned to the admin UI. Handles "-pre.N" suffixes so a stable
// release ranks above any prerelease at the same base version.
export function compareVersions(a: string, b: string): number {
  const parse = (v: string) => {
    const [base, pre] = v.split('-pre.');
    const parts = base.split('.').map(Number);
    const n = pre !== undefined ? parseInt(pre, 10) : null;
    const preN = n !== null && Number.isFinite(n) ? n : null;
    return { parts, preN };
  };
  const pa = parse(a), pb = parse(b);
  for (let i = 0; i < Math.max(pa.parts.length, pb.parts.length); i++) {
    const na = pa.parts[i] || 0, nb = pb.parts[i] || 0;
    if (na > nb) return 1;
    if (na < nb) return -1;
  }
  if (pa.preN === null && pb.preN !== null) return 1;
  if (pa.preN !== null && pb.preN === null) return -1;
  if (pa.preN !== null && pb.preN !== null) {
    if (pa.preN > pb.preN) return 1;
    if (pa.preN < pb.preN) return -1;
  }
  return 0;
}

export const isDocker = (() => {
  try {
    return fs.existsSync('/.dockerenv') || (fs.existsSync('/proc/1/cgroup') && fs.readFileSync('/proc/1/cgroup', 'utf8').includes('docker'));
  } catch { return false; }
})();

export interface VersionInfo {
  current: string;
  latest: string;
  update_available: boolean;
  release_url?: string;
  is_docker: boolean;
  is_prerelease: boolean;
}

interface ReleaseShape {
  tag_name: string;
  name: string;
  published_at?: string;
  html_url: string;
  prerelease: boolean;
}

interface GhcrVersion {
  metadata?: { container?: { tags?: string[] } };
  updated_at?: string;
}

const VERSION_CACHE_TTL = 5 * 60 * 1000;
let _versionCache: { data: VersionInfo; expiresAt: number } | null = null;

/** Test-only: clear the in-memory version cache. */
export function __clearVersionCacheForTests(): void {
  _versionCache = null;
}

function releasesHeaders(): Record<string, string> {
  return { 'Accept': 'application/vnd.github.v3+json', 'User-Agent': 'TREK-Server' };
}

function ghcrHeaders(): Record<string, string> {
  const headers: Record<string, string> = releasesHeaders();
  if (GITHUB_TOKEN) headers['Authorization'] = `Bearer ${GITHUB_TOKEN}`;
  return headers;
}

function deriveOwnerPkg(): { owner: string; repo: string; pkg: string } {
  const [owner = '', repo = ''] = GITHUB_REPO.split('/');
  return { owner, repo, pkg: repo.toLowerCase() };
}

function isPublishableTag(tag: string): boolean {
  // The "latest" floating tag and Git-SHA tags are not user-facing versions.
  return tag !== 'latest' && !/^sha-/.test(tag);
}

function tagIsPrerelease(tag: string): boolean {
  // Matches both "1.0.0-pre.1" (our internal scheme) and the common
  // "-rc.N", "-beta.N", "-alpha.N" container conventions.
  return /-pre\.|-(rc|beta|alpha)\./.test(tag);
}

async function fetchGhcrVersions(owner: string, pkg: string): Promise<GhcrVersion[]> {
  const resp = await fetch(
    `https://api.github.com/users/${owner}/packages/container/${pkg}/versions`,
    { headers: ghcrHeaders() }
  );
  if (!resp.ok) return [];
  const data = await resp.json();
  return Array.isArray(data) ? data as GhcrVersion[] : [];
}

function ghcrVersionsToReleases(versions: GhcrVersion[], owner: string, repo: string, pkg: string): ReleaseShape[] {
  const url = `https://github.com/${owner}/${repo}/pkgs/container/${pkg}/versions`;
  const out: ReleaseShape[] = [];
  for (const v of versions) {
    const tags = v.metadata?.container?.tags ?? [];
    for (const tag of tags) {
      if (!isPublishableTag(tag)) continue;
      out.push({
        tag_name: tag,
        name: tag,
        published_at: v.updated_at,
        html_url: url,
        prerelease: tagIsPrerelease(tag),
      });
    }
  }
  out.sort((a, b) => compareVersions(b.tag_name.replace(/^v/, ''), a.tag_name.replace(/^v/, '')));
  return out;
}

async function getReleasesFromPackages(perPage: string): Promise<ReleaseShape[]> {
  try {
    const { owner, repo, pkg } = deriveOwnerPkg();
    const versions = await fetchGhcrVersions(owner, pkg);
    const shaped = ghcrVersionsToReleases(versions, owner, repo, pkg);
    const limit = parseInt(perPage, 10);
    return Number.isFinite(limit) && limit > 0 ? shaped.slice(0, limit) : shaped;
  } catch {
    return [];
  }
}

export async function getGithubReleases(perPage: string = '10', page: string = '1') {
  if (GITHUB_VERSION_SOURCE === 'packages') {
    return getReleasesFromPackages(perPage);
  }
  try {
    const resp = await fetch(
      `https://api.github.com/repos/${GITHUB_REPO}/releases?per_page=${perPage}&page=${page}`,
      { headers: releasesHeaders() }
    );
    if (!resp.ok) return [];
    const data = await resp.json();
    return Array.isArray(data) ? data : [];
  } catch {
    return [];
  }
}

async function checkVersionFromPackages(currentVersion: string, isPrerelease: boolean): Promise<VersionInfo | null> {
  const { owner, repo, pkg } = deriveOwnerPkg();
  const versions = await fetchGhcrVersions(owner, pkg);
  if (!versions.length) return null;

  const candidates: Array<{ tag: string; v: string; pre: boolean }> = [];
  for (const v of versions) {
    const tags = v.metadata?.container?.tags ?? [];
    for (const tag of tags) {
      if (!isPublishableTag(tag)) continue;
      candidates.push({ tag, v: tag.replace(/^v/, ''), pre: tagIsPrerelease(tag) });
    }
  }

  // Mirror the releases path: prerelease installs track prereleases, stable
  // installs track stable tags. If no matching candidates exist the caller
  // falls back to "no update available" rather than mis-routing a user.
  const filtered = candidates.filter(c => c.pre === isPrerelease);
  if (!filtered.length) return null;

  filtered.sort((a, b) => compareVersions(b.v, a.v));
  const latest = filtered[0].v;
  const update_available = !!latest && latest !== currentVersion && compareVersions(latest, currentVersion) > 0;
  const release_url = `https://github.com/${owner}/${repo}/pkgs/container/${pkg}/versions`;
  return { current: currentVersion, latest, update_available, release_url, is_docker: isDocker, is_prerelease: isPrerelease };
}

export async function checkVersion(): Promise<VersionInfo> {
  if (_versionCache && Date.now() < _versionCache.expiresAt) {
    return _versionCache.data;
  }

  const currentVersion: string = process.env.APP_VERSION || require('../../package.json').version;
  const isPrerelease = currentVersion.includes('-pre.');
  const fallback: VersionInfo = { current: currentVersion, latest: currentVersion, update_available: false, is_docker: isDocker, is_prerelease: isPrerelease };
  let result: VersionInfo;
  try {
    if (GITHUB_VERSION_SOURCE === 'packages') {
      const packagesResult = await checkVersionFromPackages(currentVersion, isPrerelease);
      if (!packagesResult) return fallback;
      result = packagesResult;
    } else if (isPrerelease) {
      const resp = await fetch(
        `https://api.github.com/repos/${GITHUB_REPO}/releases?per_page=100`,
        { headers: releasesHeaders() }
      );
      if (!resp.ok) return fallback;
      const data = await resp.json() as Array<{ tag_name?: string; html_url?: string; prerelease?: boolean }>;
      const prereleases = Array.isArray(data) ? data.filter(r => r.prerelease) : [];
      if (!prereleases.length) return fallback;
      const tagged = prereleases.map(r => ({ r, v: (r.tag_name || '').replace(/^v/, '') }));
      tagged.sort((a, b) => compareVersions(b.v, a.v));
      const latest = tagged[0].v;
      const update_available = !!latest && latest !== currentVersion && compareVersions(latest, currentVersion) > 0;
      result = { current: currentVersion, latest, update_available, release_url: tagged[0].r.html_url || '', is_docker: isDocker, is_prerelease: true };
    } else {
      const resp = await fetch(
        `https://api.github.com/repos/${GITHUB_REPO}/releases/latest`,
        { headers: releasesHeaders() }
      );
      if (!resp.ok) return fallback;
      const data = await resp.json() as { tag_name?: string; html_url?: string };
      const latest = (data.tag_name || '').replace(/^v/, '');
      const update_available = !!latest && latest !== currentVersion && compareVersions(latest, currentVersion) > 0;
      result = { current: currentVersion, latest, update_available, release_url: data.html_url || '', is_docker: isDocker, is_prerelease: false };
    }
  } catch {
    return fallback;
  }

  _versionCache = { data: result, expiresAt: Date.now() + VERSION_CACHE_TTL };
  return result;
}

export async function checkAndNotifyVersion(): Promise<void> {
  try {
    const result = await checkVersion();
    if (!result.update_available) return;

    const lastNotified = (db.prepare('SELECT value FROM app_settings WHERE key = ?').get('last_notified_version') as { value: string } | undefined)?.value;
    if (lastNotified === result.latest) return;

    db.prepare('INSERT OR REPLACE INTO app_settings (key, value) VALUES (?, ?)').run('last_notified_version', result.latest);

    await sendNotification({
      event: 'version_available',
      actorId: null,
      scope: 'admin',
      targetId: 0,
      params: { version: result.latest },
    });
  } catch {
    // Silently ignore — version check is non-critical
  }
}

import path from 'path';
import fs from 'fs';
import { v4 as uuidv4 } from 'uuid';
import { safeFetch } from '../utils/ssrfGuard';
import { deleteOldCover, updateCoverImage, getTripRaw } from './tripCrudService';
import { NotFoundError, ValidationError } from './tripErrors';

// Same limits and formats as the multipart POST /api/trips/:id/cover route.
const MAX_COVER_SIZE = 20 * 1024 * 1024;
const MAX_REDIRECTS = 3;
const coversDir = path.join(__dirname, '../../uploads/covers');

const EXT_BY_MIME: Record<string, string> = {
  'image/jpeg': '.jpg',
  'image/png': '.png',
  'image/gif': '.gif',
  'image/webp': '.webp',
};

function sniffMime(buf: Buffer): string | null {
  if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'image/jpeg';
  if (buf.length >= 8 && buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'image/png';
  if (buf.length >= 6 && /^GIF8[79]a$/.test(buf.subarray(0, 6).toString('ascii'))) return 'image/gif';
  if (buf.length >= 12 && buf.subarray(0, 4).toString('ascii') === 'RIFF' && buf.subarray(8, 12).toString('ascii') === 'WEBP') return 'image/webp';
  return null;
}

/** Fetches with the SSRF guard re-applied to every redirect hop. */
async function fetchImage(url: string): Promise<Response> {
  let current = url;
  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    const res = await safeFetch(current, {
      redirect: 'manual',
      headers: { 'User-Agent': 'TREK/1.0 (trip cover import)', Accept: 'image/*' },
    });
    if (res.status >= 300 && res.status < 400 && res.headers.get('location')) {
      current = new URL(res.headers.get('location')!, current).toString();
      continue;
    }
    return res;
  }
  throw new ValidationError('Too many redirects while fetching the image');
}

async function readLimited(res: Response): Promise<Buffer> {
  const declared = Number(res.headers.get('content-length'));
  if (declared > MAX_COVER_SIZE) throw new ValidationError('Image exceeds the 20 MB limit');
  if (!res.body) throw new ValidationError('Image response had no body');

  const chunks: Buffer[] = [];
  let total = 0;
  const reader = res.body.getReader();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > MAX_COVER_SIZE) {
      await reader.cancel();
      throw new ValidationError('Image exceeds the 20 MB limit');
    }
    chunks.push(Buffer.from(value));
  }
  return Buffer.concat(chunks);
}

/**
 * Downloads an image from a public http(s) URL and sets it as the trip cover,
 * replacing (and deleting) any previous uploaded cover. Returns the new cover path.
 */
export async function setTripCoverFromUrl(tripId: number, imageUrl: string): Promise<string> {
  const trip = getTripRaw(tripId);
  if (!trip) throw new NotFoundError('Trip not found');

  const res = await fetchImage(imageUrl);
  if (!res.ok) throw new ValidationError(`Could not download image (HTTP ${res.status})`);

  const buf = await readLimited(res);
  const mime = sniffMime(buf);
  if (!mime) throw new ValidationError('Only jpg, png, gif, webp images allowed');

  if (!fs.existsSync(coversDir)) fs.mkdirSync(coversDir, { recursive: true });
  const filename = `${uuidv4()}${EXT_BY_MIME[mime]}`;
  fs.writeFileSync(path.join(coversDir, filename), buf);

  deleteOldCover(trip.cover_image);
  const coverUrl = `/uploads/covers/${filename}`;
  updateCoverImage(tripId, coverUrl);
  return coverUrl;
}

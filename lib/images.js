// Keeps a local copy of each saved recipe's photo, so the library still
// shows it if the original site removes the recipe or changes its images.
import fs from 'node:fs/promises';
import path from 'node:path';
import { assertPublicUrl, fetchWithTimeout } from './http.js';

const TYPES = { 'image/jpeg': 'jpg', 'image/jpg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/gif': 'gif', 'image/avif': 'avif' };
const MAX_BYTES = 10 * 1024 * 1024;

export const isLocal = (src) => typeof src === 'string' && src.startsWith('/images/');

// Downloads `url` into `dir` as `<name>.<ext>` and returns its public path ("/images/…").
export async function saveImage(url, dir, name) {
  await assertPublicUrl(url);
  const res = await fetchWithTimeout(url, { timeout: 15000, headers: { Accept: 'image/avif,image/webp,image/*;q=0.8' } });
  if (!res.ok) throw new Error(`Image download failed (${res.status})`);
  const type = (res.headers.get('content-type') || '').split(';')[0].trim().toLowerCase();
  const ext = TYPES[type];
  if (!ext) throw new Error(`Not a supported image (${type || 'unknown type'})`);
  const declared = Number(res.headers.get('content-length'));
  if (declared > MAX_BYTES) throw new Error('Image is too large');
  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.length > MAX_BYTES) throw new Error('Image is too large');

  await fs.mkdir(dir, { recursive: true });
  const file = `${name.replace(/[^a-z0-9-]/gi, '')}.${ext}`;
  const tmp = path.join(dir, `${file}.tmp`);
  await fs.writeFile(tmp, buf);
  await fs.rename(tmp, path.join(dir, file));
  return `/images/${file}`;
}

export async function deleteImage(src, dir) {
  if (!isLocal(src)) return;
  await fs.unlink(path.join(dir, path.basename(src))).catch(() => {});
}

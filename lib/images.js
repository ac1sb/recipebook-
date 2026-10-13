// Keeps a copy of each saved recipe's photo (in a local folder, or in R2 on
// Cloudflare), so the library still shows it if the original site removes it.
import { assertPublicUrl, fetchWithTimeout } from './http.js';

const TYPES = { 'image/jpeg': 'jpg', 'image/jpg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/gif': 'gif', 'image/avif': 'avif' };
const MAX_BYTES = 10 * 1024 * 1024;

export const isLocal = (src) => typeof src === 'string' && src.startsWith('/images/');

// Downloads `url` into the image store as `<name>.<ext>` and returns its public path ("/images/…").
export async function saveImage(url, images, name) {
  await assertPublicUrl(url);
  const res = await fetchWithTimeout(url, { timeout: 15000, headers: { Accept: 'image/avif,image/webp,image/*;q=0.8' } });
  if (!res.ok) throw new Error(`Image download failed (${res.status})`);
  const type = (res.headers.get('content-type') || '').split(';')[0].trim().toLowerCase();
  const ext = TYPES[type];
  if (!ext) throw new Error(`Not a supported image (${type || 'unknown type'})`);
  if (Number(res.headers.get('content-length')) > MAX_BYTES) throw new Error('Image is too large');
  const bytes = new Uint8Array(await res.arrayBuffer());
  if (bytes.byteLength > MAX_BYTES) throw new Error('Image is too large');

  const key = `${name.replace(/[^a-z0-9-]/gi, '')}.${ext}`;
  await images.put(key, bytes, type === 'image/jpg' ? 'image/jpeg' : type);
  return `/images/${key}`;
}

export async function deleteImage(src, images) {
  if (isLocal(src)) await images.delete(src.slice('/images/'.length));
}

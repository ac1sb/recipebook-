// Photo storage on your own computer: a folder of files.
import fs from 'node:fs/promises';
import path from 'node:path';

const TYPES = { jpg: 'image/jpeg', png: 'image/png', webp: 'image/webp', gif: 'image/gif', avif: 'image/avif' };

export function createFsImages(dir) {
  const safe = (key) => path.join(dir, path.basename(key));
  return {
    async put(key, bytes) {
      await fs.mkdir(dir, { recursive: true });
      const tmp = `${safe(key)}.tmp`;
      await fs.writeFile(tmp, bytes);
      await fs.rename(tmp, safe(key));
    },
    async get(key) {
      try {
        const body = await fs.readFile(safe(key));
        return { body, contentType: TYPES[path.extname(key).slice(1)] || 'application/octet-stream' };
      } catch {
        return null;
      }
    },
    async delete(key) {
      await fs.unlink(safe(key)).catch(() => {});
    },
  };
}

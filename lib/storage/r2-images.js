// Photo storage on Cloudflare R2.
export function createR2Images(bucket) {
  return {
    async put(key, bytes, contentType) {
      await bucket.put(key, bytes, { httpMetadata: { contentType } });
    },
    async get(key) {
      const obj = await bucket.get(key);
      return obj ? { body: obj.body, contentType: obj.httpMetadata?.contentType || 'application/octet-stream' } : null;
    },
    async delete(key) {
      await bucket.delete(key);
    },
  };
}

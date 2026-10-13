// Library storage on Cloudflare D1. Each library entry is stored as one JSON
// document (same shape as the local file store), plus a few columns for lookups.
// Schema: migrations/0001_init.sql

export function createD1Store(db) {
  const newId = () => globalThis.crypto.randomUUID();
  const parse = (row) => (row ? JSON.parse(row.data) : null);

  async function put(entry) {
    await db
      .prepare('INSERT INTO entries (id, source_id, saved_at, data) VALUES (?1, ?2, ?3, ?4) ON CONFLICT(id) DO UPDATE SET source_id = ?2, saved_at = ?3, data = ?4')
      .bind(entry.id, entry.recipe.id, entry.savedAt, JSON.stringify(entry))
      .run();
    return entry;
  }

  return {
    newId,
    async settings() {
      const row = await db.prepare("SELECT value FROM settings WHERE key = 'settings'").first();
      return { pref: 'balanced', ...(row ? JSON.parse(row.value) : {}) };
    },
    async updateSettings(patch) {
      const next = { ...(await this.settings()), ...patch };
      await db
        .prepare("INSERT INTO settings (key, value) VALUES ('settings', ?1) ON CONFLICT(key) DO UPDATE SET value = ?1")
        .bind(JSON.stringify(next))
        .run();
      return next;
    },
    async list() {
      const { results } = await db.prepare('SELECT data FROM entries ORDER BY saved_at DESC').all();
      return results.map(parse);
    },
    async get(id) {
      return parse(await db.prepare('SELECT data FROM entries WHERE id = ?1').bind(id).first());
    },
    async findBySourceId(sourceId) {
      return parse(await db.prepare('SELECT data FROM entries WHERE source_id = ?1').bind(sourceId).first());
    },
    async add(recipe) {
      const existing = await this.findBySourceId(recipe.id);
      if (existing) return existing;
      return put({
        id: newId(),
        savedAt: new Date().toISOString(),
        recipe,
        versions: [],
        feedback: [],
        suggestions: [],
        favoriteVersionId: null,
      });
    },
    async update(id, fn) {
      const entry = await this.get(id);
      if (!entry) return null;
      await fn(entry);
      return put(entry);
    },
    async remove(id) {
      const res = await db.prepare('DELETE FROM entries WHERE id = ?1').bind(id).run();
      return res.meta.changes > 0;
    },
    // Used by the import script / endpoint to copy an existing library in.
    async putEntry(entry) {
      return put(entry);
    },
  };
}

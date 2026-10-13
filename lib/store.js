// Tiny JSON-file store for the recipe library. Writes are serialized and atomic.
import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';

export function createStore(file) {
  let data = null;
  let writing = Promise.resolve();

  async function load() {
    if (data) return data;
    try {
      data = JSON.parse(await fs.readFile(file, 'utf8'));
    } catch (err) {
      if (err.code !== 'ENOENT') throw err;
      data = {};
    }
    data.recipes ??= [];
    data.settings ??= { pref: 'balanced' };
    return data;
  }

  function save() {
    writing = writing.then(async () => {
      await fs.mkdir(path.dirname(file), { recursive: true });
      const tmp = `${file}.${process.pid}.tmp`;
      await fs.writeFile(tmp, JSON.stringify(data, null, 2));
      await fs.rename(tmp, file);
    });
    return writing;
  }

  const newId = () => crypto.randomUUID();

  return {
    newId,
    async settings() {
      return (await load()).settings;
    },
    async updateSettings(patch) {
      const d = await load();
      Object.assign(d.settings, patch);
      await save();
      return d.settings;
    },
    async list() {
      return (await load()).recipes;
    },
    async get(id) {
      return (await load()).recipes.find((r) => r.id === id) || null;
    },
    async findBySourceId(sourceId) {
      return (await load()).recipes.find((r) => r.recipe.id === sourceId) || null;
    },
    async add(recipe) {
      const d = await load();
      const existing = d.recipes.find((r) => r.recipe.id === recipe.id);
      if (existing) return existing;
      const entry = {
        id: newId(),
        savedAt: new Date().toISOString(),
        recipe,
        versions: [],
        feedback: [],
        suggestions: [],
        favoriteVersionId: null,
      };
      d.recipes.unshift(entry);
      await save();
      return entry;
    },
    async update(id, fn) {
      const d = await load();
      const entry = d.recipes.find((r) => r.id === id);
      if (!entry) return null;
      await fn(entry);
      await save();
      return entry;
    },
    async remove(id) {
      const d = await load();
      const before = d.recipes.length;
      d.recipes = d.recipes.filter((r) => r.id !== id);
      await save();
      return d.recipes.length !== before;
    },
  };
}

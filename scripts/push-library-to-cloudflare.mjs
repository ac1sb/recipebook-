// Copies the library from your computer (data/library.json + data/images/) to
// the Cloudflare D1 database and R2 bucket used by the deployed site.
//
//   npm run push-library            -> upload to Cloudflare
//   npm run push-library -- --local -> upload to the local `wrangler dev` copy (for testing)
//
// Recipes already on Cloudflare with the same id are replaced; others are kept.
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const target = args.includes('--local') ? '--local' : '--remote';
const dataFile = path.resolve(args.find((a) => !a.startsWith('--')) || process.env.RECIPEBOOK_DATA || path.join(root, 'data', 'library.json'));
const imagesDir = path.join(path.dirname(dataFile), 'images');
const DB = 'borsari-kitchen';
const BUCKET = 'borsari-kitchen-images';
const TYPES = { jpg: 'image/jpeg', png: 'image/png', webp: 'image/webp', gif: 'image/gif', avif: 'image/avif' };

function wrangler(...cmd) {
  const res = spawnSync('npx', ['wrangler', ...cmd], { cwd: root, stdio: 'inherit', shell: process.platform === 'win32' });
  if (res.status !== 0) {
    console.error(`\nwrangler ${cmd.slice(0, 3).join(' ')} failed — see the message above.`);
    process.exit(res.status || 1);
  }
}

if (!fs.existsSync(dataFile)) {
  console.error(`No library found at ${dataFile}`);
  process.exit(1);
}
const library = JSON.parse(fs.readFileSync(dataFile, 'utf8'));
const entries = library.recipes || [];
const sql = (v) => `'${String(v).replace(/'/g, "''")}'`;

const lines = entries.map((e) =>
  `INSERT OR REPLACE INTO entries (id, source_id, saved_at, data) VALUES (${sql(e.id)}, ${sql(e.recipe.id)}, ${sql(e.savedAt)}, ${sql(JSON.stringify(e))});`);
if (library.settings) lines.push(`INSERT OR REPLACE INTO settings (key, value) VALUES ('settings', ${sql(JSON.stringify(library.settings))});`);

const big = lines.filter((l) => l.length > 90_000);
if (big.length) console.warn(`Warning: ${big.length} recipe(s) are unusually large and may be rejected by D1.`);

const where = target === '--remote' ? 'Cloudflare' : 'the local wrangler dev copy';
console.log(`Uploading ${entries.length} recipe(s) to ${where}…`);
const sqlFile = path.join(root, '.wrangler', 'library-import.sql');
fs.mkdirSync(path.dirname(sqlFile), { recursive: true });
fs.writeFileSync(sqlFile, lines.join('\n'));
wrangler('d1', 'execute', DB, target, `--file=${sqlFile}`, '--yes');
fs.unlinkSync(sqlFile);

// Only upload photos that saved recipes actually use.
const used = new Set(entries.map((e) => e.recipe.image).filter((src) => src?.startsWith('/images/')).map((src) => src.slice(8)));
const files = fs.existsSync(imagesDir) ? fs.readdirSync(imagesDir).filter((f) => used.has(f)) : [];
console.log(`Uploading ${files.length} photo(s)…`);
for (const f of files) {
  const type = TYPES[path.extname(f).slice(1)] || 'application/octet-stream';
  wrangler('r2', 'object', 'put', `${BUCKET}/${f}`, `--file=${path.join(imagesDir, f)}`, `--content-type=${type}`, target);
}
console.log(`\nDone: ${entries.length} recipe(s) and ${files.length} photo(s) copied to ${where}.`);

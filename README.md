# The Borsari Kitchen

A personal recipe library. Search for a kind of dish and get recipes, with photos, from several online sources. Choose how processed you're happy for a recipe to be (from "convenience OK" up to "from scratch"), and filter by prep and cook time. Save recipes, rate them after you cook them, and the site learns from your feedback: it suggests changes and finds recipes closer to what you want.

## Features

- **Search many sources at once.** Two free sources work with no setup:
  - **Food blogs:** about 30 popular blogs (Budget Bytes, RecipeTin Eats, Natasha's Kitchen, Once Upon a Chef, Sally's Baking, Skinnytaste…), searched live and read for photos, ingredients and steps.
  - [TheMealDB](https://www.themealdb.com).

  Optionally, Spoonacular and Edamam work with free API keys (together they cover thousands of food blogs and publishers). **Whole web** uses Claude to search recipe sites across the internet and reads each page's recipe data.
- **Results that match your whole search.** "chicken noodle soup" has to have chicken, noodles *and* be a soup. The site checks the title, ingredients, tags and method, and understands synonyms (prawn = shrimp, lasagne = lasagna, rosół = soup). "Chicken stock" doesn't count as chicken. Exact matches come first; recipes missing one part appear under **Close matches** with a note like "no noodle"; unrelated results are dropped.
- **Photos** for every recipe that has one.
- **How processed?** Pick one of four levels: Convenience OK, Lightly processed, Mostly whole foods, or From scratch. Every recipe gets a "% from scratch" score. Two kinds of items are highlighted, each with a from-scratch alternative:
  - 🥫 packaged: canned, jarred, boxed and store-bought items
  - 🏭 processed foods: hot dogs, deli meat, margarine, processed cheese, store-bought cookies, soda and so on

  Search results are ranked to match your level. **Adapt** rewrites a recipe toward it: homemade swaps for "From scratch", quick store-bought swaps for "Convenience OK".
- **Rework the ingredients** on any recipe, in search results or your library:
  - **Adapt / Make it from scratch:** swaps canned, boxed and processed products for homemade.
  - **🥫 Use canned & store-bought:** the opposite. Dried beans become canned beans, fresh tomatoes become canned, homemade stock becomes boxed broth, fresh herbs become dried.
  - **🔄 Missing something?:** tick what you don't have and pick a substitute, e.g. buttermilk → milk + lemon juice, or shallot → onion + a little garlic. With an Anthropic key, Claude suggests substitutes with amounts for that specific recipe; otherwise a built-in table of about 100 common swaps is used.

  Save the result as a version to cook and rate later.
- **Prep and cook time filters.** Times come from the recipe source when it gives them. Otherwise they're estimated from the ingredients and method, and marked with "~".
- **Import any recipe link.** Paste a URL from almost any recipe site or blog.
- **Feedback after cooking.** Give it a star rating, quick notes ("Too salty", "Took too long", "Kids loved it"…), comments, and whether you'd make it again.
- **Learns from your feedback.** Your ratings and notes build a taste profile, for example "milder food, quicker recipes, you rate mushroom and Italian dishes highly". You can see it on the library page. Search results are ranked with it, and each card says why it suits you ("✓ milder", "✓ quick (25 min)") or warns you ("! spicier").
- **Find recipes closer to what you want.** On any saved recipe, this searches for other versions of the same dish. They're ranked by how well they fix what you noted, compared with your recipe ("milder than yours", "35 min quicker", "less processed than yours").
- **Find new alterations.** Turns all your feedback for a recipe, plus an optional wish like "make it dairy-free", into three different versions to try. Save one as a new version, cook it, rate it, and repeat. Mark your favorite as your go-to version.

## Running it

Requires [Node.js](https://nodejs.org) 22 or newer.

```bash
npm install
cp .env.example .env   # optional: add API keys
npm start
```

Then open http://localhost:3000. (To put it on the internet, see **Publish on Cloudflare** below.)

### API keys (all optional)

| Key in `.env` | What it turns on | Where to get it |
|---|---|---|
| `ANTHROPIC_API_KEY` | Whole-web recipe search, plus smart alterations based on your feedback | https://console.anthropic.com |
| `SPOONACULAR_API_KEY` | Spoonacular search (recipes from many blogs and sites) | https://spoonacular.com/food-api/console |
| `EDAMAM_APP_ID` / `EDAMAM_APP_KEY` | Edamam search (millions of recipes) | https://developer.edamam.com/edamam-recipe-api |

Without an Anthropic key, alterations come from built-in rules: quantity tweaks for tags like "Too bland" or "Too spicy", plus homemade and shortcut swaps.

Your library is saved in `data/library.json`, and photos of saved recipes in `data/images/`. Set `RECIPEBOOK_DATA` to store them somewhere else.

**Saved recipes are a full local copy.** When you save a recipe, the site stores the ingredients, method, times and a copy of the photo on your computer, so it stays in your library even if the original site removes it or changes it. If a source only gave the ingredients, the method is fetched from the original page at save time. Recipes saved before this feature get their photos copied the next time you start the site. To back up your library, copy the `data` folder.

## Publish on Cloudflare

The same app runs on Cloudflare Workers:
- recipes and feedback are stored in a **D1** database
- saved photos go in an **R2** bucket
- the pages are served as static assets

**Plan:** use the **Workers Paid** plan ($5/month). Each search reads dozens of recipe pages at once, which goes beyond the Free plan's per-request limits (10 ms of CPU time and 50 outgoing requests). On the Free plan, saving and browsing your library works, but searches will fail. D1 and R2 usage for a personal recipe library stays within their included free amounts. R2 has to be turned on once in the dashboard (**R2 Object Storage → Get started**) before step 3.

### One-time setup

Run these in the project folder:

```bash
npm install
npx wrangler login                                   # opens the browser to sign in to Cloudflare
npx wrangler d1 create borsari-kitchen               # prints a database_id
```

Copy the printed `database_id` into `wrangler.toml`, replacing `REPLACE_WITH_YOUR_DATABASE_ID`. Then:

```bash
npx wrangler r2 bucket create borsari-kitchen-images
npm run cf:setup                                     # creates the tables in D1
npx wrangler secret put APP_PASSWORD                 # choose a password for the site (strongly recommended)
npx wrangler secret put ANTHROPIC_API_KEY            # optional, same for SPOONACULAR_API_KEY, EDAMAM_APP_ID, EDAMAM_APP_KEY
npm run deploy
```

`npm run deploy` prints the site's address, e.g. `https://borsari-kitchen.<your-subdomain>.workers.dev`. With `APP_PASSWORD` set, the browser asks for a username and password: type anything as the username, and your password.

**Your own domain (optional):** in the Cloudflare dashboard go to **Workers & Pages → borsari-kitchen → Settings → Domains & Routes → Add → Custom domain**, and enter something like `kitchen.yourdomain.com`. The domain must already be on your Cloudflare account.

**Instead of a password**, you can use **Cloudflare Access** (Zero Trust → Access → Applications) to require a one-time email code. If you do, you can skip `APP_PASSWORD`.

### Copy your existing library up

The library on your computer and the one on Cloudflare are separate. To copy what you've saved locally (recipes, versions, feedback, photos and settings) to Cloudflare:

```bash
npm run push-library
```

You can run it again later: recipes with the same id are replaced, and anything you've added on Cloudflare is kept.

### Updating the site later

```bash
git pull
npm install
npm run cf:setup     # only does something when there are new database changes
npm run deploy
```

To test the Cloudflare version on your computer first, run `npm run cf:dev` and open http://localhost:8787. It uses a local copy of D1 and R2. Put any keys in a `.dev.vars` file, written the same way as `.env`.

## Notes

- To add or remove blogs, edit the `SITES` list in `lib/sources/blogs.js`. Any WordPress food blog that publishes recipe data works.
- A few large recipe publishers block automated requests, so a link from one of those sites may fail to import. Most sites and food blogs work.
- `npm test` runs the unit tests.

## Project layout

```
server.js               Runs the app on your computer (npm start): JSON file + images folder
worker.js               Runs the app on Cloudflare Workers: D1 + R2 + static assets
wrangler.toml           Cloudflare settings
migrations/             D1 database tables
scripts/                push-library-to-cloudflare.mjs
lib/app.js              The web API (Hono), shared by both
lib/storage/            Library and photo storage for each place it runs
lib/homemade.js         Processed / from-scratch scoring and swaps
lib/time.js             Prep and cook times (from the source, or estimated) and time filters
lib/profile.js          Taste profile learned from feedback, and how well recipes fit it
lib/relevance.js        How well a recipe matches the words searched for (with synonyms)
lib/tweaks.js           Rule-based alterations from feedback
lib/substitutes.js      Common ingredient substitutions
lib/claude.js           Whole-web search, alterations and substitutes via Claude
lib/images.js           Copies of saved recipes' photos
lib/sources/*.js        Food blogs, TheMealDB, Spoonacular, Edamam, and any-web-page (schema.org) readers
public/                 The web app (HTML/CSS/JS, no build step)
```

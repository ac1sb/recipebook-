# The Borsari Kitchen

A personal recipe library. Search for a kind of dish and get recipes, with photos, from several online sources. Choose how processed you're happy for a recipe to be (from "convenience OK" up to "from scratch"), and filter by prep and cook time. Save recipes, rate them after you cook them, and the site learns from your feedback: it suggests changes and finds recipes closer to what you want.

## Features

- **Search many sources at once.** Includes [TheMealDB](https://www.themealdb.com) with no setup. Spoonacular and Edamam work with free API keys (together they cover thousands of food blogs and publishers). **Whole web** uses Claude to search recipe sites across the internet and reads each page's recipe data.
- **Results that match your whole search.** "chicken noodle soup" has to have chicken, noodles *and* be a soup. The site checks the title, ingredients, tags and method, and understands synonyms (prawn = shrimp, lasagne = lasagna, rosół = soup). "Chicken stock" doesn't count as chicken. Exact matches come first; recipes missing one part appear under **Close matches** with a note like "no noodle"; unrelated results are dropped.
- **Photos** for every recipe that has one.
- **How processed?** Pick one of four levels: Convenience OK, Lightly processed, Mostly whole foods, or From scratch. Every recipe gets a "% from scratch" score. Two kinds of items are highlighted, each with a from-scratch alternative:
  - 🥫 packaged: canned, jarred, boxed and store-bought items
  - 🏭 processed foods: hot dogs, deli meat, margarine, processed cheese, store-bought cookies, soda and so on

  Search results are ranked to match your level. **Adapt** rewrites a recipe toward it: homemade swaps for "From scratch", quick store-bought swaps for "Convenience OK".
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

Then open http://localhost:3000.

### API keys (all optional)

| Key in `.env` | What it turns on | Where to get it |
|---|---|---|
| `ANTHROPIC_API_KEY` | Whole-web recipe search, plus smart alterations based on your feedback | https://console.anthropic.com |
| `SPOONACULAR_API_KEY` | Spoonacular search (recipes from many blogs and sites) | https://spoonacular.com/food-api/console |
| `EDAMAM_APP_ID` / `EDAMAM_APP_KEY` | Edamam search (millions of recipes) | https://developer.edamam.com/edamam-recipe-api |

Without an Anthropic key, alterations come from built-in rules: quantity tweaks for tags like "Too bland" or "Too spicy", plus homemade and shortcut swaps.

Your library is saved in `data/library.json`. Set `RECIPEBOOK_DATA` to store it somewhere else.

## Notes

- A few large recipe publishers block automated requests, so a link from one of those sites may fail to import. Most sites and food blogs work.
- `npm test` runs the unit tests.

## Project layout

```
server.js               Express server and API
lib/homemade.js         Processed / from-scratch scoring and swaps
lib/time.js             Prep and cook times (from the source, or estimated) and time filters
lib/profile.js          Taste profile learned from feedback, and how well recipes fit it
lib/relevance.js        How well a recipe matches the words searched for (with synonyms)
lib/tweaks.js           Rule-based alterations from feedback
lib/claude.js           Whole-web search and feedback-driven alterations via Claude
lib/sources/*.js        TheMealDB, Spoonacular, Edamam, and any-web-page (schema.org) readers
lib/store.js            JSON-file library storage
public/                 The web app (HTML/CSS/JS, no build step)
```

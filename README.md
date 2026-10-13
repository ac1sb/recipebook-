# The Borsari Kitchen

A personal recipe library. Search for a kind of dish and get recipes, with photos, from several online sources. Choose how homemade you want to cook (from "shortcuts welcome" with canned and boxed products up to "from scratch"). Save recipes, rate them after you cook them, and get new variations based on your feedback.

## Features

- **Search many sources at once.** Includes [TheMealDB](https://www.themealdb.com) with no setup. Spoonacular and Edamam work with free API keys (together they cover thousands of food blogs and publishers). **Whole web** uses Claude to search recipe sites across the internet and reads each page's recipe data.
- **Photos** for every recipe that has one.
- **Homemade vs. canned slider.** Every recipe gets a homemade score. Canned, jarred, boxed and store-bought items are highlighted, each with a from-scratch alternative. Search results are ranked to match your setting, and **Adapt** rewrites a recipe toward it: homemade swaps for "From scratch" and quick store-bought swaps for "Shortcuts welcome".
- **Import any recipe link.** Paste a URL from almost any recipe site or blog.
- **Feedback after cooking.** Give it a star rating, quick notes ("Too salty", "Took too long", "Kids loved it"…), comments, and whether you'd make it again.
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
lib/homemade.js         Homemade scoring and from-scratch / shortcut swaps
lib/tweaks.js           Rule-based alterations from feedback
lib/claude.js           Whole-web search and feedback-driven alterations via Claude
lib/sources/*.js        TheMealDB, Spoonacular, Edamam, and any-web-page (schema.org) readers
lib/store.js            JSON-file library storage
public/                 The web app (HTML/CSS/JS, no build step)
```

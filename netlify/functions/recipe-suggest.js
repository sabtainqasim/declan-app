// Netlify serverless function — AI recipe suggestions
// Calls Google Gemini API using a server-side API key (never exposed to the browser)
//
// Returns the SAME structured recipeCard shape used by ask-declan.js's Recipe
// Intelligence Card, so the Kitchen module and Ask Declan chat can render recipes
// through the same shared front-end component instead of two separate ones.
//
// Set your API key in Netlify: Site settings > Environment variables > GEMINI_API_KEY
// Get a free key at: https://aistudio.google.com/app/apikey

exports.handler = async function (event) {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: JSON.stringify({ error: 'Method not allowed' }) };
  }

  const { checkRateLimit, rateLimitResponse } = require('./utils/_rateLimiter');
  const rl = checkRateLimit(event, 'recipe-suggest', 10, 60000); // 10 requests / 60s per IP
  if (!rl.allowed) return rateLimitResponse(rl.retryAfterSeconds);

  try {
    const { pantryItems, cuisine, mealType, language, country, city, allergiesAndPreferences, dietaryTags, favouriteStore } = JSON.parse(event.body || '{}');

    const apiKey = process.env.GEMINI_API_KEY;
    // Model name is configurable via env var so a future Google retirement (they've been
    // retiring Gemini models every few months) only needs a Netlify env var change, not a
    // code redeploy. Defaults to gemini-3.5-flash if GEMINI_MODEL isn't set.
    const GEMINI_MODEL = process.env.GEMINI_MODEL || 'gemini-2.5-flash';
    if (!apiKey) {
      return { statusCode: 500, body: JSON.stringify({ error: 'GEMINI_API_KEY is not set on the server.' }) };
    }

    const safePantryItems = Array.isArray(pantryItems) ? pantryItems.slice(0, 50).filter(i => typeof i === 'string') : [];
    const safeDietaryTags = Array.isArray(dietaryTags) ? dietaryTags.slice(0, 20).filter(t => typeof t === 'string') : [];
    const safeCuisine = typeof cuisine === 'string' ? cuisine.slice(0, 100) : '';
    const safeMealType = typeof mealType === 'string' ? mealType.slice(0, 50) : '';
    const safeAllergies = typeof allergiesAndPreferences === 'string' ? allergiesAndPreferences.slice(0, 500) : '';
    const safeCountry = typeof country === 'string' ? country.slice(0, 100) : '';
    const safeCity = typeof city === 'string' ? city.slice(0, 100) : '';
    const safeFavouriteStore = typeof favouriteStore === 'string' ? favouriteStore.slice(0, 100) : '';

    const prompt = `You are Declan, a friendly home AI assistant. Suggest 3 recipes a family could cook today,
using the same structured "recipeCard" shape as your main recipe intelligence feature.

Pantry items available: ${safePantryItems.length ? safePantryItems.join(', ') : 'not specified — suggest general easy recipes'}.
Preferred cuisine: ${safeCuisine || 'any (cover a mix of world cuisines, not just one region)'}.
Meal type preference: ${safeMealType && safeMealType !== 'any' ? safeMealType : 'any'}.
Allergies/food preferences to respect: ${safeAllergies || 'none specified'}.
Dietary tags to respect (adapt recipes accordingly): ${safeDietaryTags.join(', ') || 'none specified'}.
Location (for a rough price estimate if relevant): ${safeCountry ? `${safeCity ? safeCity+', ' : ''}${safeCountry}` : 'not specified'}.

For each recipe, check it against the pantry list above and fill in pantryCheck/missingIngredients accordingly.
${language && language !== 'English' ? `Write name/intro/tags in ${language}.` : ''}

FAVOURITE/RECOMMENDED STORE: ${safeFavouriteStore
  ? `The household's favourite store is "${safeFavouriteStore}" — don't suggest a different store, leave "storeSuggestion" as null (the app already shows their favourite).`
  : `The app has its own curated store list for these countries: Pakistan, India, Bangladesh, United States,
United Kingdom, Canada, Australia, United Arab Emirates, Saudi Arabia, Germany — if the location above is one
of these, leave "storeSuggestion" as null (the app handles it). For ANY OTHER country, use web search to find
one real, well-known local grocery store or supermarket chain that actually operates there — only name a
store you're reasonably confident actually exists. Fill "storeSuggestion": {"name": "...", "url": "the
store's real official homepage if found, else empty string", "note": "AI-suggested — verify local
availability"} per recipe. If you're not confident about a real store for that location, leave it null rather
than guessing or inventing a name/URL.`}

Respond ONLY as a JSON array of recipeCard objects in this exact shape:
[{
  "name": "...", "intro": "...", "cookingTime": "...", "serves": "...", "difficulty": "Easy|Medium|Hard",
  "healthScore": "Healthy|Balanced|Indulgent", "budgetScore": "Budget Friendly|Medium Cost|Premium Meal",
  "pantryCheck": [{"item":"...", "available": true}],
  "missingIngredients": ["..."],
  "estimatedCostNote": "≈ ... (estimated)",
  "storeSuggestion": null or {"name": "...", "url": "...", "note": "AI-suggested — verify local availability"}
}]
estimatedCostNote should always include "estimated" or "≈" and never claim an exact live price — leave it as
an empty string if you don't have enough info to even guess. No markdown formatting, no extra text, just the
raw JSON array.`;

    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${apiKey}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          tools: [{ google_search: {} }],
        }),
      }
    );

    const data = await response.json();
    const rawText = data?.candidates?.[0]?.content?.parts?.[0]?.text || '[]';
    const cleaned = rawText.replace(/```json|```/g, '').trim();

    let recipes;
    try {
      recipes = JSON.parse(cleaned);
    } catch (e) {
      recipes = [];
    }

    return {
      statusCode: 200,
      body: JSON.stringify({ recipes }),
    };
  } catch (err) {
    return {
      statusCode: 500,
      body: JSON.stringify({ error: 'Something went wrong generating recipes.' }),
    };
  }
};

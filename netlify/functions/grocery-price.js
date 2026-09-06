// Netlify serverless function — Grocery Price Estimator
// Uses Gemini's Google Search grounding to give an APPROXIMATE price estimate for
// grocery items/recipe ingredients in the user's country/city. This is NOT live
// scraped exact pricing (no retailer offers a public pricing API, and scraping
// their sites would violate most Terms of Service) — it's a general estimate
// based on publicly searchable information, clearly labeled as such.
//
// Set your API key in Netlify: Site settings > Environment variables > GEMINI_API_KEY

exports.handler = async function (event) {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: JSON.stringify({ error: 'Method not allowed' }) };
  }

  const { checkRateLimit, rateLimitResponse } = require('./utils/_rateLimiter');
  const rl = checkRateLimit(event, 'grocery-price', 20, 60000); // 20 requests / 60s per IP
  if (!rl.allowed) return rateLimitResponse(rl.retryAfterSeconds);

  // Deterministic country -> currency lookup. The AI is unreliable at guessing
  // currency (it can mix up symbols, use the wrong one for the country, or
  // write inconsistent labels across items in the same response), so we resolve
  // this ourselves in code and force it onto every estimate rather than trusting
  // whatever the model writes.
  const COUNTRY_CURRENCY = {
    'pakistan': { code: 'PKR', symbol: 'Rs' },
    'india': { code: 'INR', symbol: '₹' },
    'bangladesh': { code: 'BDT', symbol: '৳' },
    'united kingdom': { code: 'GBP', symbol: '£' },
    'uk': { code: 'GBP', symbol: '£' },
    'united states': { code: 'USD', symbol: '$' },
    'usa': { code: 'USD', symbol: '$' },
    'united states of america': { code: 'USD', symbol: '$' },
    'canada': { code: 'CAD', symbol: 'CA$' },
    'australia': { code: 'AUD', symbol: 'A$' },
    'united arab emirates': { code: 'AED', symbol: 'AED' },
    'uae': { code: 'AED', symbol: 'AED' },
    'saudi arabia': { code: 'SAR', symbol: 'SAR' },
    'qatar': { code: 'QAR', symbol: 'QAR' },
    'germany': { code: 'EUR', symbol: '€' },
    'france': { code: 'EUR', symbol: '€' },
    'spain': { code: 'EUR', symbol: '€' },
    'italy': { code: 'EUR', symbol: '€' },
    'netherlands': { code: 'EUR', symbol: '€' },
    'ireland': { code: 'EUR', symbol: '€' },
    'sri lanka': { code: 'LKR', symbol: 'Rs' },
    'nepal': { code: 'NPR', symbol: 'Rs' },
    'oman': { code: 'OMR', symbol: 'OMR' },
    'kuwait': { code: 'KWD', symbol: 'KWD' },
    'bahrain': { code: 'BHD', symbol: 'BHD' },
    'turkey': { code: 'TRY', symbol: '₺' },
    'egypt': { code: 'EGP', symbol: 'E£' },
    'new zealand': { code: 'NZD', symbol: 'NZ$' },
    'portugal': { code: 'EUR', symbol: '€' },
    'belgium': { code: 'EUR', symbol: '€' },
    'austria': { code: 'EUR', symbol: '€' },
  };

  function resolveCurrency(country) {
    if (!country) return null;
    const key = country.trim().toLowerCase();
    return COUNTRY_CURRENCY[key] || null;
  }

  try {
    const { items, country, city } = JSON.parse(event.body || '{}');
    const apiKey = process.env.GEMINI_API_KEY;
    // Model name is configurable via env var so a future Google retirement (they've been
    // retiring Gemini models every few months) only needs a Netlify env var change, not a
    // code redeploy. Defaults to gemini-3.5-flash if GEMINI_MODEL isn't set.
    const GEMINI_MODEL = process.env.GEMINI_MODEL || 'gemini-3.5-flash';

    if (!apiKey) {
      return { statusCode: 500, body: JSON.stringify({ error: 'GEMINI_API_KEY is not set on the server.' }) };
    }
    if (!Array.isArray(items) || items.length === 0) {
      return { statusCode: 400, body: JSON.stringify({ error: 'No items provided.' }) };
    }
    const safeItems = items.slice(0, 30).filter(i => typeof i === 'string').map(i => i.slice(0, 100));
    if (safeItems.length === 0) {
      return { statusCode: 400, body: JSON.stringify({ error: 'No valid items provided.' }) };
    }
    const safeCountry = typeof country === 'string' ? country.slice(0, 100) : '';
    const safeCity = typeof city === 'string' ? city.slice(0, 100) : '';

    const resolvedCurrency = resolveCurrency(safeCountry);
    const location = safeCountry ? `${safeCity ? safeCity + ', ' : ''}${safeCountry}` : 'a typical location (no location set by the user)';
    const currencyInstruction = resolvedCurrency
      ? `Give all prices in ${resolvedCurrency.code} (${resolvedCurrency.symbol}) — this is the correct currency for ${safeCountry}, do not use any other currency.`
      : `The user's country isn't set, so give a currency-neutral price range description instead of guessing a currency (e.g. "roughly low-cost" rather than inventing a currency symbol).`;

    const prompt = `You are Declan, a home AI assistant. Using general publicly available information (web
search), give a rough, general APPROXIMATE price estimate for these grocery items in ${location}: ${safeItems.join(', ')}.

${currencyInstruction}

Important: You do NOT have access to live/exact retailer pricing — always frame this as a general estimate/
typical range, never as an exact current price. If you're not confident about prices for this specific
location, say so honestly rather than making up numbers.

Respond ONLY as JSON in this shape:
{"estimates": [{"item": "...", "priceRange": "...", "currency": "..."}], "note": "a short honest caveat about this being a general estimate, not live pricing"}
No markdown formatting, no extra text.`;

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
    const rawText = data?.candidates?.[0]?.content?.parts?.[0]?.text || '{}';
    const cleaned = rawText.replace(/```json|```/g, '').trim();
    let result;
    try { result = JSON.parse(cleaned); } catch (e) { result = { estimates: [], note: 'Could not generate an estimate right now.' }; }

    // Force the correct currency onto every estimate — never trust the model's
    // own currency field, since that's exactly the kind of thing it can get
    // subtly wrong or inconsistent between items.
    if (Array.isArray(result.estimates)) {
      result.estimates = result.estimates.map((e) => ({
        ...e,
        currency: resolvedCurrency ? resolvedCurrency.code : '',
      }));
    }
    if (!resolvedCurrency && result.note) {
      result.note = `${result.note} (Set your country in Profile for currency-specific pricing.)`;
    }

    return { statusCode: 200, body: JSON.stringify(result) };
  } catch (err) {
    return { statusCode: 500, body: JSON.stringify({ error: 'Something went wrong estimating prices.' }) };
  }
};

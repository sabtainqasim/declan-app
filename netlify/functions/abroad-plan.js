// Netlify serverless function — Abroad Mode Trip Intelligence
//
// Turns a one-time "Trip Setup" (destination, purpose, duration, notes) into a
// connected, personalized plan instead of Abroad Mode being a set of unrelated
// static utilities. Reuses the same Gemini + Google Search grounding pattern as
// recipe-suggest.js so store/currency/document guidance is grounded in real,
// current information rather than invented.
//
// Set your API key in Netlify: Site settings > Environment variables > GEMINI_API_KEY

exports.handler = async function (event) {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: JSON.stringify({ error: 'Method not allowed' }) };
  }

  const { checkRateLimit, rateLimitResponse } = require('./utils/_rateLimiter');
  const rl = checkRateLimit(event, 'abroad-plan', 10, 60000); // 10 requests / 60s per IP
  if (!rl.allowed) return rateLimitResponse(rl.retryAfterSeconds);

  try {
    const { destinationCountry, destinationCity, homeCountry, purpose, duration, notes, allergiesAndPreferences, dietaryTags, language } = JSON.parse(event.body || '{}');

    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      return { statusCode: 500, body: JSON.stringify({ error: 'GEMINI_API_KEY is not set on the server.' }) };
    }
    if (!destinationCountry || typeof destinationCountry !== 'string') {
      return { statusCode: 400, body: JSON.stringify({ error: 'A destination country is required.' }) };
    }

    const safeDestCountry = destinationCountry.slice(0, 100);
    const safeDestCity = typeof destinationCity === 'string' ? destinationCity.slice(0, 100) : '';
    const safeHomeCountry = typeof homeCountry === 'string' ? homeCountry.slice(0, 100) : '';
    const safePurpose = typeof purpose === 'string' ? purpose.slice(0, 50) : 'general move';
    const safeDuration = typeof duration === 'string' ? duration.slice(0, 100) : '';
    const safeNotes = typeof notes === 'string' ? notes.slice(0, 1000) : '';
    const safeAllergies = typeof allergiesAndPreferences === 'string' ? allergiesAndPreferences.slice(0, 500) : '';
    const safeDietaryTags = Array.isArray(dietaryTags) ? dietaryTags.slice(0, 20).filter(t => typeof t === 'string') : [];

    const purposeGuidance = {
      student: 'university enrollment documents, student visa, accommodation (dorm/shared flat), local SIM/eSIM, student transport pass, budget student groceries',
      worker: 'work visa/permit, employment documents, commute/transport options, accommodation, monthly budget planning for a working professional, local banking setup',
      tourist: 'travel document checklist, packing essentials, currency, local emergency numbers, short-stay local shopping/food tips',
      family: 'family/dependent visa documents, schooling considerations if applicable, family accommodation, household budget, family-friendly local essentials',
    }[safePurpose] || 'general relocation essentials: documents, accommodation, budget, local basics';

    const prompt = `You are Declan, a home AI assistant, specifically powering "Abroad Mode" — helping someone
moving to a new country manage the practical side of daily life there. Using web search for anything
location-specific (currency, typical costs, emergency numbers), build a connected starter plan for this move.

Destination: ${safeDestCity ? safeDestCity + ', ' : ''}${safeDestCountry}
Moving from: ${safeHomeCountry || 'not specified'}
Purpose: ${safePurpose}${safePurpose !== 'general move' ? ` (focus especially on: ${purposeGuidance})` : ''}
Duration: ${safeDuration || 'not specified'}
Dietary needs/allergies to consider for grocery suggestions: ${safeAllergies || 'none specified'}${safeDietaryTags.length ? `, dietary tags: ${safeDietaryTags.join(', ')}` : ''}
Extra context from the user: ${safeNotes || 'none'}

Build a SHORT, genuinely useful, connected plan (not generic travel-blog advice) covering:
1. documentChecklist: 5-8 SPECIFIC document items for this exact purpose/destination (e.g. actual visa type
   name if you know it via search, not just "visa" generically)
2. estimatedStartupBudget: a short phrase like "≈ £800-1200 (estimated first-month essentials)" in the
   DESTINATION country's real currency (use web search to get the right currency and a realistic range) —
   always say "estimated", never claim it as an exact/verified figure
3. grocerySubstitutes: array of 2-4 {item, substitute} pairs for common home-country ingredients that may be
   hard to find in the destination, tailored to the user's likely home cuisine if inferable from homeCountry
4. emergencyInfo: a short phrase naming the real local emergency number for that country if you know it via
   search (e.g. "999 in the UK", "911 in the US") — leave empty if unsure, never guess
5. timeZoneNote: short phrase noting the destination's timezone name (e.g. "Europe/London" IANA format if
   you can identify it, else empty)
6. currencyCode: the destination's real ISO currency code (e.g. "GBP") if identifiable, else empty
7. summary: 1-2 warm, concise sentences tying this together as a connected plan, not a list dump

${language && language !== 'English' ? `Write summary and item text in ${language}.` : ''}

Respond ONLY as JSON in this exact shape:
{
  "documentChecklist": ["...", "..."],
  "estimatedStartupBudget": "...",
  "grocerySubstitutes": [{"item": "...", "substitute": "..."}],
  "emergencyInfo": "...",
  "timeZoneNote": "...",
  "currencyCode": "...",
  "summary": "..."
}
No markdown formatting, no extra text outside this JSON.`;

    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`,
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

    let plan;
    try {
      plan = JSON.parse(cleaned);
    } catch (e) {
      plan = null;
    }

    if (!plan) {
      return { statusCode: 200, body: JSON.stringify({ error: 'Could not generate a plan right now — please try again.' }) };
    }

    return { statusCode: 200, body: JSON.stringify({ plan }) };
  } catch (err) {
    return { statusCode: 500, body: JSON.stringify({ error: 'Something went wrong generating your trip plan.' }) };
  }
};

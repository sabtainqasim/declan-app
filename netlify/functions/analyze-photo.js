// Netlify serverless function — generic AI Vision analyzer
// Used by: Kitchen (fridge photo -> recipes, food photo -> nutrition),
// Home & Repair (room photo -> redesign, appliance photo -> troubleshoot, stain photo -> cleaning advice),
// and any future photo-based feature (e.g. plant photo -> care tips).
//
// Set your API key in Netlify: Site settings > Environment variables > GEMINI_API_KEY

const PROMPTS = {
  fridge: `You are Declan, a friendly home AI assistant. Look at this photo of a fridge/pantry.
List the food items you can identify, then suggest 3 recipes (covering a mix of cuisines, not just one region)
that could be made with what's visible. For each recipe give: name, short description, estimated time, tags.
Respond ONLY as JSON: {"itemsSeen": ["...","..."], "recipes":[{"name":"...","description":"...","time":"...","tags":["..."]}]}`,
  room: `You are Declan, a friendly home AI assistant. Look at this photo of a room. Suggest 3-4 practical
decoration/redesign ideas (furniture arrangement, color, storage, lighting) suited to what you see, keeping
suggestions realistic and budget-conscious. Respond ONLY as JSON: {"suggestions": ["...","...","..."]}`,
  appliance: `You are Declan, a friendly home AI assistant. Look at this photo of a home appliance.
Identify what it likely is, and give 2-3 basic troubleshooting tips for common issues with this type of
appliance, plus a note on when a professional/electrician should be called instead. Respond ONLY as JSON:
{"applianceGuess": "...", "tips": ["...","..."], "callProfessionalIf": "..."}`,
  plant: `You are Declan, a friendly home AI assistant. Look at this photo of a plant. Try to identify it
generally, and give simple care tips (watering, light, common issues). Respond ONLY as JSON:
{"plantGuess": "...", "careTips": ["...","...","..."]}`,
  food: `You are Declan, a friendly home AI assistant. Look at this photo of food. Estimate what dish it is
and give a rough nutrition estimate (calories, protein, notable nutrients) — clearly an estimate, not exact lab
data. Respond ONLY as JSON: {"dishGuess": "...", "estimatedCalories": "...", "notes": "..."}`,
  stain: `You are Declan, a friendly home AI assistant. Look at this photo of a stain. Guess what kind of stain
it might be and give practical cleaning advice for removing it from common household surfaces/fabric.
Respond ONLY as JSON: {"stainGuess": "...", "cleaningAdvice": ["...","..."]}`,
};

exports.handler = async function (event) {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: JSON.stringify({ error: 'Method not allowed' }) };
  }

  const { checkRateLimit, rateLimitResponse } = require('./utils/_rateLimiter');
  const rl = checkRateLimit(event, 'analyze-photo', 10, 60000); // 10 requests / 60s per IP
  if (!rl.allowed) return rateLimitResponse(rl.retryAfterSeconds);

  try {
    const { imageBase64, mimeType, mode } = JSON.parse(event.body || '{}');
    const apiKey = process.env.GEMINI_API_KEY;

    if (!apiKey) return { statusCode: 500, body: JSON.stringify({ error: 'GEMINI_API_KEY is not set on the server.' }) };
    if (!imageBase64 || typeof imageBase64 !== 'string') return { statusCode: 400, body: JSON.stringify({ error: 'No image provided.' }) };
    if (imageBase64.length > 8000000) return { statusCode: 400, body: JSON.stringify({ error: 'That image is too large — please use a smaller photo.' }) };
    const allowedMimeTypes = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];
    if (mimeType && !allowedMimeTypes.includes(mimeType)) return { statusCode: 400, body: JSON.stringify({ error: 'Unsupported image type.' }) };
    if (!PROMPTS[mode]) return { statusCode: 400, body: JSON.stringify({ error: 'Unknown mode.' }) };

    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{
            parts: [
              { text: PROMPTS[mode] },
              { inline_data: { mime_type: mimeType || 'image/jpeg', data: imageBase64 } },
            ],
          }],
        }),
      }
    );

    const data = await response.json();
    const rawText = data?.candidates?.[0]?.content?.parts?.[0]?.text || '{}';
    const cleaned = rawText.replace(/```json|```/g, '').trim();
    let result;
    try { result = JSON.parse(cleaned); } catch (e) { result = {}; }

    return { statusCode: 200, body: JSON.stringify({ result }) };
  } catch (err) {
    return { statusCode: 500, body: JSON.stringify({ error: 'Something went wrong analyzing this photo.' }) };
  }
};

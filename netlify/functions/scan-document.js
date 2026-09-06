// Netlify serverless function — Smart Scanner
// Sends a photo (base64) to Gemini's vision model and returns a plain-language explanation
// of a bill, receipt, warranty, or manual.
//
// Set your API key in Netlify: Site settings > Environment variables > GEMINI_API_KEY

exports.handler = async function (event) {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: JSON.stringify({ error: 'Method not allowed' }) };
  }

  const { checkRateLimit, rateLimitResponse } = require('./utils/_rateLimiter');
  const rl = checkRateLimit(event, 'scan-document', 10, 60000); // 10 requests / 60s per IP
  if (!rl.allowed) return rateLimitResponse(rl.retryAfterSeconds);

  try {
    const { imageBase64, mimeType } = JSON.parse(event.body || '{}');

    const apiKey = process.env.GEMINI_API_KEY;
    // Model name is configurable via env var so a future Google retirement (they've been
    // retiring Gemini models every few months) only needs a Netlify env var change, not a
    // code redeploy. Defaults to gemini-3.5-flash if GEMINI_MODEL isn't set.
    const GEMINI_MODEL = process.env.GEMINI_MODEL || 'gemini-3.6-flash';
    if (!apiKey) {
      return {
        statusCode: 500,
        body: JSON.stringify({ error: 'GEMINI_API_KEY is not set on the server.' }),
      };
    }
    if (!imageBase64 || typeof imageBase64 !== 'string') {
      return { statusCode: 400, body: JSON.stringify({ error: 'No image provided.' }) };
    }
    if (imageBase64.length > 8000000) {
      return { statusCode: 400, body: JSON.stringify({ error: 'That image is too large — please use a smaller photo.' }) };
    }
    const allowedMimeTypes = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];
    if (mimeType && !allowedMimeTypes.includes(mimeType)) {
      return { statusCode: 400, body: JSON.stringify({ error: 'Unsupported image type.' }) };
    }

    const prompt = `You are Declan, a friendly home AI assistant. Look at this photo of a document
(it could be a bill, receipt, warranty card, or appliance manual). In simple, plain language that
someone with low literacy could understand, explain:
1. What kind of document this is
2. The key numbers/charges/dates that matter (e.g. amount due, due date, warranty expiry)
3. One practical next step the person should take
Keep it short — a few sentences, no jargon.

Then, ALSO detect: if this is clearly a utility/service BILL with a payable amount, extract that amount
and a short bill name (e.g. "Electricity", "Gas", "Water", "Internet"). If it is NOT a bill (e.g. it's a
receipt, warranty, or manual), leave these blank.

Respond as JSON in this exact shape (the "explanation" field holds your plain-language answer from above):
{"explanation": "...", "isBill": true or false, "billName": "...", "billAmount": "..."}
Return ONLY the JSON, no extra text, no markdown formatting.`;

    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${apiKey}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [
            {
              parts: [
                { text: prompt },
                { inline_data: { mime_type: mimeType || 'image/jpeg', data: imageBase64 } },
              ],
            },
          ],
        }),
      }
    );

    const data = await response.json();
    const rawText = data?.candidates?.[0]?.content?.parts?.[0]?.text || '{}';
    const cleaned = rawText.replace(/```json|```/g, '').trim();
    let parsed;
    try {
      parsed = JSON.parse(cleaned);
    } catch (e) {
      parsed = { explanation: rawText || 'Could not read this document.', isBill: false };
    }

    return {
      statusCode: 200,
      body: JSON.stringify({
        explanation: parsed.explanation || 'Could not read this document.',
        isBill: !!parsed.isBill,
        billName: parsed.billName || '',
        billAmount: parsed.billAmount || '',
      }),
    };
  } catch (err) {
    return {
      statusCode: 500,
      body: JSON.stringify({ error: 'Something went wrong reading this document.' }),
    };
  }
};

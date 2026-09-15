// Declan — shared Tavily web search helper
//
// Gemini's built-in Google Search grounding tool requires Google Cloud billing
// to be enabled at all (even though the first 5,000/month are then free once
// billing is on) — confirmed directly from a live Gemini API error message.
// Since billing isn't available right now, this uses Tavily's search API
// instead (1,000 free credits/month, no credit card required, purpose-built
// for feeding LLM prompts) and manually injects the results as text context
// into the Gemini prompt — same end result (current web info), no billing
// requirement.
//
// Set TAVILY_API_KEY in Netlify: Site settings > Environment variables.

/**
 * Searches Tavily and returns a short text block formatted for direct
 * inclusion in a Gemini prompt, plus a plain list of {title, url} sources.
 * Returns null (not throws) on any failure — callers should treat search as
 * optional and continue without it, never let a search failure break the
 * main request.
 *
 * @param {string} query
 * @param {number} maxResults
 * @returns {Promise<{contextText: string, sources: Array<{title:string,url:string}>} | null>}
 */
async function tavilySearch(query, maxResults = 3) {
  const apiKey = process.env.TAVILY_API_KEY;
  if (!apiKey || !query) return null;

  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 5000);

    const response = await fetch('https://api.tavily.com/search', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
      signal: controller.signal,
      body: JSON.stringify({
        query: query.slice(0, 400),
        max_results: Math.min(maxResults, 5),
        search_depth: 'basic',
      }),
    });
    clearTimeout(timeoutId);

    if (!response.ok) return null;
    const data = await response.json();
    const results = Array.isArray(data.results) ? data.results.slice(0, maxResults) : [];
    if (results.length === 0) return null;

    function cleanTitle(r) {
      const raw = (r.title || '').replace(/[\r\n\t]+/g, ' ').trim();
      if (raw) return raw.slice(0, 80);
      try { return new URL(r.url).hostname.replace(/^www\./, ''); } catch (e) { return 'Web result'; }
    }

    const contextText = results
      .map((r, i) => `[${i + 1}] ${cleanTitle(r)}: ${(r.content || '').replace(/[\r\n\t]+/g, ' ').slice(0, 300)} (source: ${r.url})`)
      .join('\n');

    const sources = results.map(r => ({ title: cleanTitle(r), url: r.url })).filter(s => s.url);

    return { contextText, sources };
  } catch (e) {
    return null;
  }
}

module.exports = { tavilySearch };

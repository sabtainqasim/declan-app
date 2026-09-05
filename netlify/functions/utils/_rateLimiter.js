// Declan — shared lightweight rate limiter for serverless functions
//
// HOW IT WORKS: an in-memory sliding-window counter per client IP, stored in
// a module-level Map. Netlify keeps warm function instances alive between
// invocations for a while, so this Map persists across requests hitting the
// same warm instance — giving real protection against basic spam/abuse in
// the common case for a small-to-medium traffic app.
//
// HONEST LIMITATION: this is NOT a distributed rate limiter. Under heavier
// traffic Netlify can spin up multiple concurrent function instances, each
// with its own separate memory/Map, so a determined attacker spreading
// requests across instances could exceed the intended limit. A fully
// reliable limit would need a shared store (e.g. Supabase, Redis) — Declan's
// Supabase integration exists but isn't configured/required yet, so this
// in-memory approach is the practical baseline that works out of the box
// with zero extra configuration or cost. Upgrade to a Supabase-backed
// counter later if/when traffic grows enough to need distributed accuracy.

const buckets = new Map(); // key: "functionName:ip" -> array of request timestamps (ms)

function getClientIp(event) {
  const headers = event.headers || {};
  return (
    headers['x-nf-client-connection-ip'] ||
    headers['client-ip'] ||
    (headers['x-forwarded-for'] || '').split(',')[0].trim() ||
    'unknown'
  );
}

/**
 * @param {object} event - the Netlify function event
 * @param {string} functionName - identifies the bucket (e.g. 'ask-declan')
 * @param {number} maxRequests - max requests allowed per window
 * @param {number} windowMs - window size in milliseconds
 * @returns {{ allowed: boolean, retryAfterSeconds: number }}
 */
function checkRateLimit(event, functionName, maxRequests, windowMs) {
  const ip = getClientIp(event);
  const key = `${functionName}:${ip}`;
  const now = Date.now();

  let timestamps = buckets.get(key) || [];
  // Drop timestamps outside the current window
  timestamps = timestamps.filter((t) => now - t < windowMs);

  if (timestamps.length >= maxRequests) {
    const oldestInWindow = timestamps[0];
    const retryAfterSeconds = Math.ceil((windowMs - (now - oldestInWindow)) / 1000);
    buckets.set(key, timestamps); // keep as-is, don't add this rejected attempt
    return { allowed: false, retryAfterSeconds: Math.max(retryAfterSeconds, 1) };
  }

  timestamps.push(now);
  buckets.set(key, timestamps);

  // Lightweight housekeeping so the Map doesn't grow unbounded over a long
  // warm-instance lifetime — occasionally sweep fully-expired keys.
  if (buckets.size > 500 && Math.random() < 0.05) {
    for (const [k, ts] of buckets) {
      if (ts.every((t) => now - t >= windowMs)) buckets.delete(k);
    }
  }

  return { allowed: true, retryAfterSeconds: 0 };
}

function rateLimitResponse(retryAfterSeconds) {
  return {
    statusCode: 429,
    headers: { 'Retry-After': String(retryAfterSeconds) },
    body: JSON.stringify({
      error: "You're sending requests a bit too fast — please wait a moment and try again.",
    }),
  };
}

module.exports = { checkRateLimit, rateLimitResponse };

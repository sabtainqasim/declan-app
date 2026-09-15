// Declan — Family Share sync, backed by Netlify's built-in Postgres database.
//
// This replaces the old approach of calling Supabase directly from the browser
// (which required the site owner to manually create a Supabase project and
// paste in credentials — never actually done, which is why Family Share
// silently did nothing). Netlify Database needs zero manual setup: it's
// auto-provisioned on deploy once @netlify/database is a dependency.
//
// The database connection itself must stay server-side only (unlike Supabase's
// public anon-key REST API model) — so the frontend now calls this function
// instead of talking to a database directly.

const { getDatabase } = require('@netlify/database');

exports.handler = async function (event) {
  const { checkRateLimit, rateLimitResponse } = require('./utils/_rateLimiter');
  const rl = checkRateLimit(event, 'family-sync', 60, 60000); // generous — every localStorage write triggers a call
  if (!rl.allowed) return rateLimitResponse(rl.retryAfterSeconds);

  const db = getDatabase();

  try {
    if (event.httpMethod === 'POST') {
      const { householdId, dataKey, dataValue } = JSON.parse(event.body || '{}');
      if (!householdId || typeof householdId !== 'string' || householdId.length > 100) {
        return { statusCode: 400, body: JSON.stringify({ error: 'Invalid householdId' }) };
      }
      if (!dataKey || typeof dataKey !== 'string' || dataKey.length > 100) {
        return { statusCode: 400, body: JSON.stringify({ error: 'Invalid dataKey' }) };
      }
      const valueJson = JSON.stringify(dataValue ?? null);
      if (valueJson.length > 500000) {
        return { statusCode: 400, body: JSON.stringify({ error: 'Data too large to sync' }) };
      }

      await db.sql`
        INSERT INTO home_memory (household_id, data_key, data_value, updated_at)
        VALUES (${householdId}, ${dataKey}, ${valueJson}::jsonb, NOW())
        ON CONFLICT (household_id, data_key)
        DO UPDATE SET data_value = ${valueJson}::jsonb, updated_at = NOW()
      `;
      return { statusCode: 200, body: JSON.stringify({ success: true }) };
    }

    if (event.httpMethod === 'GET') {
      const householdId = event.queryStringParameters && event.queryStringParameters.householdId;
      if (!householdId || householdId.length > 100) {
        return { statusCode: 400, body: JSON.stringify({ error: 'Invalid householdId' }) };
      }
      const rows = await db.sql`
        SELECT data_key, data_value FROM home_memory WHERE household_id = ${householdId}
      `;
      return { statusCode: 200, body: JSON.stringify({ rows }) };
    }

    return { statusCode: 405, body: JSON.stringify({ error: 'Method not allowed' }) };
  } catch (err) {
    return { statusCode: 500, body: JSON.stringify({ error: 'Sync failed — your data is still safe on this device.' }) };
  }
};

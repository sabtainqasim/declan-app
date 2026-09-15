-- Declan Home Memory sync table — replaces the never-configured Supabase setup
-- with Netlify's own built-in Postgres database (auto-provisioned, no manual
-- account/credentials needed).
CREATE TABLE IF NOT EXISTS home_memory (
  id SERIAL PRIMARY KEY,
  household_id TEXT NOT NULL,
  data_key TEXT NOT NULL,
  data_value JSONB,
  updated_at TIMESTAMP DEFAULT NOW(),
  UNIQUE(household_id, data_key)
);
CREATE INDEX IF NOT EXISTS idx_home_memory_household ON home_memory(household_id);

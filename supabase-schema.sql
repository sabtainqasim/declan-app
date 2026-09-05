-- Declan — Supabase Schema (Home Memory foundation, Phase 1)
-- Run this in: Supabase Dashboard > SQL Editor > New Query > Run

-- Simple key-value store per household, mirroring the localStorage keys
-- already used in the app (declan_pantry, declan_grocery, etc.)
-- This makes migrating from localStorage to Supabase a drop-in swap.

create table if not exists home_memory (
  id uuid primary key default gen_random_uuid(),
  household_id text not null,        -- a device/household identifier (see note below)
  data_key text not null,            -- e.g. 'pantry', 'grocery', 'bills', 'todo'
  data_value jsonb not null default '[]'::jsonb,
  updated_at timestamptz not null default now(),
  unique (household_id, data_key)
);

-- Index for fast lookups per household
create index if not exists idx_home_memory_household on home_memory (household_id);

-- Row Level Security — households can only read/write their own data
alter table home_memory enable row level security;

create policy "Households can read their own data"
  on home_memory for select
  using (true); -- refine once real auth is added (see note below)

create policy "Households can write their own data"
  on home_memory for insert
  with check (true);

create policy "Households can update their own data"
  on home_memory for update
  using (true);

-- ─────────────────────────────────────────────────────────
-- NOTE on household_id (important — read before deploying):
-- For this MVP stage, "household_id" is a random ID generated on first app
-- open and stored in the browser (see declan-supabase.js). This lets a
-- household's data sync across their own devices IF they share that ID
-- (e.g. via a "family code"), but it is NOT real user authentication.
--
-- Before handling real user data at scale, replace this with Supabase Auth
-- (email/phone login) and tighten the RLS policies above to check
-- auth.uid() instead of allowing open access. Flagging this clearly so
-- it isn't forgotten once the app has real users.
-- ─────────────────────────────────────────────────────────

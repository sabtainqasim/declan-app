# Declan — Deployment Guide

## What's in this project
- `index.html` — the whole app (splash screen, home screen, all modules, settings, Ask Declan chat)
- `netlify/functions/recipe-suggest.js` — AI recipe suggestions (Gemini API)
- `netlify/functions/scan-document.js` — Smart Scanner document reading (Gemini API)
- `netlify/functions/ask-declan.js` — "Ask Declan" conversational chat, using saved Home Memory (pantry, bills, vitals, etc.) as context
- `netlify/functions/grocery-price.js` — approximate grocery price estimates via Gemini + Google Search grounding (NOT live/exact retailer pricing — no grocery chain offers a public pricing API, and scraping their sites would violate most Terms of Service, so this gives a general web-search-based estimate instead, always labeled as such)
- `netlify.toml` — Netlify configuration

## How to deploy (same process as TRR)

1. **Create a GitHub repo** and push this folder to it (or drag-and-drop deploy directly on Netlify — see below).

2. **Go to [netlify.com](https://netlify.com)** → "Add new site" → "Import an existing project" (or "Deploy manually" and drag this whole folder).

3. **Set your Gemini API key:**
   - Get a free key at https://aistudio.google.com/app/apikey
   - In Netlify: Site settings → Environment variables → Add variable
   - Key: `GEMINI_API_KEY`
   - Value: (paste your key)

4. **Set your subdomain:**
   - Site settings → Domain management → Options → Edit site name
   - Set it to `declanhome` so your URL becomes `declanhome.netlify.app`

5. **Set up Supabase (cloud data sync — optional but recommended):**
   - Create a free project at https://supabase.com
   - Go to SQL Editor → paste the contents of `supabase-schema.sql` → Run
   - Go to Project Settings → API → copy your **Project URL** and **anon public key**
   - Open `index.html`, find these two lines near the top of the `<script>` section, and fill them in:
     ```
     const SUPABASE_URL = ''; // paste your Project URL here
     const SUPABASE_ANON_KEY = ''; // paste your anon key here
     ```
   - Without this step, the app still works perfectly fine — it just stores data only on the device it's used on (localStorage), instead of syncing across devices.

6. **Deploy.** That's it — Netlify auto-detects the `netlify/functions` folder and deploys the serverless functions alongside the site.

## Notes
- Without `GEMINI_API_KEY` set, the Kitchen "AI Suggest" and Smart Scanner features will automatically fall back to offline demo data — the app still works, just not with live AI.
- Without Supabase configured, all data (pantry, grocery list, bills, reminders, etc.) stays in the browser's `localStorage` on that one device.
- **Important — read before real users join:** the current Supabase setup uses a random per-device "household ID" instead of real accounts, so it's not proper multi-user authentication yet. This is fine for early testing, but before handling real family data at scale, this should be upgraded to Supabase Auth (real login) — flagged clearly in `supabase-schema.sql` too.

## Installing as an app (PWA) — works today, free

This project already includes `manifest.json`, `service-worker.js`, and app icons — no extra setup needed once deployed to Netlify.

- **iPhone (free, no App Store needed):** Open the site in Safari → tap Share → "Add to Home Screen". The app icon, splash, and full-screen experience all work.
- **Android:** Open the site in Chrome → it will offer "Add to Home Screen" / "Install app" automatically, or you can trigger it from the browser menu.

## Publishing to Google Play Store (~$25 one-time, no Mac needed)

A `twa-manifest.json` is already included in this project (pre-filled for `declanhome.netlify.app`).

1. Install [Bubblewrap CLI](https://github.com/GoogleChromeLabs/bubblewrap) (`npm install -g @bubblewrap/cli`) — works on Windows/Linux/Mac.
2. Once deployed, run `bubblewrap build` in this folder (it will read `twa-manifest.json` directly) to produce a signed `.aab` file. If your domain differs from `declanhome.netlify.app`, update the `host` field in `twa-manifest.json` first.
3. Create a one-time $25 Google Play Developer account at https://play.google.com/console, and upload the `.aab`.

## Publishing to Apple App Store (later, once there's budget)

Requires a Mac (or a rented cloud Mac like MacinCloud, ~$20–30/month) + a $99/year Apple Developer account. Until then, the free "Add to Home Screen" PWA route above covers iPhone users.

## Analytics & SEO setup

This project already includes SEO meta tags, Open Graph tags, and structured data — nothing to configure there.

For analytics, two placeholders need to be filled in `index.html` (near the top, right after the Chart.js script tag):

1. **Google Analytics 4:**
   - Create a property at https://analytics.google.com → Admin → Data Streams → Web
   - Copy your Measurement ID (looks like `G-XXXXXXXXXX`)
   - Replace **both** occurrences of `G-XXXXXXXXXX` in `index.html` with your real ID

2. **Microsoft Clarity:**
   - Create a project at https://clarity.microsoft.com → Setup
   - Copy your Project ID
   - Replace `CLARITY_PROJECT_ID` in `index.html` with your real ID

Both are free. Without these filled in, the scripts simply won't send any data — nothing breaks.

## Reminder notifications — how they actually work

Settings → "Reminder notifications" toggle turns on browser notifications for medicine, BP/diabetes meds,
bills/expiry, maintenance, pets, vehicle, birthdays, family events, and homework due dates.

**Important limitation to know:** these fire while Declan is open (foreground or a backgrounded browser
tab/installed PWA) — they are NOT true background push notifications that arrive even when the app is
fully closed. Real always-on push requires a push server with VAPID keys (commonly done via Firebase Cloud
Messaging) — that's a bigger backend addition for a future update, not something that can run from a static
site + serverless functions alone.

## Still to build
- True background push notifications (requires Firebase Cloud Messaging or similar push server)
- Real-time AI conversation for Symptom Checker (currently rule-based, not connected to Gemini)
- Weekly/monthly health trend reports, PDF/CSV export
- Proper multi-user household accounts (Supabase Auth) — current setup uses a per-device random ID
- Mascot success/error toast animation is wired into a few actions (pantry, bills, to-do) as a working example — extending it to every single action across all modules is a mechanical follow-up task

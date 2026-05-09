# Investment App — Step-by-Step Implementation Guide

> Read this guide top to bottom before opening Cursor.
> Complete every step in order. Do not skip ahead.
> Each phase ends with a working, deployable state.

---

## Before You Start — What You Need on Hand

Have these ready before Step 1:

| Item | Where to find it |
|---|---|
| Sharesight Client ID (Dev) | Sharesight developer portal |
| Sharesight Client Secret (Dev) | Sharesight developer portal |
| Sharesight Core Portfolio UUID | Sharesight developer portal / API |
| Sharesight Satellite Portfolio UUID | Sharesight developer portal / API |
| Anthropic API key | console.anthropic.com |
| Gemini API key | ai.google.dev |
| FMP API key | financialmodelingprep.com |
| Supabase project URL | Supabase dashboard → Settings → API |
| Supabase anon key | Supabase dashboard → Settings → API |
| GitHub account + empty repo | github.com |
| Vercel account linked to GitHub | vercel.com |
| Cursor IDE installed (Pro plan) | cursor.com |

---

## Phase 0 — Project Setup (Do Once, Before Any Code)

### Step 1 — Create your project folder

1. On your computer, create a folder called `investment-app` somewhere sensible (e.g. `~/Documents/investment-app`)
2. Open **Cursor**
3. File → Open Folder → select `investment-app`
4. Cursor opens the empty folder as your project

### Step 2 — Open the Cursor terminal

- Press `` Ctrl+` `` (backtick) or go to View → Terminal
- You'll use this terminal throughout the build

### Step 3 — Create the React + Vite project scaffold

In the Cursor terminal, run:

```bash
npm create vite@latest . -- --template react
```

When prompted:
- **Package name:** `investment-app`
- **Framework:** React
- **Variant:** JavaScript (not TypeScript for now — keep it simple)

Then install dependencies:

```bash
npm install
```

Test it works:

```bash
npm run dev
```

You should see: `Local: http://localhost:5173` — open that in your browser. You'll see the default Vite + React starter page. Good. Stop the server with `Ctrl+C`.

### Step 4 — Install all required packages

In the Cursor terminal, run all of these:

```bash
# UI and styling
npm install tailwindcss @tailwindcss/vite
npm install @shadcn/ui
npm install framer-motion
npm install lucide-react
npm install recharts

# Data fetching
npm install yahoo-finance2
npm install @supabase/supabase-js

# Utilities
npm install axios
npm install date-fns
```

### Step 5 — Set up Tailwind CSS

Run:

```bash
npx tailwindcss init -p
```

Then open `tailwind.config.js` and replace contents with:

```javascript
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {},
  },
  plugins: [],
}
```

Open `src/index.css` and replace ALL contents with:

```css
@tailwind base;
@tailwind components;
@tailwind utilities;
```

### Step 6 — Set up environment variables

In the project root, create a file called `.env.local`:

```
# Sharesight OAuth — Development
VITE_SHARESIGHT_CLIENT_ID_DEV=paste_your_dev_client_id_here
VITE_SHARESIGHT_CLIENT_SECRET_DEV=paste_your_dev_client_secret_here
VITE_SHARESIGHT_PORTFOLIO_UUID_CORE=paste_your_core_uuid_here
VITE_SHARESIGHT_PORTFOLIO_UUID_SATELLITE=paste_your_satellite_uuid_here

# Sharesight OAuth — Production (fill in after Vercel deploy)
VITE_SHARESIGHT_CLIENT_ID_PROD=
VITE_SHARESIGHT_CLIENT_SECRET_PROD=

# API Keys
VITE_ANTHROPIC_API_KEY=paste_your_anthropic_key_here
VITE_GEMINI_API_KEY=paste_your_gemini_key_here
VITE_FMP_API_KEY=paste_your_fmp_key_here

# Supabase
VITE_SUPABASE_URL=paste_your_supabase_project_url_here
VITE_SUPABASE_ANON_KEY=paste_your_supabase_anon_key_here

# Environment
VITE_APP_ENV=development
VITE_APP_URL=http://localhost:5173
```

Fill in every value. Leave the two PROD Sharesight fields blank for now.

> **Note:** Vite requires environment variables to be prefixed with `VITE_` to be accessible in your React code. You access them as `import.meta.env.VITE_ANTHROPIC_API_KEY`.

### Step 7 — Create the .gitignore file

In the project root, create a file called `.gitignore`:

```
# Environment variables — NEVER commit
.env
.env.local
.env.*.local

# Dependencies
node_modules/
package-lock.json

# OS
.DS_Store

# Build output
dist/

# Logs
*.log

# IDE
.vscode/
.idea/
```

### Step 8 — Initialise Git and connect to GitHub

In the Cursor terminal:

```bash
git init
git add .
git status
```

**Before proceeding:** Look at the `git status` output. Confirm that `.env.local` is NOT listed as a staged file. It should appear in "Untracked files" or not appear at all. If it appears under "Changes to be committed" — stop. Your `.gitignore` is not working. Fix it before continuing.

Once confirmed:

```bash
git commit -m "Initial project scaffold"
git remote add origin https://github.com/YOUR_GITHUB_USERNAME/investment-app.git
git branch -M main
git push -u origin main
```

Go to GitHub and confirm your files are there. Confirm `.env.local` is NOT in the repository.

### Step 9 — Connect Vercel and add environment variables

1. Go to vercel.com → your dashboard
2. Click **Add New** → **Project**
3. Import your `investment-app` GitHub repository
4. In the **Environment Variables** section, add all production variables:

| Variable | Value |
|---|---|
| `VITE_SHARESIGHT_CLIENT_ID_PROD` | Your Prod Sharesight client ID |
| `VITE_SHARESIGHT_CLIENT_SECRET_PROD` | Your Prod Sharesight client secret |
| `VITE_SHARESIGHT_PORTFOLIO_UUID_CORE` | Your Core portfolio UUID |
| `VITE_SHARESIGHT_PORTFOLIO_UUID_SATELLITE` | Your Satellite portfolio UUID |
| `VITE_ANTHROPIC_API_KEY` | Your Anthropic API key |
| `VITE_GEMINI_API_KEY` | Your Gemini API key |
| `VITE_FMP_API_KEY` | Your FMP API key |
| `VITE_SUPABASE_URL` | Your Supabase project URL |
| `VITE_SUPABASE_ANON_KEY` | Your Supabase anon key |
| `VITE_APP_ENV` | `production` |
| `VITE_APP_URL` | Your Vercel URL (set after first deploy) |

5. Click **Deploy**
6. Vercel builds and deploys — you get a live URL (e.g. `investment-app.vercel.app`)
7. Copy that URL and add it as `VITE_APP_URL` in the Vercel environment variables

**Phase 0 complete.** You have a live (empty) React app on Vercel, connected to GitHub, with all secrets secured. Every `git push` now auto-deploys.

---

## Phase 1 — Create CLAUDE.md (The Rule Book)

Before writing a single line of app code, create the `CLAUDE.md` file. This is what every Claude session in Cursor reads to understand the project rules.

### Step 10 — Create CLAUDE.md

In the project root, create `CLAUDE.md`. Then open a **new Claude conversation in Cursor** and use this prompt:

---

**Cursor prompt — Step 10:**

```
I am building a personal investment portfolio management app. 
Read the full specification in INVESTMENT_APP_FRAMEWORK_V4.md which I will paste below.

Generate a complete CLAUDE.md file for this project that contains:
1. Project overview and Triad architecture summary (Gemini = Researcher, Claude = Thinker, Cursor = Builder)
2. Design tokens — all colours, typography, and spacing from Section 11
3. Component library: Tailwind CSS, Shadcn/UI, Framer Motion, Lucide React, Recharts
4. All business rules: DCA 0× rule, allocation formula, scoring thresholds, catalyst attachment, lazy loading rule
5. Gemini JSON schemas for: stock research, announcement triage, sector context
6. Triad integration pattern: Gemini → Supabase cache check → Claude synthesis
7. Prompt caching: cache_control on system prompt and static document blocks
8. Ticker mapping table: FMP symbol format vs Yahoo Finance format per exchange
9. Supabase table schemas including research_logs table
10. API Pause flag: all Claude and Gemini call sites must check global_api_pause before executing
11. Environment variable pattern: all secrets via import.meta.env.VITE_* — never hardcoded
12. Forbidden patterns: no localStorage, no committed secrets, no hardcoded ETF count, Claude never reads raw source documents, never scrape Yahoo Finance HTML (use yahoo-finance2 library)
13. Testing expectations

[PASTE THE FULL CONTENTS OF INVESTMENT_APP_FRAMEWORK_V4.md HERE]
```

---

Review the generated `CLAUDE.md`. Make sure it contains all 13 items. This file is the single most important file in the project — every subsequent Cursor session starts by reading it.

---

## Phase 2 — Supabase Schema (Module 2)

### Step 11 — Generate the database schema

Open a new Cursor session and use this prompt:

---

**Cursor prompt — Step 11:**

```
Read CLAUDE.md first.

Generate the complete Supabase PostgreSQL schema for the investment app described in the framework. 

Requirements:
- Every table must have Row Level Security (RLS) enabled
- Every table must have an RLS policy: authenticated users can only read/write their own rows (user_id = auth.uid())
- Include all tables needed for: positions, scorecards, research papers, watchlist, announcements, briefings, DCA history, settings, research_logs, core ETFs
- Include the research_logs table with fields: id, timestamp, ticker, raw_gemini_json (jsonb), claude_synthesis_status (text)
- Foreign key relationships where appropriate
- Indexes on commonly queried fields (ticker, user_id, created_at)
- Output as a single SQL file I can paste into the Supabase SQL editor

Do not include any application logic — schema only.
```

---

### Step 12 — Apply the schema to Supabase

1. Go to your Supabase dashboard
2. Click **SQL Editor** in the left sidebar
3. Click **New Query**
4. Paste the entire SQL schema generated by Cursor
5. Click **Run**
6. Go to **Table Editor** — confirm all tables were created
7. Go to **Authentication → Policies** — confirm RLS is enabled on all tables

**Phase 2 complete.** Your database is ready.

---

## Phase 3 — Sharesight Integration (Module 1)

This is the most complex module. Do it carefully.

### Step 13 — Build the Sharesight integration

Open a new Cursor session and use this prompt:

---

**Cursor prompt — Step 13:**

```
Read CLAUDE.md first.

Build the Sharesight API integration module. This is the foundation of the entire app.

Requirements:
1. OAuth 2.0 flow with dual-environment support:
   - Development: use VITE_SHARESIGHT_CLIENT_ID_DEV + redirect to http://localhost:5173/callback
   - Production: use VITE_SHARESIGHT_CLIENT_ID_PROD + redirect to the Vercel URL
   - Switch using import.meta.env.VITE_APP_ENV

2. Token management:
   - Store access token and refresh token in Supabase (not localStorage)
   - Silently refresh access token before expiry (tokens expire after ~60 minutes)
   - If refresh fails: display a prominent reconnection banner and suspend all Sharesight sync until re-authenticated

3. Portfolio sync:
   - Fetch Core portfolio using VITE_SHARESIGHT_PORTFOLIO_UUID_CORE
   - Fetch Satellite portfolio using VITE_SHARESIGHT_PORTFOLIO_UUID_SATELLITE
   - Sync on app load and every 30 minutes
   - Manual refresh button triggers immediate sync
   - Store all portfolio data in Supabase
   - Display last sync timestamp

4. Data to extract from Sharesight:
   - All holdings (ticker, quantity, current value, cost basis, unrealised gain/loss)
   - Broker cash balances per broker account
   - Trade history
   - Portfolio performance over time
   - Distributions and income

5. Error handling:
   - Never show blank state — always show last known data with stale warning
   - Surface sync errors clearly with the specific error message
   - Retry logic: 3 attempts before showing error state

6. Create a /callback route in the React app to handle the OAuth redirect

All secrets via import.meta.env.VITE_* only. No hardcoded values.
```

---

### Step 14 — Test Sharesight connection

1. Run `npm run dev` in Cursor terminal
2. Open `http://localhost:5173` in your browser
3. Click the "Connect Sharesight" button
4. You should be redirected to Sharesight login
5. Authorize the app
6. You should be redirected back to `http://localhost:5173/callback`
7. The app should fetch and display your portfolio data
8. Go to Supabase → Table Editor → check that holdings data is stored

If this works: **commit and push.**

```bash
git add .
git commit -m "Module 1: Sharesight integration complete"
git push
```

Vercel auto-deploys. Test on your Vercel URL. If OAuth fails on Vercel (because your Prod Sharesight credentials aren't set up yet), that's expected — come back to this after registering your second Sharesight OAuth app.

---

## Phase 4 — Live Prices and DCA Engine (Module 3)

### Step 15 — Build live price fetching

---

**Cursor prompt — Step 15:**

```
Read CLAUDE.md first.

Build the live price fetching module using the yahoo-finance2 library.

Requirements:
1. Fetch live prices for all holdings (core ETFs + satellite positions) using yahoo-finance2
2. Use the ticker mapping table from CLAUDE.md to derive the correct Yahoo Finance symbol from the FMP exchangeShortName
3. Refresh prices every 5 minutes during market hours for the relevant exchange
4. Market hours per exchange are in Section 10.15 of the framework — build a static lookup table
5. If yahoo-finance2 fails for any ticker: fall back to FMP /quote endpoint as secondary source
6. FX rates: fetch from yahoo-finance2 every 5 minutes. Convert all foreign currency positions to AUD.
7. Cache all prices in Supabase — never fetch on every page load
8. ATH (all-time high): fetch full price history via yahoo-finance2 once daily after market close. Store in Supabase.
9. Display last-known price with "updating..." indicator while fetching — never blank

No raw Yahoo Finance HTML scraping. Use yahoo-finance2 library only.
```

---

### Step 16 — Build the DCA engine

---

**Cursor prompt — Step 16:**

```
Read CLAUDE.md first.

Build the DCA (Dollar Cost Averaging) engine.

Requirements:
1. Read active core ETFs from Supabase (configurable list — not hardcoded)
2. For each active core ETF:
   - Fetch current price (from price cache in Supabase)
   - Fetch ATH (from Supabase)
   - Calculate distance from ATH as percentage
   - Determine the active tier from the ETF's assigned schedule (Standard, GHHF, or Custom)
   - Apply the tier multiplier
   - Calculate this week's contribution: Base amount × ETF allocation % × multiplier
3. 0× tier rule: if an ETF is within 1.5% of ATH, its contribution is $0 — the amount is forfeited, NOT redistributed to other ETFs
4. Total weekly contribution = sum of all active ETF contributions (some may be $0)
5. Gearing factor: read from Supabase (manually entered — no auto-fetch). Default 1.5× if not set.
6. True exposure = geared ETF allocation × gearing factor (informational only)
7. Display the DCA widget showing one row per active ETF with: price, ATH, distance, tier, multiplier, contribution
8. Base weekly amount: read from settings in Supabase (default A$350)
9. All tier schedules (Standard, GHHF, Custom) stored in Supabase and editable

Tier schedule values are in CLAUDE.md — use those exact numbers.
```

---

**Test, commit, push after each step.**

```bash
git add .
git commit -m "Module 3: Live prices and DCA engine"
git push
```

---

## Phase 5 — Satellite Portfolio and Scoring (Module 4)

### Step 17 — Build satellite position management

---

**Cursor prompt — Step 17:**

```
Read CLAUDE.md first.

Build the satellite portfolio module.

Requirements:
1. Display all satellite positions from Sharesight sync — one card per position
2. For each position show: ticker, company name, one-liner synopsis, asset class badge, score %, tier, live price (native currency), daily change, allocation % (target vs actual vs drift)
3. Live combobox ticker search for adding new positions:
   - Query FMP Ticker Search API as user types
   - Dropdown shows: Symbol | Company Name | Exchange
   - On selection: lock in FMP symbol and exchangeShortName, store both in Supabase
   - Derive Yahoo Finance symbol using ticker mapping table in CLAUDE.md
4. New position with no scorecard: show "Awaiting analysis" badge, suppress buy zone alerts
5. Allocation engine (guidance only — not enforced):
   - adjusted_score = raw_score × 0.5 if score < 65%, else raw_score × 1.0
   - target_allocation = (adjusted_score / sum_of_all_adjusted_scores) × 100
   - Always sums to 100%
   - Manual override: any position's allocation can be overridden. Remaining positions recalculate to fill (100% − override total).
6. Position detail page with 4 components: live data panel, scorecard, research paper, buy zones + exit triggers
7. Version history: load current version only on page open. Fetch older versions on-demand when selected.
8. Foreign currency: display in native currency with optional AUD parenthetical (Settings toggle)
```

---

### Step 18 — Build the scoring framework UI

---

**Cursor prompt — Step 18:**

```
Read CLAUDE.md first.

Build the scoring framework UI. This is the interface where Claude analyses a position.

Requirements:
1. Framework auto-selection: when a position is opened with no scorecard, call Claude (claude-opus-4-7) to suggest the appropriate framework based on asset type. Show the suggestion with a brief reason. Wait for user confirmation before running full analysis.
2. Five frameworks available: Regular stocks, Thematic ETFs, Fund managers/LICs, Speculative stocks, Alternative investments/PE. All framework definitions are in CLAUDE.md.
3. Triad analysis flow:
   a. Check research_logs table — if Gemini artefact exists for this ticker within last 1 hour, use it (skip Gemini call)
   b. Otherwise: call Gemini Pro to gather research. Save raw JSON to research_logs immediately.
   c. Check Supabase Gemini artefact cache — if artefact exists within 7 days, use it
   d. Otherwise: save fresh Gemini artefact to Supabase cache
   e. Check global_api_pause flag before any Claude or Gemini call — if paused, abort with message
   f. Pass Gemini JSON + FMP fundamentals to Claude for scorecard generation
   g. Use prompt caching (cache_control) on CLAUDE.md rules and framework definition
   h. Claude outputs: scored checklist (all items), section scores, overall score, buy zones, exit triggers, one-liner synopsis
4. Display scorecard: circular score ring (SVG, animated), section scores, all 60 items with Claude's score and reasoning
5. Manual override: any item score can be overridden. Log: item name, Claude score, your score, date, optional note.
6. Every analysis creates a new version in Supabase. Cap at 10 versions per position.
7. Buy zone unlock: score ≥ 65% → buy zones active. Score < 65% → 0.5× haircut, buy zones locked.
8. Progress indicator during analysis (60–120 seconds expected)
```

---

**Test, commit, push.**

```bash
git add .
git commit -m "Module 4: Satellite portfolio and scoring"
git push
```

---

## Phase 6 — Dashboard (Module 5)

### Step 19 — Build the dashboard

---

**Cursor prompt — Step 19:**

```
Read CLAUDE.md first.

Build the main dashboard. This is the first screen the user sees.

Requirements:
1. Navigation: fixed sidebar on desktop (210px), bottom navigation bar on mobile (5 items: Dashboard, Core, Satellite, Watchlist, Settings)

2. Zone 1 — Portfolio health bar (always visible):
   - Total portfolio value, core value, satellite value (from Sharesight)
   - Total cash (broker cash from Sharesight + external cash from Supabase settings)
   - Cash is clickable — expands to show breakdown by broker + external
   - Total gain/loss today ($ and %)
   - Core/satellite split: actual vs target (72/28 default)
   - Last sync timestamp

3. Zone 2 — Alerts panel (only when there is something to act on, in priority order):
   - Exit triggers (red — requires manual dismissal)
   - Buy zone alerts (green — native currency comparison only, never FX-triggered)
   - DCA this week (amber)
   - Announcement alerts (blue — Priority 2, placeholder for now)
   - Re-analysis recommended (orange — with 30-day re-fire control after dismissal)

4. Zone 3 — Portfolio chart (full width):
   - Lines: total value, core value, satellite value, cash, unrealised gain, benchmark
   - All lines individually toggleable
   - Time periods: 1M / 3M / 6M / 1Y / 2Y / All
   - Toggle: A$ vs % return
   - Benchmark: searchable dropdown, default VGS.AX
   - Data from Sharesight

5. Zone 4 — Position summary grid:
   - Panel A: all satellite positions as cards
   - Panel B: top 5 watchlist items by score

6. Zone 5 — DCA widget (one row per active core ETF from Settings):
   - Columns: ETF, live price, ATH, distance, tier, multiplier, this week's contribution
   - Base amount editable inline
   - ETFs in 0× tier show $0 explicitly

7. Zone 6 — Portfolio balance snapshot (core vs satellite, target vs actual vs book value)

Design tokens are in CLAUDE.md — use them exactly. Dark mode is default.
```

---

**Test, commit, push.**

```bash
git add .
git commit -m "Module 5: Dashboard"
git push
```

---

## Phase 7 — Watchlist (Module 6)

### Step 20 — Build the watchlist

---

**Cursor prompt — Step 20:**

```
Read CLAUDE.md first.

Build the watchlist module.

Requirements:
1. Watchlist starts empty — no pre-populated items
2. Add ticker via live FMP combobox (same component as satellite — Symbol | Company Name | Exchange)
3. Watchlist table with sortable/filterable columns: ticker, company, exchange, asset class, framework, score, tier, live price, daily change, market cap, P/E trailing, P/E forward, revenue growth, 52-week high/low, distance from 52-week low, date last analysed, auto-monitor status, one-liner synopsis
4. One-liner synopsis: FMP description before analysis, Claude-generated one-liner after analysis
5. Asset class dropdown per row — changing asset class triggers re-analysis (with confirmation)
6. On-demand announcement search button per position (calls Gemini Flash)
7. Watchlist position detail page: same 5-tab structure as satellite (Overview, Live data, Scorecard, Research paper, Buy zones + exit triggers)
8. When a position appears in Sharesight (i.e. you bought it): automatically move from watchlist to satellite, carry all data across (scorecard, research, buy zones, exit triggers, catalyst notes, version history)
9. Filter by: asset class, tier, exchange, score range, analysed/unanalysed
10. Summary stats bar: total candidates, qualify (≥65%), high conviction (≥78%), marginal, unanalysed
```

---

**Test, commit, push.**

```bash
git add .
git commit -m "Module 6: Watchlist"
git push
```

---

## Phase 8 — Portfolio Briefing (Module 7)

### Step 21 — Build the portfolio briefing

---

**Cursor prompt — Step 21:**

```
Read CLAUDE.md first.

Build the portfolio briefing module.

Requirements:
1. Single "Generate portfolio briefing" button on the dashboard
2. Before any API call: check global_api_pause flag — if paused, show message and abort
3. Triad workflow:
   a. App compiles full context: all positions, prices, scores, allocations, DCA status, buy zones, exit triggers, days since last analysis, cash position
   b. Gemini Pro gathers fresh market research and position-specific developments. Output: structured JSON.
   c. Save Gemini output to research_logs immediately
   d. Pass compiled context + Gemini JSON to Claude (claude-opus-4-7) for briefing synthesis
   e. Use prompt caching (cache_control) on CLAUDE.md rules — they are static context
4. Briefing output — three pages:
   Page 1: Portfolio snapshot (health, core ETF status, satellite allocation)
   Page 2: What needs attention (buy zones, exit triggers, announcements, re-analysis recommendations)
   Page 3: Market context and outlook (macro, position-specific developments, this week's actions)
5. Display in-app with progress indicator (60–120 seconds)
6. Save to Supabase with timestamp
7. Export as PDF button
8. Briefing history: dropdown of all past briefings, side-by-side comparison
```

---

**Test, commit, push.**

```bash
git add .
git commit -m "Module 7: Portfolio briefing"
git push
```

---

## Phase 9 — Settings and Admin (Module 8)

### Step 22 — Build settings

---

**Cursor prompt — Step 22:**

```
Read CLAUDE.md first.

Build the Settings module. All configuration surfaces for the app.

Build all settings sections from the framework (Sections 10.1 through 10.16):
- 10.1 Portfolio configuration (core/satellite split, external cash)
- 10.2 DCA settings (base amount, target day, ETF allocations — must sum to 100%)
- 10.3 Satellite allocation rules (haircut threshold, rebalance trigger)
- 10.4 API keys and connections (Sharesight status, FMP, Anthropic, Gemini)
- 10.5 Data refresh settings
- 10.6 Notification settings (all toggles)
- 10.7 Scoring and analysis settings (re-analysis thresholds, announcement retention)
- 10.8 Core ETF management (add/archive/reactivate ETFs, gearing manual entry, provider URL)
- 10.9 Satellite position management
- 10.10 Watchlist management
- 10.11 Benchmark settings
- 10.12 Display and appearance (dark/light, currency display toggle)
- 10.13 Data export and backup
- 10.14 Reset and danger zone (all destructive actions require CONFIRM typed)
- 10.15 Exchange management (exchange table + ticker mapping table — editable)
- 10.16 API Pause kill-switch (prominent toggle, in-app banner when active)

Key validation rules:
- Core ETF target allocations must sum to exactly 100% — save disabled when ≠100%
- Running sum displayed during edit
- API Pause toggle: when enabled, show persistent red banner at top of every page
```

---

**Test, commit, push.**

```bash
git add .
git commit -m "Module 8: Settings and admin"
git push
```

---

## Phase 10 — Polish and Pre-Launch

### Step 23 — UI polish pass

---

**Cursor prompt — Step 23:**

```
Read CLAUDE.md first.

Do a complete UI polish pass across the entire app.

Requirements:
1. Apply all design tokens from CLAUDE.md exactly — colours, typography, spacing
2. Dark mode is default. Verify light mode toggle works correctly.
3. Framer Motion: add entrance animations to all cards (fade in 0.15s), score rings (0.4s stroke animation on load), alerts (slide down + fade in 0.2s)
4. All number and price fields must use DM Mono font
5. All loading states: skeleton loaders — never blank white space or full-page spinner
6. Mobile layout: verify bottom navigation, single column, cards stack vertically, touch targets minimum 44px
7. Error states: every data fetch has a graceful error state with last-known data + warning indicator
8. Empty states: every list/table has a sensible empty state message
9. Verify all buy zone comparisons are in native currency — never AUD-converted
10. Verify the API Pause banner appears on every page when active
```

---

### Step 24 — Security audit before launch

Before your first real use, run the security checklist from Section 14 of the framework:

```bash
# Search for any hardcoded secrets
grep -r "sk-ant-" src/
grep -r "AIzaSy" src/
grep -r "SHARESIGHT" src/ | grep -v "import.meta.env"

# Verify .env.local is not tracked
git status

# Dry run push
git push --dry-run origin main
```

All of these should return clean results. If any grep finds a match in source code, fix it immediately before proceeding.

### Step 25 — Final commit and deploy

```bash
git add .
git commit -m "V1 complete — all modules built and polished"
git push
```

Vercel auto-deploys. Open your Vercel URL. Test the full flow:
- Sharesight connects and syncs
- Portfolio data displays correctly
- DCA engine shows correct tiers and contributions
- Scoring runs on a test position
- Briefing generates successfully
- Settings save and persist

---

## After Launch — Priority 2 (Announcement Monitoring)

Once V1 is stable and you've used it for a week or two, come back and build announcement monitoring. Use this prompt:

---

**Cursor prompt — Announcement Monitoring:**

```
Read CLAUDE.md first.

Build the announcement monitoring module (Priority 2).

Requirements:
1. Twice-daily polling per exchange schedule (from CLAUDE.md exchange table)
2. Use Gemini Flash for announcement triage — classify as: price-sensitive / non-price-sensitive / irrelevant
3. Save Gemini triage output to research_logs
4. If price-sensitive: automatically trigger full Claude analysis, attach result to current scorecard version as catalyst note
5. If non-price-sensitive: surface in-app as announcement with "Analyse" button (on-demand only)
6. 30-day rolling retention for unattached announcements
7. Catalyst-attached announcements: never deleted, stored permanently with the scorecard version
8. Optional watchlist auto-monitoring: when Settings toggle enabled and position score ≥ threshold (default 78%), apply same polling
9. Check global_api_pause flag before all Gemini and Claude calls
10. In-app alerts for price-sensitive announcements (blue banner)
```

---

## Quick Reference — Git Commands for Every Session

Every time you finish a working feature in Cursor:

```bash
git add .
git status          # verify .env.local is NOT staged
git commit -m "Description of what you built"
git push            # auto-deploys to Vercel
```

---

## Quick Reference — When Things Go Wrong

| Problem | Fix |
|---|---|
| Sharesight OAuth fails on Vercel | Check VITE_SHARESIGHT_CLIENT_ID_PROD is set in Vercel env vars. Check Prod redirect URI is registered in Sharesight portal. |
| Yahoo Finance rate limited | Fall back to FMP /quote endpoint. Check yahoo-finance2 library is being used, not raw scraping. |
| Claude API fails mid-analysis | Check research_logs — reuse Gemini artefact if within 1 hour. Check global_api_pause flag. |
| Supabase data not saving | Check RLS policies. Verify user is authenticated. Check Supabase anon key is correct. |
| Vercel build fails | Check Vercel build logs. Usually a missing environment variable or a package not installed. |
| `.env.local` accidentally committed | Rotate ALL API keys immediately. Then: `git rm --cached .env.local`, add to `.gitignore`, commit. |
| API costs running high | Enable API Pause in Settings immediately. Check research_logs for duplicate Gemini calls. Check global_api_pause is checked in all call sites. |

---

*Investment App — Implementation Guide · May 2026*

# Investment App — Full Specification · Version 4

> **Build approach:** Cursor IDE + Claude (Thinker, `claude-opus-4-7`) + Gemini (Researcher, latest Pro/Flash) — Triad architecture
> **Storage:** Supabase (free tier)
> **Layout:** Desktop-first, fully mobile responsive

---

## Table of Contents

1. [Portfolio Overview](#1-portfolio-overview)
2. [Data and Storage Architecture](#2-data-and-storage-architecture)
3. [Core Portfolio](#3-core-portfolio)
4. [Satellite Portfolio](#4-satellite-portfolio)
5. [Scoring Frameworks](#5-scoring-frameworks)
6. [Watchlist](#6-watchlist)
7. [Dashboard](#7-dashboard)
8. [Automation](#8-automation)
9. [Portfolio Briefing](#9-portfolio-briefing)
10. [Settings and Admin](#10-settings-and-admin)
11. [Design Preferences](#11-design-preferences)
12. [Nice to Haves](#12-nice-to-haves)
13. [Build Approach](#13-build-approach)
14. [GitHub & Vercel Security Setup](#14-github--vercel-security-setup)
15. [Pre-Build Checklist](#15-pre-build-checklist)

---

## 1. Portfolio Overview

### Data Source: Sharesight API (primary)

Existing paying customer on the Sharesight Standard plan, which includes API access. Sharesight is the single source of truth for all portfolio value, trade history, holdings, performance data, and broker cash balances.

#### Portfolio Structure in Sharesight

| Sharesight Portfolio | Contents | Currency |
|---|---|---|
| Core portfolio | GHHF, DHHF, EXUS, BEMG (current — list is configurable) | AUD |
| Satellite portfolio | All current satellite positions across ASX and LSE. Architecture supports any global exchange. | AUD + foreign currencies (converted to AUD) |

Both portfolios are pulled via API and combined in the app into a single unified view.

#### Broker Accounts

| Broker | Portfolio | Notes |
|---|---|---|
| Betashares Direct | Core | ASX ETFs only |
| IG Trading | Satellite | Global equities — ASX, LSE, and international exchanges |
| IBKR (future) | Satellite (additional) | Options, alternative exchanges — add when opened |

#### Cash Tracking

Cash is tracked in two layers — broker cash from Sharesight, and external cash entered manually.

- Broker cash (Betashares Direct, IG Trading, IBKR future) — pulled automatically from Sharesight on every sync. Each broker's cash balance shown separately.
- External cash (bank account, savings, any non-broker cash) — single manual entry field in Settings, updated when materially changed. Stored in Supabase.
- Dashboard health bar shows total combined cash. Click to expand and see breakdown by source (per broker + external).
- All cash lines display in AUD; cash held in foreign currencies converted via live Yahoo Finance FX.

#### Currency Handling

- Base currency: AUD
- Any position held in a foreign currency is converted to AUD for portfolio-level display using live FX rates from Yahoo Finance
- Buy zone comparisons and price alerts always made in the position's native currency — FX conversion is for portfolio value display only, not price triggers
- FX rates fetched from Yahoo Finance every 5 minutes — covers all major and many minor global currencies
- No code changes required when a new currency is encountered — the system handles any Yahoo Finance-supported FX pair generically

#### Sync Behaviour

- On app load: pull latest holdings, values, and broker cash from both Sharesight portfolios
- Scheduled refresh: every 30 minutes
- Manual refresh button always available
- Trades entered in broker → appear in Sharesight → sync to app automatically
- Distributions tracked by Sharesight — appear in app on next sync

#### Sharesight API Access Verification (action required before build)

- Confirmed plan: Sharesight Standard — includes API access
- Register an OAuth 2.0 application via Sharesight developer portal
- Obtain client ID and client secret
- Retrieve the exact **portfolio UUIDs** (`portfolio_id`) for both the Core and Satellite portfolios — these are required to filter the Sharesight API response. Do not rely on portfolio names; use UUIDs directly in all API calls.
- Confirm rate limits — typically generous for personal use
- Confirm historical data depth — required for portfolio chart over time
- Confirm cash balances are exposed via the Sharesight API for each broker account
- Confirm OAuth access token lifetime and test refresh token flow before build

#### OAuth Dual-URL Trap (critical implementation detail)

During development in Cursor the app runs on `localhost:3000`. Once deployed it runs on a Vercel URL. Sharesight's OAuth application requires a fixed Redirect URI — it will reject requests from any unregistered URL.

**Resolution:** Register **two separate OAuth applications** in the Sharesight developer portal — one with `http://localhost:3000/callback` as the Redirect URI (for development) and one with the production Vercel URL (for deployment). Store both client ID / client secret pairs in the `.env` file and switch between them via an `APP_ENV` environment variable.

**Local phone testing:** To test on mobile during development, use **ngrok** or **Cloudflare Tunnel** — these provide a temporary public URL (e.g. `https://random-words.ngrok-free.app`) that tunnels to your local machine. Register this URL as a third Redirect URI in the Sharesight developer portal. Use Cloudflare Tunnel for a persistent local URL (ngrok URLs change on each restart on the free plan).

#### OAuth Token Refresh (required implementation detail)

- Sharesight OAuth access tokens expire — typically after 60 minutes
- App must silently refresh using the stored refresh token before expiry
- If refresh fails: display a prominent reconnection prompt and suspend sync until re-authenticated
- Never allow silent sync failure — always surface auth errors clearly
- Refresh token flow must be implemented and tested as part of the Sharesight integration module

#### What Sharesight Provides

- Total portfolio value (core + satellite combined)
- Individual holding values and quantities
- Broker cash balances per broker account
- Trade history
- Performance over time (used for portfolio charts)
- Distributions and income
- Realised and unrealised gains
- Currency-adjusted valuations

#### What the App Handles Independently

- Scoring frameworks and scores
- Buy zones and exit triggers
- DCA tier calculations and weekly contribution amounts
- Allocation engine, haircut logic, and position sizing guidance
- Watchlist and research pipeline
- Triad analysis (Gemini research + Claude synthesis — see Section 13)
- External (non-broker) cash tracking
- Announcement monitoring, analysis, and 30-day catalyst-aware retention

### Portfolio Charts

| Chart | Data Source |
|---|---|
| Total portfolio value over time | Sharesight API |
| Core portfolio value over time | Sharesight API (core portfolio) |
| Satellite portfolio value over time | Sharesight API (satellite portfolio) |
| Cash position over time | Sharesight (broker cash) + Supabase (external cash) |
| Gains over time (unrealised + realised) | Sharesight API |
| Benchmark comparison | Yahoo Finance historical prices |

**Chart UI:**
- All lines on one chart, individually toggleable
- Time period: 1M / 3M / 6M / 1Y / 2Y / All
- Benchmark: searchable ticker dropdown (default VGS.AX)
- Toggle: absolute value (A$) vs percentage return (%)

### Core / Satellite Split

| Setting | Value |
|---|---|
| Target split | 72% core / 28% satellite |
| Adjustable | Yes — editable in Settings on a discretionary basis |
| Base currency | AUD |
| Foreign currencies | Any currency — all converted to AUD via live Yahoo Finance FX rates. Handled generically. |

### Balance Tracking

Two views shown simultaneously — present value drives all calculations, book value is reference only.

**Present value (drives rebalancing):**
- Current market value of core vs satellite (excluding cash)
- Actual % split vs target % split
- Dollar amount over/under target
- Rebalance instruction: how much to move and in which direction

**Book value (reference only):**
- Cost basis of core vs satellite
- Actual % split at cost vs target % split
- Not used in any calculations

**Rebalancing rules:**
- Calculated on present value only
- Total portfolio value is fixed — rebalancing moves money between core and satellite, it does not add or remove money
- Cash excluded from all rebalancing calculations
- Rebalance shown as a simple instruction: move $X from core → satellite or satellite → core
- Updates automatically on every Sharesight sync

---

## 2. Data and Storage Architecture

### Storage: Supabase

All app data (scores, scorecards, research papers, versions, manual override logs, announcements, briefings, watchlist items, settings, external cash, Gemini research artefacts) stored in Supabase — a managed PostgreSQL database.

**Why Supabase:**
- Free tier: 500 MB database, 5 GB bandwidth/month, 1 GB file storage — well above personal use needs
- Real database with relational structure — handles complex versioning and history reliably
- Syncs across devices automatically — desktop, mobile, anywhere
- Survives browser cache clears and device changes
- Direct integration with React via official client library

**Row Level Security (RLS) — enable from day one:**
- Even as a single-user app, enable Supabase RLS on all tables from the start. RLS is significantly harder to retrofit later and is required if the app is ever accessed from multiple devices or if a second user is ever added.
- All tables should have an RLS policy that restricts read/write to the authenticated user's `user_id`
- This is a one-time setup task — add it to the Supabase schema initialisation step in the build, not as an afterthought

#### Estimated Monthly Storage Usage

| Data Type | Approximate Size | Monthly Volume | Total |
|---|---|---|---|
| Scorecard with 60 items + reasoning | 5–10 KB | 2 re-analyses | ~20 KB |
| Research paper (full 12 sections) | 20–40 KB | 2 re-analyses | ~80 KB |
| Gemini research artefacts (cached JSON) | 10–20 KB per position | Per re-analysis | ~80 KB |
| Announcement (active, unattached) | 2–5 KB | ~50 announcements | ~250 KB before 30-day purge |
| Announcement (attached as catalyst) | 2–5 KB | Variable | Permanent — preserved with thesis |
| Portfolio briefing | 10–20 KB | 4 briefings | ~80 KB |
| Trade history, prices, FMP data | 1–2 KB per entry | Cumulative | ~50 KB/mo |
| **TOTAL** | | | **~400–550 KB/mo** |

At ~500 KB/month, the 500 MB free tier supports approximately 80+ years of usage.

#### Version Cap (storage hygiene)

- Each position keeps the most recent 10 scorecard/research paper versions by default
- Older versions auto-archive to a separate "historical archive" view
- Adjustable in Settings
- Archived versions still accessible — just not in the main version dropdown

**Lazy loading for version history (required implementation detail):**
- On initial page load, only the **current (most recent) version** of a position's scorecard, research paper, and Gemini JSON artefact is fetched from Supabase
- Older versions are fetched **on demand only** — when the user opens the version dropdown and selects a specific version
- Never pre-load all 10 versions on page open; this avoids UI slowdown as research papers and JSON artefacts accumulate over time
- The version dropdown shows version dates and score snapshots (small metadata only) — full content fetched on selection

### Five-Provider Data Architecture

V4 introduces Gemini as a dedicated research provider, separating research breadth (Gemini) from reasoning depth (Claude). FMP remains the structured data backbone.

| Provider | Purpose |
|---|---|
| Sharesight API | Portfolio value, holdings, broker cash, trade history, performance, distributions, gains |
| Yahoo Finance (via `yahoo-finance2`) | Live prices (all global exchanges), FX rates for all currencies, benchmark historical data, ATH calculation. Use the `yahoo-finance2` Node.js library — better maintained and more resilient than direct DOM scraping. If Yahoo throttles or is unavailable, fall back to FMP's `/quote` and `/fx` endpoints as the secondary price source. |
| Financial Modelling Prep (FMP) | Structured fundamentals — P/E, margins, ROE, ROIC, FCF, debt ratios, analyst targets, EPS history, dividend history, full financials. Also serves as secondary price/FX source if Yahoo Finance is unavailable. |
| Gemini API (Researcher) | Web-scale research — 10-Ks, earnings transcripts, news, sentiment, exchange announcements. Outputs structured JSON research artefacts cached in Supabase. Handles all token-heavy reading so Claude does not have to. |
| Anthropic API (Claude — Thinker) | Reasoning, synthesis, scorecard generation, thesis writing, briefing generation. Consumes Gemini's pre-distilled JSON output + FMP numbers — not raw source documents. |

#### FMP Coverage Verification (action required before build)

- Test FMP coverage for all current holdings: PME, PGA1, XRF, HSN, MP1, DPLM
- Test FMP coverage for current research candidates: HUB, TNE, DE, ROP, CSU, HACK, CFLO
- If any return incomplete data: fallback plan is manual entry of those metrics
- FMP coverage for ASX 200 and major LSE/US stocks is reliable; smaller caps may be incomplete
- For positions on other exchanges — test FMP coverage before relying on it
- Where FMP data is incomplete for any field, the app displays an inline "incomplete data" indicator next to that specific field with a prompt to enter manually. Notification is field-level, not position-level.
- Before adding any position on a new exchange for the first time — test FMP ticker lookup and fundamentals coverage. Add exchange to Section 10.15 Exchange Management table.

#### API Call Budget (FMP free tier = 250 calls/day)

| Action | Calls Used |
|---|---|
| Fetch fundamentals for 6 satellite positions | 6 |
| Fetch fundamentals for 7 watchlist items | 7 |
| Fetch fundamentals for new ticker added | 1 |
| Daily refresh of all fundamentals | 13 |
| Total daily usage (current) | ~27 calls |
| Free tier limit | 250 calls |
| Headroom | 223 calls/day |

Scalability note: The free tier supports approximately 35–40 positions with daily fundamentals refresh. Beyond that, implement selective refresh (only refresh positions not updated in the last 24 hours). A Settings toggle allows switching to on-demand fundamentals fetch only.

#### Claude + Gemini API Spend Monitoring

- Monthly spend tracker visible in Settings — shows current month's spend on Claude and Gemini separately, plus combined total
- Soft alert: notification when monthly combined spend exceeds a configurable threshold (set in Settings 10.7)
- No hard cap — analysis is never blocked
- Anthropic and Google billing dashboards remain the absolute backstop for cost control

#### API Keys

- Anthropic API key — register at console.anthropic.com. Model: `claude-opus-4-7`
- Gemini API key — register at ai.google.dev. Model: latest Gemini Pro/Flash releases
- FMP API key — register free at financialmodelingprep.com
- Sharesight OAuth credentials — register app via Sharesight developer portal
- Supabase project — register free at supabase.com
- All keys stored in a local `.env` file (gitignored) and as environment variables in Vercel deployment — never committed to source control
- Yahoo Finance — no key required. Use the `yahoo-finance2` npm package; do not scrape Yahoo Finance HTML directly.

---

## 3. Core Portfolio

### Configurable Core ETF List

The core portfolio is built around a configurable list of ETFs — not a fixed schema. The current four ETFs (GHHF, DHHF, EXUS, BEMG) are the default seed, but additional ETFs can be added or existing ones archived in Settings 10.8 without code changes. The number of core ETFs is not hard-coded anywhere in the app.

#### Current ETF Holdings and Target Allocations (default seed)

| ETF | Name | Target % | DCA Tier Schedule | Provider Page |
|---|---|---|---|---|
| GHHF | Betashares Geared Australian Growth Fund | 40% | GHHF schedule | betashares.com.au/fund/diversified-all-growth-geared-etf |
| DHHF | Betashares Diversified All Growth ETF | 28% | Standard schedule | betashares.com.au/fund/diversified-all-growth-etf |
| EXUS | Betashares Global Shares ETF (Currency Hedged) | 16% | Standard schedule | betashares.com.au/fund/global-shares-etf-currency-hedged |
| BEMG | Betashares Emerging Markets Equity ETF | 16% | Standard schedule | betashares.com.au/fund/emerging-markets-equity-etf |

- Target allocations are editable in Settings — must sum to 100% across active core ETFs
- Provider page links are editable per ETF and open in a new browser tab
- DCA tier schedule per ETF is selectable: Standard, GHHF (geared), or Custom (user-defined)

#### Adding, Archiving, and Managing Core ETFs

- **Add new core ETF:** ticker search, FMP/Yahoo Finance auto-fetch of name and exchange, manual entry of target allocation %, choice of DCA tier schedule
- Ticker is settable on add but locked once trades exist for that ETF (use archive instead of changing ticker)
- **Archive existing core ETF:** hides from main views, excludes from DCA and allocation calculations, preserves historical scorecard and trade data
- Settings validation: target allocations across active (non-archived) core ETFs must sum to exactly 100%. Save disabled when sum ≠ 100%.
- Inactive (archived) ETFs continue to receive value updates from Sharesight if still held, but are segregated to the archived view

### Allocation Display

Three levels of allocation shown at all times:

**1. Core allocation (% of core portfolio):**
- Each ETF's current value vs its target allocation within the core portfolio
- Drift from target shown in % and $

**2. Total portfolio allocation (% of total portfolio):**
- Each ETF's weighting within the entire portfolio (core + satellite combined)
- Based on present value from Sharesight

**3. True exposure (accounting for gearing):**
- Geared ETF gearing factor is entered **manually** — there is no automated scraping of provider pages for this value
- Manual entry in Settings 10.8 per geared ETF. Updated at your discretion (recommended: check weekly)
- Default value if not yet entered: 1.5×
- True exposure = Geared ETF allocation × current gearing multiple
- Example: GHHF at 40% of core with 1.5× gearing = 60% true exposure within core
- Informational only — does not affect DCA calculations

#### Example Allocation Display

| ETF | Target | Actual (% core) | Actual (% total) | True Exposure (% total) |
|---|---|---|---|---|
| GHHF | 40% | 41% | 29.5% | 44.3% (1.5×) |
| DHHF | 28% | 27% | 19.4% | 19.4% |
| EXUS | 16% | 16% | 11.5% | 11.5% |
| BEMG | 16% | 16% | 11.5% | 11.5% |
| Core total | 100% | 100% | 71.9% | 86.7% |

### Ticker Search — Live Combobox with Exchange Disambiguation

When adding any position (satellite or watchlist), the ticker search field uses a live combobox/typeahead component backed by the FMP Ticker Search API.

**Behaviour:**
- As you type, the app queries the FMP search endpoint in real time
- Results display as a dropdown showing: `Symbol | Company Name | Exchange` (e.g. `BHP | BHP Group | ASX`)
- Selecting a result locks in the specific `symbol` and `exchangeShortName` from FMP — all ambiguity about which exchange is resolved at this point
- The saved `symbol` and `exchangeShortName` are stored in Supabase and used for all subsequent FMP, Yahoo Finance, and Gemini calls for that position
- This prevents the ticker suffix mismatch problem (e.g. `.AX` on Yahoo Finance vs no suffix on FMP for the same ASX stock) — the stored values are the canonical reference

### DCA Tier System

**Base weekly amount:** A$350 (editable in Settings)

#### How It Works

- Each active core ETF assessed independently against its distance from all-time high
- Distance from ATH determines the multiplier applied to that ETF's share of the base weekly amount
- Formula: `Weekly contribution per ETF = Base amount × ETF core allocation % × Tier multiplier`

#### 0× Tier Rule (applies to ALL ETFs on both schedules)

When an ETF is within 1.5% of its ATH, the tier multiplier is 0× and that ETF receives no contribution that week. The portion of the base weekly amount allocated to that ETF is **forfeited** — it is **not redistributed** to other ETFs.

**Worked example** with A$350 base, GHHF (40%) at ATH (0× tier) and DHHF/EXUS/BEMG in tier 3 (1.5× multiplier):

| ETF | Calculation | Result |
|---|---|---|
| GHHF | 350 × 0.40 × 0 | $0 |
| DHHF | 350 × 0.28 × 1.5 | $147 |
| EXUS | 350 × 0.16 × 1.5 | $84 |
| BEMG | 350 × 0.16 × 1.5 | $84 |
| **Total** | | **$315** |

The GHHF allocation is intentionally forfeited — not buying near ATH is the design intent.

#### ATH

- Auto-fetched from full price history via Yahoo Finance
- Updates automatically daily
- Current price also live at all times

#### Standard Schedule (DHHF, EXUS, BEMG)

| Distance from ATH | Multiplier |
|---|---|
| 0–1.5% | 0× |
| 1.5–3.5% | 0.70× |
| 3.5–8.5% | 1.50× |
| 8.5–13.5% | 2.50× |
| 13.5–18.5% | 3.40× |
| 18.5–23.5% | 4.60× |
| 23.5–28.5% | 5.00× |
| 28.5–33.5% | 5.50× |
| 33.5%+ | 6.00× |

#### GHHF Schedule (conservative — accounts for leverage risk)

| Distance from ATH | Multiplier |
|---|---|
| 0–1.5% | 0× |
| 1.5–4% | 0.70× |
| 4–8% | 1.35× |
| 8–12% | 2.25× |
| 12–17% | 3.05× |
| 17–22% | 4.15× |
| 22–28% | 4.60× |
| 28–33% | 5.10× |
| 33%+ | 5.60× |

#### Custom Schedules

- New core ETFs added in future can use Standard, GHHF, or Custom schedule
- Custom schedules user-defined in Settings — number of tiers, distance thresholds, and multipliers all editable
- Reset to defaults available per schedule

#### Settings Requirements

- All tier schedules fully editable in Settings
- Each tier's distance threshold and multiplier individually adjustable
- Reset to defaults button per schedule
- Base weekly amount editable in Settings

### DCA Calculator Display

Always shows live calculation based on current price at time of opening app. One row per active core ETF.

| Displayed | Detail |
|---|---|
| Current price | Live — auto-fetched |
| ATH price | Auto-fetched from full history |
| Distance from ATH | Calculated automatically |
| Active tier | Highlighted in tier table |
| Multiplier | From active tier |
| This week's contribution | Per ETF — base × allocation × multiplier |
| Total weekly contribution | Sum across all active core ETFs |
| Target day | Tuesday (shown as guidance, not enforced) |

DCA execution is discretionary — no fixed day enforced.

### Core ETF Deep Dive Page

Accessible by clicking any ETF ticker or name anywhere in the app.

**Section A — Live data (auto-fetched):**
- Current price (Yahoo Finance — live)
- ATH and distance from ATH
- 52-week high and low
- Day % change
- Current DCA tier and this week's contribution

**Section B — Fund data (auto-fetched from provider weekly, every Wednesday):**
- Current gearing multiple (geared ETFs only)
- Region / country exposure (% breakdown)
- Sector exposure (% breakdown)
- Top 10 holdings (name + % weight)
- Expense ratio, AUM, tracking difference
- Last fetched datestamp

**Section C — Allocation data (from Sharesight):**
- Current value, % of core portfolio, % of total portfolio
- True exposure % (gearing-adjusted for geared ETFs)
- Book value (cost basis), unrealised gain/loss

**Section D — Links:**
- Button: "View on provider" → opens provider page in new tab (configurable per ETF)
- Button: "View on Sharesight" → opens Sharesight portfolio in new tab

### Distributions and Reinvestment

- All current core ETFs set to distribution reinvestment
- Reinvestment picked up automatically via Sharesight sync
- Does not affect DCA calculation

---

## 4. Satellite Portfolio

### Data Source

All positions, current values, quantities, average buy prices, capital gains, and income pulled automatically from Sharesight API on sync. Positions are added/removed in the app automatically as they appear/disappear in Sharesight.

### Current Positions

At time of writing the satellite portfolio contains positions across ASX and LSE. The architecture is exchange-agnostic — positions can be added on any global exchange where value is found, with no code changes required for new exchanges. Closed positions excluded automatically.

**New position with no prior research:** if a position appears in Sharesight with no existing scorecard or research paper, the app:
- Creates a new satellite position record
- Displays a prominent alert: "[Ticker] has no scorecard — analysis recommended"
- Shows an "Awaiting analysis" badge on the position card
- Triggers framework auto-suggest immediately on first open
- **Suppresses buy zone alerts and exit trigger monitoring until first scorecard is generated and score ≥ 65%**

### Satellite vs Sharesight Reconciliation

- Sharesight is authoritative for whether a position exists and its current value
- Manual archive in the app hides a position from main views but does not remove it from Sharesight sync
- If an archived position is still active in Sharesight, the archived satellite record continues to receive value updates but is segregated to the "archived" view
- To fully remove a position, close it in your broker — Sharesight will then mark it closed and the app will move it to the "closed positions" view automatically

### Allocation Engine

The allocation engine produces guidance — a suggested target allocation per position based on score. It does not automatically adjust real positions.

| Rule | Value |
|---|---|
| Haircut threshold | Score below 65% = 0.5× allocation weight |
| Buy zone unlock | Score ≥ 65% |
| Rebalance trigger | Actual allocation drifts > 10% above target |
| Allocation basis | Score-weighted guidance — see formula below. Guidance only; full manual override available. |
| Maximum position size | No hard cap at this stage. Reserved for future use when satellite holds many positions. |

#### Allocation Engine Formula

The engine adapts automatically to the number of positions in the satellite portfolio. Always sums to 100% of satellite.

```
adjusted_score = raw_score × 0.5    (if score < 65%)
adjusted_score = raw_score × 1.0    (if score ≥ 65%)

raw_weight = adjusted_score
target_allocation % = (raw_weight / sum_of_all_raw_weights) × 100
```

- Guidance allocations always sum to 100% across all satellite positions
- **Manual override:** any position's target allocation can be overridden at any time. Overrides logged with date and note. When an override is active, the formula recalculates remaining positions to sum to (100% − override total).
- **Future enhancement (deferred):** a maximum position cap can be added in Settings when the satellite grows large enough to warrant concentration limits

#### Weightings Displayed Per Position

- % of satellite portfolio (actual current value from Sharesight)
- % of total portfolio (actual current value from Sharesight)
- Target allocation % (formula-derived guidance)
- Drift from target (actual vs target — informational)

### Position Detail Page

Accessible by clicking any position anywhere in the app. Contains four components.

#### Component 1 — Live Data Panel

Pulled from Yahoo Finance (prices) and FMP (fundamentals):
- Current price (live — in native currency)
- Day % change, 52-week high / low
- Market cap, P/E (trailing and forward), EV/EBITDA
- Gross margin, operating margin, net margin
- ROE, ROIC, FCF
- Revenue growth YoY, net debt / cash
- Analyst price target, recommendation, number of analysts
- Dividend yield (if applicable), sector and industry
- FMP data completeness: any field with incomplete or missing data displays an inline "incomplete data" indicator with a prompt to enter manually

#### Component 2 — Scorecard

Generated by the Triad: Gemini gathers research, Claude (`claude-opus-4-7`) synthesises and scores.

**Framework auto-selection:**
- Claude assesses position and suggests appropriate framework
- You confirm the framework before analysis runs
- Five frameworks available: Regular stocks, Thematic ETFs, Fund managers/LICs, Speculative stocks, Alternative investments/PE

**Scorecard contents:**
- Full weighted checklist with Claude's scores and reasoning per item
- Section scores and overall score
- Buy zones (derived from analysis)
- Exit triggers (fundamental, valuation, technical)
- Haircut status (score vs 65% threshold)
- Allocation guidance (target % of satellite — guidance only)
- Catalyst notes (announcements that materially shaped this scorecard version)

**Manual adjustment:**
- Any item score can be manually overridden after Claude's assessment
- All manual adjustments logged: item name, Claude's score, your score, date, optional note
- Override log visible within the scorecard and stored in Supabase — persists across versions

#### Component 3 — Research Paper / Thesis

Generated by Claude using Gemini's JSON research artefacts as input. Structure:

1. Business overview and competitive position
2. Moat analysis
3. Financial summary (3–5 year key metrics table)
4. Capital allocation history
5. Investment thesis
6. Valuation analysis
7. Scenario analysis (bull / base / bear with approximate price targets)
8. Peer comparison (2–3 closest competitors on key metrics)
9. Key risks
10. Recent developments and news
11. Outlook and catalysts
12. Conclusion and recommendation (buy / hold / watch / avoid)

#### Component 4 — Buy Zones, Exit Triggers and Framework Rules

- Buy zones (up to 3 zones — accumulate / strong buy / deep value)
- **All buy zone prices expressed in the position's native currency.** AUD equivalent not shown in buy zone alerts — price triggers are purely in native currency to avoid FX distortion.
- Exit triggers (fundamental / valuation / technical — each with sell full or trim action)
- Haircut rule status, rebalance trigger status
- All editable manually after generation

### Versioning

- Every re-analysis creates a new version alongside previous versions
- Default version cap: 10 most recent per position (adjustable in Settings)
- Older versions auto-archive to historical archive view
- Catalyst announcements attached to a version are preserved permanently — never purged
- All versions stored in Supabase

**Version navigation:**
- Dropdown selector showing all available versions
- Side-by-side comparison: select any two versions and see score changes per section and per item
- Score history chart: overall score plotted over time across all versions
- Manual adjustment log carries across versions
- Catalyst announcements visible per version

**Re-analyse button:**
- Runs full Triad research process: Gemini gathers fresh research, Claude synthesises new scorecard and research paper
- Creates new version — does not overwrite previous versions
- Shows progress indicator while running (research can take 60–120 seconds)

### Announcement Monitoring and Catalyst-Aware Retention

> **Note:** Per analysis recommendations, this feature is Priority 2 — built after the core app is stable, not at initial launch.

#### Satellite Positions — Automated Twice-Daily Polling

For each satellite position, the app determines the appropriate announcement source based on the position's exchange:

| Exchange | Source | Schedule (local) |
|---|---|---|
| ASX | ASX announcements page | 10:30am and 4:30pm AEST on weekdays |
| LSE | London Stock Exchange RNS | 9:00am and 5:00pm GMT on weekdays |
| NYSE / NASDAQ | SEC EDGAR RSS feed | 9:30am and 4:30pm EST on weekdays |
| Other exchanges | Flagged as "manual monitoring required" — not silently ignored | — |

- New announcements displayed as in-app alert/banner
- Price-sensitive announcements → automatically sent to Triad for thesis impact analysis
- Non-price-sensitive → on-demand analysis only (button on the announcement)

#### Catalyst-Aware Retention (30-day rolling)

- **Default retention:** 30 days. After 30 days, unattached announcements are automatically deleted.
- **Catalyst attachment:** when Claude's analysis flags an announcement as causing a scorecard change (item score moved, buy zone updated, exit trigger flagged, thesis adjusted), the announcement is automatically attached to the affected scorecard version as a catalyst note.
- **Attached announcements are never deleted** — they live with the scorecard version permanently.
- **Catalyst note contents:** announcement headline, full text, date, Claude's assessment, which scorecard items were affected, link back to the scorecard version it shaped.
- **Manual attachment/detachment:** you can manually attach or detach any announcement from a scorecard version. Detached announcements revert to the 30-day rolling retention rule.
- Retention configurable in Settings 10.7 (default 30 days, options: 14 / 30 / 60 / 90 days)

#### Watchlist Positions — On-Demand Search Only

- Watchlist positions do not receive automated announcement monitoring by default
- A "Search announcements" button is available on each watchlist position detail page — triggers Gemini to search for recent material announcements on demand
- **Optional auto-monitoring:** Settings toggle "Auto-monitor watchlist positions scoring ≥ [threshold]" (default: off, default threshold: 78%)
- When enabled, qualifying watchlist positions receive the same twice-daily polling as satellite positions
- Identical 30-day catalyst-aware retention applies

#### Claude Announcement Analysis Output

- Thesis impact: no change / minor update / material change
- Scorecard items affected (if any)
- Exit triggers: none triggered / review recommended / triggered
- Buy zones: unchanged / updated
- Recommendation: hold / re-analyse / act
- If material: announcement is automatically attached to current scorecard version as catalyst

### Foreign Currency Handling

- Any satellite position held in a foreign currency is displayed in its native currency on the position detail page (with optional AUD parenthetical — see Settings 10.12)
- Portfolio-level values converted to AUD using live Yahoo Finance FX rates
- **Buy zone comparisons and price alerts always in native currency only** — hardcoded rule, independent of display settings

### Cash

- All broker cash balances pulled automatically from Sharesight (see Section 1)
- External (non-broker) cash entered manually in Settings
- Cash shown on dashboard health bar — total combined, expandable to per-source breakdown
- Not included in allocation engine calculations

---

## 5. Scoring Frameworks

### How Scoring Is Accessed

Scoring is always accessed contextually — never from a standalone page:
- From the satellite page → click any position → position detail page → scorecard tab
- From the watchlist → click any ticker → opens position detail page with scorecard tab
- New position — when added via ticker search, Claude auto-suggests the appropriate framework and runs the full Triad analysis on confirmation

### Framework Auto-Selection

- Claude reviews the asset type, sector, business model, and listing details
- Suggests the most appropriate framework with a brief reason
- Waits for your confirmation before running the full analysis
- You can override and select a different framework manually

### Universal Scoring Rules

| Rule | Value |
|---|---|
| Buy zone unlock threshold | Score ≥ 65% |
| Haircut threshold | Score < 65% = 0.5× allocation weight |
| High conviction threshold | Score ≥ 78% |
| Maximum satellite allocation | No cap currently — reserved for future |
| Rebalance trigger | Actual drift > 10% above target |
| Score source | Triad: Gemini research + Claude (`claude-opus-4-7`) synthesis |
| Manual override | Allowed on any item — logged with date and note |
| Versioning | Every re-analysis creates new version (cap 10 per position) |
| Catalyst attachment | Material announcements auto-attached to scorecard version they shaped |

---

### Framework 1 — Regular Stocks

*Applies to: Companies listed on any major global exchange with established revenues and earnings history.*

Scale: 1–5 stars per item. Total items: 60.

| Section | Weight | Items | Key Focus |
|---|---|---|---|
| Competitive moat | 20% | 7 | Moat source, pricing power, gross margin, revenue quality, retention, market share |
| Profitability & returns | 20% | 8 | ROIC vs WACC, ROE, margins, FCF conversion, EPS growth, earnings quality |
| Balance sheet | 12% | 7 | Net debt/EBITDA, interest coverage, current ratio, goodwill, off-balance-sheet risks |
| Cash flow & capital allocation | 12% | 6 | FCF yield, capex intensity, M&A discipline, dilution, management skin in the game |
| Management & governance | 8% | 7 | CEO tenure, capital allocation philosophy, compensation, board quality, succession |
| Growth runway | 8% | 5 | TAM, product pipeline, competitive intensity, geographic diversification, tailwinds |
| Valuation | 10% | 7 | P/E vs history, EV/EBITDA vs peers, PEG, FCF yield, DCF implied growth, margin of safety |
| Risk & red flags | 7% | 6 | Customer concentration, insider selling, auditor, regulatory exposure, short interest |
| Technical analysis | 3% | 7 | Price vs 50MA, price vs 200MA, RSI, support/resistance, volume, trend, MACD |

#### Score Thresholds — Regular Stocks

| Score | Tier | Meaning |
|---|---|---|
| 85%+ | Tier 1 — Exceptional | Rare. Maximum conviction. Full allocation. |
| 78–84% | Tier 2 — High conviction | Strong buy. Buy zones active. |
| 65–77% | Tier 3 — Qualifies | Buy zones active. Allocation proportional to score. |
| 50–64% | Tier 4 — Marginal | 0.5× haircut applied. Buy zones locked. Monitor only. |
| Below 50% | Tier 5 — Avoid | Do not hold. Exit if currently in portfolio. |

---

### Framework 2 — Thematic ETFs

*Applies to: ETFs listed on any exchange with a specific sector or factor theme (e.g. HACK, CFLO).*

Scale: 1–4 stars per item. Total items: 40.

| Section | Weight | Items | Key Focus |
|---|---|---|---|
| Theme integrity | 35% | 5 | Structural vs cyclical, theme specificity, holdings purity > 70%, consensus risk, verifiable tailwinds |
| Holdings valuation | 20% | 4 | Top 5 P/E vs sector, blended fund P/E < 40×, revenue growth supports multiple, FCF positive majority |
| Fund structure & cost | 20% | 5 | Expense ratio ≤ 0.65%, AUM > $200M, daily liquidity, rules-based index, physical replication |
| Performance & risk | 15% | 3 | Tracking difference, drawdown behaviour, 3-year return vs benchmark |
| Portfolio fit | 10% | 3 | Overlap with existing holdings, unique exposure, tax efficiency |

#### Score Thresholds — Thematic ETFs

| Score | Tier | Meaning |
|---|---|---|
| 82%+ | Tier 1 | Strong conviction. Full allocation. Buy zones active. |
| 68–81% | Tier 2 | Considered inclusion. Buy zones active. |
| 52–67% | Tier 3 | Monitor only. No buy zones. 0.5× haircut. |
| Below 52% | Tier 4 | Avoid. |

---

### Framework 3 — Fund Managers / LICs

*Applies to: Listed and unlisted active fund managers, LICs, complex ETFs with active management (e.g. PGA1).*

Scale: 1–4 stars per item. Total items: 40.

| Section | Weight | Items | Key Focus |
|---|---|---|---|
| Alpha generation | 30% | 6 | Annualised alpha > 3%, consistency, downside capture < 80%, upside participation ≥ 90%, Sharpe ratio, win rate > 60% |
| Manager quality & process | 25% | 5 | Process clarity, personal co-investment, key-person risk, tenure through full cycle, no style drift |
| Structure & fees | 25% | 5 | Management fee ≤ 1.5% for L/S, performance fee with HWM and hurdle, NTA discount/premium, liquidity terms, AUM capacity |
| Portfolio fit & governance | 20% | 5 | Correlation with direct holdings, external ratings, board independence, reporting transparency |

#### Score Thresholds — Fund Managers / LICs

| Score | Tier | Meaning |
|---|---|---|
| 85%+ | Tier 1 | High conviction allocation. Full allocation. Buy zones active. |
| 70–84% | Tier 2 | Core satellite inclusion. Buy zones active. |
| 55–69% | Tier 3 | Monitor only. 0.5× haircut. |
| Below 55% | Tier 4 | Avoid or exit. |

---

### Framework 4 — Speculative Stocks

*Applies to: Pre-profit, early-stage, or high-risk/high-reward positions where the investment case is thesis-driven rather than earnings-based (e.g. MP1 during loss-making phase).*

Scale: 1–4 stars per item. Total items: 40.

| Section | Weight | Items | Key Focus |
|---|---|---|---|
| Thesis clarity & catalyst | 30% | 5 | Single articulable thesis, identifiable catalyst with timeline, binary outcome understood, differentiated from consensus |
| Survivability & runway | 25% | 5 | Cash runway > 18 months, burn rate stable or declining, dilution risk, no near-term debt maturity |
| Asymmetric payoff | 25% | 5 | Upside ≥ 3× in bull case, downside understood and sized, comparable transaction validation |
| Management & red flags | 20% | 5 | Domain expertise, insider buying, no promotional activity, short interest < 8%, reputable auditor |

#### Score Thresholds — Speculative Stocks

| Score | Tier | Meaning |
|---|---|---|
| 80%+ | Tier 1 | High conviction speculative. Small position. Buy zones active. |
| 65–79% | Tier 2 | Tracked position. Buy zones active. 0.5× haircut still applies. |
| 50–64% | Tier 3 | Watchlist only. No position. |
| Below 50% | Tier 4 | Avoid. |

---

### Framework 5 — Alternative Investments / PE

*Applies to: Private equity, venture capital, infrastructure, hedge funds, listed PE vehicles, real assets.*

Scale: 1–4 stars per item. Total items: 40.

| Section | Weight | Items | Key Focus |
|---|---|---|---|
| Access & structure | 25% | 5 | Vehicle type vs liquidity needs, lock-up alignment, J-curve understood, single-layer fees, secondary market exists |
| Manager & strategy | 30% | 5 | DPI > 1.0× in prior vintages, net IRR consistently > 15%, PME > 1.0×, vintage diversification |
| Deal quality & returns | 25% | 5 | Entry multiples below sector average, value creation from operations not just leverage, strong exit track record |
| Fees, transparency & red flags | 20% | 5 | Management fee ≤ 2% + carry ≤ 20% with 8% hurdle, independently verified NAV, transparent quarterly reporting |

#### Score Thresholds — Alternative Investments / PE

| Score | Tier | Meaning |
|---|---|---|
| 82%+ | Tier 1 | Strong — illiquidity premium justified. Full allocation. |
| 65–81% | Tier 2 | Acceptable for alts allocation. Buy zones active. |
| 50–64% | Tier 3 | Marginal. Monitor fees and liquidity. 0.5× haircut. |
| Below 50% | Tier 4 | Avoid — insufficient illiquidity premium. |

---

### Score Versioning Across All Frameworks

- Every re-analysis generates a new version
- Score history tracked over time per position
- Side-by-side comparison available between any two versions
- Manual overrides logged per item with date and optional note
- Claude's original score preserved even when manually adjusted
- Default version cap: 10 most recent per position (adjustable in Settings)
- Catalyst announcements attached to a version are preserved permanently

### Watchlist Scoring Behaviour

- Score stored against the watchlist item in Supabase
- Tier and buy zone status shown on watchlist table
- If score ≥ 65% — option to move position from watchlist to satellite portfolio appears
- Full scorecard and research paper stored and accessible from watchlist

---

## 6. Watchlist

### Purpose

The watchlist is a research pipeline — stocks and ETFs being monitored and analysed before they enter the satellite portfolio. Positions move from watchlist to satellite automatically when they appear in Sharesight (i.e. when you make a purchase). All research, scores, notes, and attached catalyst announcements carry across automatically on that transition.

### Initial State

- Watchlist starts empty — no hardcoded items
- All watchlist items added manually via ticker search
- First-time users see an empty state with prompt: "Search a ticker to add your first watchlist item"

### Adding to Watchlist

- Via ticker search — type any ticker on any global exchange, app fetches company data from FMP and Yahoo Finance automatically
- Claude suggests the appropriate framework based on asset type
- You confirm the framework before analysis runs
- Alternatively add without analysis — position sits on watchlist as unanalysed until you trigger research

### Watchlist Dashboard View

One row per position. All columns sortable.

| Column | Source | Notes |
|---|---|---|
| Ticker | FMP / Yahoo | — |
| Company name | FMP | — |
| Exchange | FMP | — |
| Asset class | User-set | Dropdown to change — triggers re-analysis on change |
| Framework | Derived from asset class | Updates when asset class changes |
| Score | Triad analysis | Shown as % with colour coding |
| Tier | Derived from score | High conviction / Qualifies / Marginal / Avoid |
| Current price | Yahoo Finance (live) | Auto-refreshes every 5 minutes — in native currency |
| Daily change % | Yahoo Finance (live) | Green/red |
| Market cap | FMP | — |
| P/E trailing | FMP | — |
| P/E forward (NTM) | FMP | — |
| Revenue growth YoY | FMP | — |
| 52-week high | Yahoo Finance | — |
| 52-week low | Yahoo Finance | — |
| Distance from 52-wk low | Calculated | (Current − 52wk low) / 52wk low |
| Date last analysed | App | Datestamp of most recent Triad analysis |
| Auto-monitor | Settings + score | Yes if score ≥ threshold and toggle on |
| One-liner synopsis | FMP + Claude | FMP description default; Claude one-liner once analysed |

### One-Liner Synopsis

- Before analysis: FMP company description truncated to one sentence
- After analysis: Claude-generated one-liner — what the business does, why it's interesting, in one sentence
- Claude one-liner replaces FMP default once analysis has been run
- Editable manually
- Shown on watchlist row and on satellite position card

### Asset Class Dropdown

Options: Regular stock / Thematic ETF / Fund manager / LIC / Speculative stock / Alternative investment / PE

When changed:
- App notifies you that changing asset class will trigger a re-analysis
- You confirm
- Full re-analysis runs automatically (new version created)

### Watchlist Position Detail Page

Same structure as satellite position detail page. Five tabs:

**Tab 1 — Overview:** one-liner synopsis, live price, daily change, 52-week range, market cap, P/E, framework, tier, score, auto-monitor status

**Tab 2 — Live data:** full fundamentals from FMP (same fields as satellite live data panel)

**Tab 3 — Scorecard:** full framework checklist, section scores, overall score, manual override per item, version dropdown, side-by-side comparison, score history chart, catalyst announcements per version

**Tab 4 — Research paper:** full 12-section research paper, version dropdown

**Tab 5 — Buy zones and exit triggers:** buy zones (up to 3, all in native currency), exit triggers, haircut status — carries across automatically when position moves to satellite

### Announcement Monitoring (Watchlist)

- **On-demand:** "Search announcements" button on each watchlist position detail page. Always available.
- **Optional auto-monitoring:** Settings toggle "Auto-monitor watchlist positions scoring ≥ [threshold]" (default: off, default threshold: 78%). When enabled, qualifying positions receive the same twice-daily polling as satellite positions with identical 30-day catalyst-aware retention.
- During due diligence (running a full research and scorecard), Claude automatically reads recent announcements via Gemini as part of the process.
- Catalyst-attached announcements carry across to satellite when position transitions; unattached announcements expire under the 30-day rule.

### Moving from Watchlist to Satellite

Triggered automatically when Sharesight sync detects a new position:
- All data carries across: scorecard, research paper, buy zones, exit triggers, synopsis, score, tier, attached catalyst announcements, version history, manual override log
- Watchlist item archived (not deleted) — accessible from a "Previously watched" section
- If no prior research exists: prominent alert shown, framework auto-suggest triggered on first open

### Filtering and Sorting

- Sort by any column (ascending / descending)
- Filter by: asset class, tier, exchange, score range, analysed / unanalysed, auto-monitored / not
- Search by ticker or company name
- Default sort: score descending

### Summary Stats Bar

| Stat | Description |
|---|---|
| Total candidates | All watchlist items |
| Qualify (≥ 65%) | Buy zones active |
| High conviction (≥ 78%) | Ready to act immediately if opportunity arises |
| Marginal (50–64%) | Haircut applies |
| Unanalysed | No Triad analysis run yet |
| Auto-monitored | Currently receiving twice-daily announcement polling (if Settings toggle enabled) |
| Moved to portfolio | Count of positions that transitioned via Sharesight |

---

## 7. Dashboard

### Purpose

The dashboard answers three questions instantly:
1. How is my portfolio doing right now?
2. Is there anything I need to act on today?
3. What should I be doing this week?

### Navigation Structure

Sidebar on desktop, bottom navigation bar on mobile:
- Dashboard
- Core Portfolio
- Satellite Portfolio
- Watchlist
- Settings

Portfolio Briefing is accessible via a button on the Dashboard — not a navigation item.

### Zone 1 — Portfolio Health Bar (top strip)

Always visible regardless of which section you're in.

| Metric | Source | Notes |
|---|---|---|
| Total portfolio value | Sharesight | Live, AUD |
| Core value | Sharesight | AUD |
| Satellite value | Sharesight | AUD |
| Total cash | Sharesight (broker) + Supabase (external) | Combined total. Click to expand for breakdown. |
| Total gain/loss today | Sharesight | $ and % |
| Total gain/loss all time | Sharesight | $ and % |
| Core / satellite split | Calculated | Actual vs target (72/28) |
| Last Sharesight sync | App | Timestamp |

Cash breakdown (expandable): Betashares Direct, IG Trading, IBKR (when added), External (bank/non-broker). Each line shown separately with timestamp of last update.

### Zone 2 — Alerts Panel

Shown prominently below the health bar. Only appears when there is something to act on.

**Alert types in priority order:**

1. **Exit triggers** — Highest priority. Fires when a triggered exit trigger is marked. Red, requires manual dismissal.
2. **Buy zone alerts** — Fires when price moves into or below a buy zone (compared in native currency). Green. Auto-dismisses if price moves above zone. Suppressed for positions without a completed scorecard.
3. **DCA this week** — Shows every time you open the app. Amber.
4. **Announcement alerts** — Fires within polling window of new announcement for a monitored position. Blue.
5. **Re-analysis recommended** — Fires when position not analysed in 90+ days or material announcement received. Orange. Manually dismissible — does not refire until 30 days elapse, a re-analysis is run, or a new material announcement is detected.

### Zone 3 — Portfolio Chart

Full-width chart showing portfolio performance over time.

**Chart lines (all toggleable individually):**
- Total portfolio value (AUD)
- Core portfolio value (AUD)
- Satellite portfolio value (AUD)
- Cash position (AUD — combined total)
- Total unrealised gain
- Benchmark (default: VGS.AX — searchable dropdown)

**Controls:** Time period: 1M / 3M / 6M / 1Y / 2Y / All · Toggle: A$ vs % return · Benchmark selector · Individual line toggles

### Zone 4 — Position Summary Grid

**Panel A — Satellite positions:** One card per position showing ticker, company name, one-liner synopsis, asset class badge, score % with tier, live price and daily change (native currency), allocation (target vs actual vs drift), buy zone status (native currency comparison), exit trigger status, days since last analysis.

**Panel B — Watchlist highlights:** Top 5 watchlist items by score, same card format, with "Not held" badge.

### Zone 5 — This Week's DCA Widget

One row per active core ETF — list adapts to current Settings 10.8 configuration.

| ETF | Live Price | ATH | Distance | Tier | Multiplier | This Week |
|---|---|---|---|---|---|---|
| [Active ETFs from Settings 10.8] | | | | | | |
| Total | | | | | | $XXX |

- Base weekly amount shown and editable inline
- Target day shown: Tuesday
- ETFs in 0× tier show $0 contribution explicitly — that allocation is forfeited that week

### Zone 6 — Portfolio Balance Snapshot

| | Core | Satellite | Total |
|---|---|---|---|
| Target | 72% | 28% | 100% |
| Present value | X% | X% | A$X |
| Book value | X% | X% | A$X |
| Rebalance needed | -$X | +$X | — |

Informational only — no rebalance alert generated (rebalancing is discretionary).

### Refresh Behaviour

| Data | Refresh Frequency |
|---|---|
| Sharesight portfolio data + broker cash | Every 30 minutes + on app load |
| Live prices (Yahoo Finance) | Every 5 minutes during market hours (per exchange) |
| Satellite announcement monitoring | Twice daily per exchange schedule (Priority 2) |
| Watchlist auto-monitoring (if enabled) | Twice daily per qualifying position's exchange schedule |
| ATH prices | Daily |
| Provider fund data (gearing, holdings) | Weekly (Wednesday) |
| FMP fundamentals | Daily |
| Benchmark chart data | On time period change |

Manual refresh button always available in top right corner.

### Mobile Behaviour

- Health bar collapses to 3 key numbers on mobile (total value, today's gain, split)
- Cash breakdown accessible via tap on cash figure
- Alerts panel remains full width and prominent
- Chart is full width, swipeable time periods
- Position cards stack vertically
- DCA widget collapses to total only with tap to expand
- Note: Desktop is the primary experience. Mobile is fully functional secondary.

---

## 8. Automation

### Purpose

The app should require minimal manual input. Everything that can be fetched, calculated, or monitored automatically should be. Manual input is reserved for things that genuinely cannot be automated.

### Data Refresh Schedule

| Data Type | Source | Frequency | Trigger |
|---|---|---|---|
| Live prices — positions and watchlist | Yahoo Finance | Every 5 minutes during market hours (per exchange) | Automatic |
| Live prices — core ETFs | Yahoo Finance | Every 5 minutes during ASX market hours | Automatic |
| Exchange rates | Yahoo Finance | Every 5 minutes | Automatic |
| ATH prices | Yahoo Finance (full history) | Daily — after market close | Automatic |
| Sharesight portfolio sync (incl. broker cash) | Sharesight API | Every 30 min + on app load | Automatic + manual |
| FMP fundamentals | FMP | Daily — after market close | Automatic |
| Satellite announcements (Priority 2) | Exchange-specific | Twice daily per exchange schedule | Automatic |
| Watchlist auto-monitoring (if enabled) | Exchange-specific source | Twice daily — qualifying positions only | Automatic when threshold met |
| Gearing factor | Manual entry in Settings 10.8 | On manual update |
| Benchmark historical data | Yahoo Finance | On time period change | On demand |
| Triad announcement analysis (price-sensitive) | Gemini + Claude | Immediately on detection | Automatic |
| Triad announcement analysis (non-price-sensitive) | Gemini + Claude | On demand | Manual |
| Watchlist on-demand announcement search | Gemini | On demand | Manual (button) |
| Re-analysis recommendation flag | App logic | When 90+ days or material event | Automatic flag with re-fire control |
| Announcement purge (30-day rolling) | App logic | Daily housekeeping | Automatic — unattached announcements only |
| API spend tracker | App logic | Daily | Automatic |

### Market Hours

| Market | Hours (local) | Timezone |
|---|---|---|
| ASX | 10:00am – 4:00pm | AEST/AEDT |
| LSE | 8:00am – 4:30pm | GMT/BST |
| NYSE / NASDAQ | 9:30am – 4:00pm | EST/EDT |
| TSX (Canada) | 9:30am – 4:00pm | EST/EDT |
| Euronext (Paris/Amsterdam) | 9:00am – 5:30pm | CET/CEST |
| SGX (Singapore) | 9:00am – 5:00pm | SGT |
| HKEX (Hong Kong) | 9:30am – 4:00pm | HKT |
| JPX (Japan) | 9:00am – 3:30pm | JST |
| Additional exchanges | Sourced from FMP market hours endpoint | Added via Exchange Management settings (Section 10.15) |

Price refresh only runs during relevant market hours for each exchange — derived from the position's exchange field.

### Automated Calculations

| Calculation | Inputs | Updates When |
|---|---|---|
| DCA weekly contribution per ETF | Live price + ATH + base + tier schedule | Price refreshes |
| DCA total weekly contribution | Per-ETF contributions (active ETFs only) | Any ETF price refreshes |
| Distance from ATH per ETF | Live price + ATH | Price refreshes |
| Active DCA tier per ETF | Distance from ATH + tier schedule | Price refreshes |
| Satellite allocation guidance | Scores + haircut rules + manual overrides | Score changes or Sharesight sync |
| Allocation drift per position | Target allocation guidance + actual value | Sharesight sync |
| Core/satellite split | Sharesight portfolio values | Sharesight sync |
| Rebalancing requirement | Core value + satellite value + target | Sharesight sync |
| True exposure (geared ETFs) | Geared ETF allocation + manually entered gearing factor | Manual gearing update |
| Buy zone status per position | Live price (native currency) + buy zone ranges (native currency) | Price refreshes |
| Multi-currency AUD conversion | Live price/cash × live FX rate for each currency | Price/rate refreshes |
| Total cash combined | Sharesight broker cash + Supabase external cash | Sharesight sync or manual update |
| Re-analysis flag re-fire eligibility | Days since last fire + dismissal status + new material events | Daily check |

### Automated Alerts

**Buy zone alerts:**
- Fires when live price (native currency) moves into or below a buy zone (native currency)
- FX movement alone cannot trigger a buy zone alert
- Suppressed for positions without a completed scorecard
- Fires once per zone entry — does not repeat while in zone
- Resets if price moves above zone then re-enters

**Exit trigger alerts:**
- Fires when a previously untriggered exit trigger is marked as triggered
- Also fires when Triad announcement analysis identifies a potential exit trigger
- Requires manual dismissal

**Re-analysis recommended (with re-fire control):**
- Fires when position not analysed in 90+ days
- Fires when material announcement received since last analysis
- In-app only — no browser notification
- Manually dismissible. After dismissal, does not re-fire until: (a) 30 more days elapse (configurable), (b) re-analysis is run, or (c) a new material announcement is detected.

**API spend alert:**
- Fires once per month when monthly Claude + Gemini combined spend exceeds configured threshold
- In-app only — soft alert, analysis never blocked

### Browser Notifications

| Notification | Trigger | Timing |
|---|---|---|
| Buy zone entered | Price moves into buy zone (native currency) | Within 5 minutes of price refresh |
| Exit trigger identified | Triad flags potential exit trigger | Immediately after analysis |
| Price-sensitive announcement | New announcement for monitored position | Within twice-daily polling window |
| Weekly DCA reminder | Every Tuesday morning | 8:00am AEST |

### Manual Inputs

| Input | Reason |
|---|---|
| External cash balance (bank/non-broker) | Not exposed via any broker API |
| Score manual overrides | Discretionary — intentionally manual |
| DCA execution | Discretionary timing — Tuesday is a guide not a rule |
| Gearing factor (manual entry) | Updated at your discretion when the fund publishes a new gearing ratio — no automated fetch |
| Exit trigger marking | Requires your judgement — Triad flags, you confirm |
| Buy zone ranges | Set by Triad analysis — editable manually |
| Research paper re-analysis | On demand — you decide when to re-run |
| Target allocation override | Discretionary — formula provides guidance, you decide final target |
| Catalyst attachment / detachment | Manual override of Triad's automatic attachment decision |
| Core ETF management (add / archive) | Discretionary portfolio construction decisions |

### Automation Failure Handling

- Last known data shown with a warning indicator and timestamp
- Error message explains what failed and which data source
- Manual refresh button always available
- App never shows blank or broken state — always falls back to last known good data
- Sharesight sync failures shown prominently
- Triad failures: partial results saved, prompt to retry

---

## 9. Portfolio Briefing

### Purpose

A single on-demand button on the dashboard that generates a comprehensive written briefing covering everything relevant to your portfolio at that point in time. One press, one output, no back and forth required.

### How It Works

- Press "Generate portfolio briefing" on the dashboard
- App compiles your full portfolio context automatically (prices, scores, allocations, recent announcements, DCA status, buy zones, exit triggers, days since last analysis, cash position)
- Triad workflow: Gemini gathers fresh market and position-specific research; Claude (`claude-opus-4-7`) synthesises the structured briefing
- Output displayed in the app — printable and saveable as PDF
- Each briefing stored in Supabase with date stamp
- Estimated time: 60–120 seconds
- Cost efficiency: Gemini handles the research-heavy token load; Claude receives a pre-distilled JSON summary rather than raw documents — minimising Claude token consumption per briefing

### Page 1 — Portfolio Snapshot

*What is my portfolio doing right now?*

**1.1 Portfolio health:**
- Total portfolio value vs last briefing ($ and % change)
- Core value, satellite value, total cash (with breakdown) — each vs last briefing
- Core/satellite split: actual vs target (72/28)
- Overall portfolio performance vs benchmark since last briefing

**1.2 Core ETF status:**
- Current price and distance from ATH for each active core ETF
- Active DCA tier and multiplier for each
- This week's recommended contribution per ETF and total
- Any ETFs at or near ATH (0× multiplier active — contribution forfeited)
- True exposure summary including geared ETF gearing

**1.3 Satellite allocation snapshot:**
- Each position: current price (native currency), daily change, allocation % (actual vs target guidance), drift
- Any positions with triggered exit triggers
- Any positions in buy zones
- Overall satellite performance vs last briefing

### Page 2 — What Needs Attention

*Is there anything I need to act on?*

**2.1 Buy zone alerts:** For each position currently in or below a buy zone: current price vs zone range (native currency), which zone, Claude's view on whether the buy case remains intact, recommended action. Watchlist positions in buy zones flagged as "not yet held — consider adding via broker."

**2.2 Exit trigger review:** Position name, which trigger and why it may be relevant, Claude's assessment, recommended action (sell full / trim / monitor).

**2.3 Recent announcements:** Position, headline, date, Claude's assessment (thesis impact), whether attached as catalyst, whether exit triggers or buy zones were affected.

**2.4 Re-analysis recommendations:** Position name, days since last analysis, reason, priority order (most urgent first).

### Page 3 — Market Context and Outlook

*What is happening in the world that is relevant to my portfolio?*

**3.1 Macro developments:** Interest rate environment, relevant FX movements based on current portfolio currency exposures, any significant market-wide events since last briefing.

**3.2 Position-specific developments:** One paragraph per position maximum. Sourced from Gemini's fresh research at briefing time. Flagged as: no change / minor update / material development.

**3.3 Watchlist developments:** Price movements relative to buy zones (native currency), earnings or announcements, score implications.

**3.4 This week's action summary:** DCA recommendation (total and per active core ETF), buy zone entries worth acting on, exit triggers to review, re-analyses worth running, watchlist positions approaching buy zones.

### Briefing Controls

| Control | Function |
|---|---|
| Generate briefing | Runs full Triad briefing — takes 60–120 seconds |
| Save as PDF | Exports current briefing as a formatted PDF |
| Briefing history | Dropdown of all previous briefings by date |
| Compare to previous | Side-by-side view of current vs any previous briefing |

### Briefing History

- Stored permanently in Supabase by default; retention configurable in Settings 10.7
- Date and time generated, portfolio value at time of briefing, key metrics snapshot, full briefing text
- Accessible from dashboard via "Previous briefings" link

### Frequency Recommendation

- Weekly — Sunday evening before the Tuesday DCA day
- After any significant market event
- After an earnings release for a held position
- When you haven't checked the app in more than a week

---

## 10. Settings and Admin

### 10.1 Portfolio Configuration

| Setting | Description | Default |
|---|---|---|
| Total portfolio value | Manual override if Sharesight sync unavailable | From Sharesight |
| Core / satellite target split | Adjustable — drives rebalancing calculation | 72% / 28% |
| Base currency | AUD — fixed | AUD |
| External cash balance | Single manual entry for non-broker cash (bank, savings, etc.) | $0 — manual |

### 10.2 DCA Settings

| Setting | Description | Default |
|---|---|---|
| Base weekly DCA amount | Total base before multipliers | A$350 |
| Target DCA day | Guidance only — not enforced | Tuesday |
| Core ETF allocations | % allocation within core (must sum to 100% across active ETFs) | GHHF 40 / DHHF 28 / EXUS 16 / BEMG 16 |

DCA tier editor — Standard, GHHF, and Custom schedules are each independently editable with per-tier threshold and multiplier controls, add/remove tier buttons, and reset-to-defaults.

### 10.3 Satellite Allocation Rules

| Setting | Description | Default |
|---|---|---|
| Maximum position size | Hard cap per position as % of satellite. Disabled by default. | Off (no cap) |
| Haircut threshold | Score below this = 0.5× allocation weight | 65% |
| Haircut multiplier | Applied to score when below threshold | 0.5× |
| Buy zone unlock threshold | Score must reach this to activate buy zones | 65% |
| Rebalance trigger | Drift above this % triggers rebalance flag | 10% |

### 10.4 API Keys and Connections

| Connection | Status | Action |
|---|---|---|
| Sharesight API (OAuth 2.0) | Connected / Disconnected | Connect / Reconnect / Test connection |
| Financial Modelling Prep (FMP) | Key stored / Not set | Enter API key |
| Anthropic (Claude — claude-opus-4-7) | Key stored / Not set | Enter API key |
| Google AI (Gemini Pro) | Key stored / Not set | Enter API key |
| Supabase | Connected (auto on signup) | Status indicator only |
| Yahoo Finance | No key required | Status indicator only |

### 10.5 Data Refresh Settings

| Setting | Default |
|---|---|
| Live price refresh interval | Every 5 minutes during market hours (per exchange) |
| Sharesight sync frequency | Every 30 minutes |
| ATH refresh time | Daily after market close |
| FMP fundamentals refresh | Daily after market close |
| FMP refresh mode | Automatic daily / On-demand only (toggle for scalability) |
| Provider data refresh | Weekly — Wednesday |
| Announcement check frequency (Priority 2) | Twice daily per exchange schedule |
| Watchlist auto-monitoring | Off by default. Toggle on with score threshold (default 78%). |

### 10.6 Notification Settings

| Notification | Toggle | Notes |
|---|---|---|
| Buy zone entered — satellite position | On / Off | Browser + in-app |
| Buy zone entered — watchlist position | On / Off | Browser + in-app |
| Exit trigger identified | On / Off | Browser + in-app |
| Price-sensitive announcement | On / Off | Browser + in-app |
| Weekly DCA reminder (Tuesday 8am AEST) | On / Off | Browser only |
| Re-analysis recommended (90+ days) | On / Off | In-app only — manually dismissible |
| Sharesight sync failure | On / Off | In-app only |
| FMP incomplete data detected | On / Off | In-app only |
| Monthly API spend alert | On / Off | In-app only |
| API Pause active reminder | Always on | In-app banner — cannot be disabled |

### 10.7 Scoring and Analysis Settings

| Setting | Default |
|---|---|
| Re-analysis recommendation threshold | 90 days |
| Re-analysis re-fire interval after dismissal | 30 days |
| Auto-analyse price-sensitive announcements | On |
| Framework auto-suggest | On |
| Score version retention (per position) | 10 most recent |
| Manual override logging | On — cannot be disabled |
| Announcement retention (rolling, unattached) | 30 days (options: 14 / 30 / 60 / 90) |
| Catalyst attachment | Auto + manual override |
| Briefing history retention | All (options: 1yr / 2yr / 5yr / All) |
| Watchlist auto-monitoring threshold | 78% (when toggle is on) |
| Monthly API spend alert threshold | Configurable — set in Settings on first use |
| Claude model | claude-opus-4-7 (update string when new Opus 4 release available) |
| Gemini model | Latest Gemini Pro release |

### 10.8 Core ETF Management

Core ETFs are a configurable list — not a fixed schema.

| Field | Editable |
|---|---|
| Ticker | Yes — set on add. Locked once trades exist (use archive instead). |
| Name | Yes |
| Target allocation % | Yes — must sum to 100% across active ETFs |
| DCA tier schedule | Yes — Standard / GHHF / Custom |
| Gearing factor (geared ETFs only) | Yes — manual entry. Update when the fund publishes a new gearing ratio. Default: 1.5× |
| Gearing factor last updated | Display only — datestamp of last manual edit |
| Provider page URL | Yes — editable per ETF |
| Active | Yes — toggle off to archive |

**Actions:** Add new core ETF · Archive existing core ETF · Reactivate archived ETF

**Settings validation:** target allocations across active ETFs must sum to 100%. Save disabled when sum ≠ 100%. Running sum displayed during edit.

### 10.9 Satellite Position Management

- Edit target allocation override (replaces formula guidance until cleared)
- Edit score manually (override between re-analyses)
- Edit buy zones and exit triggers manually
- Archive position manually (hides from main views; if still active in Sharesight, continues to receive value updates in archived view)
- View closed/archived positions and their research history
- Manage catalyst attachments — attach or detach announcements from scorecard versions

### 10.10 Watchlist Management

- Add ticker (opens ticker search with FMP auto-fetch — supports any global exchange)
- Remove from watchlist (research history archived not deleted)
- Change asset class (triggers re-analysis)
- View archived watchlist items
- Export watchlist as CSV
- Toggle auto-monitoring per position (overrides global threshold setting)

### 10.11 Benchmark Settings

| Setting | Default |
|---|---|
| Default benchmark | VGS.AX |
| Benchmark display name | Vanguard MSCI Index International Shares ETF |
| Secondary benchmark | None (optional second line on chart) |

### 10.12 Display and Appearance

| Setting | Default |
|---|---|
| Theme | Dark (toggleable to Light) |
| Foreign currency display on position pages | Native only (toggle: "Show AUD parenthetical alongside native") |
| Buy zone alert currency | Hardcoded to native currency only — independent of display setting above |
| Price decimal places | 2 |
| Date format | DD/MM/YYYY |
| Timezone | AEST/AEDT auto |
| Chart default time period | 1Y |
| Dashboard default sort | Score descending |

### 10.13 Data Export and Backup

| Export | Format | Contents |
|---|---|---|
| Full portfolio data export | JSON | All positions, scores, buy zones, exit triggers, watchlist, settings, catalyst attachments |
| Watchlist export | CSV | Tickers, scores, key metrics, tier, date last analysed |
| Scorecard export | PDF | Individual position scorecard, research paper, attached catalyst announcements |
| Portfolio briefing export | PDF | Any saved portfolio briefing |
| DCA history | CSV | All DCA calculations with dates and amounts |
| Announcement log | CSV | All announcements (active + attached) with Triad assessments |

Backup: Supabase data is automatically backed up daily. Manual full data export recommended monthly.

### 10.14 Reset and Danger Zone

| Action | Confirmation |
|---|---|
| Reset DCA tiers to default | Yes |
| Reset all settings to default | Yes — type CONFIRM |
| Clear unattached announcement log | Yes — does not affect catalyst-attached announcements |
| Clear briefing history | Yes |
| Clear all score history | Yes — type CONFIRM |
| Disconnect Sharesight | Yes — type CONFIRM |
| Delete Supabase project data | Yes — type CONFIRM (irreversible) |

### 10.15 Exchange Management

A lookup table of supported exchanges that drives market hours detection, announcement source selection, and price refresh scheduling.

| Exchange | Market Hours (local) | Timezone | Announcement Source |
|---|---|---|---|
| ASX | 10:00am–4:00pm | AEST/AEDT | ASX announcements page |
| LSE | 8:00am–4:30pm | GMT/BST | LSE RNS |
| NYSE / NASDAQ | 9:30am–4:00pm | EST/EDT | SEC EDGAR RSS |
| TSX | 9:30am–4:00pm | EST/EDT | SEDAR (manual flag) |
| Other exchanges | — | — | Manual monitoring required — in-app flag |

Editable: new rows can be added when a position on a new exchange is first encountered. No code changes required — the pipeline reads this table dynamically.

#### Ticker Mapping Table (required — prevents suffix mismatch)

FMP and Yahoo Finance use different ticker suffixes for the same stock on the same exchange. Without a mapping table, API calls will silently fail or return data for the wrong security.

| Exchange | FMP Symbol Format | Yahoo Finance Format | Example |
|---|---|---|---|
| ASX | `TICKER` (no suffix) | `TICKER.AX` | FMP: `BHP` / Yahoo: `BHP.AX` |
| LSE | `TICKER.L` | `TICKER.L` | `DPLM.L` / `DPLM.L` |
| NYSE / NASDAQ | `TICKER` | `TICKER` | `AAPL` / `AAPL` |
| TSX | `TICKER.TO` | `TICKER.TO` | `RY.TO` / `RY.TO` |
| Euronext | `TICKER.PA` / `.AS` etc | `TICKER.PA` / `.AS` etc | Varies by country |

**Implementation rule:** When a ticker is added via the live combobox search (which locks in the FMP `symbol` and `exchangeShortName`), the app automatically derives the correct Yahoo Finance format using this mapping table. Both the FMP symbol and Yahoo Finance symbol are stored in Supabase for that position. All subsequent API calls use the correct format for each provider — there is no runtime guessing.

**Maintenance:** Add a new row to this table whenever a position on a new exchange is first added. Document the FMP and Yahoo Finance suffix conventions for that exchange.

---

## 11. Design Preferences

### Layout Priority

**Desktop-first.** Designed for a 1280px+ screen as the primary experience. Mobile is a fully functional second experience, not an afterthought.

### Aesthetic Direction

"Premium Financial" — clean typography, glassmorphism accents on key cards, subtle entrance animations via Framer Motion. Inspired by Raycast's design language: precise, minimal, functional. Avoids consumer-app polish; feels institutional.

Both dark and light mode supported. Dark mode is the default.

### Dark Mode — Primary Theme

| Element | Colour |
|---|---|
| Page background | `#0A0A0F` |
| Surface 1 (cards, panels) | `#111118` |
| Surface 2 (inputs, nested cards) | `#1A1A24` |
| Surface 3 (hover states, active rows) | `#22222F` |
| Border — subtle | `rgba(255,255,255,0.06)` |
| Border — strong | `rgba(255,255,255,0.12)` |
| Glassmorphism overlay | `rgba(255,255,255,0.04)` with 12px backdrop blur |
| Text — primary | `#F0F0F8` |
| Text — secondary | `#9090A8` |
| Text — tertiary | `#505068` |
| Accent — primary | `#4DB8FF` |
| Accent — primary hover | `#79CBFF` |
| Green (positive, buy, qualifying) | `#22C55E` |
| Amber (warning, haircut, watch) | `#F59E0B` |
| Red (exit, sell, avoid) | `#EF4444` |

### Light Mode — Secondary Theme

| Element | Colour |
|---|---|
| Page background | `#F4F4F8` |
| Surface 1 | `#FFFFFF` |
| Surface 2 | `#F0F0F5` |
| Surface 3 | `#E8E8F0` |
| Text — primary | `#0A0A1A` |
| Text — secondary | `#50507A` |
| Accent — primary | `#1A8FD1` |

### Typography

| Element | Font | Size | Weight |
|---|---|---|---|
| Page titles | DM Sans | 22px | 600 |
| Section headers | DM Sans | 14px | 600 |
| Body text | DM Sans | 14px | 400 |
| Data labels | DM Sans | 10px | 500 — uppercase |
| Numbers / prices | DM Mono | 14–20px | 500 |
| Large score display | DM Mono | 32–52px | 700 |
| Code / tickers | DM Mono | 13px | 500 |

Monospace font (DM Mono) used for all numbers, prices, percentages, and tickers.

### Component Library

- Tailwind CSS — utility classes
- Shadcn/UI — primitives (buttons, dialogs, dropdowns, tooltips)
- Framer Motion — premium animations and entrance transitions
- Lucide React — iconography
- Recharts — charts and data visualisations

### Desktop Layout

- Fixed sidebar navigation — 210px wide — always visible
- Main content area fills remaining width
- Maximum content width: 1200px — centred on large screens
- Cards and panels use a grid system — 2 or 3 columns on desktop
- Data tables full-width with horizontal scroll on overflow
- Detail panels open inline (not in modals) — slide in from the right

### Mobile Layout

- Sidebar collapses to a bottom navigation bar (5 items)
- Single column layout throughout
- Tables collapse to card format on small screens
- Detail panels open as full-screen overlays
- Touch-friendly tap targets (minimum 44px)
- Swipeable chart time periods

### Breakpoints

| Breakpoint | Layout |
|---|---|
| < 768px | Mobile — single column, bottom nav |
| 768–1024px | Tablet — sidebar collapses, 2-column grid |
| 1024px+ | Desktop — full sidebar, 2–3 column grid |

### Component Design Language

**Cards:** subtle border, 10–12px border radius, optional glassmorphism on key dashboard cards, 16px standard padding, border brightens on hover, border changes to accent colour when active/selected.

**Score display:** circular progress ring (SVG — animated on load via Framer Motion). Colour transitions: green ≥75% → light green 65–74% → amber 50–64% → red <50%. Large DM Mono number centred in ring.

**Charts (Recharts):** minimal gridlines, smooth curves, dark/light tooltips, toggleable legend below chart, accent blue for primary line.

**Alerts:** full-width banner below health bar, colour-coded 4px left border, dismiss button, stack vertically if multiple, animate in via Framer Motion.

**Loading states:** skeleton loaders — never blank white space. Price fields show last known value with "updating..." indicator. Never spinner on whole page.

### Spacing System

| Token | Value | Use |
|---|---|---|
| space-1 | 4px | Tight inline gaps |
| space-2 | 8px | Between related elements |
| space-3 | 12px | Card internal padding (compact) |
| space-4 | 16px | Card internal padding (standard) |
| space-5 | 20px | Between cards |
| space-6 | 24px | Page padding |
| space-8 | 32px | Section separation |

### Animation and Motion (Framer Motion)

- Page transitions: fade in (0.15s)
- Card hover: border colour transition (0.15s)
- Score ring: stroke-dasharray animation on load (0.4s ease)
- Alert entry: slide down + fade in (0.2s)
- Briefing CTA: subtle pulse on hover
- No bouncy or springy animations — financial tool, not consumer app

### Accent Colour Usage

Light blue (`#4DB8FF`) used sparingly: active navigation item, primary buttons, links, live price indicator, selected card border, chart primary line, focus rings on inputs.

---

## 12. Nice to Haves

Ranked 1–5 by importance (1 = highest priority).

### Priority 1 — Must have soon after launch

- **Portfolio value chart over time** — non-negotiable
- **PDF export** — scorecard and research paper as formatted PDF including catalyst attachments
- **Mobile experience (responsive)** — must be fully usable on iPhone
- **Web deployment via Vercel** — deploy from day one. Free tier sufficient. Auto-deploy on git push.

### Priority 2 — High value, build in first major update

- **Announcement monitoring with catalyst-aware retention** — twice daily polling per exchange schedule, 30-day rolling retention, permanent for catalyst-attached
- **Historical score tracking chart** — per position, score over time across all versions, dots clickable to open that version's scorecard, markers for catalyst attachments
- **Side-by-side position comparison** — any two positions, columns: score, section scores, key metrics, allocation, buy zone status, days since analysis
- **Browser notifications (full mobile)** — service worker + Firebase Cloud Messaging for true push notifications
- **Announcement log** — searchable and filterable across all positions, exportable as CSV

### Priority 3 — Meaningful but not urgent

- **Weekly portfolio summary email** — optional, plain text, sent Sunday evening (AEST), toggle in Settings
- **Gain/loss breakdown by position** — per position total return including unrealised + realised + income, from Sharesight
- **DCA history log** — record of every DCA execution from Sharesight trade history, filterable, exportable as CSV

### Priority 4 — Good to have eventually

- **Sector and geographic exposure** — aggregate across all holdings, account for gearing, pie/donut chart
- **Franking credit tracker** — from Sharesight, useful at tax time
- **Custom price alerts (watchlist)** — set custom price alert independent of buy zone system, in native currency
- **Portfolio stress test** — apply user-defined % decline, show resulting values, allocation changes, DCA tier activations
- **Maximum position cap (when satellite grows)** — reactivates position concentration limit when satellite holds many positions

### Priority 5 — Future consideration

- **IBKR integration** — primary vehicle for accessing markets beyond ASX and LSE. Pull positions, trades, values, cash automatically via IBKR API. Merge with existing satellite portfolio view.
- **Options tracking (if IBKR opened)** — basic options position tracking: underlying, strike, expiry, current value, P&L
- **Tax year summary report** — annual report for Australian financial year (July–June): realised gains/losses, income, franking credits, foreign income. From Sharesight. Exportable as PDF.
- **Alternative asset / PE tracking** — track committed capital, called capital, DPI, TVPI, IRR, PME. Manual entry.
- **News feed integration** — aggregated news feed for held and watched positions. Low priority unless a free or sufficiently cheap source is identified. May be redundant given Triad already gathers news for analysis and briefings.

---

## 13. Build Approach

### Decision: Cursor IDE + Claude (Thinker) + Gemini (Researcher) — Triad Architecture

V4 uses a developer-first stack centred on Cursor IDE. The core principle: separate research breadth (Gemini) from reasoning depth (Claude) and use FMP for structured numerical accuracy. This gives full code ownership and avoids platform lock-in.

### The Triad — Researcher, Thinker, Builder

#### Researcher — Gemini Pro / Flash

- **Role:** Web-scale data extraction and sentiment gathering
- **Tasks:** Scours 10-Ks, earnings transcripts, news, social sentiment, exchange announcements
- **Output:** Structured JSON research summaries cached in Supabase — pre-distilled for Claude consumption. Claude never reads raw source documents.
- **Model tiering:** Use Gemini Pro for full deep-research runs. Use Gemini Flash for lightweight triage tasks (quick announcement checks, price lookups, earnings date confirmation) — significantly lower token consumption for high-frequency low-complexity calls.

#### Thinker — Claude (`claude-opus-4-7`)

- **Role:** High-level logical analysis and synthesis
- **Tasks:** Ingests Gemini's pre-distilled JSON output + FMP numbers. Performs DCF modelling, risk assessment, scorecard generation, thesis writing, briefing synthesis.
- **Context:** Operates within Cursor using project-wide context for logic consistency
- **Reserved exclusively for high-value reasoning** — never used for data retrieval or raw document reading

#### Builder — Cursor IDE

- **Role:** Code implementation and UI/UX refinement
- **Tasks:** Converts Claude's logic into functional components. Manages the visual design system.
- Full code ownership via local file management — no platform lock-in
- Auto-deploys to Vercel on git push

### Why This Approach

- **Efficiency:** Triad separates token-heavy research (Gemini) from token-expensive reasoning (Claude) — each model used only where it has a structural advantage
- **Accuracy:** Three-way separation of concerns — Gemini for breadth, FMP for structured numerical precision, Claude for synthesis
- **Ownership:** Full local code ownership in Cursor — no platform lock-in
- **Flexibility:** Direct access to all components, easy to extend or refactor
- **Trade-off:** More hands-on developer workflow than a scaffold-first model. Claude in Cursor accelerates this significantly.

### CLAUDE.md Project File

A `CLAUDE.md` file lives in the project root and serves as the persistent rule book for Claude when invoked from Cursor. It contains:

- Project overview and Triad architecture summary
- Design tokens (colours, typography, spacing — sourced from Section 11)
- Architectural conventions (file structure, naming, state management patterns)
- Key business rules: DCA 0× rule, allocation engine formula, scoring thresholds, catalyst attachment rules
- Triad integration patterns (how Gemini JSON is consumed by Claude)
- Forbidden patterns: no localStorage, never commit secrets, no hardcoded ETF count, Claude never reads raw source documents
- Testing expectations and conventions

Updated by hand as the project evolves. Claude reads it as part of every session in Cursor.

### Workflow

1. Set up Cursor project with React + Vite + Tailwind + Shadcn/UI scaffold
2. Initialise Supabase project, schema, and connection
3. Create `CLAUDE.md` with project rules and design tokens
4. Build core scaffolding — routing, navigation, base components
5. Implement modules one at a time (Sharesight integration first — it is the foundation for everything else)
6. For each module: Gemini researches → Claude designs the implementation → Cursor builds it
7. Push to GitHub; auto-deploy via Vercel
8. Iterate using Cursor's design mode for UI polish

### Modules Requiring Claude Refinement (in Cursor)

- Scoring frameworks (5 frameworks with item-level structure)
- DCA tier engine with editable schedules and 0× rule
- Allocation engine (score-weighted guidance, haircut logic, manual override)
- Sharesight OAuth flow and data sync — including token refresh and broker cash extraction
- Exchange management pipeline (market hours lookup, announcement source routing, FX conversion)
- Triad orchestration (Gemini research → cache → Claude synthesis pipeline)
- Portfolio briefing generation (Triad)
- Announcement monitoring with catalyst-aware retention (Priority 2)
- Provider data scraping with mitigation strategy
- API spend tracker

**Model strings:**
- Claude API calls: `claude-opus-4-7` (update to latest Opus 4 release when available)
- Gemini API calls: latest Gemini Pro/Flash release

### Cost Optimisation Strategy

API costs scale with token volume. The Triad architecture is designed to minimise token consumption at every layer. The following implementation rules must be followed.

#### 1. Gemini handles all raw document reading — Claude never sees raw source material

- Gemini reads full 10-Ks, earnings transcripts, news articles, and announcement PDFs in their entirety
- Claude receives only Gemini's distilled output — a structured JSON summary — never the source documents
- **This is the single highest-impact cost control in the entire architecture.** Violating it multiplies Claude token consumption by an order of magnitude.

#### 2. Gemini output must always be structured JSON

- Gemini is always prompted to return structured JSON — never free-form prose
- JSON is more token-efficient than prose: shorter, no filler, no formatting
- JSON schema defined per task type (stock research, announcement triage, sector context, etc.) and stored in `CLAUDE.md`
- Claude's prompt references the JSON schema so it knows exactly what fields to expect — no schema inference required
- Example: a Gemini research summary is a JSON object with defined fields (`thesis_summary`, `key_risks`, `recent_developments`, `financials_commentary`, `sentiment`) — Claude reads this compact object, not a multi-page prose report

#### 3. Prompt caching for static context

- The Anthropic API supports prompt caching — content Claude has already processed in a recent session is cached and costs a fraction of the standard input rate to re-read
- Mark the following as cacheable in every Claude API call: `CLAUDE.md` project rules, the active scoring framework definition, the position's existing scorecard (when re-analysing)
- These are large, static blocks sent with every analysis call — caching them dramatically reduces the effective input token cost for repeated analysis sessions
- Implementation: use the `cache_control` parameter on the system prompt and any large static document blocks

#### 4. Tiered Gemini model usage

- Not all Gemini tasks require Gemini Pro. Use the cheapest model sufficient for the task.
- **Gemini Pro:** full deep-research runs — reading 10-Ks, synthesising earnings transcripts, generating comprehensive research JSON
- **Gemini Flash:** lightweight triage tasks — checking if a new announcement is price-sensitive, confirming earnings dates, quick sentiment scan, announcement headline classification
- The distinction matters most for announcement monitoring (Priority 2), which runs twice daily across all monitored positions
- Route by task type in the orchestration layer — task type is always known before the call is made

#### 5. Supabase caching of Gemini research artefacts

- Every Gemini research JSON is saved to Supabase immediately on generation, keyed by `ticker + date`
- Before triggering a new Gemini research run, the app checks Supabase for a cached artefact less than N days old (configurable — default 7 days for full research, 1 day for announcement triage)
- If a valid cached artefact exists, it is passed directly to Claude — no new Gemini call made
- Eliminates redundant Gemini calls when position detail pages are opened multiple times or briefing is run within a short window

#### 6. FMP data cached in Supabase — never fetched per page load

- FMP fundamentals are fetched once daily (or on demand) and cached in Supabase
- All app views read from the Supabase cache — no live FMP calls on page load
- Keeps FMP usage well within the free tier limit regardless of how many times pages are opened

#### 7. CLAUDE.md as the single source of business rules

- All business rules — scoring thresholds, DCA tier logic, allocation formula, catalyst attachment rules, prompt templates — are defined once in `CLAUDE.md`
- Rules are never duplicated across prompts — duplication means larger prompts and higher token counts
- When a rule changes, update `CLAUDE.md` once — it propagates everywhere

#### 8. On-demand Claude analysis only — no background AI polling

- Claude is never called on a schedule or in the background — only when triggered by a user action or a Gemini triage result that flags material content
- Gemini announcement triage (Priority 2) runs on the schedule; Claude analysis runs only if Gemini classifies an announcement as price-sensitive or material
- The vast majority of twice-daily polling cycles consume only lightweight Gemini Flash tokens — Claude is reserved for the subset that warrants deep analysis

#### 9. Research logs table — short-term Gemini output cache for debugging

Create a `research_logs` table in Supabase with the following fields: `timestamp`, `ticker`, `raw_gemini_json`, `claude_synthesis_status` (success / failed / pending).

**Before passing data to Claude for final synthesis, save the raw Gemini research output to `research_logs`.**

If the Claude API call fails, the user refreshes, or a bug occurs during development, the app checks `research_logs` first — if a Gemini artefact for the same ticker exists within the last hour, it is reused directly rather than triggering a new Gemini research call. This short-term cache prevents paying for repeated Gemini research runs during debugging.

This is separate from the longer-term Supabase Gemini artefact cache (keyed by `ticker + date`, configurable retention). The `research_logs` table is a transient safety net specifically for in-session failures.

| Service | Tier |
|---|---|
| Cursor IDE | Pro plan |
| Supabase | Free tier |
| Vercel | Free tier |
| GitHub | Free |
| Anthropic API (Claude — `claude-opus-4-7`) | Pay-as-you-go |
| Google AI (Gemini Pro + Flash) | Pay-as-you-go |
| FMP | Free tier (250 calls/day) |
| Yahoo Finance | Free (no key required) |
| Sharesight | Existing Standard plan |
| Resend (optional weekly email) | Free tier |

---

## 14. GitHub & Vercel Security Setup

**This section must be completed before the first `git push`. Do this during initial Cursor project setup, before Module 1 begins.**

### .gitignore — Prevent accidental secret commits

Create a `.gitignore` file in the project root with the following contents:

```
# Environment variables — NEVER commit these
.env
.env.local
.env.*.local

# Dependencies
node_modules/
package-lock.json
yarn.lock

# OS
.DS_Store
.vscode/

# Build output
dist/
build/
.next/
out/

# Logs
*.log
npm-debug.log*

# IDE
.idea/
*.swp
*.swo
```

**Verification:** Run `git status` before any commit. Your `.env` file should appear as "untracked files not staged for commit" — NOT staged. If it shows as "Changes to be committed", you have a `.gitignore` problem.

### Local development — .env file

Create a `.env.local` file in the project root (Cursor can do this in the setup step):

```
# Sharesight OAuth — Development (localhost:3000)
SHARESIGHT_CLIENT_ID_DEV=your_dev_client_id_here
SHARESIGHT_CLIENT_SECRET_DEV=your_dev_client_secret_here
VITE_SHARESIGHT_PORTFOLIO_UUID_CORE=your_core_portfolio_uuid
VITE_SHARESIGHT_PORTFOLIO_UUID_SATELLITE=your_satellite_portfolio_uuid

# Sharesight OAuth — Production (Vercel)
SHARESIGHT_CLIENT_ID_PROD=your_prod_client_id_here
SHARESIGHT_CLIENT_SECRET_PROD=your_prod_client_secret_here

# API Keys
ANTHROPIC_API_KEY=sk-ant-...
GEMINI_API_KEY=AIzaSy...
FMP_API_KEY=your_fmp_key_here

# Environment
APP_ENV=development
NEXT_PUBLIC_APP_URL=http://localhost:3000
```

**Important:**
- `.env.local` is gitignored — it will never be committed
- Do NOT commit this file to GitHub
- Fill in your actual API keys and credentials in `.env.local` — this is your personal copy only
- Each developer/machine has their own `.env.local` with their own API keys

### Vercel deployment — Environment variables

After you link your GitHub repository to Vercel:

1. Go to your Vercel project dashboard → Settings → Environment Variables
2. Add each variable for **production** deployment:

| Variable | Value | Scope |
|---|---|---|
| `SHARESIGHT_CLIENT_ID_PROD` | Your Prod Sharesight client ID | Production |
| `SHARESIGHT_CLIENT_SECRET_PROD` | Your Prod Sharesight client secret | Production |
| `VITE_SHARESIGHT_PORTFOLIO_UUID_CORE` | Your Core portfolio UUID | Production |
| `VITE_SHARESIGHT_PORTFOLIO_UUID_SATELLITE` | Your Satellite portfolio UUID | Production |
| `ANTHROPIC_API_KEY` | Your Anthropic API key | Production |
| `GEMINI_API_KEY` | Your Gemini API key | Production |
| `FMP_API_KEY` | Your FMP API key | Production |
| `APP_ENV` | `production` | Production |
| `NEXT_PUBLIC_APP_URL` | Your Vercel production URL | Production |

**Do NOT add `DEV` credentials to Vercel** — only production credentials. Vercel injects these at build time. Your code reads `process.env.APP_ENV` to determine which pair of Sharesight credentials to use.

### Code pattern — Accessing environment variables

In your Cursor code, access secrets like this:

```javascript
const getSharesightCredentials = () => {
  const env = process.env.APP_ENV || 'development';
  
  if (env === 'production') {
    return {
      clientId: process.env.SHARESIGHT_CLIENT_ID_PROD,
      clientSecret: process.env.SHARESIGHT_CLIENT_SECRET_PROD,
    };
  }
  
  return {
    clientId: process.env.SHARESIGHT_CLIENT_ID_DEV,
    clientSecret: process.env.SHARESIGHT_CLIENT_SECRET_DEV,
  };
};
```

**Never do this:**
```javascript
// ❌ WRONG — hardcoded secret
const clientId = 'abc123xyz';

// ❌ WRONG — secret in config file
export const config = {
  sharesightClientId: 'abc123xyz',
};
```

Always use `process.env.VARIABLE_NAME` instead.

### Pre-push security checklist

Before your first `git push`, run this checklist:

- [ ] `.gitignore` file exists in project root and includes `.env*` patterns
- [ ] `.env.local` file exists and is **not staged** for commit (`git status` shows it as untracked)
- [ ] No API keys appear anywhere in source code (search codebase for `sk-ant-`, `AIzaSy`, any FMP keys)
- [ ] All secrets are accessed via `process.env.VARIABLE_NAME` only
- [ ] Vercel dashboard has environment variables configured for production
- [ ] `git log --all --pretty=format:"%H %s"` shows no commits containing API keys (run before first push as a final check)
- [ ] Ran `git push` with `--dry-run` first to verify nothing sensitive is about to be committed: `git push --dry-run origin main`

If any check fails, fix it before pushing. Once a secret is committed to GitHub, it's compromised — rotate the API key immediately, even if you delete the commit later.

---

## 15. Pre-Build Checklist

### Account Registrations

- [ ] Sharesight — confirm Standard plan + register **two** OAuth apps via developer portal (one for `localhost:3000`, one for Vercel production URL). Retrieve `portfolio_id` UUIDs for Core and Satellite portfolios.
- [ ] (Optional) Set up ngrok or Cloudflare Tunnel for mobile testing during development — register tunnel URL as a third Sharesight OAuth Redirect URI
- [ ] Anthropic — register at console.anthropic.com, generate API key (model: `claude-opus-4-7`)
- [ ] Google AI — register at ai.google.dev, generate Gemini API key (latest Pro + Flash)
- [ ] Financial Modelling Prep — register free at financialmodelingprep.com, generate API key
- [ ] Supabase — register free at supabase.com, create new project
- [ ] Vercel — register free at vercel.com, link GitHub for auto-deploy
- [ ] Resend (optional, for weekly email) — register free at resend.com
- [ ] Cursor — install IDE, register Pro plan
- [ ] GitHub — register/use existing account for code repository

### Data Verification

- [ ] Test FMP coverage for current holdings: PME, PGA1, XRF, HSN, MP1, DPLM
- [ ] Test FMP coverage for research candidates: HUB, TNE, DE, ROP, CSU, HACK, CFLO
- [ ] Document any positions with incomplete fundamental data (manual entry fallback for those fields)
- [ ] Confirm Sharesight portfolio names exactly as they appear in your account
- [ ] Confirm Sharesight historical data depth available via API
- [ ] Confirm Sharesight rate limits are sufficient for personal use
- [ ] Confirm Sharesight API exposes broker cash balances for each broker account
- [ ] Confirm Sharesight OAuth access token lifetime and test refresh token flow before build
- [ ] Before adding any position on a new exchange for the first time — test FMP ticker lookup and fundamentals coverage. Add exchange to Section 10.15.

### Technical Verifications

- [ ] Verify SEC EDGAR RSS feed endpoint for US-listed position announcement monitoring
- [ ] Verify `yahoo-finance2` npm package covers all required data types: live prices, FX rates, ATH (full history), 52-week range, benchmark historical data
- [ ] Verify FMP `/quote` and `/fx` endpoints as secondary price/FX fallback when Yahoo Finance is unavailable
- [ ] Confirm FMP market hours endpoint is available on free tier (or build static table fallback)
- [ ] Test Claude API access (`claude-opus-4-7`) with a sample scorecard and research paper prompt
- [ ] Test Gemini Pro API access with a sample research extraction prompt (JSON output)
- [ ] Test Gemini Flash API access with a sample triage prompt (JSON output)
- [ ] Test Triad handoff: confirm Gemini output JSON can be cleanly consumed by Claude with no data loss
- [ ] Verify Cursor + Claude project context handling with a test `CLAUDE.md` file
- [ ] Verify FMP ticker search endpoint returns `symbol` and `exchangeShortName` — required for live combobox
- [ ] Build and verify ticker mapping table (Section 10.15) for ASX and LSE before first build module — test that Yahoo Finance suffix is correctly derived from FMP `exchangeShortName`
- [ ] Create `research_logs` table in Supabase schema with fields: `timestamp`, `ticker`, `raw_gemini_json`, `claude_synthesis_status`
- [ ] Enable Row Level Security (RLS) on all Supabase tables during schema initialisation — do not retrofit later
- [ ] Confirm Supabase RLS policies restrict all read/write to authenticated `user_id`

### Spec Verification (V4 — confirmed)

- [x] Storage architecture: Supabase confirmed
- [x] Build approach: Cursor IDE + Claude (Thinker) + Gemini (Researcher) confirmed
- [x] Layout priority: Desktop-first, mobile responsive confirmed
- [x] Announcement monitoring: Priority 2, satellite-only automated by default, optional watchlist auto-monitor for ≥78% scores, catalyst-aware 30-day retention
- [x] Watchlist: starts empty, manual addition only
- [x] Exchange scope: any global exchange supported
- [x] Claude model: `claude-opus-4-7`
- [x] Gemini models: Pro for deep research, Flash for triage
- [x] DCA base amount: A$350
- [x] 0× tier rule: applies to all core ETFs at 0–1.5% from ATH; allocation forfeited (not redistributed)
- [x] Rebalance trigger: >10% drift
- [x] Allocation engine: score-weighted guidance, no hard cap (reserved for future), full manual override available
- [x] Core ETF list: configurable, not fixed (add/archive/reactivate via Settings 10.8)
- [x] Cash tracking: broker cash via Sharesight + single external manual entry
- [x] Catalyst-aware announcement retention: 30 days unattached, permanent if attached to scorecard version
- [x] Re-analysis re-fire control: 30-day cooldown after dismissal
- [x] New position safeguard: buy zone alerts suppressed until first scorecard
- [x] API spend alert: soft alert at configurable threshold, no hard cap
- [x] Gemini output format: always structured JSON, schema defined in CLAUDE.md
- [x] Prompt caching: implemented for CLAUDE.md, scoring frameworks, and existing scorecards
- [x] No costs in spec: cost figures removed, cost optimisation strategy substituted
- [x] Sharesight OAuth: two apps registered (localhost + Vercel), portfolio UUIDs retrieved and stored
- [x] Yahoo Finance: using `yahoo-finance2` library (not raw scraping), FMP as secondary price/FX fallback
- [x] Ticker search: live FMP combobox with symbol + exchangeShortName lock-in, ticker mapping table in 10.15
- [x] Gearing: manual input only — no provider scraping
- [x] Supabase RLS: enabled on all tables from day one
- [x] Version history: lazy loading — active version only on page load, older versions fetched on demand
- [x] Research logs table: `research_logs` table in Supabase for short-term Gemini output cache
- [x] API kill-switch: Global API Pause toggle in Settings 10.16

### 10.16 API Pause (Kill-Switch)

A global toggle in Settings that immediately suspends all outbound calls to the Anthropic API and Google Gemini API. FMP and Yahoo Finance price fetching continues unaffected.

| Setting | Default | Effect when enabled |
|---|---|---|
| Global API Pause | Off | No Claude or Gemini API calls made from any part of the app. Analysis buttons disabled. Briefing generation disabled. Announcement triage paused. Existing cached data still displayed normally. |

**Purpose:** Prevents runaway API spend in the event of a recursive re-analysis bug, a loop condition during development, or any scenario where you want to immediately stop all AI API activity without touching the code.

**Behaviour:**
- Toggle is prominently visible in Settings — not buried
- When enabled, all Claude and Gemini API call sites check this flag before executing and silently skip the call
- In-app banner shown when pause is active: "API Pause is enabled — analysis and briefing generation are suspended"
- Does not affect Sharesight sync, Yahoo Finance prices, or FMP fundamentals
- Toggle off to resume immediately — no restart required

- [ ] Project overview and Triad architecture summary
- [ ] Design tokens (Section 11) — colours, typography, spacing
- [ ] Component library list (Tailwind, Shadcn/UI, Framer Motion, Lucide, Recharts)
- [ ] Business rules: DCA 0× rule, allocation formula, scoring thresholds, catalyst attachment
- [ ] Gemini JSON schemas per task type (stock research, announcement triage, sector context)
- [ ] Triad integration: Gemini → Supabase cache → Claude consumption pattern
- [ ] Prompt caching implementation: `cache_control` on system prompt and static document blocks
- [ ] Ticker mapping table: FMP symbol format vs Yahoo Finance format per exchange (Section 10.15)
- [ ] Supabase table schemas including `research_logs` (fields: timestamp, ticker, raw_gemini_json, claude_synthesis_status)
- [ ] API Pause flag: all Claude and Gemini call sites must check `global_api_pause` flag before executing
- [ ] Forbidden patterns: no localStorage, no committed secrets, no hardcoded ETF count, Claude never reads raw source documents, never scrape Yahoo Finance HTML directly (use `yahoo-finance2`)
- [ ] Testing expectations and conventions

### Ready to Begin

Once all items above are complete, the build can begin.

**Module build order:**
1. Sharesight integration (foundation for everything else — portfolio data, broker cash, trade history). Includes: dual OAuth app setup, portfolio UUID configuration, token refresh flow.
2. Supabase schema initialisation — all tables with RLS enabled, including `research_logs`
3. DCA engine (core ETF list from Settings 10.8, tier schedules, 0× rule, live price integration via `yahoo-finance2`)
4. Satellite / scoring (allocation engine, scoring frameworks, position detail page, lazy version loading)
5. Dashboard (health bar, alerts, chart, DCA widget, balance snapshot)
6. Watchlist (live combobox ticker search with FMP, ticker mapping, scoring, version history)
7. Portfolio briefing (Triad orchestration, Gemini JSON → research_logs → Claude synthesis)
8. Settings and admin (all configuration surfaces including API Pause toggle in 10.16)
9. Announcement monitoring (Priority 2 — after core app is stable)

---

*Investment App Framework V4 · Last updated May 2026 · Incorporates Gemini technical review*

# Investment App — `CLAUDE.md`

Persistent rules for Claude (Thinker) when working in Cursor on this repository. Align all implementation with **`INVESTMENT_APP_FRAMEWORK_V6.md`** in the project root (authoritative product spec).

---

## 1. Project overview and Triad architecture

### What this app is

A **personal**, **desktop-first** portfolio management web app:

- **Sharesight API** is the source of truth for holdings, valuations, trades, performance, distributions, gains, and **broker cash** (Core + Satellite portfolios). Use **portfolio UUIDs**, never portfolio names, in API calls.
- **Supabase (PostgreSQL)** stores scores, scorecards/research versions, manual overrides, watchlist, settings, external (non-broker) cash, briefings, Gemini artefacts, announcements (with catalyst rules), exports metadata, spend tracking, etc. **Enable RLS on every table from day one** with policies scoped to `auth.uid()` / `user_id`.
- **Yahoo Finance** via **`yahoo-finance2`** supplies live quotes, FX, ATH/history where needed, benchmark series. **FMP** supplies fundamentals and ticker search (`symbol` + `exchangeShortName` lock-in). FMP/YahooFallback when Yahoo fails.
- **AUD** is the base portfolio currency; **FX is for valuation display only**. **Buy zones and price alerts** compare **native currency only**.

### Triad roles

| Role | Tool / model | Responsibility |
|------|----------------|----------------|
| **Researcher** | **Gemini** (Pro for deep research, Flash for lightweight triage) | Web-scale ingestion: filings, transcripts, news, announcements, sentiment. Output is **structured JSON only** — never optimised for Claude to read prose docs end-to-end. |
| **Thinker** | **Claude** (`claude-opus-4-7` or successor Opus) | Reasoning on **Gemini JSON + FMP numbers + app state**. Scorecards, thesis, briefing synthesis, allocation/scoring interpretations. **Does not ingest raw regulatory PDFs/HTML dumps.** |
| **Builder** | **Cursor IDE** | Implements React+Vite UI, integrations, caching, orchestration — this codebase. |

**Cost/control principle:** Gemini carries token-heavy breadth; Claude carries high-value synthesis; **FMP/fundamentals cached in DB** — not fetched per passive page load; **Gemini artefacts cached** in Supabase with freshness rules (spec: e.g. default 7 days full research, 1 day triage — tune in app config).

---

## 2. Design tokens (Section 11)

Map these into Tailwind theme extensions / CSS variables. **Default theme: dark.**

### Colours — dark mode (primary)

| Token / use | Hex |
|-------------|-----|
| Page background | `#0A0A0F` |
| Surface 1 (cards, panels) | `#111118` |
| Surface 2 (inputs, nested) | `#1A1A24` |
| Surface 3 (hover, active rows) | `#22222F` |
| Border subtle | `rgba(255,255,255,0.06)` |
| Border strong | `rgba(255,255,255,0.12)` |
| Glass overlay | `rgba(255,255,255,0.04)` + **12px** backdrop blur |
| Text primary | `#F0F0F8` |
| Text secondary | `#9090A8` |
| Text tertiary | `#505068` |
| Accent primary | `#4DB8FF` |
| Accent primary hover | `#79CBFF` |
| Positive / buy / qualify | `#22C55E` |
| Warning / haircut / watch | `#F59E0B` |
| Exit / avoid / danger | `#EF4444` |

### Colours — light mode (secondary)

| Token / use | Hex |
|-------------|-----|
| Page background | `#F4F4F8` |
| Surface 1 | `#FFFFFF` |
| Surface 2 | `#F0F0F5` |
| Surface 3 | `#E8E8F0` |
| Text primary | `#0A0A1A` |
| Text secondary | `#50507A` |
| Accent primary | `#1A8FD1` |

Use accent **sparingly**: active nav, primary buttons, links, live price indicator, selected card border, chart primary line, focus rings.

### Typography

**Fonts:** **DM Sans** (UI), **DM Mono** (all numbers, prices, percentages, tickers).

| Role | Font | Size | Weight |
|------|------|------|--------|
| Page titles | DM Sans | 22px | 600 |
| Section headers | DM Sans | 14px | 600 |
| Body | DM Sans | 14px | 400 |
| Data labels | DM Sans | 10px | 500, uppercase |
| Numbers / prices | DM Mono | 14–20px | 500 |
| Large score | DM Mono | 32–52px | 700 |
| Tickers / code-like | DM Mono | 13px | 500 |

### Spacing system

| Token | Value | Typical use |
|-------|-------|--------------|
| space-1 | 4px | Tight inline gaps |
| space-2 | 8px | Related elements |
| space-3 | 12px | Compact card padding |
| space-4 | 16px | Standard card padding |
| space-5 | 20px | Between cards |
| space-6 | 24px | Page padding |
| space-8 | 32px | Section separation |

### Layout / breakpoints / motion

- **Desktop-first:** sidebar **210px**, max content width **1200px** centred on large screens.
- **Breakpoints:** `<768px` mobile (bottom nav); `768–1024px` tablet; `≥1024px` desktop sidebar.
- **Motion (Framer Motion):** restrained — fade **0.15s**, card hover border **0.15s**, score ring load **~0.4s ease**, alert slide+fade **0.2s** — avoid bouncy/springy consumer animations.

---

## 3. Component library

Use consistently across the UI:

| Library | Purpose |
|---------|---------|
| **Tailwind CSS** | Utility styling; compose with tokens above |
| **Shadcn/UI** | Primitives — buttons, dialogs, dropdowns, tooltips, forms |
| **Framer Motion** | Page/card/alert transitions; score ring animation |
| **Lucide React** | Icons |
| **Recharts** | Portfolio and score history charts |

**UI patterns:** glassmorphism on key dashboard cards optional; skeleton loaders (no blank flashes); alerts as full-width banners with **4px** left accent border.

---

## 4. Business rules (non-negotiable)

### Core / Satellite

- Target split default **72% core / 28% satellite** (editable in Settings).
- **Rebalancing** uses **present value** of core vs satellite **excluding cash**. Instruction: move **$X** core↔satellite; **does not** add/remove money.
- **Book value** split is **display only** — never used in rebalance math.

### DCA (core ETFs)

- **Base weekly amount** default **A$350** (editable).
- **Per-ETF weekly** = `base_weekly × (ETF target % of core) × tier_multiplier`.
- **0× tier (all schedules):** if distance from ATH is **0–1.5%**, multiplier **0** — that ETF’s **share of the base is forfeited**; **do not redistribute** to other ETFs.
- **ATH** from Yahoo full history; refresh **daily** after close (per spec).
- Tier tables: **Standard** and **GHHF** schedules as in spec Section 3; **Custom** schedules editable in Settings.
- **Execution day** Tuesday is **guidance only** — not enforced.
- **Core ETF list** is **configurable** (add/archive); active targets must **sum to 100%**; **no hardcoded ETF count** in code paths.

### True exposure (geared ETFs)

- **Gearing factor** is **manual** in Settings (default **1.5×** if unset until user enters).
- `true_exposure_within_core ≈ allocation × gearing_factor` (informational; **does not** change DCA math).

### Satellite allocation engine (guidance only)

Haircut threshold default **65%**; unlock buy zones **score ≥ 65%**.

```
adjusted_score = raw_score × 0.5   if raw_score < 65%
adjusted_score = raw_score × 1.0   if raw_score ≥ 65%

raw_weight = adjusted_score
target_allocation_pct = (raw_weight / sum(all raw_weights)) × 100   over satellite positions
```

- Targets **always sum to 100%** across satellite positions.
- **Manual target override** supported; overrides **logged**; remaining positions normalize to **`100% − Σ overrides`** per spec.
- **Rebalance trigger:** actual vs target drift **>** **10%** (informational / flag behaviour per product).
- **Max position cap:** off by default (future).

### Scoring frameworks and thresholds

- Five frameworks per spec (**Regular stocks**, **Thematic ETFs**, **Fund managers/LICs**, **Speculative**, **Alts/PE**) with scales and tiers as documented.
- **Universal rules:** buy zone unlock **≥ 65%**; haircut **< 65%** ⇒ **0.5×** weight in allocation formula; **high conviction ≥ 78%**; **manual item overrides logged** with date/note; **every re-analysis = new version**; default **10** versions retained per position (configurable).

### Buy zones / exit triggers / alerts

- Up to **3** buy zones; **always native currency**.
- Buy zone alerts: **native price** vs zones; **FX cannot trigger**; **suppressed** until **first scorecard exists** AND **score ≥ 65%** for monitoring (spec: suppress buy zone alerts until scorecard generated and score threshold — preserve product wording in UI copy).
- Exit triggers: prominent alerts; manual confirmation culture in spec.

### New satellite position without research

If Sharesight shows a holding with no scorecard/research: create record, **“Awaiting analysis”**, **framework auto-suggest on first open**; **suppress buy zones/exit monitoring** until first scorecard and **score ≥ 65%** (per spec).

### Watchlist

- **Starts empty** — no seeded tickers.
- Transition to satellite when position appears in Sharesight; **archive** watchlist row; **carry** research, versions, catalyst attachments per spec.

### Catalyst attachment (announcements)

- **Unattached** announcements: **rolling retention** default **30** days (14/30/60/90 configurable).
- **Attached** to a scorecard version as **catalyst** → **never auto-deleted**; stays with that version.
- Manual attach/detach allowed; detached resume retention rules.

### Lazy loading (version history)

On position open: fetch **only current** scorecard, research paper, and Gemini JSON. **Older versions on demand** when user picks a version in the dropdown. **Do not** preload all N versions on initial load.

### API Pause (kill-switch)

When **`global_api_pause`** is true: **no Anthropic or Google Gemini outbound calls**; analysis/briefing buttons disabled; banner shown; **Sharesight, Yahoo, FMP** continue per spec. Every Claude/Gemini call site **must** check this flag first.

### Data refresh (summary)

- Sharesight sync: **on load** + **every 30 min** + manual.
- Live prices / FX: **~5 min** during **that exchange’s market hours** (from exchange table / FMP hours).
- FMP fundamentals: **daily** after close (or on-demand mode if user selects).
- Provider ETF data (gearing line items from provider — manual gearing still primary for math): **weekly Wednesday** cadence in spec for fund data block.

---

## 5. Gemini JSON schemas

Gemini must return **valid JSON** matching these shapes (extend with `additionalProperties: false` in Zod/OpenAPI internally if desired). Claude prompts **declare which schema** applies.

### 5.1 `stock_research` (deep research)

```json
{
  "$schema": "http://json-schema.org/draft-07/schema#",
  "title": "stock_research",
  "type": "object",
  "additionalProperties": false,
  "required": [
    "schema_version",
    "ticker",
    "exchange",
    "instrument_type_guess",
    "thesis_summary",
    "business_overview",
    "moat_commentary",
    "financial_summary_commentary",
    "capital_allocation_commentary",
    "valuation_commentary",
    "scenario_outline",
    "peers_commentary",
    "risks",
    "recent_developments",
    "catalysts",
    "management_governance_signals",
    "sentiment",
    "data_gaps_for_fmp_fields",
    "sources"
  ],
  "properties": {
    "schema_version": { "type": "integer", "const": 1 },
    "ticker": { "type": "string" },
    "exchange": { "type": "string" },
    "instrument_type_guess": {
      "type": "string",
      "enum": [
        "regular_stock",
        "thematic_etf",
        "fund_manager_lic",
        "speculative",
        "alternative_pe",
        "unknown"
      ]
    },
    "thesis_summary": { "type": "string", "maxLength": 4000 },
    "business_overview": { "type": "string" },
    "moat_commentary": { "type": "string" },
    "financial_summary_commentary": { "type": "string" },
    "capital_allocation_commentary": { "type": "string" },
    "valuation_commentary": { "type": "string" },
    "scenario_outline": {
      "type": "object",
      "additionalProperties": false,
      "required": ["bull", "base", "bear"],
      "properties": {
        "bull": { "type": "string" },
        "base": { "type": "string" },
        "bear": { "type": "string" }
      }
    },
    "peers_commentary": { "type": "string" },
    "risks": {
      "type": "array",
      "items": {
        "type": "object",
        "additionalProperties": false,
        "required": ["risk", "severity", "notes"],
        "properties": {
          "risk": { "type": "string" },
          "severity": { "type": "string", "enum": ["low", "medium", "high"] },
          "notes": { "type": "string" }
        }
      }
    },
    "recent_developments": {
      "type": "array",
      "items": {
        "type": "object",
        "additionalProperties": false,
        "required": ["headline", "date_iso", "impact"],
        "properties": {
          "headline": { "type": "string" },
          "date_iso": { "type": "string" },
          "impact": {
            "type": "string",
            "enum": ["none", "minor", "material"]
          },
          "summary": { "type": "string" }
        }
      }
    },
    "catalysts": {
      "type": "array",
      "items": {
        "type": "object",
        "additionalProperties": false,
        "required": ["catalyst", "timeline", "confidence"],
        "properties": {
          "catalyst": { "type": "string" },
          "timeline": { "type": "string" },
          "confidence": {
            "type": "string",
            "enum": ["low", "medium", "high"]
          }
        }
      }
    },
    "management_governance_signals": { "type": "string" },
    "sentiment": {
      "type": "object",
      "additionalProperties": false,
      "required": ["overall"],
      "properties": {
        "overall": {
          "type": "string",
          "enum": ["negative", "mixed", "positive", "unknown"]
        },
        "notes": { "type": "string" }
      }
    },
    "data_gaps_for_fmp_fields": {
      "type": "array",
      "items": {
        "type": "object",
        "additionalProperties": false,
          "required": ["field_key", "status"],
        "properties": {
          "field_key": { "type": "string" },
          "status": {
            "type": "string",
            "enum": ["missing", "stale", "conflicting"]
          },
          "notes": { "type": "string" }
        }
      }
    },
    "sources": {
      "type": "array",
      "items": {
        "type": "object",
        "additionalProperties": false,
        "required": ["title", "url"],
        "properties": {
          "title": { "type": "string" },
          "url": { "type": "string" },
          "publisher": { "type": "string" },
          "date_iso": { "type": "string" }
        }
      }
    }
  }
}
```

### 5.2 `announcement_triage` (Flash-friendly)

```json
{
  "$schema": "http://json-schema.org/draft-07/schema#",
  "title": "announcement_triage",
  "type": "object",
  "additionalProperties": false,
  "required": [
    "schema_version",
    "ticker",
    "exchange",
    "announcement_headline",
    "announcement_datetime_iso",
    "price_sensitive",
    "materiality",
    "thesis_impact",
    "recommended_action",
    "summary",
    "flags"
  ],
  "properties": {
    "schema_version": { "type": "integer", "const": 1 },
    "ticker": { "type": "string" },
    "exchange": { "type": "string" },
    "announcement_headline": { "type": "string" },
    "announcement_datetime_iso": { "type": "string" },
    "price_sensitive": { "type": "boolean" },
    "materiality": {
      "type": "string",
      "enum": ["none", "low", "medium", "high"]
    },
    "thesis_impact": {
      "type": "string",
      "enum": ["no_change", "minor_update", "material_change", "unknown"]
    },
    "recommended_action": {
      "type": "string",
      "enum": [
        "no_action",
        "monitor",
        "triage_deep_research",
        "trigger_exit_review",
        "suggest_reanalyse",
        "unknown"
      ]
    },
    "summary": { "type": "string", "maxLength": 1500 },
    "flags": {
      "type": "object",
      "additionalProperties": false,
      "required": [],
      "properties": {
        "may_affect_buy_zones": { "type": "boolean" },
        "may_affect_exit_triggers": { "type": "boolean" },
        "may_affect_scorecard_items": { "type": "boolean" }
      }
    }
  }
}
```

### 5.3 `sector_context` (macro + sector overlays)

```json
{
  "$schema": "http://json-schema.org/draft-07/schema#",
  "title": "sector_context",
  "type": "object",
  "additionalProperties": false,
  "required": [
    "schema_version",
    "sectors",
    "macro",
    "portfolio_relevance",
    "fx_commentary_aud",
    "watch_items"
  ],
  "properties": {
    "schema_version": { "type": "integer", "const": 1 },
    "sectors": {
      "type": "array",
      "items": {
        "type": "object",
        "additionalProperties": false,
        "required": ["sector_name", "narrative", "risk_level"],
        "properties": {
          "sector_name": { "type": "string" },
          "narrative": { "type": "string" },
          "risk_level": {
            "type": "string",
            "enum": ["low", "medium", "high"]
          },
          "key_drivers": {
            "type": "array",
            "items": { "type": "string" }
          }
        }
      }
    },
    "macro": {
      "type": "object",
      "additionalProperties": false,
      "required": ["rates_outlook_note", "liquidity_credit_note"],
      "properties": {
        "rates_outlook_note": { "type": "string" },
        "liquidity_credit_note": { "type": "string" },
        "geopolitical_note": { "type": "string" }
      }
    },
    "portfolio_relevance": { "type": "string" },
    "fx_commentary_aud": { "type": "string" },
    "watch_items": {
      "type": "array",
      "items": {
        "type": "object",
        "additionalProperties": false,
        "required": ["topic", "why_it_matters"],
        "properties": {
          "topic": { "type": "string" },
          "why_it_matters": { "type": "string" }
        }
      }
    }
  }
}
```

---

## 6. Triad integration pattern

Orchestration for analysis, re-analysis, and briefing:

1. **Guardrails:** If `global_api_pause` → abort before any Gemini/Claude call; preserve cached artefacts and last-known-good UI state.
2. **Inputs:** Locked-in **`fmp_symbol`**, **`exchange_short_name`**, derived **`yahoo_symbol`**, baseline fundamentals row from DB cache, portfolio context from Sharesight sync snapshot.
3. **Gemini:**
   - Build prompt with explicit **JSON-only** requirement and **`response_mime_type` / schema** constraint if using Google SDK schema mode.
   - On success → validate JSON shape (`stock_research`, `announcement_triage`, or `sector_context`).
4. **`research_logs` write (short-lived safety net):**
   - Insert row **before** calling Claude — store `raw_gemini_json`, `status = pending`, `task_type`, `model`, `prompt_hash` optional.
5. **Supabase artefact cache (longer TTL):**
   - Upsert into `gemini_research_artefacts` keyed by **`user_id`, `canonical_symbol_key`, job type, optionally `bucket_date`** per product rules; skip Gemini if fresher-than-TTL artefact exists (unless **force refresh** triggered by user).
6. **Claude:**
   - System + user messages include **Gemini JSON** + numeric fundament tables + **`CLAUDE.md` rules excerpt** via prompt-cache blocks where supported.
   - Never attach raw filings as multi-MB payloads; Gemini JSON + compact tables only.
   - Persist outputs: scorecard version, thesis sections, deltas vs prior version metadata.
7. **On Claude failure:**
   - Mark `research_logs.claude_synthesis_status = failed`; allow retry path that prefers **reuse of last Gemini JSON < 1h** rather than repeating Gemini (`research_logs` + artefact table).

---

## 7. Prompt caching (`cache_control`)

When using the **Anthropic Messages API**:

- Mark large, **static** blocks with **cache breakpoints** — at minimum:
  - This **`CLAUDE.md`** (or a trimmed build-time export),
  - The **active scoring framework definition** payload,
  - **Existing scorecard snapshot** during re-analysis.
- Prefer **single stable ordering** of blocks so caches hit reliably.
- Do **not** cache highly volatile fragments (live prices except as small ephemeral attachments).

Consult current Anthropic docs for exact `cache_control` field names and tier limits.

---

## 8. Ticker mapping table (FMP ↔ Yahoo)

Derive **`yahoo_symbol`** from FMP **`symbol`** + **`exchangeShortName`** (locked at add).

| Exchange family | `exchangeShortName` / notes | **FMP symbol format** | **Yahoo Finance format** |
|----------------|-----------------------------|------------------------|---------------------------|
| ASX | `AU` etc. **No** `.AX` on FMP for many assets | Typically `SYMBOL` (no suffix) | `SYMBOL.AX` · e.g. `BHP` → `BHP.AX` |
| LSE | `LSE`, `GB`, etc. | Often `SYM.L` | `SYM.L` · e.g. `DPLM.L` |
| US (NYSE/Nasdaq) | `NYSE`, `NASDAQ` | Typically `SYM` | `SYM` · e.g. `AAPL` |
| TSX | `TSX`, `TOR` | Often `SYM.TO` | `SYM.TO` · e.g. `RY.TO` |
| Euronext etc. | Per venue | Variant suffixes `.PA`, `.AS`, … | Mirror Yahoo suffix conventions per venue |

**Persistence:** Both `fmp_symbol` and `yahoo_symbol` stored on each position/watchlist row; thereafter **never guess**.

**Maintenance:** Add new rows when onboarding first position on new exchange (**Section 10.15 Exchange Management**).

---

## 9. Supabase table schemas

All tables:

- **`id uuid`** PK default `gen_random_uuid()` unless noted.
- **`user_id uuid not null`** references **`auth.users(id)`**, unless row is global immutable reference seeded by migrations (exchange map).
- **`created_at timestamptz default now()`, `updated_at`** where mutable.
- **RLS:** `ENABLE ROW LEVEL SECURITY` + **`USING (user_id = auth.uid())`** (and **`WITH CHECK`**) for tenant tables.

### 9.1 `user_settings`

| Column | Type | Notes |
|--------|------|--------|
| `user_id` | uuid PK | |
| `core_satellite_targets` | jsonb | `{ "corePct": 72, "satellitePct": 28 }` |
| `weekly_dca_aud` | numeric | default 350 |
| `tier_schedules` | jsonb | standard / ghhf / custom arrays |
| `external_cash_aud` | numeric | manual bank cash |
| `global_api_pause` | boolean default false | kill-switch |
| `reanalysis_days` | int default 90 | |
| `refire_days_after_dismiss` | int default 30 | |
| `announcement_retention_days` | int default 30 | unattached rolling |
| `score_version_cap` | int default 10 | |
| `briefing_retention` | text | `'1y'` / `'2y'` / `'5y'` / `'all'` |
| `preferences` | jsonb | theme, decimals, TZ, benchmarks, FX display toggles |

### 9.2 `core_etfs`

| Column | Type | Notes |
|--------|------|--------|
| `id` | uuid | |
| `ticker_locked` | text | ticker immutable after trades exist — enforce app-side |
| `name` | text | |
| `target_weight_pct` | numeric | shares sum 100% active |
| `tier_schedule_kind` | text | `'standard'` \| `'ghhf'` \| `'custom'` |
| `custom_schedule` | jsonb | nullable |
| `gearing_multiple` | numeric nullable | manual; default UX 1.5 until set |
| `provider_url` | text | |
| `archived` | boolean default false | |

### 9.3 `positions`

Satellite holdings + metadata (Sharesight linkage).

| Column | Type |
|--------|------|
| `sharesight_instrument_or_holding_key` | text unique per user nullable |
| `fmp_symbol` | text |
| `exchange_short_name` | text |
| `yahoo_symbol` | text |
| `currency` | text |
| `archived` | boolean |
| `awaiting_analysis` | boolean |

### 9.4 `watchlist_items`

Mirrors ticker lock-in + lifecycle.

### 9.5 `scorecard_versions`

| Column | Type |
|--------|------|
| `position_id` | uuid FK |
| `version_no` | int |
| `framework` | text |
| `overall_score` | numeric |
| `payload` | jsonb | checklist, section scores, items |
| `generated_at` | timestamptz |

Unique `(position_id, version_no)`.

### 9.6 `research_paper_versions`

| Column | Type |
|--------|------|
| `position_id` | uuid |
| `scorecard_version_id` | uuid FK |
| `sections` | jsonb | 12-section structure |
| `generated_at` | timestamptz |

### 9.7 `score_override_events`

| Column | Type |
|--------|------|
| `scorecard_version_id` | uuid |
| `item_key` | text |
| `claude_score` | numeric |
| `user_score` | numeric |
| `note` | text |
| `created_at` | timestamptz |

### 9.8 `allocation_overrides`

| Column | Type |
|--------|------|
| `position_id` | uuid |
| `target_pct_override` | numeric nullable |
| `note` | text |
| `active` | boolean |

### 9.9 `gemini_research_artefacts`

| Column | Type |
|--------|------|
| `canonical_symbol_key` | text `(exchange:fmp_symbol)` |
| `task_type` | text `'stock_research'` \| `'announcement_triage'` \| `'sector_context'` |
| `model` | text |
| `payload` | jsonb |
| `fetched_at` | timestamptz |
| `ttl_days` | int |

Index `(user_id, canonical_symbol_key, task_type, fetched_at desc)`.

### 9.10 `research_logs` (required)

| Column | Type | Notes |
|--------|------|--------|
| `id` | uuid PK | |
| `user_id` | uuid | |
| `timestamp` | timestamptz default now() | alias of `created_at` ok |
| `ticker` | text | canonical display ticker |
| `canonical_symbol_key` | text | optional linkage |
| `task_type` | text | aligns with artefacts |
| `raw_gemini_json` | jsonb | verbatim parsed output |
| `claude_synthesis_status` | text **`success` \| `failed` \| `pending`** |
| `error_message` | text nullable | |

Purpose: resilience + debug — prefer reuse within **≤ 1 hour** on Claude failure retry.

### 9.11 `portfolio_briefings`

| Column | Type |
|--------|------|
| `title_run_at` | timestamptz |
| `body_md` | text |
| `metrics_snapshot` | jsonb |

### 9.12 `announcements`

| Column | Type |
|--------|------|
| `exchange` | text |
| `source` | text |
| `published_at` | timestamptz |
| `headline` | text |
| `body` | text nullable |
| `attached_version_id` | uuid nullable FK |
| `purge_after` | timestamptz nullable | null if catalyst-attached eternal |

(RLS per user.)

### 9.13 `exchange_registry`

Venue catalogue for hours + announcement routing (editable). May be seeded read-only globally with `user_id` null + service role inserts or per-user overrides — prefer **singleton global migration** readable by authenticated users (`SELECT` policy for `authenticated`).

Columns: **exchange_short_name**, **timezone**, **open_local**, **close_local**, **`announcement_source`**, **`manual_monitoring`**.

### 9.14 `api_spend_rollups`

| Column | Type |
|--------|------|
| `month` | date |
| `anthropic_aud_cents` | bigint |
| `google_aud_cents` | bigint |

(Or store raw usage events line-by-line.)

---

## 10. Global API Pause

- Persisted **`user_settings.global_api_pause`** (`boolean`).
- **All Gemini + Claude callers** MUST call `assertAiAllowed(settings)` immediately before requests.
- UX: disabling primary actions, subtle **persistent banner**.

---

## 11. Environment variables (Vite): `import.meta.env.VITE_*`

**Never hardcode secrets** in source. Prefix **public/client** vars with **`VITE_`** and read via **`import.meta.env.VITE_*`** only.

| Variable | Purpose |
|---------|---------|
| `VITE_APP_ENV` | `'development'` \| `'production'` — selects Sharesight OAuth pair if client-side flow |
| `VITE_SHARESIGHT_CLIENT_ID_DEV` / `VITE_SHARESIGHT_CLIENT_SECRET_DEV` | OAuth dev app |
| `VITE_SHARESIGHT_CLIENT_ID_PROD` / `VITE_SHARESIGHT_CLIENT_SECRET_PROD` | OAuth prod app |
| `VITE_SHARESIGHT_REDIRECT_ORIGIN_*` | If split — or single `VITE_SHARESIGHT_REDIRECT_URI` per env file |
| `VITE_SHARESIGHT_PORTFOLIO_UUID_CORE` | Core portfolio UUID |
| `VITE_SHARESIGHT_PORTFOLIO_UUID_SATELLITE` | Satellite UUID |
| `VITE_SUPABASE_URL` | Supabase project URL |
| `VITE_SUPABASE_ANON_KEY` | anon key (**RLS** enforced) |
| `VITE_FMP_API_KEY` | Financial Modeling Prep |
| `VITE_ANTHROPIC_API_KEY` | Claude API |
| `VITE_GEMINI_API_KEY` | Google Gemini |
| `VITE_PUBLIC_APP_URL` | Baseline origin for OAuth redirect building |

**Security note:** Anything in `VITE_*` is **exposed to the browser bundle**. For stricter production posture, prefer **Supabase Edge Functions** or server routes to hold AI keys — if the codebase later adds a server tier, migrate keys **out** of `VITE_*`. Until then, follow the project’s chosen pattern literally.

---

## 12. Forbidden patterns

| Rule | Detail |
|------|--------|
| **No `localStorage`** for domain state | Use Supabase + in-memory / URL state. |
| **No committed secrets** | `.env*` gitignored; never paste keys in docs or tests. |
| **No hardcoded ETF count** | Core list length always from data. |
| **Claude never ingests raw source documents** | Only Gemini JSON + compact tabular numbers. |
| **Never scrape Yahoo HTML** | Use **`yahoo-finance2`** only. |
| **Never silent AI failure** | Surface errors; log to `research_logs`; prefer cached fallbacks. |

---

## 13. Testing expectations and conventions

| Area | Expectation |
|------|-------------|
| **Unit tests** | Pure math: **DCA tiers + 0× rule**, allocation engine with haircut + overrides normalization, ATH distance → tier lookup, ticker mapping derivation, **`global_api_pause` guard**. |
| **Integration tests** | Mock HTTP for FMP/Yahoo/Sharesight; verify sync transforms; RLS policies smoke-tested with Supabase local or test project. |
| **Contract tests** | Golden JSON fixtures for **`stock_research`**, **`announcement_triage`**, **`sector_context`** — reject drift. |
| **E2E (optional later)** | Playwright: OAuth mocked, dashboard health bar renders with fixture payload. |
| **Lint / typecheck** | `eslint` + `tsc --noEmit` (if TS) on CI; no `any` for public API shapes. |
| **Observability** | Structured console logs in dev only; user-facing toasts for recoverable errors. |

**Test file layout:** colocate `*.test.ts` near modules or under `src/__tests__/` — pick one convention per repo and keep it.

---

## Module build order (from spec)

1. Sharesight integration (OAuth dual-app, refresh, UUID filters, cash).
2. Supabase schema + RLS (`research_logs` included).
3. DCA engine + Yahoo ATH integration.
4. Satellite/scoring UX + versioning + lazy loads.
5. Dashboard.
6. Watchlist + ticker search + mappings.
7. Portfolio briefing orchestration.
8. Settings/admin + **API Pause**.
9. Announcement monitoring (Priority 2) after core stabilization.

---

*End of CLAUDE.md — keep aligned with `INVESTMENT_APP_FRAMEWORK_V6.md`; update tokens and schemas deliberately when those sections change.*

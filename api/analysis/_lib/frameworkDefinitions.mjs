/**
 * Scoring framework keys + human labels (INVESTMENT_APP_FRAMEWORK_V6 §5).
 * Full section tables are summarised for Anthropic prompt caching.
 */

export const FRAMEWORK_KEYS = /** @type {const} */ ([
  'regular_stocks',
  'thematic_etfs',
  'fund_managers_lic',
  'speculative',
  'alternatives_pe',
])

/** @param {string} k */
export function frameworkLabel(k) {
  const m = {
    regular_stocks: 'Regular stocks',
    thematic_etfs: 'Thematic ETFs',
    fund_managers_lic: 'Fund managers / LICs',
    speculative: 'Speculative stocks',
    alternatives_pe: 'Alternative investments / PE',
  }
  return m[/** @type {keyof typeof m} */ (k)] ?? k
}

/**
 * Static text for prompt cache — mirrors spec tables (compressed).
 */
export const FRAMEWORK_RULES_FOR_CACHE = `
## Universal rules (non-negotiable)
- Buy zones unlock when overall score ≥ 65%. Below 65%: 0.5× allocation haircut; buy zones locked.
- High conviction band ≥ 78% where applicable per framework tiers.
- Score each checklist item; provide short reasoning per item.
- Output valid JSON only matching the response schema in the user message.

## Framework 1 — Regular stocks (60 items, 1–5 stars per item)
Sections & weights: Competitive moat 20% (7); Profitability & returns 20% (8); Balance sheet 12% (7); Cash flow & cap allocation 12% (6); Management & governance 8% (7); Growth runway 8% (5); Valuation 10% (7); Risk & red flags 7% (6); Technical analysis 3% (7).

## Framework 2 — Thematic ETFs (40 items, 1–4 stars)
Theme integrity 35% (5); Holdings valuation 20% (4); Fund structure & cost 20% (5); Performance & risk 15% (3); Portfolio fit 10% (3).

## Framework 3 — Fund managers / LICs (40 items, 1–4 stars)
Alpha generation 30% (6); Manager quality & process 25% (5); Structure & fees 25% (5); Portfolio fit & governance 20% (5).

## Framework 4 — Speculative stocks (40 items, 1–4 stars)
Thesis clarity & catalyst 30% (5); Survivability & runway 25% (5); Asymmetric payoff 25% (5); Management & red flags 20% (5).

## Framework 5 — Alternative investments / PE (40 items, 1–4 stars)
Access & structure 25% (5); Manager & strategy 30% (5); Deal quality & returns 25% (5); Fees, transparency & red flags 20% (5).

## Threshold quick reference
- Regular: Tier 65–77 qualifies; 78+ high conviction; <65 marginal haircut.
- Thematic ETF: tiers per spec (~52–67 monitor, etc.).
- Fund/LIC / Speculative / Alts: use framework-specific tier table from spec; honour 65% buy-zone gate universally.
`

export const RESPONSE_SCHEMA_HINT = `
Return a single JSON object (no markdown) with keys:
{
  "framework_key": "...",
  "overall_score_pct": number 0-100,
  "synopsis_one_liner": "string <= 280 chars",
  "section_scores": [ { "section_id": string, "title": string, "weight_pct": number, "score_pct": 0-100, "notes": string } ],
  "items": [
    {
      "item_key": "stable_slug",
      "section_id": string,
      "title": string,
      "stars_awarded": number,
      "stars_max": number,
      "score_pct": 0-100,
      "rationale": string
    }
  ],
  "buy_zones_native": [ { "label": string, "floor_price_native": number, "rationale": string } ],
  "exit_triggers": [ { "label": string, "condition_native": string, "rationale": string } ],
  "research_paper_outline": { "sections": [ { "heading": string, "body_md": string } ] }
}
stars_max must be 5 for regular_stocks framework_key and 4 for others.
Produce exactly as many checklist items as the active framework specifies (60 for regular_stocks, 40 otherwise), each with stable item_key snake_case unique within the framework.
Native currency amounts in buy zones are numbers in the listing currency (never AUD).
`

/** Framework rules for Claude (INVESTMENT_APP_FRAMEWORK_V6 §5). */
export const FRAMEWORK_RULES_FOR_CLAUDE = `
## Universal rules
- Buy zone unlock when overall score ≥ 65%. Below 65%: 0.5× allocation haircut; buy zones locked until score clears gate.
- High conviction ≥ 78% where applicable per framework.
- Score every checklist item with 1-2 sentence rationale citing 1-2 specific data points.
- Output valid JSON only — no markdown fences around the outer object.

## Framework 1 — Regular Stocks (60 items, 1-5 stars per item)
| Section | Weight | Items |
| Competitive moat | 20% | 7 |
| Profitability & returns | 20% | 8 |
| Balance sheet | 12% | 7 |
| Cash flow & capital allocation | 12% | 6 |
| Management & governance | 8% | 7 |
| Growth runway | 8% | 5 |
| Valuation | 10% | 7 |
| Risk & red flags | 7% | 6 |
| Technical analysis | 3% | 7 |
Tiers: 85%+ Exceptional; 78-84% High conviction; 65-77% Qualifies; 50-64% Marginal; <50% Avoid.

## Framework 2 — Thematic ETFs (40 items, 1-4 stars)
| Theme integrity | 35% | 5 |
| Holdings valuation | 20% | 4 |
| Fund structure & cost | 20% | 5 |
| Performance & risk | 15% | 3 |
| Portfolio fit | 10% | 3 |
Tiers: 82%+ Tier 1; 68-81% Tier 2; 52-67% Tier 3; <52% Tier 4.

## Framework 3 — Fund Managers / LICs (40 items, 1-4 stars)
| Alpha generation | 30% | 6 |
| Manager quality & process | 25% | 5 |
| Structure & fees | 25% | 5 |
| Portfolio fit & governance | 20% | 5 |
Tiers: 85%+ Tier 1; 70-84% Tier 2; 55-69% Tier 3; <55% Tier 4.

## Framework 4 — Speculative Stocks (40 items, 1-4 stars)
| Thesis clarity & catalyst | 30% | 5 |
| Survivability & runway | 25% | 5 |
| Asymmetric payoff | 25% | 5 |
| Management & red flags | 20% | 5 |
Tiers: 80%+ Tier 1; 65-79% Tier 2; 50-64% Tier 3; <50% Tier 4.

## Framework 5 — Alternative Investments / PE (40 items, 1-4 stars)
| Access & structure | 25% | 5 |
| Manager & strategy | 30% | 5 |
| Deal quality & returns | 25% | 5 |
| Fees, transparency & red flags | 20% | 5 |
Tiers: 82%+ Tier 1; 65-81% Tier 2; 50-64% Tier 3; <50% Tier 4.
`

/**
 * @param {string} ticker
 * @param {string} companyName
 * @param {string} exchange
 */
export function buildGeminiDeepResearchPrompt(ticker, companyName, exchange) {
  const today = new Date().toISOString().split('T')[0]
  return `You are a senior equity analyst conducting deep fundamental research on ${ticker} (${companyName}) listed on ${exchange}.

Use web search extensively. Pull the most recent earnings report, management commentary, analyst ratings, competitor data, and industry news. Cite specific numbers, dates, percentages, and named sources throughout. Quality of research takes priority over speed — take as long as needed to gather comprehensive evidence.

Return ONLY a JSON object with these fields. Every field must include specific quantified evidence (numbers, percentages, dates, sources). Aim for 3-6 sentences per field minimum.

{
  "ticker": "${ticker}",
  "company": "${companyName}",
  "research_date": "${today}",
  "reference_price": "current share price with currency and source date",
  "market_cap": "with currency",

  "business_overview": "detailed description: segments, geographies, revenue mix with specific numbers and most recent reporting period",

  "competitive_moat": "moat analysis with specific evidence — market share %, pricing power examples, brand metrics, technology IP, durability assessment",

  "pricing_power_evidence": "specific examples of price increases, customer retention, brand loyalty metrics with dates and %s",

  "financial_metrics": {
    "revenue_growth": "last 3 years with specific %s and dates",
    "gross_margin": "current and trend with specific numbers",
    "operating_margin": "current and trend",
    "net_margin": "current and trend",
    "roe": "current and 3-year trend",
    "roic": "current vs WACC estimate",
    "debt_levels": "net debt / EBITDA, interest coverage with numbers",
    "free_cash_flow": "FCF trends and conversion from EBITDA",
    "eps_history": "last 5 years EPS with growth rates",
    "dividend_history": "if applicable — yield, payout, growth"
  },

  "capital_allocation": "M&A history with specific deals, buybacks, dividends, capex discipline, ROI on past acquisitions",

  "management_quality": "leadership tenure, insider ownership %, governance issues, track record, key executive bios",

  "growth_runway": "TAM, expansion opportunities, structural tailwinds, addressable market, geographic expansion plans",

  "valuation_analysis": {
    "current_pe": "with peer comparison",
    "ev_ebitda": "current and trend",
    "peg_ratio": "if available",
    "fcf_yield": "current",
    "analyst_price_targets": "high/median/low with sources",
    "dcf_implications": "what current price assumes"
  },

  "peer_comparison": "2-3 closest competitors with key metrics (P/E, margins, growth) and competitive position",

  "technical_analysis": {
    "price_vs_50dma": "with current MA estimate",
    "price_vs_200dma": "with current MA estimate",
    "rsi": "if available",
    "support_levels": "key support prices",
    "resistance_levels": "key resistance prices",
    "52_week_range": "high/low",
    "trend_structure": "higher highs/lower lows assessment",
    "volume_profile": "liquidity assessment"
  },

  "key_risks": [
    "detailed risk 1 with quantification and evidence",
    "risk 2 with specifics",
    "risk 3 with specifics",
    "risk 4 with specifics",
    "risk 5 with specifics"
  ],

  "recent_developments": "detailed chronological summary of last 12 months: earnings beats/misses, M&A, management changes, guidance updates, regulatory events, with specific dates",

  "analyst_consensus": "current consensus rating, target prices from major brokers with names, recent upgrades/downgrades with dates",

  "esg_governance": "any material ESG, governance, or audit concerns",

  "sentiment": "positive | neutral | negative",

  "recommended_framework": "Regular Stock | Thematic ETF | Fund Manager / LIC | Speculative Stock | Alternative / PE",

  "sources_used": ["list of named sources cited"]
}

Return ONLY the JSON. No markdown fences. No prose wrapper.`
}

/**
 * @param {string} frameworkKey
 * @param {string} frameworkLabel
 * @param {string} ticker
 * @param {string} companyName
 * @param {Record<string, unknown>} geminiJson
 */
export function buildClaudeScorecardPrompt(frameworkKey, frameworkLabel, ticker, companyName, geminiJson) {
  const starsMax = frameworkKey === 'regular_stocks' ? 5 : 4
  const itemCount = frameworkKey === 'regular_stocks' ? 60 : 40

  return `You are scoring ${ticker} (${companyName}) against the ${frameworkLabel} framework using the deep research provided below.

${FRAMEWORK_RULES_FOR_CLAUDE}

ACTIVE FRAMEWORK: ${frameworkLabel} (framework_key: ${frameworkKey})
Required item count: exactly ${itemCount} items. Star scale: 1-${starsMax} per item.

DEEP RESEARCH FROM GEMINI:
${JSON.stringify(geminiJson)}

INSTRUCTIONS:
1. Score every single item in the ${frameworkLabel} framework (${itemCount} items total).
2. For each item provide: item_number, item_name (exact framework wording), stars_awarded (1-${starsMax}), rationale (1-2 sentences citing 1-2 specific data points (numbers, percentages, dates). Keep concise — the scorecard is a quick-reference; depth goes in the investment thesis).
3. Group items into sections matching the framework table with correct weights.
4. Calculate weighted section_score_pct and overall_score (0-100).
5. Assign tier (1-5) and tier_label using this framework's tier thresholds.
6. Generate up to 3 buy_zones_native with floor_price_native as numbers in listing currency.
7. Generate up to 5 exit_triggers.
8. Do NOT include a research paper or markdown thesis — scorecard JSON only.

Return ONLY a JSON object with this exact structure (no markdown fences):

{
  "framework": "${frameworkLabel}",
  "framework_key": "${frameworkKey}",
  "overall_score": 0-100,
  "overall_score_pct": 0-100,
  "tier": 1-5,
  "tier_label": "Exceptional | High conviction | Qualifies | Marginal | Avoid",
  "synopsis": "one paragraph executive summary",
  "synopsis_one_liner": "string <= 280 chars",
  "sections": [
    {
      "section_number": 1,
      "section_name": "Section name from framework",
      "weight_pct": number,
      "item_count": number,
      "section_score_pct": 0-100,
      "items": [
        {
          "item_number": 1,
          "item_name": "exact item name",
          "stars_awarded": number,
          "stars_max": ${starsMax},
          "score_pct": 0-100,
          "rationale": "1-2 sentences with 1-2 cited data points"
        }
      ]
    }
  ],
  "items": [
    {
      "item_key": "stable_snake_case_slug",
      "section_id": "section_slug",
      "item_number": 1,
      "title": "item name",
      "stars_awarded": number,
      "stars_max": ${starsMax},
      "score_pct": 0-100,
      "rationale": "1-2 sentences"
    }
  ],
  "section_scores": [
    {
      "section_id": "section_slug",
      "title": "section name",
      "weight_pct": number,
      "score_pct": 0-100,
      "notes": "brief section summary"
    }
  ],
  "buy_zones_native": [
    { "label": "string", "floor_price_native": number, "rationale": "string" }
  ],
  "exit_triggers": [
    { "label": "string", "condition_native": "string", "rationale": "string" }
  ]
}

The flat "items" array must contain all ${itemCount} items with unique item_key values. stars_max must be ${starsMax} for every item. Do not include research_paper_markdown or research_paper_outline.`
}

/**
 * @param {string} ticker
 * @param {string} companyName
 * @param {Record<string, unknown>} geminiJson
 * @param {Record<string, unknown>} scorecardJson
 */
export function buildClaudeResearchPaperPrompt(ticker, companyName, geminiJson, scorecardJson) {
  return `Using the deep research and scorecard provided, write a comprehensive investment thesis in markdown format (1500-3000 words) covering:

1. Business overview & competitive position
2. Moat analysis
3. Financial summary (3-5 year metrics table)
4. Capital allocation history
5. Investment thesis
6. Valuation analysis
7. Scenario analysis (bull/base/bear with price targets)
8. Peer comparison
9. Key risks
10. Recent developments
11. Outlook and catalysts
12. Conclusion and recommendation

DEEP RESEARCH: ${JSON.stringify(geminiJson)}

SCORECARD: ${JSON.stringify(scorecardJson)}

Return ONLY markdown. No JSON wrapper, no code fences, no preamble.`
}

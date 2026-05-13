# Investment App — V1 Feedback

> This file is the source of truth for all outstanding bugs and improvements.
> Each item is a discrete task. Work through them in priority order.
> Reference CLAUDE.md and INVESTMENT_APP_FRAMEWORK_V6.md for all business rules and design tokens.

---

## Priority 1 — Data Correctness (fix first)

### BUG-01 — Closed positions still showing (Core + Satellite)

**Pages affected:** Core Portfolio, Satellite Portfolio, Dashboard position grid

**What should happen:** Positions that are fully closed in Sharesight (zero quantity, marked as closed) should not appear in active views. They should be moved to a "Closed positions" archived view only.

**What actually happens:**
- AAA (Betashares Australian High Interest Cash ETF) is showing on Core Portfolio despite being closed
- IPX (Impax Asset Management) is showing on Satellite despite being closed
- Hansen Technologies (HSN) is showing on Satellite despite being closed

**Fix required:**
1. In `syncSharesightPortfolios.js`, when a holding is synced, check if `quantity = 0` or if Sharesight marks it as closed/inactive
2. Set `closed = true` on those `sharesight_holdings` rows
3. All UI views that display holdings must filter `WHERE closed = false` — this applies to: satellite position cards, core sleeve overview, dashboard position grid, DCA widget ticker matching
4. Add a "Closed positions" collapsible section at the bottom of Core and Satellite pages where closed positions are archived and still viewable
5. AAA is a cash-like holding and should also be filtered from invested portfolio calculations regardless of open/closed status

---

### BUG-02 — Cost basis and unrealised/realised P&L not displaying

**Pages affected:** Core Portfolio, Satellite Portfolio position cards, Sleeve Overview

**What should happen:** Each position card should show cost basis (AUD), unrealised G/L (AUD and %), and realised G/L where applicable. Sleeve overview should show total cost basis and total unrealised P&L.

**What actually happens:** Cost basis shows `—` or `$0` for all positions. Unrealised G/L shows `—` for all positions.

**Fix required:**
1. Check what Sharesight's `/valuation.json` endpoint returns for `cost_basis` — log the raw valuation holding object for GHHF and MP1 to see exact field names
2. The valuation endpoint likely returns `cost_value`, `opening_balance`, `purchase_price`, or similar — map these to `cost_basis` in `applyValuationHoldingToSharesightRow`
3. Also check the `/performance.json` endpoint for cost basis fields as a fallback
4. Unrealised G/L = `holding_value_aud - cost_basis` once cost_basis is populated
5. Realised G/L: check if Sharesight `/performance.json` provides `realised_gain_loss` or `capital_gain` at holding level — store in `sharesight_holdings.realized_gain_loss`
6. Update position cards and sleeve overview to display all three values once populated

---

### BUG-03 — DPLM value missing on Satellite

**Page affected:** Satellite Portfolio position card, Sleeve Overview

**What should happen:** DPLM (Diploma plc, LSE) should show quantity and AUD value like other positions.

**What actually happens:** DPLM shows price (6,945 GBP) but QTY and VALUE (AUD) are `—`.

**Fix required:**
1. Run a sync and check `[sharesight-sync] valuation_holdings_id_ledger` in the console — find the DPLM entry and confirm whether it is present in the valuation response
2. If present but not matching: the id or instrument code used for DPLM in the valuation response does not match the v3 holdings id — add the specific field path that DPLM uses to `indexValuationHoldingsByExternalId`
3. If not present in valuation response at all: DPLM may be in a different portfolio or sub-portfolio in Sharesight — check the raw valuation payload structure
4. Once matched, `holding_value_aud` should be populated by converting `quantity × 6945 GBP × GBPAUD FX rate` if valuation does not provide an AUD value directly

---

### BUG-04 — Cash balances not pulling from Sharesight

**Page affected:** Dashboard health bar — Total Cash field

**What should happen:** Total cash should show the sum of all broker cash account balances from Sharesight (Betashares Direct cash, IG Trading cash) plus the manually entered external cash from Settings.

**What actually happens:** Total cash shows `$0` — broker cash accounts are not being pulled from Sharesight.

**Fix required:**
1. Check `sharesight_cash_balances` table in Supabase — run `SELECT * FROM sharesight_cash_balances LIMIT 10` and share results
2. If empty: the cash sync is failing — check `syncPortfolioHoldingsCashPerf` for the valuation/cash path and add logging to show what the Sharesight `/valuation.json` returns for `cash_accounts`
3. If populated: the dashboard is not reading from `sharesight_cash_balances` correctly — fix `useDashboardData.js` to sum cash balances from that table
4. Cash breakdown (expandable on click) should show: each broker account name + balance, plus external cash from `user_settings.external_cash_aud`
5. The Total Cash button/card must be inline with the other health bar metrics (Portfolio Value, Core, Satellite) — fix the layout so all six metrics sit in a single horizontal row

---

### BUG-05 — Today (Holdings Δ) showing wrong value

**Page affected:** Dashboard health bar

**What should happen:** Shows the change in total portfolio value since the previous market close — i.e. today's gain or loss in AUD and %.

**What actually happens:** Shows a large negative value that appears to be calculated from distance from all-time highs, not from today's price movement.

**Fix required:**
1. The "today delta" calculation must use: `sum(quantity × (current_price - previous_close_price))` across all holdings
2. `previous_close` is already stored in `market_quote_snapshots` as `previous_close` — use this field
3. For foreign currency holdings (DPLM, IPX): convert `quantity × (current_price - previous_close) × FX rate` to AUD
4. Cash holdings and cash-like rows must be excluded from the today delta calculation
5. Do not use ATH, distance from ATH, or any all-time high calculation for this metric

---

## Priority 2 — Missing UI Features

### BUG-06 — Portfolio history chart not showing portfolio data

**Page affected:** Dashboard — Portfolio history chart

**What should happen:** Chart shows portfolio value over time with lines for Total, Core, Satellite, Cash, Unrealised gain, and Benchmark. Data sourced from Sharesight performance snapshots.

**What actually happens:** Only the benchmark (VGS.AX) line is showing. Portfolio lines (Total, Core, Satellite) are flat or missing.

**Fix required:**
1. Check `sharesight_performance_snapshots` table — run `SELECT COUNT(*), MIN(start_date), MAX(end_date) FROM sharesight_performance_snapshots` to confirm data exists
2. If empty: performance sync is failing — add logging to `syncPortfolioHoldingsCashPerf` to show what the Sharesight `/performance.json` endpoint returns
3. If populated: the chart parser in `PortfolioTrendChart.jsx` is not correctly reading the snapshot data — log what `perfCoreSeries` and `perfSatSeries` contain before rendering
4. Add **Year to Date (YTD)** and **This Financial Year (FY)** buttons to the time period selector. Australian financial year runs 1 July to 30 June. YTD = 1 January to today. FY = 1 July of the most recent financial year start to today.
5. Time period buttons should be: `1M | 3M | 6M | YTD | FY | 1Y | 2Y | ALL`

---

### BUG-07 — "Awaiting Analysis" positions have no Analyse button

**Page affected:** Satellite Portfolio position cards

**What should happen:** Positions showing the "Awaiting Analysis" badge should have a clearly visible "Analyse" or "Run analysis" button that opens the scoring workbench for that position.

**What actually happens:** The "Awaiting Analysis" badge is shown but there is no button to trigger analysis. The user has no way to initiate analysis from the satellite page.

**Fix required:**
1. On each satellite position card that shows `awaiting_analysis: true` or has no scorecard, add a prominent "Analyse" button below the badge
2. Clicking "Analyse" navigates to the position detail page with the scoring workbench tab pre-selected and the framework suggestion immediately triggered
3. The button should use the accent colour (`#4DB8FF`) and be clearly labeled "Run analysis →"
4. Positions that already have a scorecard should show a "Re-analyse" button instead, but smaller and less prominent

---

### BUG-08 — Satellite allocation donut chart — two colours too similar

**Page affected:** Satellite Portfolio — Sleeve Overview donut chart

**What should happen:** Each position should be clearly distinguishable in the donut chart by colour.

**What actually happens:** Two positions share very similar blue colours making them hard to distinguish.

**Fix required:**
1. Replace the current colour palette for the donut chart with a visually distinct set
2. Use this colour sequence for satellite positions (in order): `#4DB8FF`, `#22C55E`, `#F59E0B`, `#EF4444`, `#A855F7`, `#EC4899`, `#14B8A6`, `#F97316`, `#6366F1`, `#84CC16`
3. No two adjacent slices should use similar hues
4. Colour assignment should be consistent — same position always gets the same colour across page loads (assign by sorted ticker alphabetically)

---

## Priority 3 — UX Improvements

### UX-01 — Ticker search combobox — improve to TIKR-style dropdown

**Pages affected:** All search inputs where a stock or ETF can be searched (Satellite add position, Watchlist add ticker, any other ticker search)

**What should happen:** As the user types, a dropdown appears showing results with:
- Company logo (small icon, from FMP or a fallback)
- Ticker symbol (bold)
- Company name
- Exchange name (italic, right-aligned)
- Clear visual hover state
- Keyboard navigation (arrow keys, Enter to select, Escape to close)
- Minimum 3 characters before search fires to avoid excessive API calls
- Debounce of 300ms on input

**What actually happens:** A basic dropdown appears but lacks visual polish, logos, and full keyboard navigation.

**Fix required:**
1. Update `AddTickerCombobox.jsx` (and any other combobox components) with the improved design
2. Use Shadcn/UI `Command` component as the base for keyboard navigation
3. Add company logo: FMP provides `image` field on search results — show as a small 20px circular icon with a fallback grey circle showing the first letter of the ticker
4. Layout per result row: `[logo] [TICKER bold] [Company Name] [EXCHANGE italic right]`
5. Show a loading spinner inside the input while the search API call is in flight
6. Show "No results found" empty state when search returns zero hits
7. Show "Type to search..." placeholder when input is empty or fewer than 3 characters
8. Apply to: Satellite "Add position" search, Watchlist "Add ticker" search, Dashboard benchmark search, and any other ticker search in the app

---

## Summary Table

| ID | Priority | Page | Title | Status |
|---|---|---|---|---|
| BUG-01 | P1 | Core + Satellite | Closed positions still showing | Open |
| BUG-02 | P1 | Core + Satellite | Cost basis and P&L not displaying | Open |
| BUG-03 | P1 | Satellite | DPLM value missing | Open |
| BUG-04 | P1 | Dashboard | Cash balances not pulling from Sharesight | Open |
| BUG-05 | P1 | Dashboard | Today delta showing wrong value | Open |
| BUG-06 | P2 | Dashboard | Portfolio history chart not showing data | Open |
| BUG-07 | P2 | Satellite | No Analyse button on awaiting analysis positions | Open |
| BUG-08 | P2 | Satellite | Donut chart colours too similar | Open |
| UX-01 | P3 | All search | Improve ticker search to TIKR-style dropdown | Open |

---

*FEEDBACK_V1.md — Created May 2026*

/**
 * Canonical DCA tier ladders — INVESTMENT_APP_FRAMEWORK §DCA ( mirrored in CLAUDE.md ).
 * Persisted/edited copies live in {@link user_settings.tier_schedules} (standard + ghhf keys).
 */

/**
 * Sequential caps: multiplier applies while `distanceFromAthPct <= maxPct` (walking smallest→largest cap).
 * Last row: `maxPct: null` = all larger distances share that multiplier.
 *
 * Distance = % below ATH: `((ATH - price) / ATH) * 100`.
 *
 * @typedef {{ maxPct: number | null, multiplier: number }} DcaTierBand
 */

/** Standard schedule — DHHF / EXUS / BEMG default */
export const DEFAULT_STANDARD_TIERS = /** @type {const DcaTierBand[]} */ ([
  { maxPct: 1.5, multiplier: 0 },
  { maxPct: 3.5, multiplier: 0.7 },
  { maxPct: 8.5, multiplier: 1.5 },
  { maxPct: 13.5, multiplier: 2.5 },
  { maxPct: 18.5, multiplier: 3.4 },
  { maxPct: 23.5, multiplier: 4.6 },
  { maxPct: 28.5, multiplier: 5.0 },
  { maxPct: 33.5, multiplier: 5.5 },
  { maxPct: null, multiplier: 6.0 },
])

/** GHHF conservative schedule — leverage-aware */
export const DEFAULT_GHHF_TIERS = /** @type {const DcaTierBand[]} */ ([
  { maxPct: 1.5, multiplier: 0 },
  { maxPct: 4, multiplier: 0.7 },
  { maxPct: 8, multiplier: 1.35 },
  { maxPct: 12, multiplier: 2.25 },
  { maxPct: 17, multiplier: 3.05 },
  { maxPct: 22, multiplier: 4.15 },
  { maxPct: 28, multiplier: 4.6 },
  { maxPct: 33, multiplier: 5.1 },
  { maxPct: null, multiplier: 5.6 },
])

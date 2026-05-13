import { DEFAULT_GHHF_TIERS, DEFAULT_STANDARD_TIERS } from './defaultTierSchedules.js'
import { distanceFromAthPercent, matchTier, parseTierBands } from './tierMultiplier.js'
import { coreEtfTickerMatchesQuoteRow } from './tickerMatch.js'
import { isSharesightHoldingClosed } from '../satellite/satelliteMerge.js'

const DEFAULT_BASE_WEEKLY_AUD = 350
const DEFAULT_GEARING = 1.5

/**
 * @typedef {import('./defaultTierSchedules.js').DcaTierBand} DcaTierBand
 */

/**
 * @typedef {{
 *   ticker: string
 *   target_weight_pct: number
 *   tier_schedule_kind: string
 *   custom_tier_schedule: unknown
 *   gearing_multiple: number | null
 *   sort_order?: number | null
 *   name?: string | null
 *   provider_page_url?: string | null
 * }} CoreEtfRow
 */

/**
 * @typedef {{
 *   portfolio_role: string
 *   instrument_symbol: string | null
 *   yahoo_symbol: string
 *   fmp_symbol?: string | null
 *   display_aud: number | null
 *   ath: number | null
 *   is_cash_like?: boolean
 * }} QuoteLikeRow
 */

/**
 * @typedef {{
 *   standard: DcaTierBand[]
 *   ghhf: DcaTierBand[]
 * }} ResolvedSchedules
 */

/**
 * @param {unknown} raw
 * @returns {ResolvedSchedules}
 */
export function resolveSchedulesFromSettings(raw) {
  const std = DEFAULT_STANDARD_TIERS.map((b) => ({ ...b }))
  const gh = DEFAULT_GHHF_TIERS.map((b) => ({ ...b }))

  if (!raw || typeof raw !== 'object') return { standard: std, ghhf: gh }

  const o = /** @type {Record<string, unknown>} */ (raw)
  const parsedStd = parseTierBands(o.standard)
  const parsedGh = parseTierBands(o.ghhf)

  return {
    standard: parsedStd ?? std,
    ghhf: parsedGh ?? gh,
  }
}

/**
 * @param {CoreEtfRow} etf
 * @param {ResolvedSchedules} schedules
 */
/**
 * @param {QuoteLikeRow[]} mergedRows
 * @param {string} ticker
 */
export function findCoreQuoteForTicker(mergedRows, ticker) {
  const core = mergedRows.filter((r) => `${r?.portfolio_role ?? ''}`.trim().toLowerCase() === 'core')

  /** @type {QuoteLikeRow | null} */
  let best = null

  for (const r of core) {
    if (Reflect.get(/** @type {Record<string, unknown>} */ (r), 'closed') === true || isSharesightHoldingClosed(/** @type {Record<string, unknown>} */ (r))) continue

    if (!coreEtfTickerMatchesQuoteRow(r, ticker)) continue

    if (!best) {
      best = r
      continue
    }
    const score = (row) => (row.display_aud != null ? 2 : 0) + (row.ath != null ? 1 : 0)

    if (score(r) > score(best)) best = r
  }

  /** Core sleeve tag wrong in DB — still tie DCA display to core ETF holdings by ticker. */
  if (!best) {
    const scored = mergedRows.filter((r) => coreEtfTickerMatchesQuoteRow(r, ticker) && !r?.is_cash_like)

    for (const r of scored) {
      if (Reflect.get(/** @type {Record<string, unknown>} */ (r), 'closed') === true || isSharesightHoldingClosed(/** @type {Record<string, unknown>} */ (r))) continue

      if (!best) {
        best = /** @type {QuoteLikeRow} */ (/** @type {unknown} */ (r))
        continue
      }
      const score = (row) => (row.display_aud != null ? 2 : 0) + (row.ath != null ? 1 : 0)

      if (score(/** @type {QuoteLikeRow} */ (r)) > score(best)) best = /** @type {QuoteLikeRow} */ (/** @type {unknown} */ (r))
    }
  }

  return best
}

/**
 * @typedef {{
 *   ticker: string
 *   allocationPct: number
 *   scheduleKind: string
 *   scheduleLabel: string
 *   priceAud: number | null
 *   athAud: number | null
 *   distancePct: number | null
 *   tierBandLabel: string
 *   multiplier: number | null
 *   multiplierLabel: string
 *   contributionAud: number | null
 *   gearingFactor: number
 *   trueExposurePct: number | null
 *   quoteMatched: boolean
 *   displayName: string | null
 *   providerPageUrl: string | null
 *   gearingFromDb: number | null
 * }} DcaEtfComputationRow
 */

/**
 * @param {{
 *   weeklyDcaBaseAud: number
 *   tierSchedulesJson: unknown
 *   coreEtfs: CoreEtfRow[]
 *   mergedRows: QuoteLikeRow[]
 * }} p
 */
export function computeWeeklyDcaRows(p) {
  const base = Number.isFinite(p.weeklyDcaBaseAud) ? p.weeklyDcaBaseAud : DEFAULT_BASE_WEEKLY_AUD
  const schedules = resolveSchedulesFromSettings(p.tierSchedulesJson)

  const active = [...p.coreEtfs].filter((e) => e && typeof e.ticker === 'string' && e.ticker.trim())
  active.sort((a, b) => {
    const so = (Number(a.sort_order) || 0) - (Number(b.sort_order) || 0)
    if (so !== 0) return so
    return a.ticker.localeCompare(b.ticker)
  })

  /** @type {DcaEtfComputationRow[]} */
  const rows = []

  for (const etf of active) {
    const w = Number(etf.target_weight_pct)
    const alloc = Number.isFinite(w) ? w : 0
    const kind = `${etf.tier_schedule_kind ?? 'standard'}`.trim().toLowerCase()
    const customParsed = kind === 'custom' ? parseTierBands(etf.custom_tier_schedule) : null
    const bands =
      kind === 'ghhf'
        ? schedules.ghhf
        : kind === 'custom' && customParsed
          ? customParsed
          : schedules.standard
    const scheduleLabel = kind === 'custom' && !customParsed ? 'custom (fallback standard)' : kind

    const quote = findCoreQuoteForTicker(p.mergedRows, etf.ticker)
    const priceAud = quote?.display_aud ?? null
    const athAud = quote?.ath ?? null
    const dist = distanceFromAthPercent(priceAud, athAud)
    const tier = matchTier(dist, bands)

    const mult = tier.multiplier
    let contributionAud = null
    if (alloc > 0 && mult != null && Number.isFinite(base)) {
      contributionAud = base * (alloc / 100) * mult
    } else if (alloc === 0 || mult === 0) {
      contributionAud = 0
    }

    const gRaw = etf.gearing_multiple
    const gearingFromDb = typeof gRaw === 'number' && Number.isFinite(gRaw) && gRaw > 0 ? gRaw : null

    const gearingFactor = gearingFromDb ?? DEFAULT_GEARING

    const trueExposurePct =
      alloc > 0 && Number.isFinite(gearingFactor) ? (alloc / 100) * gearingFactor * 100 : null

    const dn = etf.name

    const pu = etf.provider_page_url

    rows.push({
      ticker: etf.ticker.trim(),
      allocationPct: alloc,
      scheduleKind: kind,
      scheduleLabel,
      priceAud,
      athAud,
      distancePct: dist,
      tierBandLabel: tier.bandLabel,
      multiplier: mult,
      multiplierLabel: tier.multLabel,
      contributionAud,
      gearingFactor,
      trueExposurePct,
      quoteMatched: Boolean(quote),
      displayName: typeof dn === 'string' && dn.trim() ? dn.trim() : null,
      providerPageUrl: typeof pu === 'string' && pu.trim() ? pu.trim() : null,
      gearingFromDb,
    })
  }

  const totalWeekly = rows.reduce((s, r) => s + (r.contributionAud != null && Number.isFinite(r.contributionAud) ? r.contributionAud : 0), 0)

  const weightSum = rows.reduce((s, r) => s + r.allocationPct, 0)

  return { rows, totalWeekly, baseWeeklyAud: base, weightSum, schedules }
}

/**
 * @param {unknown} v
 * @param {number} fallback
 */
export function numOr(v, fallback) {
  const n = typeof v === 'number' ? v : Number.parseFloat(`${v ?? ''}`)
  return Number.isFinite(n) ? n : fallback
}

export { DEFAULT_BASE_WEEKLY_AUD, DEFAULT_GEARING }

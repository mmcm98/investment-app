import { tickersLooselyEqual } from '../dca/tickerMatch.js'

/**
 * Total core sleeve market value in AUD (excludes cash-like holdings) from merged quote rows.
 *
 * @param {Array<{ portfolio_role?: string, is_cash_like?: boolean, holding_value_aud?: number|null }>} mergedRows
 */

export function coreSleeveMarketValueExcCashAud(mergedRows) {
  let t = 0

  for (const r of mergedRows) {
    if (`${r.portfolio_role ?? ''}`.toLowerCase() !== 'core') continue

    if (r.is_cash_like) continue

    const hv = typeof r.holding_value_aud === 'number' && Number.isFinite(r.holding_value_aud) ? r.holding_value_aud : null

    if (hv == null) continue

    t += hv
  }

  return t
}

/**
 * Sum of core holding values in AUD that match a `core_etfs.ticker` (instrument or Yahoo symbol).
 *
 * @param {Array<{ portfolio_role?: string, is_cash_like?: boolean, instrument_symbol?: string|null, yahoo_symbol?: string, holding_value_aud?: number|null }>} mergedRows
 * @param {string} etfTicker
 */

export function coreHoldingValueAudForTicker(mergedRows, etfTicker) {
  let sum = 0

  for (const r of mergedRows) {
    if (`${r.portfolio_role ?? ''}`.toLowerCase() !== 'core') continue

    if (r.is_cash_like) continue

    if (!tickersLooselyEqual(r.instrument_symbol, etfTicker) && !tickersLooselyEqual(r.yahoo_symbol, etfTicker)) continue

    const hv = typeof r.holding_value_aud === 'number' && Number.isFinite(r.holding_value_aud) ? r.holding_value_aud : 0

    sum += hv
  }

  return sum
}

/**
 * Actual weight of this ETF within the **core sleeve** (ex cash), as % of total core market value.
 *
 * @param {Array<{ portfolio_role?: string, is_cash_like?: boolean, instrument_symbol?: string|null, yahoo_symbol?: string, holding_value_aud?: number|null }>} mergedRows
 * @param {string} etfTicker
 */

export function actualCoreSleevePct(mergedRows, etfTicker) {
  const sleeve = coreSleeveMarketValueExcCashAud(mergedRows)

  if (sleeve <= 0) return null

  return (coreHoldingValueAudForTicker(mergedRows, etfTicker) / sleeve) * 100
}

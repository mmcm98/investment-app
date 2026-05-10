/**
 * Aggregate dashboard finance from merged holdings rows (+ external cash broker rows handled separately).
 *
 * Core / Satellite “value excluding cash holdings” aligns with drift math guidance.
 */

import { isCashLikeHolding } from '../satellite/satelliteMerge.js'
import { resolveSharesightHoldingValueAud } from '../sharesight/normalizePayloads.js'

/** @param {{ portfolio_role?: string, is_cash_like?: boolean, holding_value_aud?: number|null }} row */
export function portfolioRole(row) {
  return `${row.portfolio_role ?? ''}`.toLowerCase()
}

/**
 * Sum holding_value_aud excluding cash-like holdings, split by portfolio role.
 *
 * @param {Array<{ portfolio_role?: string, is_cash_like?: boolean, holding_value_aud?: number|null }>} mergedRows
 */
export function holdingsExCashByRoleAud(mergedRows) {
  let core = 0
  let sat = 0

  for (const r of mergedRows) {
    if (r?.is_cash_like) continue

    const hv = typeof r?.holding_value_aud === 'number' && Number.isFinite(r.holding_value_aud) ? r.holding_value_aud : null

    if (hv == null) continue

    const pr = portfolioRole(r)

    if (pr === 'core') core += hv
    if (pr === 'satellite') sat += hv
  }

  return { coreHoldingsExcCashAud: core, satelliteHoldingsExcCashAud: sat }
}

/**
 * Sum Sharesight `holding_value_aud` (and fallbacks from raw) by sleeve — **not** live Yahoo × qty.
 *
 * @param {unknown[]} rawHoldings rows from `sharesight_holdings`
 */
export function holdingsExCashByRoleAudFromSharesight(rawHoldings) {
  let core = 0
  let sat = 0

  for (const row of rawHoldings) {
    const r = /** @type {Record<string, unknown>} */ (row)

    if (isCashLikeHolding(r)) continue

    const hv = resolveSharesightHoldingValueAud(r)

    if (hv == null || !Number.isFinite(hv)) continue

    const pr = `${r.portfolio_role ?? ''}`.trim().toLowerCase()

    if (pr === 'core') core += hv
    if (pr === 'satellite') sat += hv
  }

  return { coreHoldingsExcCashAud: core, satelliteHoldingsExcCashAud: sat }
}

/**
 * @param {Array<{ unrealised_gain_aud?: number|null }>} mergedRows
 */
export function unrealisedGainSumAud(mergedRows) {
  let t = 0

  for (const r of mergedRows) {
    const ug = typeof r?.unrealised_gain_aud === 'number' && Number.isFinite(r.unrealised_gain_aud) ? r.unrealised_gain_aud : null

    if (ug != null) t += ug
  }

  return t
}

/**
 * AUD book value totals from Sharesight holdings (omit non-AUD rows to avoid misleading FX aggregates).
 *
 * @param {unknown[]} rawHoldings sharesight_holdings rows
 * @param {'core'|'satellite'} role
 */
export function bookValueTotalsFromHoldingsAud(rawHoldings, role) {
  let t = 0

  for (const row of rawHoldings) {
    const r = /** @type {Record<string, unknown>} */ (row)

    if (`${r.portfolio_role ?? ''}`.trim().toLowerCase() !== role) continue

    if (isCashLikeHolding(r)) continue

    const cbRaw = Reflect.get(r, 'cost_basis')
    const cur = `${Reflect.get(r, 'currency') ?? ''}`.trim().toUpperCase()

    const cb = typeof cbRaw === 'number' && Number.isFinite(cbRaw) ? cbRaw : Number.parseFloat(`${cbRaw ?? ''}`)

    if (!Number.isFinite(cb)) continue

    if (cur !== 'AUD') continue

    t += cb
  }

  return t
}

/**
 * @typedef {{ portfolio_role?: string|null, currency?: string|null, balance?: number|null, label?: string|null }} CashRowLike
 */

/**
 * @param {CashRowLike[]} cashRows raw Supabase balances
 * @param {Record<string, { aud_per_unit: number }>} fx currency → aud
 */
export function brokerCashAudBreakdown(cashRows, fx) {
  /** @type {{ portfolio_role: string, label: string, currency: string, balance_aud: number }[]} */
  const lines = []

  let totalAud = 0

  for (const row of cashRows) {
    const pr = `${row.portfolio_role ?? ''}`.toLowerCase() || 'unknown'
    const cur = `${row.currency ?? ''}`.trim().toUpperCase() || 'AUD'
    const bal =
      typeof row.balance === 'number' && Number.isFinite(row.balance) ? row.balance : Number.parseFloat(`${row.balance ?? ''}`)

    if (!Number.isFinite(bal)) continue

    const aud =
      cur === 'AUD'
        ? bal
        : fx[cur]?.aud_per_unit != null && Number.isFinite(fx[cur].aud_per_unit)
          ? bal * fx[cur].aud_per_unit
          : null

    if (aud == null) continue

    totalAud += aud

    lines.push({
      portfolio_role: pr,
      label: `${row.label ?? row.portfolio_role ?? 'Broker cash'}`.trim(),
      currency: cur,
      balance_aud: aud,
    })
  }

  return { totalBrokerCashAud: totalAud, breakdown: lines }
}

/**
 * @param {Array<{ day_move_value_aud?: number|null }>} mergedRows
 */
export function dayMoveTotalsAud(mergedRows) {
  let t = 0

  for (const r of mergedRows) {
    const dv = typeof r?.day_move_value_aud === 'number' && Number.isFinite(r.day_move_value_aud) ? r.day_move_value_aud : null

    if (dv != null) t += dv
  }

  return t
}

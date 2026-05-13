/**
 * @param {Record<string, unknown> | null | undefined} h
 */
export function isCashLikeHolding(h) {
  if (!h) return false

  const sym = `${Reflect.get(h, 'instrument_symbol') ?? ''}`.trim().toUpperCase()

  const name = `${Reflect.get(h, 'instrument_name') ?? ''}`.toLowerCase()

  if (sym && /^(CASH|FUNDS|USD|AUD|GBP|EUR)$/i.test(sym)) return true

  if (!sym && /cash|money market|settlement/i.test(name)) return true

  if (/cash balance|portfolio cash|uninvested cash/i.test(name)) return true

  return false
}

/**
 * @param {unknown} n
 */
export function numOrNull(n) {
  const v = typeof n === 'number' && Number.isFinite(n) ? n : Number.parseFloat(`${n ?? ''}`)

  return Number.isFinite(v) ? v : null
}

/**
 * Fully closed / inactive Sharesight holding — exclude from active views and quote cycles.
 *
 * @param {Record<string, unknown> | null | undefined} h sharesight_holdings row (or merged shape with `raw`)
 */
export function isSharesightHoldingClosed(h) {
  if (!h || typeof h !== 'object') return false

  if (Reflect.get(h, 'closed') === true) return true

  const q = numOrNull(Reflect.get(h, 'quantity'))

  if (q === 0) return true

  const raw = Reflect.get(h, 'raw')

  if (raw && typeof raw === 'object') {
    const o = /** @type {Record<string, unknown>} */ (raw)

    if (Reflect.get(o, 'valid_position') === false) return true

    if (Reflect.get(o, 'closed') === true) return true

    if (Reflect.get(o, 'is_open') === false) return true

    if (Reflect.get(o, 'active') === false) return true

    const st = `${Reflect.get(o, 'status') ?? Reflect.get(o, 'state') ?? ''}`.trim().toLowerCase()

    if (st.includes('closed') || st === 'inactive' || st === 'archived') return true

    const vh = Reflect.get(o, 'sharesight_valuation_holding')

    if (vh && typeof vh === 'object') {
      const vq = numOrNull(Reflect.get(/** @type {Record<string, unknown>} */ (vh), 'quantity'))

      if (vq === 0) return true
    }
  }

  return false
}

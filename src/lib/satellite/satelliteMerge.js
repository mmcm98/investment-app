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

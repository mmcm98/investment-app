/**
 * Normalise tickers for matching core_etf.ticker ↔ Sharesight instrument_symbol / Yahoo symbols.
 *
 * @param {string | null | undefined} s
 */
export function tickerNorm(s) {
  const u = `${s ?? ''}`.trim().toUpperCase()
  if (!u) return ''
  return u.replace(/^ASX:/, '').replace(/\.AX$/i, '').replace(/\.AU$/i, '').replace(/\.US$/i, '').replace(/\.L$/i, '')
}

/**
 * @param {string | null | undefined} a
 * @param {string | null | undefined} b
 */
export function tickersLooselyEqual(a, b) {
  const na = tickerNorm(a)
  const nb = tickerNorm(b)
  if (!na || !nb) return false
  return na === nb
}

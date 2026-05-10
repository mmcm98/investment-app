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

/**
 * `core_etfs.ticker` is often bare (`GHHF`) while snapshots use Yahoo/FMP forms (`GHHF.AX`, `GHHF.L`).
 *
 * @param {{ instrument_symbol?: string | null, yahoo_symbol?: string | null, fmp_symbol?: string | null }} row
 * @param {string | null | undefined} etfTicker
 */
export function coreEtfTickerMatchesQuoteRow(row, etfTicker) {
  const t = `${etfTicker ?? ''}`.trim()

  if (!t) return false

  return (
    tickersLooselyEqual(row?.instrument_symbol, t) ||
    tickersLooselyEqual(row?.yahoo_symbol, t) ||
    tickersLooselyEqual(row?.fmp_symbol, t)
  )
}

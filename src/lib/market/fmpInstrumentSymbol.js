/**
 * FMP stable v3 profile / historical routes expect symbols like `MP1.AX`, `DPLM.L`.
 *
 * @param {string|null|undefined} fmp
 * @param {string|null|undefined} exchangeShort
 */
export function fmpInstrumentSymbol(fmp, exchangeShort) {
  const s = `${fmp ?? ''}`.trim().toUpperCase().replace(/^=/, '')
  const e = `${exchangeShort ?? ''}`.trim().toUpperCase()

  if (!s) return ''

  if (e === 'ASX' || e === 'AU' || e === 'AX' || e === 'ASX LIMITED') return `${s}.AX`

  if (e === 'LSE' || e === 'LON' || e === 'L' || e === 'LSE GROUP') return `${s}.L`

  if (e === 'NYSE' || e === 'NASDAQ' || e === 'AMEX' || e === 'US' || e === 'USA') return s

  return s
}

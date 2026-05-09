import { deriveYahooSymbolFromFmp } from './tickerMap.js'
import { mapFmpExchangeToSession } from './exchangeSessions.js'

/**
 * Sharesight payloads vary by tenant — prefer structured fields inside `instrument` JSON, then heuristic fallbacks.
 *
 * @param {Record<string, unknown>} raw
 */
function pickInstrument(raw) {
  if (!raw || typeof raw !== 'object') return null

  return /** @type {Record<string, unknown>} */ (Reflect.get(raw, 'instrument')) ?? null
}

/**
 * Best-effort FMP-style exchange short name for mapping + market hours.
 *
 * @param {Record<string, unknown>} raw
 * @param {string} instrumentSymbol
 */
export function inferExchangeShortNameFromSharesightRaw(raw, instrumentSymbol) {
  const inst = pickInstrument(raw)

  const fromInst =
    [inst?.exchange, inst?.market, inst?.market_identifier, inst?.country_code, inst?.country]
      .map((v) => (typeof v === 'string' ? v.trim().toUpperCase() : ''))
      .find(Boolean) ?? ''

  if (fromInst) {
    if (fromInst.includes('ASX') || fromInst === 'AU' || fromInst === 'XASX') return 'AU'

    if (fromInst.includes('LSE') || fromInst === 'GB' || fromInst === 'GBR' || fromInst.includes('LONDON')) return 'LSE'

    if (fromInst.includes('NYSE')) return 'NYSE'

    if (fromInst.includes('NASDAQ') || fromInst === 'NMS') return 'NASDAQ'

    if (fromInst.includes('TSX') || fromInst === 'TOR') return 'TSX'
  }

  const sym = `${instrumentSymbol ?? ''}`.trim().toUpperCase()

  if (sym.endsWith('.AX') || sym.endsWith('.AU')) return 'AU'

  if (sym.endsWith('.L')) return 'LSE'

  if (sym.endsWith('.TO')) return 'TSX'

  // Product default: ASX baseline
  return 'AU'
}

/**
 * FMP symbol best-effort from Sharesight code (until combobox lock-in persists true FMP codes).
 *
 * @param {string} instrumentSymbol
 * @param {string} exchangeShort
 */
export function inferFmpSymbol(instrumentSymbol, exchangeShort) {
  const s = `${instrumentSymbol ?? ''}`.trim().toUpperCase()

  if (!s) return ''

  const key = mapFmpExchangeToSession(exchangeShort)

  if (key === 'ASX') return s.replace(/\.AX$/i, '').replace(/\.AU$/i, '')

  if (key === 'LSE') return s.endsWith('.L') ? s : `${s}.L`

  if (key === 'TSX') return s.endsWith('.TO') ? s : `${s}.TO`

  return s.replace(/\.(AX|L|TO)$/i, '')
}

/**
 * @param {{
 *   instrument_symbol: string | null
 *   raw: Record<string, unknown>
 * }} row
 */
export function resolveQuoteIdentity(row) {
  const instrumentSymbol = `${row.instrument_symbol ?? ''}`.trim()

  const exchangeShort = inferExchangeShortNameFromSharesightRaw(row.raw, instrumentSymbol)
  const fmpSymbol = inferFmpSymbol(instrumentSymbol, exchangeShort)
  const yahooSymbol = deriveYahooSymbolFromFmp({ fmpSymbol: instrumentSymbol || fmpSymbol, exchangeShortName: exchangeShort })

  return {
    fmpSymbol: fmpSymbol || instrumentSymbol,
    exchangeShortName: exchangeShort,
    yahooSymbol,
  }
}

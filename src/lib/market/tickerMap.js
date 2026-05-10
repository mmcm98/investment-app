import { mapFmpExchangeToSession } from './exchangeSessions.js'

/**
 * Build Yahoo Finance symbol from FMP `symbol` + `exchangeShortName` (CLAUDE.md §8 & framework §10.15 ticker table).
 *
 * @param {{ fmpSymbol: string, exchangeShortName?: string | null }} args
 */
export function deriveYahooSymbolFromFmp(args) {
  const raw = `${args.fmpSymbol ?? ''}`.trim()

  if (!raw) return ''

  const upperSymbol = raw.toUpperCase()

  const sessionKey = mapFmpExchangeToSession(args.exchangeShortName)

  /** Already Yahoo-shaped */
  if (upperSymbol.endsWith('.AX')) return normalizeYahooTicker(upperSymbol)

  switch (sessionKey) {
    case 'ASX': {
      const base = stripSuffix(upperSymbol, '.AU')

      return `${stripExchangeSuffix(base)}.AX`
    }

    case 'LSE': {
      if (upperSymbol.endsWith('.L')) return normalizeYahooTicker(upperSymbol)

      const base = stripExchangeSuffix(upperSymbol)

      return `${base}.L`
    }

    case 'NASDAQ':
    case 'NYSE':
      return normalizeYahooTicker(stripExchangeSuffix(upperSymbol))

    case 'TSX':
      return upperSymbol.endsWith('.TO') ? normalizeYahooTicker(upperSymbol) : `${stripExchangeSuffix(upperSymbol)}.TO`

    default:
      return normalizeYahooTicker(upperSymbol)
  }
}

/** @param {string} s */
/**
 * Strip common broker suffix duplication before deriving Yahoo ticker.
 *
 * @param {string} code
 */
function stripExchangeSuffix(code) {
  return code.replace(/\.(AU|LN|LM|OI|OA|OI|NYSE|NMS|NMS|NMS)$/, '')
}

/** @param {string} symbol */
/** @param {string} suffix */
function stripSuffix(symbol, suffix) {
  return symbol.endsWith(suffix) ? symbol.slice(0, -suffix.length) : symbol
}

/** @param {string} ticker */
export function normalizeYahooTicker(ticker) {
  return ticker.trim().toUpperCase().replace(/\s+/g, '')
}

/**
 * Yahoo / upstream quote rows sometimes use `-` vs `.` for class tickers (e.g. BRK-B vs BRK.B).
 *
 * @param {string | null | undefined} a
 * @param {string | null | undefined} b
 */
export function yahooSymbolsLooselyEqual(a, b) {
  const x = normalizeYahooTicker(`${a ?? ''}`)
  const y = normalizeYahooTicker(`${b ?? ''}`)

  if (!x || !y) return false

  if (x === y) return true

  const xn = x.replace(/-/g, '.')
  const yn = y.replace(/-/g, '.')

  return xn === yn
}

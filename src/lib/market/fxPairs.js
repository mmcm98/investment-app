/**
 * Yahoo FX pair symbols for AUD conversion ({@link deriveYahooFxSymbol}). Values are majors quoted vs AUD (=X FX pair).
 */

/** ISO 4217 upper → Yahoo symbol whose `regularMarketPrice` is interpreted as AUD per 1 foreign unit via {@link interpretationForPair}. */
const CURRENCY_TO_YAHOO = /** @type {const Record<string, string>} */ ({
  AUD: '',
  USD: 'USDAUD=X',
  GBP: 'GBPAUD=X',
  EUR: 'EURAUD=X',
  JPY: 'AUDJPY=X',
  HKD: 'HKDAUD=X',
  CAD: 'CADAUD=X',
  NZD: 'NZDAUD=X',
  CHF: 'AUDCHF=X',
  SGD: 'SGDAUD=X',
})

/**
 * @param {string} currencyIso
 * @returns {string | null} Yahoo FX ticker, or null when already AUD.
 */
export function deriveYahooFxSymbol(currencyIso) {
  const c = `${currencyIso ?? ''}`.trim().toUpperCase()

  if (!c || c === 'AUD') return null

  return CURRENCY_TO_YAHOO[c] ?? null
}

/**
 * Interpret Yahoo quote `regularMarketPrice` as **AUD per 1 unit foreign** (`audPerFx`).
 *
 * Most `*AUD=X` pairs ship as AUD per foreign unit directly. Inverse pairs flip.
 *
 * @param {string} yahooFxSymbol
 * @param {number} price Yahoo regularMarketPrice
 */
export function audPerForeignUnit(yahooFxSymbol, price) {
  if (!(Number.isFinite(price) && price > 0)) return null

  if (yahooFxSymbol === 'AUDJPY=X') {
    // Yahoo returns JPY per 1 AUD — invert → AUD per JPY unit (not ideal for quoting JPY equities; approximate).
    return 1 / price
  }

  if (yahooFxSymbol === 'AUDCHF=X') {
    return 1 / price
  }

  return price
}

/**
 * Enumerate distinct FX Yahoo symbols required for currencies in the app.
 *
 * @param {Iterable<string>} currencyCodes
 */
export function uniqueFxPairsForCurrencies(currencyCodes) {
  /** @type {Set<string>} */
  const out = new Set()

  for (const raw of currencyCodes) {
    const sym = deriveYahooFxSymbol(raw)

    if (sym) out.add(sym)
  }

  return [...out]
}

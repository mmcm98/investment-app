import { deriveYahooSymbolFromFmp, normalizeYahooTicker } from './tickerMap.js'
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
 * Code used for Yahoo/FMP mapping when `instrument_symbol` is blank (common right after sync).
 *
 * @param {{ instrument_symbol: string | null, raw: Record<string, unknown> }} row
 */
export function resolveInstrumentCodeForQuote(row) {
  const direct = `${row.instrument_symbol ?? ''}`.trim()

  if (direct) return direct

  const raw = row.raw

  if (!raw || typeof raw !== 'object') return ''

  const inst = pickInstrument(raw)

  if (inst && typeof inst === 'object') {
    const nestedTicker = Reflect.get(inst, 'ticker')

    const fromNested =
      nestedTicker && typeof nestedTicker === 'object'
        ? Reflect.get(/** @type {Record<string, unknown>} */ (nestedTicker), 'symbol') ??
          Reflect.get(/** @type {Record<string, unknown>} */ (nestedTicker), 'code')
        : null

    const code =
      Reflect.get(inst, 'code') ??
      Reflect.get(inst, 'symbol') ??
      Reflect.get(inst, 'ticker') ??
      (typeof fromNested === 'string' ? fromNested : null) ??
      Reflect.get(inst, 'short_code') ??
      Reflect.get(inst, 'trading_symbol') ??
      Reflect.get(inst, 'local_code') ??
      Reflect.get(inst, 'instrument_code') ??
      Reflect.get(inst, 'yahoo_symbol') ??
      Reflect.get(inst, 'yahooSymbol')

    if (typeof code === 'string' && code.trim()) return code.trim()

    if (code != null && typeof code !== 'object') {
      const s = String(code).trim()

      if (s) return s
    }

    const tObj = Reflect.get(inst, 'ticker')

    if (tObj && typeof tObj === 'object') {
      const o = /** @type {Record<string, unknown>} */ (tObj)

      for (const k of ['symbol', 'code', 'ticker']) {
        const v = Reflect.get(o, k)

        if (typeof v === 'string' && v.trim()) return v.trim()
      }
    }
  }

  const top =
    Reflect.get(raw, 'code') ??
    Reflect.get(raw, 'symbol') ??
    Reflect.get(raw, 'ticker') ??
    Reflect.get(raw, 'yahoo_symbol') ??
    Reflect.get(raw, 'security_code')

  return typeof top === 'string' ? top.trim() : ''
}

/**
 * If Sharesight already provides a Yahoo-shaped ticker, use it verbatim.
 *
 * @param {Record<string, unknown>|null|undefined} inst
 */
function tryDirectYahooFromInstrument(inst) {
  if (!inst || typeof inst !== 'object') return ''

  const y =
    Reflect.get(inst, 'yahoo_symbol') ??
    Reflect.get(inst, 'yahooSymbol') ??
    Reflect.get(inst, 'yahoo_ticker') ??
    Reflect.get(inst, 'yahoo')

  return typeof y === 'string' && y.trim() ? normalizeYahooTicker(y) : ''
}

/**
 * Best-effort FMP-style exchange short name for mapping + market hours.
 *
 * @param {Record<string, unknown>} raw
 * @param {string} instrumentSymbol
 */
/** @param {string} micOrHint */
function classifyExchangeHint(micOrHint) {
  const v = `${micOrHint ?? ''}`.trim().toUpperCase()

  if (!v) return null

  if (v === 'AU' || v === 'ASX' || v === 'XASX' || v === 'CXA' || v === 'CHIX' || v === 'SSX' || v.includes('ASX') || v.includes('AUSTRAL')) {
    return 'AU'
  }

  if (
    v === 'LSE' ||
    v === 'XLON' ||
    v === 'LON' ||
    v === 'AIM' ||
    v === 'LSIN' ||
    v === 'GB' ||
    v === 'GBR' ||
    v.includes('LONDON') ||
    v.includes('LSE')
  ) {
    return 'LSE'
  }

  if (v.includes('NYSE') || v === 'NYQ') return 'NYSE'

  if (v.includes('NASDAQ') || v === 'NMS' || v === 'NGS') return 'NASDAQ'

  if (v === 'TSX' || v === 'TOR' || v === 'TSE' || v === 'XTSE' || v.includes('TORONTO')) return 'TSX'

  return null
}

export function inferExchangeShortNameFromSharesightRaw(raw, instrumentSymbol) {
  const inst = pickInstrument(raw)

  /** @type {string[]} */
  const hints = []

  if (inst && typeof inst === 'object') {
    const o = /** @type {Record<string, unknown>} */ (inst)

    for (const k of [
      'exchange',
      'primary_exchange',
      'exchange_code',
      'listing_exchange',
      'trading_exchange',
      'mic',
      'market_identifier',
      'market',
      'country_code',
      'country',
    ]) {
      const val = Reflect.get(o, k)

      if (typeof val === 'string' && val.trim()) hints.push(val)
      else if (typeof val === 'number' && Number.isFinite(val)) hints.push(String(val))
    }
  }

  if (raw && typeof raw === 'object') {
    const r = /** @type {Record<string, unknown>} */ (raw)

    for (const k of ['exchange', 'primary_exchange', 'listing_exchange', 'market']) {
      const val = Reflect.get(r, k)

      if (typeof val === 'string' && val.trim()) hints.push(val)
      else if (typeof val === 'number' && Number.isFinite(val)) hints.push(String(val))
    }
  }

  for (const h of hints) {
    const c = classifyExchangeHint(h)

    if (c) return c
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
  const inst = pickInstrument(row.raw)
  const directYahoo = tryDirectYahooFromInstrument(inst)

  /** Only trust pre-formed Yahoo tickers (contain venue suffix or path). */
  if (directYahoo && /[./]/.test(directYahoo)) {
    const instrumentCode = resolveInstrumentCodeForQuote(row)
    const exchangeShort = inferExchangeShortNameFromSharesightRaw(row.raw, instrumentCode)
    const fmpSymbol = inferFmpSymbol(instrumentCode, exchangeShort)

    return {
      fmpSymbol: fmpSymbol || instrumentCode,
      exchangeShortName: exchangeShort,
      yahooSymbol: directYahoo,
    }
  }

  const instrumentCode = resolveInstrumentCodeForQuote(row)

  const exchangeShort = inferExchangeShortNameFromSharesightRaw(row.raw, instrumentCode)
  const fmpSymbol = inferFmpSymbol(instrumentCode, exchangeShort)

  /** Prefer canonical FMP-shaped base (e.g. DPLM.L) over bare code so venue suffix is not lost. */
  const yahooSymbol = deriveYahooSymbolFromFmp({
    fmpSymbol: fmpSymbol || instrumentCode,
    exchangeShortName: exchangeShort,
  })

  return {
    fmpSymbol: fmpSymbol || instrumentCode,
    exchangeShortName: exchangeShort,
    yahooSymbol,
  }
}

/**
 * One row of console diagnostics for Yahoo quote matching (includes truncated raw JSON).
 *
 * @param {Record<string, unknown>} row
 */
export function describeHoldingQuoteDiagnostics(row) {
  const raw = Reflect.get(row, 'raw')
  const inst = raw && typeof raw === 'object' ? pickInstrument(/** @type {Record<string, unknown>} */ (raw)) : null

  /** @type {string} */
  let rawFull

  try {
    rawFull = JSON.stringify(raw ?? null)

    if (rawFull.length > 16_000) rawFull = `${rawFull.slice(0, 16_000)}…(truncated)`
  } catch {
    rawFull = '(unserializable raw)'
  }

  const id = resolveQuoteIdentity(
    /** @type {{ instrument_symbol: string | null, raw: Record<string, unknown> }} */ ({
      instrument_symbol: Reflect.get(row, 'instrument_symbol') ?? null,
      raw: raw && typeof raw === 'object' ? /** @type {Record<string, unknown>} */ (raw) : {},
    }),
  )

  return {
    holding_external_id: Reflect.get(row, 'holding_external_id'),
    portfolio_role: Reflect.get(row, 'portfolio_role'),
    instrument_symbol: Reflect.get(row, 'instrument_symbol'),
    instrument_name: Reflect.get(row, 'instrument_name'),
    resolved_instrument_code: resolveInstrumentCodeForQuote(
      /** @type {{ instrument_symbol: string | null, raw: Record<string, unknown> }} */ ({
        instrument_symbol: Reflect.get(row, 'instrument_symbol') ?? null,
        raw: raw && typeof raw === 'object' ? /** @type {Record<string, unknown>} */ (raw) : {},
      }),
    ),
    raw_instrument: inst,
    inferred_exchange: id.exchangeShortName,
    fmp_symbol: id.fmpSymbol,
    yahoo_symbol: id.yahooSymbol,
    raw_full: rawFull,
  }
}

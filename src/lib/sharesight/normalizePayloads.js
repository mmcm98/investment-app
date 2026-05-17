/** @param {unknown} v */
function coerceString(v) {
  if (typeof v === 'string') return v.trim() ? v : ''
  if (typeof v === 'number' && Number.isFinite(v)) return String(v)

  return ''
}

/**
 * Sharesight often returns money as `{ amount, currency_code }` and amounts as comma-formatted strings.
 *
 * @param {unknown} v
 */
function coerceNumber(v) {
  if (typeof v === 'number' && Number.isFinite(v)) return v

  if (typeof v === 'string' && v.trim()) {
    const n = Number.parseFloat(v.trim().replace(/,/g, ''))

    return Number.isFinite(n) ? n : null
  }

  if (v && typeof v === 'object' && !Array.isArray(v)) {
    const amt = Reflect.get(v, 'amount')

    if (typeof amt === 'number' && Number.isFinite(amt)) return amt

    if (typeof amt === 'string' && amt.trim()) {
      const n = Number.parseFloat(amt.trim().replace(/,/g, ''))

      if (Number.isFinite(n)) return n
    }

    const val = Reflect.get(v, 'value')

    if (typeof val === 'number' && Number.isFinite(val)) return val

    if (typeof val === 'string' && val.trim()) {
      const n = Number.parseFloat(val.trim().replace(/,/g, ''))

      if (Number.isFinite(n)) return n
    }
  }

  return null
}

const SHARESIGHT_MARKET_LABELS = {
  ASX: 'ASX',
  NZX: 'NZX',
  NYSE: 'NYSE',
  NASDAQ: 'NASDAQ',
  LSE: 'LSE',
  EURONEXT: 'Euronext',
  TSE: 'TSE',
  CVE: 'TSX-V',
  CNSX: 'CNSX',
  HKG: 'HKEX',
  SGX: 'SGX',
  JSE: 'JSE',
  FRA: 'FSE',
  XETR: 'Xetra',
  SWX: 'SIX',
  TYO: 'TSE',
  BIT: 'BIT',
  BME: 'BME',
  STO: 'OMX',
  OSL: 'OSL',
  AMEX: 'AMEX',
  BVMF: 'B3',
  KRX: 'KRX',
  TAI: 'TWSE',
  FundAU: 'AU Fund',
  FundNZ: 'NZ Fund',
  FundUK: 'UK Fund',
  FundUS: 'US Fund',
  FundCA: 'CA Fund',
  mFund: 'mFund',
  OTHER: 'Other',
}

/** @param {Record<string, unknown>} holding */
function sharesightMarketCodeFromHolding(holding) {
  const instrument = Reflect.get(holding, 'instrument')
  const instrumentMarketCode =
    instrument && typeof instrument === 'object'
      ? Reflect.get(/** @type {Record<string, unknown>} */ (instrument), 'market_code')
      : null

  return coerceString(instrumentMarketCode ?? Reflect.get(holding, 'market_code'))
}

/** @param {string} marketCode */
function sharesightMarketDisplayLabel(marketCode) {
  const exact = SHARESIGHT_MARKET_LABELS[/** @type {keyof typeof SHARESIGHT_MARKET_LABELS} */ (marketCode)]

  if (exact) return exact

  const upper = marketCode.toUpperCase()

  return SHARESIGHT_MARKET_LABELS[/** @type {keyof typeof SHARESIGHT_MARKET_LABELS} */ (upper)] ?? marketCode
}

/** @param {unknown} symbol */
export function normalizeSharesightSymbolKey(symbol) {
  return coerceString(symbol)
    .toUpperCase()
    .replace(/^ASX:/i, '')
    .replace(/\.(AX|AU|L)$/i, '')
}

/**
 * Best-effort market value in **AUD** from a Sharesight holdings API payload (v2/v3 shapes vary).
 *
 * @param {Record<string, unknown>|null|undefined} h
 */
export function pickSharesightHoldingValueAudFromRaw(h) {
  if (!h || typeof h !== 'object') return null

  const val = h.value && typeof h.value === 'object' ? /** @type {Record<string, unknown>} */ (h.value) : null
  const valCcy = `${val?.currency_code ?? val?.currency ?? ''}`.trim().toUpperCase()
  const valAmt = coerceNumber(val?.amount ?? val)

  if (valAmt != null && valCcy === 'AUD') return valAmt

  const explicit = coerceNumber(
    Reflect.get(h, 'market_value_aud') ??
      Reflect.get(h, 'portfolio_value_aud') ??
      Reflect.get(h, 'value_in_aud') ??
      Reflect.get(h, 'value_in_reporting_currency_aud'),
  )

  if (explicit != null) return explicit

  const reportingCcy = `${Reflect.get(h, 'reporting_currency') ?? Reflect.get(h, 'reporting_currency_code') ?? ''}`
    .trim()
    .toUpperCase()

  if (reportingCcy === 'AUD') {
    const n = coerceNumber(
      Reflect.get(h, 'reporting_market_value') ??
        Reflect.get(h, 'reporting_value') ??
        Reflect.get(h, 'value_in_reporting_currency') ??
        valAmt,
    )

    if (n != null) return n
  }

  const portCcy = `${Reflect.get(h, 'portfolio_currency') ?? Reflect.get(h, 'portfolio_currency_code') ?? ''}`
    .trim()
    .toUpperCase()

  if (portCcy === 'AUD') {
    const n = coerceNumber(
      Reflect.get(h, 'portfolio_value') ??
        Reflect.get(h, 'market_value_in_portfolio_currency') ??
        Reflect.get(h, 'value_in_portfolio_currency') ??
        Reflect.get(h, 'market_value') ??
        Reflect.get(h, 'latest_close_value') ??
        Reflect.get(h, 'close_value') ??
        valAmt,
    )

    if (n != null) return n
  }

  const inst =
    Reflect.get(h, 'instrument') && typeof Reflect.get(h, 'instrument') === 'object'
      ? /** @type {Record<string, unknown>} */ (Reflect.get(h, 'instrument'))
      : null

  if (inst) {
    const instVal =
      Reflect.get(inst, 'value') && typeof Reflect.get(inst, 'value') === 'object'
        ? /** @type {Record<string, unknown>} */ (Reflect.get(inst, 'value'))
        : null
    const iccy = `${instVal?.currency_code ?? instVal?.currency ?? ''}`.trim().toUpperCase()
    const iamt = coerceNumber(instVal?.amount ?? Reflect.get(inst, 'value'))

    if (iamt != null && iccy === 'AUD') return iamt
  }

  const curVal =
    h.current_value && typeof h.current_value === 'object'
      ? /** @type {Record<string, unknown>} */ (h.current_value)
      : null
  const curCcy = `${curVal?.currency_code ?? curVal?.currency ?? ''}`.trim().toUpperCase()
  const curAmt = coerceNumber(curVal?.amount)

  if (curAmt != null && curCcy === 'AUD') return curAmt

  return null
}

/**
 * @param {Record<string, unknown>|null|undefined} h
 */
export function pickSharesightQuantityFromRaw(h) {
  if (!h || typeof h !== 'object') return null

  const inst =
    Reflect.get(h, 'instrument') && typeof Reflect.get(h, 'instrument') === 'object'
      ? /** @type {Record<string, unknown>} */ (Reflect.get(h, 'instrument'))
      : null

  return coerceNumber(
    Reflect.get(h, 'quantity') ??
      Reflect.get(h, 'quantity_on_hand') ??
      Reflect.get(h, 'units_on_hand') ??
      Reflect.get(h, 'units') ??
      Reflect.get(h, 'balance') ??
      Reflect.get(h, 'units_held') ??
      (inst ? Reflect.get(inst, 'quantity') : null) ??
      (inst ? Reflect.get(inst, 'units_on_hand') : null) ??
      (inst ? Reflect.get(inst, 'balance') : null),
  )
}

/**
 * @param {{ holding_value_aud?: unknown, market_value?: unknown, currency?: unknown, raw?: unknown }} row
 */
export function resolveSharesightHoldingValueAud(row) {
  const col = coerceNumber(Reflect.get(row, 'holding_value_aud'))

  if (col != null) return col

  const raw =
    row.raw && typeof row.raw === 'object' ? /** @type {Record<string, unknown>} */ (row.raw) : null

  const fromRaw = pickSharesightHoldingValueAudFromRaw(raw)

  if (fromRaw != null) return fromRaw

  const cur = `${Reflect.get(row, 'currency') ?? ''}`.trim().toUpperCase()

  if (cur === 'AUD') return coerceNumber(Reflect.get(row, 'market_value'))

  return null
}

/**
 * @param {{ quantity?: unknown, raw?: unknown }} row
 */
export function resolveSharesightHoldingQuantity(row) {
  const col = coerceNumber(Reflect.get(row, 'quantity'))

  if (col != null) return col

  const raw =
    row.raw && typeof row.raw === 'object' ? /** @type {Record<string, unknown>} */ (row.raw) : null

  return pickSharesightQuantityFromRaw(raw)
}

/** @param {unknown} raw */
export function normalizeHolding(raw) {
  if (!raw || typeof raw !== 'object') return null

  /** @type {any} */
  const h = raw

  const instrument = h.instrument && typeof h.instrument === 'object' ? h.instrument : null

  const holding_external_id = coerceString(h.id ?? h.holding_id ?? h.holding?.id)
  if (!holding_external_id) return null

  const currency = coerceString(
    h.currency_code ??
      h.value?.currency_code ??
      instrument?.currency_code ??
      h.portfolio_currency ??
      '',
  )

  const market_value = coerceNumber(
    h.market_value ??
      h.value ??
      h.latest_close_value ??
      h.close_value ??
      h.portfolio_value ??
      instrument?.market_value ??
      instrument?.value ??
      instrument?.latest_close_value,
  )

  const holding_value_aud =
    pickSharesightHoldingValueAudFromRaw(/** @type {Record<string, unknown>} */ (h)) ??
    (currency === 'AUD' ? market_value : null)

  return {
    holding_external_id,
    instrument_symbol: coerceString(instrument?.code ?? instrument?.symbol ?? instrument?.ticker ?? h.code),
    instrument_name: coerceString(instrument?.name ?? h.name ?? h.description),
    quantity: pickSharesightQuantityFromRaw(/** @type {Record<string, unknown>} */ (h)),
    market_value,
    holding_value_aud,
    cost_basis: null,
    unrealized_gain_loss: null,
    realized_gain_loss: null,
    payout_gain: null,
    currency_gain: null,
    total_gain: null,
    capital_gain_percent: null,
    total_gain_percent: null,
    currency,
    raw: /** @type {Record<string, unknown>} */ ({ ...h }),
  }
}

/** @param {unknown} raw */
export function normalizeTrade(raw) {
  if (!raw || typeof raw !== 'object') return null

  /** @type {any} */
  const t = raw

  const trade_external_id = coerceString(t.id ?? t.trade_id)
  if (!trade_external_id) return null

  return {
    trade_external_id,
    raw: /** @type {Record<string, unknown>} */ ({ ...t }),
  }
}

/** @param {unknown} raw */
export function normalizePayout(raw) {
  if (!raw || typeof raw !== 'object') return null

  /** @type {any} */
  const p = raw

  const income_external_id = coerceString(p.id ?? p.payout_id)
  if (!income_external_id) return null

  const paidRaw = coerceString(p.transaction_date ?? p.payment_date ?? p.date ?? '')
  const paid_on = paidRaw ? paidRaw.slice(0, 10) : null

  return {
    income_external_id,
    paid_on,
    amount: coerceNumber(p.amount ?? p.payment ?? p.amount_paid ?? p.amount_base),
    currency: coerceString(p.currency_code ?? p.currency ?? ''),
    kind: coerceString(p.transaction_type ?? p.type ?? 'payout'),
    raw: /** @type {Record<string, unknown>} */ ({ ...p }),
  }
}

/**
 * @param {unknown} valuation Sharesight `GET …/valuation.json` payload
 * @returns {unknown[]}
 */
export function parseValuationHoldingsList(valuation) {
  if (!valuation || typeof valuation !== 'object') return []

  const v = /** @type {Record<string, unknown>} */ (valuation)

  /** @type {unknown[]} */
  const candidates = []

  if (Array.isArray(v.holdings)) candidates.push(...v.holdings)

  if (Array.isArray(v.portfolio_holdings)) candidates.push(...v.portfolio_holdings)

  const port = v.portfolio

  if (port && typeof port === 'object') {
    const ph = Reflect.get(/** @type {Record<string, unknown>} */ (port), 'holdings')

    if (Array.isArray(ph)) candidates.push(...ph)
  }

  if (Array.isArray(v.data)) {
    for (const chunk of v.data) {
      if (chunk && typeof chunk === 'object') {
        const h = Reflect.get(/** @type {Record<string, unknown>} */ (chunk), 'holdings')

        if (Array.isArray(h)) candidates.push(...h)
      }
    }
  }

  return candidates
}

/**
 * Index valuation `holdings[]` rows by Sharesight holding id (and instrument id as fallback key).
 *
 * @param {unknown} valuation
 * @returns {Map<string, Record<string, unknown>>}
 */
/**
 * @param {unknown} item
 */
function indexValuationHoldingAliases(item, /** @type {Map<string, Record<string, unknown>>} */ map) {
  if (!item || typeof item !== 'object') return

  const o = /** @type {Record<string, unknown>} */ (item)

  const idCandidates = [
    Reflect.get(o, 'id'),
    Reflect.get(o, 'holding_id'),
    Reflect.get(o, 'portfolio_holding_id'),
    Reflect.get(o, 'sharesight_holding_id'),
  ]

  const nestedH = Reflect.get(o, 'holding')

  if (nestedH && typeof nestedH === 'object') {
    const nh = /** @type {Record<string, unknown>} */ (nestedH)

    idCandidates.push(Reflect.get(nh, 'id'), Reflect.get(nh, 'holding_id'))
  }

  for (const rawId of idCandidates) {
    const hid = coerceString(rawId)

    if (hid) map.set(hid, o)
  }

  const inst = Reflect.get(o, 'instrument')

  if (inst && typeof inst === 'object') {
    const io = /** @type {Record<string, unknown>} */ (inst)

    const iid = coerceString(
      Reflect.get(io, 'id') ?? Reflect.get(io, 'instrument_id') ?? Reflect.get(io, 'security_id'),
    )

    if (iid) map.set(iid, o)

    const pcode = coerceString(
      Reflect.get(io, 'portfolio_investment_id') ?? Reflect.get(io, 'portfolio_instrument_id'),
    )

    if (pcode) map.set(pcode, o)
  }
}

export function indexValuationHoldingsByExternalId(valuation) {
  /** @type {Map<string, Record<string, unknown>>} */
  const map = new Map()

  for (const item of parseValuationHoldingsList(valuation)) {
    indexValuationHoldingAliases(item, map)
  }

  return map
}

/**
 * Last row wins when duplicate codes exist in the valuation payload.
 *
 * @param {unknown} valuation
 * @returns {Map<string, Record<string, unknown>>}
 */
export function indexValuationHoldingsByInstrumentCode(valuation) {
  /** @type {Map<string, Record<string, unknown>>} */
  const map = new Map()

  for (const item of parseValuationHoldingsList(valuation)) {
    if (!item || typeof item !== 'object') continue

    const o = /** @type {Record<string, unknown>} */ (item)
    const inst = Reflect.get(o, 'instrument')
    const instObj = inst && typeof inst === 'object' ? /** @type {Record<string, unknown>} */ (inst) : null

    let rawCode = ''

    if (instObj) {
      rawCode = coerceString(
        Reflect.get(instObj, 'code') ??
          Reflect.get(instObj, 'symbol') ??
          Reflect.get(instObj, 'ticker'),
      )
    }

    if (!rawCode) {
      rawCode = coerceString(
        Reflect.get(o, 'symbol') ?? Reflect.get(o, 'code') ?? Reflect.get(o, 'instrument_symbol'),
      )
    }

    const code = rawCode
      .trim()
      .toUpperCase()
      .replace(/^ASX:/i, '')
      .replace(/\.(AX|AU|L)$/i, '')

    if (code) map.set(code, o)
  }

  return map
}

/**
 * Best-effort **total** cost basis from a Sharesight valuation or performance holding object (amount, not per-share).
 *
 * @param {Record<string, unknown>} o
 */
export function pickSharesightCostBasisFromHoldingLike(o) {
  const qty = pickSharesightQuantityFromRaw(o)
  const direct = coerceNumber(
    Reflect.get(o, 'cost_basis') ??
      Reflect.get(o, 'total_cost') ??
      Reflect.get(o, 'cost_value') ??
      Reflect.get(o, 'cost') ??
      Reflect.get(o, 'book_cost') ??
      Reflect.get(o, 'opening_balance'),
  )

  if (direct != null) return direct

  const purchasePrice = coerceNumber(Reflect.get(o, 'purchase_price'))

  if (purchasePrice != null && qty != null && qty !== 0) {
    const total = purchasePrice * qty

    if (Number.isFinite(total)) return total
  }

  return null
}

/**
 * @param {Record<string, unknown>} o
 */
export function pickSharesightRealizedGainFromHoldingLike(o) {
  return coerceNumber(
    Reflect.get(o, 'realized_gain_loss') ??
      Reflect.get(o, 'realised_gain_loss') ??
      Reflect.get(o, 'realized_capital_gain') ??
      Reflect.get(o, 'realised_capital_gain') ??
      Reflect.get(o, 'realised_capital_gain_loss') ??
      Reflect.get(o, 'realized_capital_gain_loss') ??
      Reflect.get(o, 'total_realized_gain') ??
      Reflect.get(o, 'total_realised_gain'),
  )
}

/**
 * BUG-02: log raw valuation holding for MP1 / GHHF to discover cost field names in production payloads.
 *
 * @param {Record<string, unknown>} valHolding
 * @param {Record<string, unknown>} row
 */
function logValuationHoldingCostBasisDebug(valHolding, row) {
  const sym = `${Reflect.get(row, 'instrument_symbol') ?? ''}`.toUpperCase()
  const inst = Reflect.get(valHolding, 'instrument')
  const instCode =
    inst && typeof inst === 'object'
      ? `${Reflect.get(/** @type {Record<string, unknown>} */ (inst), 'code') ?? Reflect.get(/** @type {Record<string, unknown>} */ (inst), 'symbol') ?? ''}`.toUpperCase()
      : ''

  const hay = `${sym}|${instCode}`

  if (!hay.includes('MP1') && !hay.includes('GHHF')) return

  console.info('[sharesight-sync] valuation_holding_cost_basis_debug', {
    holding_external_id: Reflect.get(row, 'holding_external_id'),
    instrument_symbol: sym || instCode,
    raw_valuation_holding: valHolding,
  })
}

/**
 * Merge one valuation holding row into a `sharesight_holdings` upsert row (numeric columns + raw snapshot).
 *
 * @param {Record<string, unknown>} row
 * @param {Record<string, unknown>} valHolding
 */
export function applyValuationHoldingToSharesightRow(row, valHolding) {
  logValuationHoldingCostBasisDebug(valHolding, row)

  const v = valHolding
  const qty = pickSharesightQuantityFromRaw(v)
  const marketVal = coerceNumber(
    Reflect.get(v, 'market_value') ??
      Reflect.get(v, 'latest_close_value') ??
      Reflect.get(v, 'close_value') ??
      Reflect.get(v, 'value'),
  )
  const cost = pickSharesightCostBasisFromHoldingLike(v)
  const capitalGain = coerceNumber(Reflect.get(v, 'capital_gain') ?? Reflect.get(v, 'gain_loss'))
  const payoutGain = coerceNumber(Reflect.get(v, 'payout_gain') ?? Reflect.get(v, 'income_gain') ?? Reflect.get(v, 'income'))
  const currencyGain = coerceNumber(Reflect.get(v, 'currency_gain'))
  const totalGain =
    coerceNumber(Reflect.get(v, 'total_gain') ?? Reflect.get(v, 'gain_loss')) ??
    (capitalGain != null && payoutGain != null ? capitalGain + payoutGain : capitalGain)
  const capitalGainPercent = coerceNumber(Reflect.get(v, 'capital_gain_percent') ?? Reflect.get(v, 'gain_loss_percent'))
  const totalGainPercent = coerceNumber(Reflect.get(v, 'total_gain_percent'))
  const averagePurchasePrice = coerceNumber(Reflect.get(v, 'average_purchase_price'))
  const marketCode = sharesightMarketCodeFromHolding(v)
  const exchangeDisplay = marketCode ? sharesightMarketDisplayLabel(marketCode) : ''
  const currency = coerceString(
    Reflect.get(v, 'instrument_currency') ??
      Reflect.get(v, 'currency_code') ??
      Reflect.get(v, 'currency') ??
      `${Reflect.get(row, 'currency') ?? ''}`,
  )

  const syntheticForAud = /** @type {Record<string, unknown>} */ ({
    ...v,
    market_value: marketVal ?? Reflect.get(v, 'market_value'),
    value: Reflect.get(v, 'value'),
    portfolio_currency: Reflect.get(v, 'portfolio_currency'),
    reporting_currency: Reflect.get(v, 'reporting_currency'),
  })

  let holdingValueAud = pickSharesightHoldingValueAudFromRaw(syntheticForAud)

  if (holdingValueAud == null && currency === 'AUD' && marketVal != null) holdingValueAud = marketVal

  const rawBase =
    row.raw && typeof row.raw === 'object' ? /** @type {Record<string, unknown>} */ ({ ...row.raw }) : {}

  rawBase.sharesight_valuation_holding = {
    id: Reflect.get(v, 'id'),
    symbol: Reflect.get(v, 'symbol'),
    quantity: Reflect.get(v, 'quantity'),
    value: Reflect.get(v, 'value'),
    cost_basis: Reflect.get(v, 'cost_basis'),
    purchase_price: Reflect.get(v, 'purchase_price'),
    average_purchase_price: averagePurchasePrice,
    total_cost: Reflect.get(v, 'total_cost'),
    capital_gain: Reflect.get(v, 'capital_gain'),
    gain_loss: Reflect.get(v, 'gain_loss'),
    payout_gain: Reflect.get(v, 'payout_gain'),
    currency_gain: Reflect.get(v, 'currency_gain'),
    total_gain: Reflect.get(v, 'total_gain'),
    market_code: marketCode,
    exchange_display: exchangeDisplay,
  }

  const prevQty = coerceNumber(Reflect.get(row, 'quantity'))
  const prevMv = coerceNumber(Reflect.get(row, 'market_value'))
  const prevHv = coerceNumber(Reflect.get(row, 'holding_value_aud'))
  const hvOut = holdingValueAud != null ? holdingValueAud : prevHv

  return {
    ...row,
    quantity: qty != null ? qty : prevQty,
    market_value: marketVal != null ? marketVal : prevMv,
    holding_value_aud: hvOut,
    cost_basis: cost != null ? cost : Reflect.get(row, 'cost_basis'),
    unrealized_gain_loss: capitalGain != null ? capitalGain : Reflect.get(row, 'unrealized_gain_loss'),
    payout_gain: payoutGain != null ? payoutGain : Reflect.get(row, 'payout_gain'),
    currency_gain: currencyGain != null ? currencyGain : Reflect.get(row, 'currency_gain'),
    total_gain: totalGain != null ? totalGain : Reflect.get(row, 'total_gain'),
    capital_gain_percent: capitalGainPercent != null ? capitalGainPercent : Reflect.get(row, 'capital_gain_percent'),
    total_gain_percent: totalGainPercent != null ? totalGainPercent : Reflect.get(row, 'total_gain_percent'),
    currency: currency || `${Reflect.get(row, 'currency') ?? ''}`,
    raw: rawBase,
  }
}

/**
 * Collect arrays that may contain holding-level rows from a performance API payload (shape varies).
 *
 * @param {unknown} performance
 * @returns {unknown[]}
 */
export function collectPerformanceHoldingLikeRows(performance) {
  if (!performance || typeof performance !== 'object') return []

  const p = /** @type {Record<string, unknown>} */ (performance)

  return Array.isArray(p.holdings) ? p.holdings : []
}

/**
 * @param {unknown} performance
 * @returns {Map<string, Record<string, unknown>>}
 */
export function indexPerformanceHoldingsByExternalId(performance) {
  /** @type {Map<string, Record<string, unknown>>} */
  const map = new Map()

  for (const item of collectPerformanceHoldingLikeRows(performance)) {
    if (!item || typeof item !== 'object') continue

    const o = /** @type {Record<string, unknown>} */ (item)
    const hid = coerceString(Reflect.get(o, 'id') ?? Reflect.get(o, 'holding_id'))

    if (hid) map.set(hid, o)

    const symbol = normalizeSharesightSymbolKey(Reflect.get(o, 'symbol'))
    if (symbol) map.set(`symbol:${symbol}`, o)
  }

  return map
}

/**
 * Fill only **null** numeric fields on a holding row from a performance payload row (backup when valuation omits fields).
 *
 * @param {Record<string, unknown>} row
 * @param {Record<string, unknown>} perfRow
 */
export function applyPerformanceHoldingFillGaps(row, perfRow) {
  const qty = pickSharesightQuantityFromRaw(perfRow)
  const marketVal = coerceNumber(
    Reflect.get(perfRow, 'market_value') ??
      Reflect.get(perfRow, 'value') ??
      Reflect.get(perfRow, 'latest_close_value'),
  )

  const capitalGain = coerceNumber(Reflect.get(perfRow, 'capital_gain'))
  const payoutGain = coerceNumber(Reflect.get(perfRow, 'payout_gain'))
  const currencyGain = coerceNumber(Reflect.get(perfRow, 'currency_gain'))
  const totalGain = coerceNumber(Reflect.get(perfRow, 'total_gain'))
  const capitalGainPercent = coerceNumber(Reflect.get(perfRow, 'capital_gain_percent'))
  const totalGainPercent = coerceNumber(Reflect.get(perfRow, 'total_gain_percent'))

  const prevQty = coerceNumber(Reflect.get(row, 'quantity'))
  const prevMv = coerceNumber(Reflect.get(row, 'market_value'))

  const currency = coerceString(
    Reflect.get(perfRow, 'instrument_currency') ??
      Reflect.get(perfRow, 'currency_code') ??
      `${Reflect.get(row, 'currency') ?? ''}`,
  )

  const nextQty = prevQty == null && qty != null ? qty : prevQty
  const nextMv = prevMv == null && marketVal != null ? marketVal : prevMv

  let nextHv = coerceNumber(Reflect.get(row, 'holding_value_aud'))

  if (nextHv == null) {
    const syn = /** @type {Record<string, unknown>} */ ({ ...perfRow, market_value: nextMv ?? marketVal })
    const fromPick = pickSharesightHoldingValueAudFromRaw(syn)
    const cur = currency || `${Reflect.get(row, 'currency') ?? ''}`

    nextHv = fromPick != null ? fromPick : cur === 'AUD' && nextMv != null ? nextMv : null
  }

  const rawBase =
    row.raw && typeof row.raw === 'object' ? /** @type {Record<string, unknown>} */ ({ ...row.raw }) : {}

  rawBase.sharesight_performance_holding = {
    id: Reflect.get(perfRow, 'id'),
    symbol: Reflect.get(perfRow, 'symbol'),
    market: Reflect.get(perfRow, 'market'),
    name: Reflect.get(perfRow, 'name'),
    quantity: Reflect.get(perfRow, 'quantity'),
    value: Reflect.get(perfRow, 'value'),
    capital_gain: Reflect.get(perfRow, 'capital_gain'),
    capital_gain_percent: Reflect.get(perfRow, 'capital_gain_percent'),
    payout_gain: Reflect.get(perfRow, 'payout_gain'),
    payout_gain_percent: Reflect.get(perfRow, 'payout_gain_percent'),
    currency_gain: Reflect.get(perfRow, 'currency_gain'),
    currency_gain_percent: Reflect.get(perfRow, 'currency_gain_percent'),
    total_gain: Reflect.get(perfRow, 'total_gain'),
    total_gain_percent: Reflect.get(perfRow, 'total_gain_percent'),
  }

  return {
    ...row,
    quantity: nextQty,
    market_value: nextMv,
    unrealized_gain_loss: capitalGain != null ? capitalGain : Reflect.get(row, 'unrealized_gain_loss'),
    payout_gain: payoutGain != null ? payoutGain : Reflect.get(row, 'payout_gain'),
    currency_gain: currencyGain != null ? currencyGain : Reflect.get(row, 'currency_gain'),
    total_gain: totalGain != null ? totalGain : Reflect.get(row, 'total_gain'),
    capital_gain_percent: capitalGainPercent != null ? capitalGainPercent : Reflect.get(row, 'capital_gain_percent'),
    total_gain_percent: totalGainPercent != null ? totalGainPercent : Reflect.get(row, 'total_gain_percent'),
    holding_value_aud: nextHv != null ? nextHv : Reflect.get(row, 'holding_value_aud'),
    currency: currency || `${Reflect.get(row, 'currency') ?? ''}`,
    raw: rawBase,
  }
}

/** @param {unknown} cashPayload */
export function extractCashBalancesFromCashAccountsPayload(cashPayload) {
  const payload = cashPayload && typeof cashPayload === 'object' ? /** @type {Record<string, unknown>} */ (cashPayload) : {}
  const rawAccounts = Array.isArray(payload.cash_accounts)
    ? payload.cash_accounts
    : Array.isArray(payload.accounts)
      ? payload.accounts
      : Array.isArray(cashPayload)
        ? cashPayload
        : []

  return rawAccounts
    .map((item) => {
      if (!item || typeof item !== 'object') return null

      const account = /** @type {Record<string, unknown>} */ (item)
      const id = coerceString(Reflect.get(account, 'id'))
      const currency = coerceString(Reflect.get(account, 'currency') ?? Reflect.get(account, 'currency_code'))

      return {
        cash_account_id: id,
        account_key: id || coerceString(Reflect.get(account, 'name')) || 'cash_account:unknown',
        name: coerceString(Reflect.get(account, 'name')),
        label: coerceString(Reflect.get(account, 'name')),
        currency,
        balance: coerceNumber(Reflect.get(account, 'balance')),
        balance_in_portfolio_currency: coerceNumber(Reflect.get(account, 'balance_in_portfolio_currency')),
        raw: /** @type {Record<string, unknown>} */ ({ ...account }),
      }
    })
    .filter(Boolean)
}

/** @param {unknown} valuation */
export function extractCashBalancesFromValuationPayload(valuation) {
  /** @type {Array<{ account_key: string, label?: string, currency?: string, balance?: number|null, raw: Record<string, unknown> }>} */
  const rows = []

  const pushRow = (
    /** @type {{ account_key: string, label?: string, currency?: string, balance?: unknown, raw?: Record<string, unknown> }} */ r,
  ) => {
    rows.push({
      account_key: r.account_key,
      label: r.label,
      currency: r.currency === undefined || r.currency === null ? '' : coerceString(r.currency),
      balance: coerceNumber(r.balance),
      raw: r.raw ?? {},
    })
  }

  /** @type {any} */
  const vAny = valuation

  const tryConsumeArray = (arr, namespace) => {
    if (!Array.isArray(arr)) return

    arr.forEach((item, idx) => {
      if (!item || typeof item !== 'object') return

      /** @type {any} */
      const it = item

      const key = coerceString(
        it.account_id ?? it.account_key ?? it.id ?? it.portfolio_cash_account_id ?? `${namespace}:${idx}`,
      )

      pushRow({
        account_key: key || `${namespace}:${idx}`,
        label: coerceString(it.name ?? it.description ?? it.broker ?? it.bank_name ?? it.account_name),
        currency: coerceString(it.currency_code ?? it.currency ?? it.portfolio_currency ?? ''),
        balance: it.balance ?? it.value?.amount ?? it.cash_balance ?? it.total,
        raw: /** @type {Record<string, unknown>} */ ({ ...it }),
      })
    })
  }

  tryConsumeArray(vAny?.cash_accounts ?? vAny?.cashBalances ?? vAny?.portfolio_cash_accounts, 'cash_account')
  tryConsumeArray(vAny?.linked_accounts ?? vAny?.bank_accounts ?? vAny?.brokers, 'linked_account')

  if (rows.length === 0) {
    pushRow({
      account_key: 'portfolio_valuation:unparsed',
      label: 'Unparsed valuation payload (inspect raw JSON)',
      raw: vAny && typeof vAny === 'object' ? { valuation: JSON.parse(JSON.stringify(vAny)) } : { valuation },
    })
  }

  return rows
}

const BATCH_PATH = '/api/market/batch'

/**
 * @param {Record<string, unknown>} payload
 * @returns {Promise<Record<string, unknown>>}
 */
export async function postMarketBatch(payload) {
  const secret = `${import.meta.env.VITE_MARKET_API_SECRET ?? ''}`.trim()

  /** @type {Record<string, string>} */
  const headers = { 'Content-Type': 'application/json' }

  if (secret) headers['x-market-secret'] = secret

  const res = await fetch(BATCH_PATH, {
    method: 'POST',
    headers,
    body: JSON.stringify(payload),
  })

  if (!res.ok) {
    const text = await res.text().catch(() => '')

    console.warn('[market-api] batch_http_error', {
      status: res.status,
      op: typeof payload.op === 'string' ? payload.op : undefined,
      bodyPreview: text.slice(0, 240),
      sentMarketSecret: Boolean(secret),
    })

    throw new Error(`market batch HTTP ${res.status}: ${text.slice(0, 300)}`)
  }

  return /** @type {Record<string, unknown>} */ (await res.json())
}

/**
 * @param {string} query
 * @param {number} [limit]
 */
export async function postTickerSearch(query, limit = 15) {
  return postMarketBatch({ op: 'tickerSearch', query, limit })
}

/**
 * Direct FMP search from the browser (watchlist typeahead).
 *
 * @param {string} query
 * @param {number} [limit]
 * @returns {Promise<{ symbol: string, name: string, exchangeShortName: string, currency: string|null }[]>}
 */
export async function fetchFmpTickerSearch(query, limit = 10) {
  const key = `${import.meta.env.VITE_FMP_API_KEY ?? ''}`.trim()
  if (!key) throw new Error('VITE_FMP_API_KEY is not configured.')

  const q = `${query ?? ''}`.trim()
  if (!q) return []

  const url = `https://financialmodelingprep.com/stable/search-symbol?query=${encodeURIComponent(q)}&limit=${limit}&apikey=${encodeURIComponent(key)}`
  const res = await fetch(url, { headers: { Accept: 'application/json' } })
  const json = await res.json()

  if (!res.ok) {
    throw new Error(`FMP search failed (${res.status}): ${JSON.stringify(json).slice(0, 200)}`)
  }

  const rawList = Array.isArray(json)
    ? json
    : json && typeof json === 'object' && Array.isArray(Reflect.get(json, 'data'))
      ? Reflect.get(json, 'data')
      : []
  /** @type {{ symbol: string, name: string, exchangeShortName: string, currency: string|null }[]} */
  const results = []

  for (const row of rawList) {
    if (!row || typeof row !== 'object') continue
    const o = /** @type {Record<string, unknown>} */ (row)
    const symbol = `${Reflect.get(o, 'symbol') ?? Reflect.get(o, 'ticker') ?? ''}`.trim().toUpperCase()
    const name = `${Reflect.get(o, 'name') ?? Reflect.get(o, 'companyName') ?? ''}`.trim()
    const exchangeShortName =
      `${
        Reflect.get(o, 'stockExchangeShortName') ??
        Reflect.get(o, 'exchangeShortName') ??
        Reflect.get(o, 'exchange_short_name') ??
        Reflect.get(o, 'stock_exchange_short_name') ??
        Reflect.get(o, 'exchange') ??
        Reflect.get(o, 'stock_exchange') ??
        ''
      }`
        .trim()
        .toUpperCase() || 'UNKNOWN'
    const curRaw = Reflect.get(o, 'currency')
    const currency = typeof curRaw === 'string' && curRaw.trim() ? curRaw.trim().toUpperCase() : null
    if (!symbol || !name) continue
    results.push({ symbol, name, exchangeShortName, currency })
    if (results.length >= limit) break
  }

  return results
}

/**
 * @param {string} symbol Yahoo symbol e.g. VGS.AX
 * @param {'1M'|'3M'|'6M'|'1Y'|'2Y'|'ALL'} [preset]
 */
export async function postChartHistory(symbol, preset = '1Y') {
  return postMarketBatch({ op: 'chartHistory', symbol, preset })
}

/**
 * @param {string} symbol FMP base symbol e.g. AAPL
 */
export async function postEquityFacts(symbol) {
  return postMarketBatch({ op: 'equityFacts', symbol })
}

/**
 * @param {string} symbol FMP base symbol e.g. AAPL
 * @param {string} exchangeShort
 * @param {'3M'|'6M'|'1Y'|'2Y'} period
 */
export async function postFmpHistoricalPriceFull(symbol, exchangeShort, period) {
  return postMarketBatch({
    op: 'fmpHistoricalFull',
    symbol,
    exchangeShort,
    period,
  })
}

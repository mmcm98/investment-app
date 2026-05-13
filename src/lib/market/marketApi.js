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
 * @param {string} symbol Yahoo symbol e.g. VGS.AX
 * @param {'1M'|'3M'|'6M'|'1Y'|'2Y'|'ALL'} [preset]
 */
export async function postChartHistory(symbol, preset = '1Y') {
  return postMarketBatch({ op: 'chartHistory', symbol, preset })
}

/**
 * @param {string} symbol FMP base symbol e.g. AAPL
 */
export async function postFmpHistoricalPriceFull(symbol, exchangeShort, period) {
  return postMarketBatch({
    op: 'fmpHistoricalFull',
    symbol,
    exchangeShort,
    period,
  })
}

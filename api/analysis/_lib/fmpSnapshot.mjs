const FMP_BASE = 'https://financialmodelingprep.com/api/v3'

/**
 * Compact fundamentals quote for Claude (best-effort).
 *
 * @param {string} fmpSymbol
 * @param {string | undefined} fmpKey
 */
export async function fetchFmpFundamentalsSnapshot(fmpSymbol, fmpKey) {
  const key = `${fmpKey ?? ''}`.trim()

  if (!key || !`${fmpSymbol ?? ''}`.trim()) return null

  const sym = encodeURIComponent(`${fmpSymbol}`.trim())

  const url = `${FMP_BASE}/profile/${sym}?apikey=${encodeURIComponent(key)}`

  const res = await fetch(url, { headers: { Accept: 'application/json' } })

  if (!res.ok) return { error: `fmp_http_${res.status}` }

  /** @type {unknown} */
  const json = await res.json()

  if (!Array.isArray(json) || json.length === 0) return null

  /** @type {Record<string, unknown>} */
  const row = /** @type {Record<string, unknown>} */ (json[0])

  return {
    symbol: row.symbol,
    companyName: row.companyName,
    exchangeShortName: row.exchangeShortName,
    industry: row.industry,
    sector: row.sector,
    mktCap: row.mktCap,
    price: row.price,
    pe: row.pe,
    beta: row.beta,
    lastDiv: row.lastDiv,
    range: row.range,
    description: row.description,
  }
}

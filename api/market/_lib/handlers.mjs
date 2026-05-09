/** Server-only: Yahoo via yahoo-finance2 + FMP quote fallback — no DOM scraping. */
import yahooFinance from 'yahoo-finance2'

const FMP_BASE = 'https://financialmodelingprep.com/api/v3'

/**
 * @param {typeof process.env | Record<string,string|undefined>} env
 */
function resolveFmpApiKey(env) {
  return (
    `${env.FMP_API_KEY ?? ''}`.trim() ||
    `${env.VITE_FMP_API_KEY ?? ''}`.trim() ||
    `${env.VITE_FMP ?? ''}`.trim()
  )
}

/** @typedef {{ fmpSymbol?: string|null, exchangeShort?: string|null, yahooSymbol: string }} QuoteItemInput */

async function fmpQuote(symbol, apiKey) {
  const key = `${apiKey ?? ''}`.trim()

  if (!key) return null

  const url = `${FMP_BASE}/quote/${encodeURIComponent(symbol)}?apikey=${encodeURIComponent(key)}`
  const res = await fetch(url, { headers: { Accept: 'application/json' } })

  if (!res.ok) return null

  /** @type {unknown} */
  const json = await res.json()

  if (!Array.isArray(json) || json.length === 0) return null

  /** @type {Record<string, unknown>} */
  const row = /** @type {Record<string, unknown>} */ (json[0])

  return row
}

/**
 * @param {unknown} quoteResult
 */
function coerceYahooQuote(quoteResult) {
  if (!quoteResult || typeof quoteResult !== 'object') return null

  /** @type {Record<string, unknown>} */
  const q = /** @type {Record<string, unknown>} */ (quoteResult)

  const currency = Reflect.get(q, 'currency')
  const last = Reflect.get(q, 'regularMarketPrice')

  const previousClose =
    Reflect.get(q, 'regularMarketPreviousClose') ?? Reflect.get(q, 'postMarketPricePreviousClose')

  const changePct = Reflect.get(q, 'regularMarketChangePercent')

  const parsedLast =
    typeof last === 'number' && Number.isFinite(last) ? last : Number.parseFloat(`${last ?? ''}`)
  const parsedPrev =
    typeof previousClose === 'number' && Number.isFinite(previousClose)
      ? previousClose
      : Number.parseFloat(`${previousClose ?? ''}`)
  const parsedChg =
    typeof changePct === 'number' && Number.isFinite(changePct) ? changePct : Number.parseFloat(`${changePct ?? ''}`)

  return {
    currency: typeof currency === 'string' ? currency : null,
    last: Number.isFinite(parsedLast) ? parsedLast : Number.NaN,
    previous_close: Number.isFinite(parsedPrev) ? parsedPrev : Number.NaN,
    change_percent: Number.isFinite(parsedChg) ? parsedChg : Number.NaN,
  }
}

/** @template T */

/** @returns {Awaited<T>[]} */
async function mapPool(concurrency, items, fn) {
  /** @type {Awaited<T>[]} */
  const out = []

  let i = 0

  /** @returns {Promise<void>} */
  const worker = async () => {
    while (true) {
      const job = /** @type {number} */ (i)

      i += 1

      if (job >= items.length) return

      out[job] = await fn(items[job], job)
    }
  }

  /** @type {Promise<void>[]} */
  const workers = []

  for (let w = 0; w < Math.min(concurrency, items.length); w += 1) {
    workers.push(worker())
  }

  await Promise.all(workers)

  return out
}

/**
 * @param {{ items: QuoteItemInput[] }} body
 * @param {typeof process.env | Record<string,string|undefined>} env
 */
export async function quotesOp(body, env) {
  const fmpApiKey = resolveFmpApiKey(env)

  const items = Array.isArray(body.items) ? body.items : []

  /** @type {QuoteItemInput[]} */
  const cleaned = []

  for (const it of items) {
    const yahooSymbol = `${it.yahooSymbol ?? ''}`.trim().toUpperCase()

    if (!yahooSymbol) continue

    cleaned.push({ ...it, yahooSymbol })
  }

  const results = await mapPool(/** @type {const} */ (6), cleaned, async (it) => {
    try {
      const single = /** @type {unknown} */ (await yahooFinance.quote(it.yahooSymbol))
      const y = coerceYahooQuote(Array.isArray(single) ? single[0] : single)

      const lastNum = typeof y?.last === 'number' && Number.isFinite(y.last) ? Number(y.last) : Number.NaN

      if (Number.isFinite(lastNum)) {
        return Object.assign({}, y ?? {}, { symbol: it.yahooSymbol, source: /** @type {const} */ ('yahoo') })
      }

      throw new Error('Yahoo quote missing numeric last')
    } catch {
      const fmpSym = `${it.fmpSymbol ?? ''}`.trim()

      const fmpRow = fmpSym ? await fmpQuote(fmpSym.replace(/^=/, ''), fmpApiKey) : null

      const price = fmpRow ? fmpRow.price : null

      if (typeof price === 'number' && Number.isFinite(price)) {
        const prevCloseRaw = fmpRow.previousClose ?? fmpRow.open
        const chgPctRaw =
          fmpRow.changePercentage ??
          fmpRow.changesPercentage ??
          fmpRow.changePercent ??
          fmpRow.change ??
          fmpRow.percentChange

        const prevParsed =
          typeof prevCloseRaw === 'number' ? prevCloseRaw : Number.parseFloat(`${prevCloseRaw ?? ''}`)
        const chgParsed = typeof chgPctRaw === 'number' ? chgPctRaw : Number.parseFloat(`${chgPctRaw ?? ''}`)

        const cur =
          fmpRow.currency && typeof fmpRow.currency === 'string' ? fmpRow.currency : fmpRow.exchangeShortName ?? null

        return {
          symbol: it.yahooSymbol,
          source: /** @type {const} */ ('fmp'),
          currency: typeof cur === 'string' ? cur.trim().toUpperCase() : null,
          last: price,
          previous_close: Number.isFinite(prevParsed) ? prevParsed : Number.NaN,
          change_percent: Number.isFinite(chgParsed) ? chgParsed : Number.NaN,
        }
      }

      return { symbol: it.yahooSymbol, source: /** @type {const} */ ('none'), error: 'yahoo_and_fmp_failed' }
    }
  })

  return { ok: true, quotes: results }
}

/**
 * @param {{ symbols: string[] }} body
 * @param {typeof process.env | Record<string,string|undefined>} env
 */
export async function fxOp(body, env) {
  void env

  const symbols = [...new Set((Array.isArray(body.symbols) ? body.symbols : []).map((s) => `${s}`.trim().toUpperCase()).filter(Boolean))]

  /** @type {Record<string, { price: number | null, raw?: unknown }>} */
  const by = {}

  if (symbols.length === 0) return { ok: true, fx: by }

  /** @typedef {{ sym: string, price: number | null, raw?: unknown }} FxRow */

  /** @type {FxRow[]} */
  const fetched = /** @type {FxRow[]} */ (
    await mapPool(
      /** @type {const} */ (8),
      symbols,
      /** @returns {Promise<FxRow>} */
      async (sym) => {
        try {
          const row = /** @type {unknown} */ (await yahooFinance.quote(sym))

          const q = Array.isArray(row) ? row[0] : row

          if (!q || typeof q !== 'object') return { sym, price: null }

          const ro = /** @type {Record<string, unknown>} */ (q)

          const priceRaw = Reflect.get(ro, 'regularMarketPrice')

          const priceNum =
            typeof priceRaw === 'number' && Number.isFinite(priceRaw)
              ? priceRaw
              : Number.parseFloat(`${priceRaw ?? ''}`)

          return { sym, price: Number.isFinite(priceNum) ? priceNum : null, raw: ro }
        } catch {
          return { sym, price: null }
        }
      },
    )
  )

  for (const row of fetched) {
    by[row.sym] = { price: row.price, raw: row.raw }
  }

  return { ok: true, fx: by }
}

/**
 * @param {{ symbols: string[] }} body
 */
export async function athOp(body) {
  const symbols = [...new Set((Array.isArray(body.symbols) ? body.symbols : []).map((s) => `${s}`.trim().toUpperCase()).filter(Boolean))]

  /** @type {{ symbol: string, high: number | null, athDate: string | null, error?: string }[]} */
  const out = []

  for (const sym of symbols) {
    try {
      const chart = /** @type {{ quotes?: unknown[] }} */ (
        await yahooFinance.chart(sym, {
          period1: '1990-01-01',
          interval: '1wk',
        })
      )

      const quotesArr = Array.isArray(chart.quotes) ? chart.quotes : []

      /** @type {number} */
      let best = -Infinity

      /** @type {Date | null} */
      let bestDate = null

      for (const row of quotesArr) {
        if (!row || typeof row !== 'object') continue

        const highRaw = Reflect.get(row, 'high')

        const highNum =
          typeof highRaw === 'number' && Number.isFinite(highRaw)
            ? highRaw
            : Number.parseFloat(`${highRaw ?? ''}`)

        if (!Number.isFinite(highNum)) continue

        if (highNum > best) {
          best = highNum

          const d = Reflect.get(row, 'date')

          bestDate =
            d instanceof Date
              ? d
              : typeof d === 'number'
                ? new Date(d * 1000)
                : typeof d === 'string'
                  ? new Date(d)
                  : null
        }
      }

      out.push({
        symbol: sym,
        high: best > -Infinity ? best : null,
        athDate:
          bestDate && Number.isFinite(bestDate.getTime()) ? bestDate.toISOString().slice(0, 10) : null,
      })
    } catch (e) {
      out.push({ symbol: sym, high: null, athDate: null, error: `${e}` })
    }
  }

  return { ok: true, ath: out }
}

/**
 * FMP ticker / company search (user types → dropdown lock-in symbol + exchange).
 *
 * @param {{ query?: string|null, limit?: number }} body
 * @param {typeof process.env | Record<string,string|undefined>} env
 */
export async function tickerSearchOp(body, env) {
  const key = resolveFmpApiKey(env)

  if (!key) return { ok: false, error: 'fmp_key_missing', results: [] }

  const rawQ = typeof body.query === 'string' ? body.query.trim() : ''

  if (rawQ.length < 1) return { ok: true, results: [] }

  const limitRaw = Number(body.limit ?? 12)

  const limit = Number.isFinite(limitRaw) ? Math.min(Math.max(1, Math.floor(limitRaw)), 40) : 12

  const tryUrls = [
    `${FMP_BASE}/search?query=${encodeURIComponent(rawQ)}&limit=${limit}&apikey=${encodeURIComponent(key)}`,
    `${FMP_BASE}/search-ticker?query=${encodeURIComponent(rawQ)}&limit=${limit}&apikey=${encodeURIComponent(key)}`,
  ]

  /** @type {unknown} */
  let parsed = null

  for (const url of tryUrls) {
    const res = await fetch(url, { headers: { Accept: 'application/json' } })

    if (!res.ok) continue

    try {
      const j = /** @type {unknown} */ (await res.json())

      if (Array.isArray(j)) {
        parsed = j

        break
      }
    } catch {
      /* try alternate path */
    }
  }

  if (!parsed || !Array.isArray(parsed)) parsed = []

  const rawList = Array.isArray(parsed) ? parsed : []

  /** @type {{ symbol: string, name: string, exchangeShortName: string, currency: string|null }[]} */
  const results = []

  for (const row of rawList) {
    if (!row || typeof row !== 'object') continue

    const o = /** @type {Record<string, unknown>} */ (row)

    const symbol = `${Reflect.get(o, 'symbol') ?? Reflect.get(o, 'ticker') ?? ''}`.trim().toUpperCase()

    const name = `${Reflect.get(o, 'name') ?? Reflect.get(o, 'companyName') ?? ''}`.trim()

    const x =
      `${Reflect.get(o, 'stockExchangeShortName') ?? Reflect.get(o, 'exchangeShortName') ?? Reflect.get(o, 'exchange') ?? ''}`.trim()

    const curRaw = Reflect.get(o, 'currency')

    const currency = typeof curRaw === 'string' && curRaw.trim() ? curRaw.trim().toUpperCase() : null

    if (!symbol || !name) continue

    results.push({ symbol, name, exchangeShortName: x.toUpperCase() || 'UNKNOWN', currency })
    if (results.length >= limit) break
  }

  return { ok: true, results }
}

/** @param {Record<string, unknown>} body */

export async function dispatchMarketRpc(body, env) {
  const op = typeof body.op === 'string' ? body.op.trim() : ''

  if (!op) return { ok: false, error: 'missing_op' }

  if (op === 'quotes') return await quotesOp(body, env)

  if (op === 'fx') return await fxOp(body, env)

  if (op === 'ath') return await athOp(body)

  if (op === 'tickerSearch') return await tickerSearchOp(body, env)

  return { ok: false, error: `unknown_op:${op}` }
}

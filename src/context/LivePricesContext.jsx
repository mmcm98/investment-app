/* eslint-disable react-refresh/only-export-components -- Provider + hook */
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import { useSharesightIntegration } from './SharesightIntegrationContext.jsx'
import { audPerForeignUnit, deriveYahooFxSymbol, uniqueFxPairsForCurrencies } from '../lib/market/fxPairs.js'
import { isLivePriceWindowActiveForExchange } from '../lib/market/exchangeSessions.js'
import { describeHoldingQuoteDiagnostics, resolveQuoteIdentity } from '../lib/market/sharesightHoldingFx.js'
import { resolveSharesightHoldingQuantity, resolveSharesightHoldingValueAud } from '../lib/sharesight/normalizePayloads.js'
import { yahooSymbolsLooselyEqual } from '../lib/market/tickerMap.js'
import { postMarketBatch } from '../lib/market/marketApi.js'
import { shouldRunDailyAthJob, sydneyWallDateIso } from '../lib/market/sydneyClock.js'
import { isCashLikeHolding } from '../lib/satellite/satelliteMerge.js'

/** @typedef {import('@supabase/supabase-js').SupabaseClient} SupabaseClient */

/** @typedef {{
 *   id: string
 *   portfolio_role: string
 *   portfolio_external_id: string
 *   holding_external_id: string
 *   instrument_symbol: string|null
 *   instrument_name: string|null
 *   quantity: number|null
 *   market_value: number|null
 *   holding_value_aud: number|null
 *   cost_basis: number|null
 *   unrealized_gain_loss: number|null
 *   currency: string|null
 *   raw: Record<string, unknown>
 * }} SharesightHoldingRow */

/** @typedef {{
 *   yahoo_symbol: string
 *   fmp_symbol: string|null
 *   exchange_short_name: string
 *   instrument_symbol: string|null
 *   instrument_name: string|null
 *   portfolio_role: string
 *   holding_external_id: string
 *   last_price: number|null
 *   previous_close: number|null
 *   change_percent: number|null
 *   aud_last_price: number|null
 *   ath: number|null
 *   ath_as_of: string|null
 *   quote_source: string|null
 *   sharesight_market_value: number|null
 *   display_native: number|null
 *   display_aud: number|null
 *   quantity: number|null
 *   quote_currency: string
 *   is_cash_like: boolean
 *   holding_value_aud: number|null
 *   unrealised_gain_aud: number|null
 *   day_move_value_aud: number|null
 * }} MergedQuoteRow */

/** @type {React.Context<{
 *   mergedRows: MergedQuoteRow[]
 *   pricesUpdating: boolean
 *   quoteError: string | null
 *   refreshMarketData: () => Promise<void>
 * } | null>} */
const LivePricesContext = createContext(null)

const REFRESH_MS = 5 * 60 * 1000

/** Core FX pairs against AUD — refreshed every cycle (framework: ~5 min). */
const BASE_FX_YAHOO = /** @type {const} */ (['USDAUD=X', 'EURAUD=X', 'GBPAUD=X'])

/** @type {Record<string, string>} */
const BASE_FX_TO_CCY = { 'USDAUD=X': 'USD', 'EURAUD=X': 'EUR', 'GBPAUD=X': 'GBP' }

/** @param {{ portfolio_role: string, holding_external_id: string }} k */
function holdingKey(k) {
  return `${k.portfolio_role}:${k.holding_external_id}`
}

/**
 * @param {any[]} holdings
 * @param {string} quoteSymbolFromApi
 */
function listHoldingsMatchingQuoteSymbol(holdings, quoteSymbolFromApi) {
  /** @type {any[]} */
  const out = []

  for (const h of holdings) {
    const id = resolveQuoteIdentity(h)

    if (!`${id.yahooSymbol ?? ''}`.trim()) continue

    if (yahooSymbolsLooselyEqual(id.yahooSymbol, quoteSymbolFromApi)) out.push(h)
  }

  return out
}

/**
 * Quote symbols that returned a numeric last but did not map to any holding Yahoo identity.
 *
 * @param {Record<string, unknown>[]} quotes
 * @param {any[]} holdings
 */
function quotesSymbolsUnmatchedToHoldings(quotes, holdings) {
  /** @type {string[]} */
  const out = []

  for (const q of quotes) {
    const sym = `${Reflect.get(q, 'symbol') ?? ''}`.trim()

    if (!sym) continue

    if (numOrNull(Reflect.get(q, 'last')) == null) continue

    if (listHoldingsMatchingQuoteSymbol(holdings, sym).length === 0) out.push(sym)
  }

  return out
}

/** @param {string|null|undefined} c */
function currencyIso(c) {
  const v = `${c ?? ''}`.trim().toUpperCase()

  return v || 'AUD'
}

/** @param {unknown} v */
function numOrNull(v) {
  const n = typeof v === 'number' && Number.isFinite(v) ? v : Number.parseFloat(`${v ?? ''}`)

  return Number.isFinite(n) ? n : null
}

/**
 * @param {number|null|undefined} price
 * @param {string} cur
 * @param {Record<string, { aud_per_unit: number, yahoo_symbol: string }>} fx
 */
function toAud(price, cur, fx) {
  if (price == null || !Number.isFinite(Number(price))) return null

  const c = currencyIso(cur)

  if (c === 'AUD') return Number(price)

  const row = fx[c]

  if (!row || !Number.isFinite(row.aud_per_unit)) return null

  return Number(price) * row.aud_per_unit
}

/**
 * @param {SupabaseClient} supabase
 * @param {string} userId
 */
async function loadFxMap(supabase, userId) {
  const { data, error } = await supabase
    .from('fx_rates_cache')
    .select('currency,aud_per_unit,yahoo_symbol')
    .eq('user_id', userId)

  if (error) throw error

  /** @type {Record<string, { aud_per_unit: number, yahoo_symbol: string }>} */
  const out = {}

  for (const row of data ?? []) {
    const currency = `${row.currency ?? ''}`.trim().toUpperCase()

    if (!currency) continue

    const rate = Number(row.aud_per_unit)

    if (!Number.isFinite(rate)) continue

    out[currency] = { aud_per_unit: rate, yahoo_symbol: `${row.yahoo_symbol ?? ''}` }
  }

  return out
}

/**
 * @param {SupabaseClient} supabase
 * @param {string} userId
 */
async function loadSnapshots(supabase, userId) {
  const { data, error } = await supabase.from('market_quote_snapshots').select('*').eq('user_id', userId)

  if (error) throw error

  /** @type {Map<string, Record<string, unknown>>} */
  const map = new Map()

  for (const row of data ?? []) {
    const r = /** @type {Record<string, unknown>} */ (row)

    const pr = Reflect.get(r, 'portfolio_role')
    const hid = Reflect.get(r, 'holding_external_id')

    if (typeof pr === 'string' && typeof hid === 'string') {
      map.set(holdingKey({ portfolio_role: pr, holding_external_id: hid }), r)
    }
  }

  return map
}

/**
 * @param {SupabaseClient} supabase
 * @param {string} userId
 */
async function loadAthJobState(supabase, userId) {
  const { data, error } = await supabase
    .from('user_market_job_state')
    .select('last_ath_run_sydney_date')
    .eq('user_id', userId)
    .maybeSingle()

  if (error) throw error

  return data?.last_ath_run_sydney_date ?? null
}

/**
 * Weekly Yahoo chart ATH → `market_quote_snapshots.ath` (AUD) via FX.
 *
 * @param {import('@supabase/supabase-js').SupabaseClient} supabase
 * @param {string} uid
 * @param {any[]} holdings
 * @param {boolean} advanceSydneyJobDate when true, stamps `user_market_job_state` (daily job).
 */
async function persistAthHighsForHoldings(supabase, uid, holdings, advanceSydneyJobDate) {
  if (holdings.length === 0) return

  const symbols = [
    ...new Set(holdings.map((h) => `${resolveQuoteIdentity(h).yahooSymbol ?? ''}`.trim()).filter(Boolean)),
  ]

  if (symbols.length === 0) return

  const athResp = /** @type {Record<string, unknown>} */ (await postMarketBatch({ op: 'ath', symbols }))
  const athList = /** @type {Record<string, unknown>[]} */ (Reflect.get(athResp, 'ath') ?? [])

  /** @type {Record<string, { high: number|null, athDate: string|null }>} */
  const bySym = {}

  for (const row of athList) {
    const sym = `${Reflect.get(row, 'symbol') ?? ''}`.trim().toUpperCase()

    if (!sym) continue

    const high = Reflect.get(row, 'high')
    const athDate = Reflect.get(row, 'athDate')

    bySym[sym] = {
      high: typeof high === 'number' && Number.isFinite(high) ? high : null,
      athDate: typeof athDate === 'string' ? athDate : null,
    }
  }

  const fxForAth = await loadFxMap(supabase, uid)
  const athNow = new Date().toISOString()
  /** @type {Record<string, unknown>[]} */
  const athUpserts = []

  for (const h of holdings) {
    const id = resolveQuoteIdentity(h)
    const symKey = `${id.yahooSymbol ?? ''}`.trim().toUpperCase()

    if (!symKey) continue

    const rec = bySym[symKey]

    if (!rec || rec.high == null) continue

    const quoteCurrency = currencyIso(h.currency)
    const athAud = toAud(rec.high, quoteCurrency, fxForAth)

    athUpserts.push({
      user_id: uid,
      portfolio_role: h.portfolio_role,
      portfolio_external_id: h.portfolio_external_id,
      holding_external_id: h.holding_external_id,
      instrument_symbol: h.instrument_symbol,
      instrument_name: h.instrument_name,
      fmp_symbol: id.fmpSymbol,
      exchange_short_name: id.exchangeShortName,
      yahoo_symbol: id.yahooSymbol,
      quote_currency: quoteCurrency,
      ath: athAud,
      ath_as_of: rec.athDate,
      ath_computed_at: athNow,
      updated_at: athNow,
    })
  }

  if (athUpserts.length > 0) {
    const { error } = await supabase.from('market_quote_snapshots').upsert(athUpserts, {
      onConflict: 'user_id,portfolio_role,holding_external_id',
    })

    if (error) throw error

    console.info('[live-prices] market_quote_snapshots_ath_upsert', { rows: athUpserts.length })
  }

  if (advanceSydneyJobDate) {
    const sydneyToday = sydneyWallDateIso(new Date())

    const { error: jobErr } = await supabase.from('user_market_job_state').upsert(
      { user_id: uid, updated_at: new Date().toISOString(), last_ath_run_sydney_date: sydneyToday },
      { onConflict: 'user_id' },
    )

    if (jobErr) throw jobErr
  }
}

/** @typedef {{ children: import('react').ReactNode }} LpProps */

/** @param {LpProps} props */
export function LivePricesProvider({ children }) {
  const { supabase, userPresent, holdingsCount } = useSharesightIntegration()

  const [holdingRows, setHoldingRows] = useState(/** @type {SharesightHoldingRow[]} */ ([]))
  const [snapshotByKey, setSnapshotByKey] = useState(() => /** @type {Map<string, Record<string, unknown>>} */ (new Map()))
  const [fxByCurrency, setFxByCurrency] = useState(
    () => /** @type {Record<string, { aud_per_unit: number, yahoo_symbol: string }>} */ ({}),
  )

  const [pricesUpdating, setPricesUpdating] = useState(false)
  const [quoteError, setQuoteError] = useState(/** @type {string|null} */ (null))

  const userIdRef = useRef(/** @type {string | null} */ (null))
  const snapshotRef = useRef(/** @type {Map<string, Record<string, unknown>>} */ (new Map()))

  useEffect(() => {
    snapshotRef.current = snapshotByKey
  }, [snapshotByKey])

  useEffect(() => {
    if (!supabase || !userPresent) {
      userIdRef.current = null

      return
    }

    void supabase.auth.getUser().then(({ data }) => {
      userIdRef.current = data.user?.id ?? null
    })
  }, [supabase, userPresent])

  const hydrateFromSupabase = useCallback(async () => {
    if (!supabase) return

    const { data: ud } = await supabase.auth.getUser()
    const uid = ud.user?.id

    if (!uid) return

    userIdRef.current = uid

    const [fx, snaps] = await Promise.all([loadFxMap(supabase, uid), loadSnapshots(supabase, uid)])

    setFxByCurrency(fx)
    setSnapshotByKey(snaps)
  }, [supabase])

  const loadHoldings = useCallback(async () => {
    if (!supabase) return

    const { data: ud } = await supabase.auth.getUser()
    const uid = ud.user?.id

    if (!uid) return

    userIdRef.current = uid

    const { data, error } = await supabase
      .from('sharesight_holdings')
      .select(
        'id,portfolio_role,portfolio_external_id,holding_external_id,instrument_symbol,instrument_name,quantity,market_value,holding_value_aud,cost_basis,unrealized_gain_loss,currency,raw',
      )
      .eq('user_id', uid)
      .order('instrument_symbol', { ascending: true })

    if (error) throw error

    setHoldingRows(/** @type {SharesightHoldingRow[]} */ (data ?? []))
  }, [supabase])

  useEffect(() => {
    if (!supabase || !userPresent) {
      queueMicrotask(() => {
        setHoldingRows([])
        setSnapshotByKey(new Map())
        setFxByCurrency({})
        setQuoteError(null)
      })

      return undefined
    }

    queueMicrotask(() => {
      void (async () => {
        try {
          await hydrateFromSupabase()
          await loadHoldings()
        } catch (e) {
          setQuoteError(e instanceof Error ? e.message : String(e))
        }
      })()
    })

    return undefined
  }, [supabase, userPresent, holdingsCount, hydrateFromSupabase, loadHoldings])

  const persistFxRows = useCallback(
    /**
     * @param {string} uid
     * @param {Record<string, { yahoo: string, audPer: number }>} byCurrency
     */
    async (uid, byCurrency) => {
      if (!supabase) return

      const now = new Date().toISOString()

      const rows = Object.entries(byCurrency).map(([currency, v]) => ({
        user_id: uid,
        currency,
        aud_per_unit: v.audPer,
        yahoo_symbol: v.yahoo,
        updated_at: now,
      }))

      if (rows.length === 0) return

      const { error } = await supabase.from('fx_rates_cache').upsert(rows, { onConflict: 'user_id,currency' })

      if (error) throw error
    },
    [supabase],
  )

  const runMarketCycle = useCallback(async () => {
    if (!supabase || !userPresent) return

    const { data: ud } = await supabase.auth.getUser()
    const uid = ud.user?.id

    if (!uid) return

    userIdRef.current = uid

    setPricesUpdating(true)
    setQuoteError(null)

    try {
      const holdings = holdingRows

      console.info('[live-prices] market_cycle_start', { holdingCount: holdings.length })

      const currencies = [...new Set(holdings.map((h) => currencyIso(h.currency)))]

      const fromHoldings = uniqueFxPairsForCurrencies(currencies)

      const fxSymbols = [...new Set([...BASE_FX_YAHOO, ...fromHoldings])]

      /** @type {Record<string, { yahoo: string, audPer: number }>} */
      const fxBuilt = { AUD: { yahoo: 'AUD', audPer: 1 } }

      const fxResp = /** @type {Record<string, unknown>} */ (await postMarketBatch({ op: 'fx', symbols: fxSymbols }))

      const fxPriceMap = /** @type {Record<string, { price: number | null }>} */ (Reflect.get(fxResp, 'fx') ?? {})

      console.info('[live-prices] fx_fetch_response', {
        ok: Reflect.get(fxResp, 'ok'),
        symbolsRequested: fxSymbols.length,
        fxKeys: Object.keys(fxPriceMap).length,
      })

      for (const sym of fxSymbols) {
        const px = fxPriceMap[sym]?.price
        const audPer = audPerForeignUnit(sym, typeof px === 'number' ? px : Number.NaN)

        if (audPer == null || !Number.isFinite(audPer)) continue

        const baseCcy = Reflect.get(BASE_FX_TO_CCY, sym)

        if (typeof baseCcy === 'string') {
          fxBuilt[baseCcy] = { yahoo: sym, audPer }
        }

        for (const c of currencies) {
          const y = deriveYahooFxSymbol(c)

          if (y === sym) fxBuilt[c] = { yahoo: sym, audPer }
        }
      }

      await persistFxRows(uid, fxBuilt)

      const fxLive = await loadFxMap(supabase, uid)

      setFxByCurrency(fxLive)

      /**
       * During regular session we poll Yahoo for that venue. Outside session we still fetch when we have no
       * cached `last_price` (weekends / first deploy) so the UI is not stuck at $0 while the batch API works.
       */
      const items =
        holdings.length > 0
          ? holdings
              .filter((h) => {
                const id = resolveQuoteIdentity(h)
                const inSession = isLivePriceWindowActiveForExchange(id.exchangeShortName)
                const snap = snapshotRef.current.get(holdingKey(h))
                const lastCached = snap ? numOrNull(Reflect.get(snap, 'last_price')) : null
                const missingQuote = lastCached == null

                return inSession || missingQuote
              })
              .map((h) => {
                const id = resolveQuoteIdentity(h)

                if (!`${id.yahooSymbol ?? ''}`.trim()) return null

                return { yahooSymbol: id.yahooSymbol, fmpSymbol: id.fmpSymbol, exchangeShort: id.exchangeShortName }
              })
              .filter(Boolean)
          : []

      if (items.length > 0) {
        const diagnostics = holdings.map((h) => describeHoldingQuoteDiagnostics(/** @type {Record<string, unknown>} */ (h)))

        console.info('[live-prices] quotes_fetch_attempt', {
          holdings: holdings.length,
          quoteItems: items.length,
          hasMarketSecret: Boolean(`${import.meta.env.VITE_MARKET_API_SECRET ?? ''}`.trim()),
          fetchYahooSymbols: items.map((it) => it.yahooSymbol),
        })

        console.info('[live-prices] holding_quote_resolution', diagnostics)

        const qResp = /** @type {Record<string, unknown>} */ (await postMarketBatch({ op: 'quotes', items }))

        const quotes = /** @type {Record<string, unknown>[]} */ (Reflect.get(qResp, 'quotes') ?? [])

        console.info('[live-prices] quotes_fetch_response', {
          ok: Reflect.get(qResp, 'ok'),
          quoteRows: Array.isArray(quotes) ? quotes.length : 0,
        })

        const nowIso = new Date().toISOString()

        const upserts = []

        for (const q of quotes) {
          const symRaw = `${Reflect.get(q, 'symbol') ?? ''}`.trim()

          const matchHoldings = listHoldingsMatchingQuoteSymbol(holdings, symRaw)

          const last = Reflect.get(q, 'last')
          const prev = Reflect.get(q, 'previous_close')
          const chg = Reflect.get(q, 'change_percent')
          const src = Reflect.get(q, 'source')
          const curFromQuote = Reflect.get(q, 'currency')

          const lastNum = numOrNull(last)

          if (lastNum == null) continue

          const prevNum = numOrNull(prev)
          const chgNum = numOrNull(chg)

          for (const holding of matchHoldings) {
            const id = resolveQuoteIdentity(holding)

            const quoteCurrency =
              typeof curFromQuote === 'string' && curFromQuote.trim()
                ? curFromQuote.trim().toUpperCase()
                : currencyIso(holding.currency)

            const snap = snapshotRef.current.get(holdingKey(holding))

            const audLast = toAud(lastNum, quoteCurrency, fxLive)

            upserts.push({
              user_id: uid,
              portfolio_role: holding.portfolio_role,
              portfolio_external_id: holding.portfolio_external_id,
              holding_external_id: holding.holding_external_id,
              instrument_symbol: holding.instrument_symbol,
              instrument_name: holding.instrument_name,
              fmp_symbol: id.fmpSymbol,
              exchange_short_name: id.exchangeShortName,
              yahoo_symbol: id.yahooSymbol,
              quote_currency: quoteCurrency,
              last_price: lastNum,
              previous_close: prevNum,
              change_percent: chgNum,
              aud_last_price: audLast,
              quote_source: typeof src === 'string' ? src : null,
              quotes_fetched_at: nowIso,
              ath: Reflect.get(snap ?? {}, 'ath'),
              ath_as_of: Reflect.get(snap ?? {}, 'ath_as_of'),
              ath_computed_at: Reflect.get(snap ?? {}, 'ath_computed_at'),
              updated_at: nowIso,
            })
          }
        }

        if (upserts.length > 0) {
          const { error } = await supabase.from('market_quote_snapshots').upsert(upserts, {
            onConflict: 'user_id,portfolio_role,holding_external_id',
          })

          if (error) throw error

          console.info('[live-prices] market_quote_snapshots_upsert', { rows: upserts.length })
        } else {
          const quoteSymbols = quotes.map((row) => Reflect.get(row, 'symbol'))
          const quotesWithLast = quotes.filter((row) => numOrNull(Reflect.get(row, 'last')) != null).length

          const holdingYahooKeys = holdings.map((h) => resolveQuoteIdentity(h).yahooSymbol)

          const unmatchedQuotes = quotesSymbolsUnmatchedToHoldings(quotes, holdings)

          console.warn('[live-prices] quotes_fetch_no_upserts', {
            quoteRows: quotes.length,
            quotesWithNumericLast: quotesWithLast,
            quoteSymbols,
            holdingYahooKeys,
            unmatchedQuoteSymbols: unmatchedQuotes,
            reason: 'no upsert rows — check symbol match vs resolveQuoteIdentity or null last from API',
          })
        }
      }

      /** Fresh DB snapshots so ATH checks see rows just written by the quotes upsert. */
      let snapMapForAth = snapshotRef.current

      try {
        snapMapForAth = await loadSnapshots(supabase, uid)

        snapMapForAth.forEach((v, k) => snapshotRef.current.set(k, v))
      } catch {
        /* keep prior ref */
      }

      const holdingsNeedingAth = holdings.filter((h) => {
        if (
          isCashLikeHolding({
            instrument_symbol: h.instrument_symbol,
            instrument_name: h.instrument_name,
          })
        ) {
          return false
        }

        const id = resolveQuoteIdentity(h)

        if (!`${id.yahooSymbol ?? ''}`.trim()) return false

        const snap = snapMapForAth.get(holdingKey(h))
        const ath = snap ? numOrNull(Reflect.get(snap, 'ath')) : null

        return ath == null
      })

      if (holdingsNeedingAth.length > 0) {
        console.info('[live-prices] ath_backfill_missing', { holdings: holdingsNeedingAth.length })

        await persistAthHighsForHoldings(supabase, uid, holdingsNeedingAth, false)
      }

      const sydneyToday = sydneyWallDateIso(new Date())
      const lastAth = await loadAthJobState(supabase, uid)

      if (shouldRunDailyAthJob(new Date()) && lastAth !== sydneyToday && holdings.length > 0) {
        await persistAthHighsForHoldings(supabase, uid, holdings, true)
      }

      await hydrateFromSupabase()
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)

      console.warn('[live-prices] market_cycle_error', { message: msg })

      setQuoteError(msg)
    } finally {
      setPricesUpdating(false)
    }
  }, [supabase, userPresent, holdingRows, hydrateFromSupabase, persistFxRows])

  useEffect(() => {
    if (!supabase || !userPresent || holdingRows.length === 0) {
      if (supabase && userPresent && holdingRows.length === 0) {
        console.info('[live-prices] refresh_timer_skip', { reason: 'holdings_not_loaded_yet' })
      }

      return undefined
    }

    console.info('[live-prices] refresh_timer_armed', { intervalMs: REFRESH_MS, holdingCount: holdingRows.length })

    const id = window.setInterval(() => {
      console.info('[live-prices] refresh_timer_tick')

      void runMarketCycle()
    }, REFRESH_MS)

    queueMicrotask(() => {
      void runMarketCycle()
    })

    return () => window.clearInterval(id)
  }, [supabase, userPresent, holdingRows.length, runMarketCycle])

  const mergedRows = useMemo(() => {
    return holdingRows.map((h) => {
      const id = resolveQuoteIdentity(h)

      const snap = snapshotByKey.get(holdingKey(h))

      const last = snap ? numOrNull(Reflect.get(snap, 'last_price')) : null
      const prev = snap ? numOrNull(Reflect.get(snap, 'previous_close')) : null
      const chg = snap ? numOrNull(Reflect.get(snap, 'change_percent')) : null
      const aud = snap ? numOrNull(Reflect.get(snap, 'aud_last_price')) : null
      const ath = snap ? numOrNull(Reflect.get(snap, 'ath')) : null
      const athAsOf = snap ? Reflect.get(snap, 'ath_as_of') : null
      const src = snap ? Reflect.get(snap, 'quote_source') : null

      const mv = h.market_value != null && Number.isFinite(Number(h.market_value)) ? Number(h.market_value) : null
      const quoteCur = snap && typeof Reflect.get(snap, 'quote_currency') === 'string' ? `${Reflect.get(snap, 'quote_currency')}` : currencyIso(h.currency)

      const audFromFx = last != null ? toAud(last, quoteCur, fxByCurrency) : null

      const displayNative =
        last != null
          ? last
          : mv && quoteCur === currencyIso(h.currency)
            ? mv
            : null

      const displayAud =
        aud != null
          ? aud
          : audFromFx != null
            ? audFromFx
            : quoteCur === 'AUD' && displayNative != null
              ? displayNative
              : null

      const hk = /** @type {Record<string, unknown>} */ (h)
      const qty = resolveSharesightHoldingQuantity(hk)
      const cashLike = isCashLikeHolding({
        instrument_symbol: h.instrument_symbol,
        instrument_name: h.instrument_name,
      })

      const holdingValueAud = resolveSharesightHoldingValueAud(hk)

      /** @type {number|null} */
      let unrealisedGainAud = null

      const cost = numOrNull(Reflect.get(hk, 'cost_basis'))

      if (holdingValueAud != null && cost != null && Number.isFinite(holdingValueAud) && Number.isFinite(cost)) {
        unrealisedGainAud = holdingValueAud - cost
      } else {
        const uglRaw = Reflect.get(hk, 'unrealized_gain_loss')
        const ugl =
          uglRaw != null && Number.isFinite(Number(uglRaw))
            ? Number(uglRaw)
            : Number.parseFloat(`${uglRaw ?? ''}`)

        if (Number.isFinite(ugl) && currencyIso(h.currency) === 'AUD') unrealisedGainAud = ugl
      }

      /** @type {number|null} */
      let dayMoveAud = null

      if (qty != null && last != null && prev != null && Number.isFinite(qty)) {
        const nativeDelta = last - prev
        const perUnitAud =
          quoteCur === 'AUD'
            ? 1
            : fxByCurrency[quoteCur]?.aud_per_unit != null && Number.isFinite(fxByCurrency[quoteCur].aud_per_unit)
              ? fxByCurrency[quoteCur].aud_per_unit
              : null

        if (perUnitAud != null && Number.isFinite(nativeDelta)) dayMoveAud = qty * nativeDelta * perUnitAud
      }

      return {
        yahoo_symbol: id.yahooSymbol,
        fmp_symbol: id.fmpSymbol,
        exchange_short_name: id.exchangeShortName,
        instrument_symbol: h.instrument_symbol,
        instrument_name: h.instrument_name,
        portfolio_role: h.portfolio_role,
        holding_external_id: h.holding_external_id,
        last_price: last,
        previous_close: prev,
        change_percent: chg,
        aud_last_price: aud,
        ath,
        ath_as_of: typeof athAsOf === 'string' ? athAsOf : null,
        quote_source: typeof src === 'string' ? src : null,
        sharesight_market_value: mv,
        display_native: displayNative,
        display_aud: displayAud,
        quantity: qty,
        quote_currency: quoteCur,
        is_cash_like: cashLike,
        holding_value_aud: holdingValueAud,
        unrealised_gain_aud: unrealisedGainAud,
        day_move_value_aud: dayMoveAud,
      }
    })
  }, [holdingRows, snapshotByKey, fxByCurrency])

  const refreshMarketData = useCallback(async () => {
    await runMarketCycle()
  }, [runMarketCycle])

  const value = useMemo(
    () => ({
      mergedRows,
      pricesUpdating,
      quoteError,
      refreshMarketData,
    }),
    [mergedRows, pricesUpdating, quoteError, refreshMarketData],
  )

  return <LivePricesContext.Provider value={value}>{children}</LivePricesContext.Provider>
}

export function useLivePrices() {
  const ctx = useContext(LivePricesContext)

  if (!ctx) throw new Error('useLivePrices must be used within LivePricesProvider')

  return ctx
}

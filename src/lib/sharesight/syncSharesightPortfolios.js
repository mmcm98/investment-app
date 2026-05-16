/** @typedef {import('@supabase/supabase-js').SupabaseClient} SupabaseClient */

import {
  ensureSharesightAccessToken,
  seedSharesightAccessMemoryFromRow,
  setSharesightAccessMemoryToken,
  SharesightSuspendedError,
} from './tokenSession.js'
import { sharesightAuthorizedFetch } from './sharesightHttp.js'
import { getSharesightPortfolioUuids } from './runtimeEnv.js'
import {
  normalizeHolding,
  normalizeTrade,
  normalizePayout,
  extractCashBalancesFromCashAccountsPayload,
  parseValuationHoldingsList,
  collectPerformanceHoldingLikeRows,
  normalizeSharesightSymbolKey,
  indexValuationHoldingsByExternalId,
  indexValuationHoldingsByInstrumentCode,
  applyValuationHoldingToSharesightRow,
  indexPerformanceHoldingsByExternalId,
  applyPerformanceHoldingFillGaps,
} from './normalizePayloads.js'
import {
  fetchSharesightOAuthRow,
  patchSharesightSyncMeta,
  patchSharesightTradeCursor,
  upsertSharesightOAuthRow,
} from './oauthCredentialsRepository.js'
import { mapWithConcurrency } from './asyncPool.js'
import { promoteWatchlistMatchesAfterSync } from '../watchlist/promoteWatchlistMatches.js'
import { isSharesightHoldingClosed } from '../satellite/satelliteMerge.js'

function isoDateUtc(d = new Date()) {
  return d.toISOString().slice(0, 10)
}

/** @type {(attempt: unknown) => string} */
function formatErrorBestEffort(attempt) {
  if (attempt instanceof Error) return attempt.message

  if (typeof attempt === 'string') return attempt

  try {
    return JSON.stringify(attempt)
  } catch {
    return 'Unknown Sharesight sync error.'
  }
}

/**
 * @param {SupabaseClient} supabase
 * @param {string} syncRunId
 * @param {{ status: 'success'|'error'|'partial', error_message?: string | null }} patch
 */
async function finalizeSharesightSyncRun(supabase, syncRunId, patch) {
  const { error } = await supabase
    .from('sharesight_sync_runs')
    .update({
      completed_at: new Date().toISOString(),
      status: patch.status,
      error_message: patch.error_message ?? null,
    })
    .eq('id', syncRunId)

  if (error) throw error
}

/** Supabase `.upsert` conflict target aligned with Postgres unique indexes (`sharesight_*_natural_key`). */
const UPSERT_HOLDINGS_ON = 'user_id,portfolio_role,holding_external_id'
const UPSERT_TRADES_ON = 'user_id,portfolio_role,trade_external_id'
const UPSERT_CASH_ON = 'user_id,portfolio_role,portfolio_external_id,account_key,currency'
const UPSERT_PERFORMANCE_ON = 'user_id,portfolio_role,portfolio_external_id,start_date,end_date'
const UPSERT_INCOME_ON = 'user_id,portfolio_role,holding_external_id,income_external_id'

const RAW_HOLDING_AUDIT_TICKERS = /** @type {const} */ (['MP1', 'GHHF'])

/**
 * Raw Sharesight audit logging only. Keep this free of normalisation or sync decisions.
 *
 * @param {string} label
 * @param {Record<string, unknown>} ctx
 * @param {unknown} response
 */
function logSharesightRaw(label, ctx, response) {
  console.info(label, {
    ...ctx,
    response,
  })
}

/** @param {unknown} value */
function numOrNull(value) {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'string' && value.trim()) {
    const n = Number.parseFloat(value.trim().replace(/,/g, ''))

    return Number.isFinite(n) ? n : null
  }

  return null
}

/** @param {unknown} trade */
function tradeSymbolKey(trade) {
  if (!trade || typeof trade !== 'object') return ''

  return normalizeSharesightSymbolKey(Reflect.get(/** @type {Record<string, unknown>} */ (trade), 'symbol'))
}

/** @param {unknown} type */
function isBuyTradeType(type) {
  const t = `${type ?? ''}`.trim().toUpperCase()

  return t === 'BUY' || t === 'OPENING_BALANCE'
}

/** @param {unknown} type */
function isSellTradeType(type) {
  return `${type ?? ''}`.trim().toUpperCase() === 'SELL'
}

/**
 * Weighted-average open-cost basis from Sharesight v2 trades, keyed by symbol.
 *
 * @param {unknown[]} trades
 * @returns {Map<string, number>}
 */
function calculateCostBasisBySymbol(trades) {
  /** @type {Map<string, { buyQty: number, buyCost: number, sellQty: number, trades: unknown[] }>} */
  const totalsBySymbol = new Map()

  for (const trade of trades) {
    if (!trade || typeof trade !== 'object') continue

    const t = /** @type {Record<string, unknown>} */ (trade)
    const symbol = tradeSymbolKey(t)
    if (!symbol) continue

    const qty = Math.abs(numOrNull(Reflect.get(t, 'quantity')) ?? 0)
    if (!qty) continue

    const transactionType = Reflect.get(t, 'transaction_type')
    const price = numOrNull(Reflect.get(t, 'price')) ?? 0
    const tradeCurrency = `${Reflect.get(t, 'currency') ?? Reflect.get(t, 'currency_code') ?? ''}`.trim().toUpperCase()
    const exchangeRate = tradeCurrency === 'AUD' ? 1 : (numOrNull(Reflect.get(t, 'exchange_rate')) ?? 1)
    const totals = totalsBySymbol.get(symbol) ?? { buyQty: 0, buyCost: 0, sellQty: 0, trades: [] }

    totals.trades.push(trade)

    if (isBuyTradeType(transactionType)) {
      totals.buyQty += qty
      totals.buyCost += qty * price * exchangeRate
      totalsBySymbol.set(symbol, totals)
      continue
    }

    if (isSellTradeType(transactionType)) {
      totals.sellQty += qty
      totalsBySymbol.set(symbol, totals)
    }
  }

  const out = new Map()

  for (const [symbol, totals] of totalsBySymbol.entries()) {
    if (totals.buyQty <= 0) continue

    const currentQuantity = Math.max(totals.buyQty - totals.sellQty, 0)
    const averageBuyPrice = totals.buyCost / totals.buyQty
    const costBasis = averageBuyPrice * currentQuantity

    if (symbol === 'MP1') {
      console.info('[sharesight-sync] mp1_cost_basis_trades', {
        symbol,
        raw_trades: totals.trades,
        total_bought_quantity: totals.buyQty,
        total_sold_quantity: totals.sellQty,
        current_quantity: currentQuantity,
        total_buy_cost_aud: totals.buyCost,
        average_buy_price_aud: averageBuyPrice,
        cost_basis_aud: costBasis,
      })
    }

    if (Number.isFinite(costBasis)) out.set(symbol, costBasis)
  }

  return out
}

/** @param {unknown} portfoliosPayload */
function indexPortfolioInceptionDates(portfoliosPayload) {
  const payload =
    portfoliosPayload && typeof portfoliosPayload === 'object'
      ? /** @type {Record<string, unknown>} */ (portfoliosPayload)
      : {}
  const portfolios = Array.isArray(payload.portfolios)
    ? payload.portfolios
    : Array.isArray(portfoliosPayload)
      ? portfoliosPayload
      : []

  /** @type {Map<string, string>} */
  const map = new Map()

  for (const portfolio of portfolios) {
    if (!portfolio || typeof portfolio !== 'object') continue

    const p = /** @type {Record<string, unknown>} */ (portfolio)
    const ids = [
      Reflect.get(p, 'id'),
      Reflect.get(p, 'portfolio_id'),
      Reflect.get(p, 'uuid'),
      Reflect.get(p, 'portfolio_uuid'),
    ]
      .map((id) => `${id ?? ''}`.trim())
      .filter(Boolean)
    const inception = `${Reflect.get(p, 'inception_date') ?? Reflect.get(p, 'start_date') ?? ''}`.trim()

    if (inception) {
      for (const id of ids) map.set(id, inception.slice(0, 10))
    }
  }

  return map
}

/** @param {unknown} raw */
function rawHoldingSearchText(raw) {
  if (!raw || typeof raw !== 'object') return ''

  const h = /** @type {Record<string, unknown>} */ (raw)
  const inst = h.instrument && typeof h.instrument === 'object' ? /** @type {Record<string, unknown>} */ (h.instrument) : null
  const holding = h.holding && typeof h.holding === 'object' ? /** @type {Record<string, unknown>} */ (h.holding) : null

  return [
    Reflect.get(h, 'code'),
    Reflect.get(h, 'symbol'),
    Reflect.get(h, 'ticker'),
    Reflect.get(h, 'name'),
    Reflect.get(h, 'description'),
    inst ? Reflect.get(inst, 'code') : null,
    inst ? Reflect.get(inst, 'symbol') : null,
    inst ? Reflect.get(inst, 'ticker') : null,
    inst ? Reflect.get(inst, 'name') : null,
    holding ? Reflect.get(holding, 'code') : null,
    holding ? Reflect.get(holding, 'symbol') : null,
    holding ? Reflect.get(holding, 'ticker') : null,
    holding ? Reflect.get(holding, 'name') : null,
  ]
    .filter((x) => x != null && x !== '')
    .join('|')
    .toUpperCase()
}

/**
 * @param {unknown[]} holdings
 * @param {Record<string, unknown>} ctx
 */
function logSharesightRawAuditHoldings(holdings, ctx) {
  for (const ticker of RAW_HOLDING_AUDIT_TICKERS) {
    const holding = holdings.find((raw) => rawHoldingSearchText(raw).includes(ticker))

    console.info('[sharesight-raw] one holding full object', {
      ...ctx,
      ticker,
      found: Boolean(holding),
      holding: holding ?? null,
    })
  }
}

/**
 * @template T
 * @param {T[]} rows
 * @param {(row: T) => string} keyOf Last row wins when keys collide (e.g. API pagination overlaps).
 */
function dedupeRowsBy(rows, keyOf) {
  const map = new Map()

  for (const row of rows) {
    map.set(keyOf(row), row)
  }

  return [...map.values()]
}

const POSITIONS_CLOSED_MIRROR_CHUNK = 120

/**
 * Align `positions.closed` with `sharesight_holdings` for rows linked by `sharesight_holding_key`.
 *
 * @param {SupabaseClient} supabase
 * @param {string} userId
 * @param {{ holding_external_id?: unknown, closed?: unknown }[]} holdingsRows
 */
async function mirrorPositionsClosedFromHoldings(supabase, userId, holdingsRows) {
  /** @type {string[]} */
  const closedKeys = []
  /** @type {string[]} */
  const openKeys = []

  for (const row of holdingsRows) {
    const id = `${row.holding_external_id ?? ''}`.trim()
    if (!id) continue
    if (row.closed === true) closedKeys.push(id)
    else openKeys.push(id)
  }

  const runChunk = async (keys, closed) => {
    for (let i = 0; i < keys.length; i += POSITIONS_CLOSED_MIRROR_CHUNK) {
      const chunk = keys.slice(i, i + POSITIONS_CLOSED_MIRROR_CHUNK)
      const { error } = await supabase
        .from('positions')
        .update({ closed })
        .eq('user_id', userId)
        .in('sharesight_holding_key', chunk)

      if (error) throw error
    }
  }

  if (closedKeys.length) await runChunk(closedKeys, true)
  if (openKeys.length) await runChunk(openKeys, false)
}

/**
 * Log one raw Sharesight holding payload for debugging normalisation (e.g. GHHF).
 * Safe for production: one structured `console.info` per sync when a match exists.
 *
 * @param {unknown[]} holdingsRaw
 * @param {string} tickerNeedle e.g. `GHHF` — matched case-insensitively on instrument code/symbol/name.
 * @param {{ portfolio_role?: string, portfolio_external_id?: string }} [ctx]
 */
function logSharesightHoldingRawSampleForDebug(holdingsRaw, tickerNeedle, ctx) {
  const needle = `${tickerNeedle ?? ''}`.trim().toUpperCase()

  if (!needle || !Array.isArray(holdingsRaw)) return

  for (const raw of holdingsRaw) {
    if (!raw || typeof raw !== 'object') continue

    const h = /** @type {Record<string, unknown>} */ (raw)
    const inst = h.instrument && typeof h.instrument === 'object' ? /** @type {Record<string, unknown>} */ (h.instrument) : null

    const code = `${inst?.code ?? inst?.symbol ?? inst?.ticker ?? h.code ?? ''}`.trim().toUpperCase()
    const name = `${inst?.name ?? h.name ?? ''}`.toLowerCase()

    const hit =
      code.includes(needle) ||
      name.includes(needle.toLowerCase()) ||
      `${h.description ?? ''}`.toLowerCase().includes(needle.toLowerCase())

    if (!hit) continue

    try {
      const json = JSON.stringify(raw)
      const truncated = json.length > 16_000 ? `${json.slice(0, 16_000)}…(truncated)` : json

      console.info('[sharesight-sync] sample_holding_raw', {
        portfolio_role: ctx?.portfolio_role,
        portfolio_external_id: ctx?.portfolio_external_id,
        tickerNeedle: needle,
        topLevelKeys: Object.keys(h),
        instrumentKeys: inst ? Object.keys(inst) : null,
        json: truncated,
      })
    } catch (e) {
      console.info('[sharesight-sync] sample_holding_raw_unserializable', {
        portfolio_role: ctx?.portfolio_role,
        portfolio_external_id: ctx?.portfolio_external_id,
        tickerNeedle: needle,
        topLevelKeys: Object.keys(h),
        err: e instanceof Error ? e.message : String(e),
      })
    }

    return
  }

  console.info('[sharesight-sync] sample_holding_raw_no_match', {
    portfolio_role: ctx?.portfolio_role,
    portfolio_external_id: ctx?.portfolio_external_id,
    tickerNeedle: needle,
    holdingCount: holdingsRaw.length,
    hint: 'No holding matched this ticker; check instrument code in Sharesight vs search string.',
  })
}

/**
 * @param {unknown} valuation
 * @param {{ portfolio_role?: string, portfolio_external_id?: string }} ctx
 */
function logValuationResponseSample(valuation, ctx) {
  if (!valuation || typeof valuation !== 'object') {
    console.info('[sharesight-sync] valuation_response_sample', {
      ...ctx,
      present: false,
    })

    return
  }

  const list = parseValuationHoldingsList(valuation)
  const first = list[0] && typeof list[0] === 'object' ? Object.keys(/** @type {Record<string, unknown>} */ (list[0])) : null

  /** @type {string} */
  let json

  try {
    const s = JSON.stringify(valuation)

    json = s.length > 14_000 ? `${s.slice(0, 14_000)}…(truncated)` : s
  } catch (e) {
    json = `(unserializable: ${e instanceof Error ? e.message : String(e)})`
  }

  console.info('[sharesight-sync] valuation_response_sample', {
    ...ctx,
    present: true,
    topLevelKeys: Object.keys(/** @type {Record<string, unknown>} */ (valuation)),
    valuationHoldingsCount: list.length,
    firstHoldingKeys: first,
    json,
  })
}

/**
 * Per-valuation-row id fields (diagnose v3 holdings id vs valuation holding id mismatches).
 *
 * @param {unknown} valuation
 * @param {{ portfolio_role?: string, portfolio_external_id?: string }} ctx
 */
function logValuationHoldingsIdLedger(valuation, ctx) {
  const list = parseValuationHoldingsList(valuation)

  const rows = list.slice(0, 150).map((item, idx) => {
    if (!item || typeof item !== 'object') return { idx, error: 'non_object' }

    const o = /** @type {Record<string, unknown>} */ (item)
    const inst =
      Reflect.get(o, 'instrument') && typeof Reflect.get(o, 'instrument') === 'object'
        ? /** @type {Record<string, unknown>} */ (Reflect.get(o, 'instrument'))
        : null

    /** @type {Record<string, unknown>|null} */
    const nestH =
      Reflect.get(o, 'holding') && typeof Reflect.get(o, 'holding') === 'object'
        ? /** @type {Record<string, unknown>} */ (Reflect.get(o, 'holding'))
        : null

    return {
      idx,
      ids: {
        id: Reflect.get(o, 'id'),
        id_type: typeof Reflect.get(o, 'id'),
        holding_id: Reflect.get(o, 'holding_id'),
        portfolio_holding_id: Reflect.get(o, 'portfolio_holding_id'),
        nested_holding_id: nestH ? Reflect.get(nestH, 'id') : undefined,
      },
      instrument_ids: inst
        ? {
            instrument_id: Reflect.get(inst, 'id'),
            instrument_id_type: typeof Reflect.get(inst, 'id'),
            code: Reflect.get(inst, 'code'),
            symbol: Reflect.get(inst, 'symbol'),
          }
        : null,
      valuation_symbol_top: Reflect.get(o, 'symbol'),
      quantity: Reflect.get(o, 'quantity'),
      market_value: Reflect.get(o, 'market_value'),
      value_preview: Reflect.get(o, 'value'),
    }
  })

  console.info('[sharesight-sync] valuation_holdings_id_ledger', {
    ...ctx,
    totalValuationHoldingsParsed: list.length,
    ledgerRowsSampled: rows.length,
    rows,
  })
}

/**
 * INSERT … ON CONFLICT DO UPDATE via PostgREST (survives re-sync and intra-batch duplicates).
 *
 * @template T
 * @param {SupabaseClient} supabase
 * @param {string} table
 * @param {T[]} rows
 * @param {string} onConflict Comma-separated column list matching unique index columns.
 * @param {number} chunkSize
 */
async function upsertChunks(supabase, table, rows, onConflict, chunkSize = 250) {
  if (rows.length === 0) return

  for (let i = 0; i < rows.length; i += chunkSize) {
    const slice = rows.slice(i, i + chunkSize)

    if (slice.length === 0) continue

    const { error } = await supabase.from(table).upsert(slice, { onConflict })

    if (error) throw error
  }
}

/**
 * @typedef {{ portfolioRole: 'core'|'satellite', portfolioExternalId: string, inceptionDate: string }} PortfolioTarget
 */

/**
 * Best-effort: pull payouts for holdings (distribution / income tracking).
 *
 * @param {SupabaseClient} supabase
 * @param {string} accessToken
 * @param {{ holding_external_id: string }[]} holdings
 */
/** @param {unknown} raw */
function tradeExecutedAtMs(raw) {
  if (!raw || typeof raw !== 'object') return 0

  /** @type {any} */
  const t = raw
  const s = String(t.trade_date ?? t.transaction_date ?? t.date ?? t.trade_placed_at ?? '').trim()

  if (!s) return 0

  const ms = Date.parse(s)

  return Number.isFinite(ms) ? ms : 0
}

async function syncIncomeForHoldings(supabase, accessToken, holdings) {
  const incomeRowsToInsert = await mapWithConcurrency(2, holdings, async (h) => {
    const payoutsJson = /** @type {any} */ (
      await sharesightAuthorizedFetch(
        accessToken,
        `api/v3/holdings/${encodeURIComponent(h.holding_external_id)}/payouts`,
        { supabase },
      )
    )

    logSharesightRaw(
      '[sharesight-raw] payouts',
      {
        endpoint: `api/v3/holdings/${encodeURIComponent(h.holding_external_id)}/payouts`,
        holding_external_id: h.holding_external_id,
      },
      payoutsJson,
    )

    const payouts = Array.isArray(payoutsJson?.payouts) ? payoutsJson.payouts : Array.isArray(payoutsJson) ? payoutsJson : []

    return payouts
      .map((payout) => {
        const n = normalizePayout(payout)

        return n ? { normalized: n, holding_external_id: h.holding_external_id } : null
      })
      .filter(Boolean)
  })

  return incomeRowsToInsert.flat()
}

/**
 * Deletes prior snapshot rows for one portfolio slice before re-import.
 *
 * @param {SupabaseClient} supabase
 * @param {string} userId
 * @param {'core'|'satellite'} portfolioRole
 * @param {string} portfolioId
 */
async function deletePortfolioSnapshotRows(supabase, userId, portfolioRole, portfolioId) {
  const tables = /** @type {const} */ ([
    'sharesight_holdings',
    'sharesight_trades',
    'sharesight_cash_balances',
    'sharesight_performance_snapshots',
    'sharesight_income_events',
  ])

  for (const table of tables) {
    const { error } = await supabase
      .from(table)
      .delete()
      .eq('user_id', userId)
      .eq('portfolio_role', portfolioRole)
      .eq('portfolio_external_id', portfolioId)

    if (error) throw error
  }
}

/**
 * Sequential Sharesight API fetch (holdings → valuation → performance) to reduce parallel 401 pressure.
 *
 * @param {SupabaseClient} supabase
 * @param {string} accessToken
 * @param {string} userId
 * @param {string} syncRunId
 * @param {PortfolioTarget} target
 */
async function syncPortfolioHoldingsCashPerf(supabase, accessToken, userId, syncRunId, target) {
  const portfolioId = target.portfolioExternalId

  const portfolioRole = /** @type {'core'|'satellite'} */ (target.portfolioRole)

  const safePortfolioPath = encodeURIComponent(portfolioId)

  /** @type {string[]} */
  const warnings = []

  try {
    await deletePortfolioSnapshotRows(supabase, userId, portfolioRole, portfolioId)

    /** @type {any} */
    let holdingsPayload

    try {
      holdingsPayload = await sharesightAuthorizedFetch(
        accessToken,
        `api/v3/portfolios/${safePortfolioPath}/holdings`,
        { supabase },
      )
      logSharesightRaw(
        '[sharesight-raw] holdings',
        {
          endpoint: `api/v3/portfolios/${safePortfolioPath}/holdings`,
          portfolio_role: portfolioRole,
          portfolio_external_id: portfolioId,
        },
        holdingsPayload,
      )
    } catch (reason) {
      warnings.push(`Holdings sync failed (${portfolioRole}): ${formatErrorBestEffort(reason)}`)

      return {
        holdingsOk: false,
        warnings,
        portfolioRole,
        portfolioId,
        portfolioHoldingKeys: /** @type {{ holding_external_id: string }[]} */ ([]),
      }
    }

    /** @type {{ holding_external_id: string }[]} */
    const portfolioHoldingKeys = []

    const holdingsRaw = Array.isArray(holdingsPayload?.holdings)
      ? holdingsPayload.holdings
      : Array.isArray(holdingsPayload)
        ? holdingsPayload
        : []

    logSharesightRawAuditHoldings(holdingsRaw, {
      endpoint: `api/v3/portfolios/${safePortfolioPath}/holdings`,
      source: 'holdings',
      portfolio_role: portfolioRole,
      portfolio_external_id: portfolioId,
    })

    logSharesightHoldingRawSampleForDebug(holdingsRaw, 'GHHF', {
      portfolio_role: portfolioRole,
      portfolio_external_id: portfolioId,
    })

    const holdingRows = holdingsRaw
      .map((raw) => {
        const normalized = normalizeHolding(raw)

        if (!normalized) return null

        portfolioHoldingKeys.push({ holding_external_id: normalized.holding_external_id })

        return {
          user_id: userId,
          portfolio_role: portfolioRole,
          portfolio_external_id: portfolioId,
          holding_external_id: normalized.holding_external_id,
          instrument_symbol: normalized.instrument_symbol,
          instrument_name: normalized.instrument_name,
          quantity: normalized.quantity,
          market_value: normalized.market_value,
          holding_value_aud: normalized.holding_value_aud,
          cost_basis: normalized.cost_basis,
          unrealized_gain_loss: normalized.unrealized_gain_loss,
          realized_gain_loss: normalized.realized_gain_loss,
          payout_gain: normalized.payout_gain,
          currency_gain: normalized.currency_gain,
          total_gain: normalized.total_gain,
          capital_gain_percent: normalized.capital_gain_percent,
          total_gain_percent: normalized.total_gain_percent,
          currency: normalized.currency,
          raw: normalized.raw,
          sync_run_id: syncRunId,
        }
      })
      .filter(Boolean)

    const dedupedHoldings = dedupeRowsBy(
      /** @type {any[]} */ (holdingRows),
      (r) => `${r.user_id}|${r.portfolio_role}|${r.holding_external_id}`,
    )

    /** @type {any} */
    let valuationPayload = null

    try {
      valuationPayload = await sharesightAuthorizedFetch(
        accessToken,
        `api/v2/portfolios/${safePortfolioPath}/valuation.json`,
        { supabase },
      )
      logSharesightRaw(
        '[sharesight-raw] valuation',
        {
          endpoint: `api/v2/portfolios/${safePortfolioPath}/valuation.json`,
          portfolio_role: portfolioRole,
          portfolio_external_id: portfolioId,
        },
        valuationPayload,
      )
      logSharesightRawAuditHoldings(parseValuationHoldingsList(valuationPayload), {
        endpoint: `api/v2/portfolios/${safePortfolioPath}/valuation.json`,
        source: 'valuation',
        portfolio_role: portfolioRole,
        portfolio_external_id: portfolioId,
      })
    } catch (reason) {
      warnings.push(`Valuation fetch failed (${portfolioRole}): ${formatErrorBestEffort(reason)}`)
    }

    /** @type {any} */
    let performancePayload = null

    try {
      performancePayload = await sharesightAuthorizedFetch(
        accessToken,
        `api/v2/portfolios/${safePortfolioPath}/performance.json`,
        {
          supabase,
          searchParams: {
            start_date: target.inceptionDate,
            end_date: isoDateUtc(),
          },
        },
      )
      logSharesightRaw(
        '[sharesight-raw] performance',
        {
          endpoint: `api/v2/portfolios/${safePortfolioPath}/performance.json`,
          portfolio_role: portfolioRole,
          portfolio_external_id: portfolioId,
          start_date: target.inceptionDate,
          end_date: isoDateUtc(),
        },
        performancePayload,
      )
      logSharesightRawAuditHoldings(collectPerformanceHoldingLikeRows(performancePayload), {
        endpoint: `api/v2/portfolios/${safePortfolioPath}/performance.json`,
        source: 'performance',
        portfolio_role: portfolioRole,
        portfolio_external_id: portfolioId,
      })
    } catch (reason) {
      warnings.push(`Performance fetch failed (${portfolioRole}): ${formatErrorBestEffort(reason)}`)
    }

    const tradesResult = await syncPortfolioTrades(
      supabase,
      accessToken,
      userId,
      syncRunId,
      portfolioRole,
      portfolioId,
    )

    if (tradesResult.warning) warnings.push(tradesResult.warning)

    /** @type {any} */
    let cashAccountsPayload = null

    try {
      cashAccountsPayload = await sharesightAuthorizedFetch(
        accessToken,
        `api/v2/portfolios/${safePortfolioPath}/cash_accounts.json`,
        { supabase },
      )
      logSharesightRaw(
        '[sharesight-raw] cash_accounts',
        {
          endpoint: `api/v2/portfolios/${safePortfolioPath}/cash_accounts.json`,
          portfolio_role: portfolioRole,
          portfolio_external_id: portfolioId,
        },
        cashAccountsPayload,
      )
    } catch (reason) {
      warnings.push(`Cash accounts fetch failed (${portfolioRole}): ${formatErrorBestEffort(reason)}`)
    }

    logValuationResponseSample(valuationPayload, {
      portfolio_role: portfolioRole,
      portfolio_external_id: portfolioId,
    })

    if (`${portfolioRole}`.trim().toLowerCase() === 'satellite') {
      logValuationHoldingsIdLedger(valuationPayload, {
        portfolio_role: portfolioRole,
        portfolio_external_id: portfolioId,
      })
    }

    const valuationById = indexValuationHoldingsByExternalId(valuationPayload)
    const valuationByInstrumentCode = indexValuationHoldingsByInstrumentCode(valuationPayload)
    const performanceById = indexPerformanceHoldingsByExternalId(performancePayload)

    console.info('[sharesight-sync] performance_holding_index', {
      portfolio_role: portfolioRole,
      portfolio_external_id: portfolioId,
      indexedHoldingRows: performanceById.size,
      performanceTopKeys:
        performancePayload && typeof performancePayload === 'object'
          ? Object.keys(/** @type {Record<string, unknown>} */ (performancePayload))
          : [],
    })

    const holdingsMerged = dedupedHoldings.map((row) => {
      const r = /** @type {Record<string, unknown>} */ (row)
      const hid = `${r.holding_external_id ?? ''}`.trim()

      let out = r

      let vh = hid ? valuationById.get(hid) : undefined

      if (!vh && hid) {
        const n = Number.parseFloat(hid)

        if (Number.isFinite(n))
          vh = valuationById.get(String(Math.trunc(n))) ?? valuationById.get(String(n))
      }

      const codeKey = `${r.instrument_symbol ?? ''}`
        .trim()
        .toUpperCase()
        .replace(/^ASX:/i, '')
        .replace(/\.(AX|AU|L)$/i, '')

      if (!vh && codeKey) vh = valuationByInstrumentCode.get(codeKey)

      if (vh) out = applyValuationHoldingToSharesightRow(out, vh)

      const symbolKey = normalizeSharesightSymbolKey(Reflect.get(r, 'instrument_symbol'))
      const ph = (hid ? performanceById.get(hid) : undefined) ?? (symbolKey ? performanceById.get(`symbol:${symbolKey}`) : undefined)

      if (ph) out = applyPerformanceHoldingFillGaps(out, ph)

      if (symbolKey && tradesResult.costBasisBySymbol.has(symbolKey)) {
        out = {
          ...out,
          cost_basis: tradesResult.costBasisBySymbol.get(symbolKey),
        }
      }

      return out
    })

    const holdingsForUpsert = holdingsMerged.map((row) => ({
      ...row,
      closed: isSharesightHoldingClosed(/** @type {Record<string, unknown>} */ (row)),
    }))

    const ghhNorm = holdingsForUpsert.find((r) => `${r.instrument_symbol ?? ''}`.toUpperCase().includes('GHHF'))

    if (ghhNorm) {
      console.info('[sharesight-sync] ghh_f_normalized_upsert_row', {
        holding_external_id: ghhNorm.holding_external_id,
        instrument_symbol: ghhNorm.instrument_symbol,
        quantity: ghhNorm.quantity,
        market_value: ghhNorm.market_value,
        holding_value_aud: ghhNorm.holding_value_aud,
        cost_basis: ghhNorm.cost_basis,
        unrealized_gain_loss: ghhNorm.unrealized_gain_loss,
        payout_gain: ghhNorm.payout_gain,
        currency_gain: ghhNorm.currency_gain,
        total_gain: ghhNorm.total_gain,
        capital_gain_percent: ghhNorm.capital_gain_percent,
        total_gain_percent: ghhNorm.total_gain_percent,
        currency: ghhNorm.currency,
      })
    }

    await upsertChunks(supabase, 'sharesight_holdings', holdingsForUpsert, UPSERT_HOLDINGS_ON)

    try {
      await mirrorPositionsClosedFromHoldings(supabase, userId, holdingsForUpsert)
    } catch (e) {
      warnings.push(`positions.closed mirror (${portfolioRole}): ${formatErrorBestEffort(e)}`)
    }

    if (cashAccountsPayload) {
      try {
        const cashRowsRaw = extractCashBalancesFromCashAccountsPayload(cashAccountsPayload).map((c) => ({
          user_id: userId,
          portfolio_role: portfolioRole,
          portfolio_external_id: portfolioId,
          portfolio_id: portfolioId,
          account_key: c.account_key,
          cash_account_id: c.cash_account_id,
          label: c.label,
          name: c.name,
          currency: c.currency ?? '',
          balance: c.balance,
          balance_in_portfolio_currency: c.balance_in_portfolio_currency,
          raw: c.raw,
          sync_run_id: syncRunId,
        }))

        const dedupedCash = dedupeRowsBy(
          /** @type {any[]} */ (cashRowsRaw),
          (r) => `${r.user_id}|${r.portfolio_role}|${r.portfolio_external_id}|${r.account_key}|${r.currency}`,
        )

        await upsertChunks(supabase, 'sharesight_cash_balances', dedupedCash, UPSERT_CASH_ON)
      } catch (error) {
        warnings.push(`Cash accounts import failed (${portfolioRole}): ${formatErrorBestEffort(error)}`)
      }
    }

    if (performancePayload) {
      try {
        const endDate = isoDateUtc()

        await upsertChunks(
          supabase,
          'sharesight_performance_snapshots',
          [
            {
              user_id: userId,
              portfolio_role: portfolioRole,
              portfolio_external_id: portfolioId,
              start_date: target.inceptionDate,
              end_date: endDate,
              payload: performancePayload,
              sync_run_id: syncRunId,
            },
          ],
          UPSERT_PERFORMANCE_ON,
          10,
        )
      } catch (error) {
        warnings.push(`Performance import failed (${portfolioRole}): ${formatErrorBestEffort(error)}`)
      }
    }

    return {
      holdingsOk: true,
      warnings,
      portfolioRole,
      portfolioId,
      portfolioHoldingKeys,
    }
  } catch (error) {
    warnings.push(`Holdings sync failed (${portfolioRole}): ${formatErrorBestEffort(error)}`)

    return {
      holdingsOk: false,
      warnings,
      portfolioRole,
      portfolioId,
      portfolioHoldingKeys: [],
    }
  }
}

/**
 * @param {SupabaseClient} supabase
 * @param {string} accessToken
 * @param {string} userId
 * @param {string} syncRunId
 * @param {'core'|'satellite'} portfolioRole
 * @param {string} portfolioId
 */
async function syncPortfolioTrades(
  supabase,
  accessToken,
  userId,
  syncRunId,
  portfolioRole,
  portfolioId,
) {
  const safePortfolioPath = encodeURIComponent(portfolioId)

  try {
    const tradesAll = []

    const maxPages = 250

    for (let page = 1; page <= maxPages; page += 1) {
      /** @type {Record<string, string | number>} */
      const searchParams = { page }

      /** @type {any} */
      const tradesPayload = /** @type {any} */ (
        await sharesightAuthorizedFetch(accessToken, `api/v2/portfolios/${safePortfolioPath}/trades.json`, {
          supabase,
          searchParams,
        })
      )

      logSharesightRaw(
        '[sharesight-raw] trades',
        {
          endpoint: `api/v2/portfolios/${safePortfolioPath}/trades.json`,
          portfolio_role: portfolioRole,
          portfolio_external_id: portfolioId,
          page,
        },
        tradesPayload,
      )

      const pageTrades = Array.isArray(tradesPayload?.trades)
        ? tradesPayload.trades
        : Array.isArray(tradesPayload)
          ? tradesPayload
          : []

      if (pageTrades.length === 0) break

      tradesAll.push(...pageTrades)
    }

    const tradeRows = tradesAll
      .map((t) => {
        const normalized = normalizeTrade(t)

        if (!normalized) return null

        return {
          user_id: userId,
          portfolio_role: portfolioRole,
          portfolio_external_id: portfolioId,
          trade_external_id: normalized.trade_external_id,
          raw: normalized.raw,
          sync_run_id: syncRunId,
        }
      })
      .filter(Boolean)

    const dedupedTrades = dedupeRowsBy(
      /** @type {any[]} */ (tradeRows),
      (r) => `${r.user_id}|${r.portfolio_role}|${r.trade_external_id}`,
    )

    await upsertChunks(supabase, 'sharesight_trades', dedupedTrades, UPSERT_TRADES_ON)

    let maxTradeMs = 0

    for (const t of tradesAll) {
      maxTradeMs = Math.max(maxTradeMs, tradeExecutedAtMs(t))
    }

    if (maxTradeMs > 0) {
      const nextCursor = new Date(maxTradeMs).toISOString()

      await patchSharesightTradeCursor(supabase, portfolioRole, nextCursor)
    }

    return { warning: null, costBasisBySymbol: calculateCostBasisBySymbol(tradesAll) }
  } catch (error) {
    return {
      warning: /** @type {string} */ (`Trades import failed (${portfolioRole}): ${formatErrorBestEffort(error)}`),
      costBasisBySymbol: new Map(),
    }
  }
}

/**
 * @param {SupabaseClient} supabase
 * @param {string} accessToken
 * @param {string} userId
 * @param {string} syncRunId
 * @param {'core'|'satellite'} portfolioRole
 * @param {string} portfolioId
 * @param {{ holding_external_id: string }[]} portfolioHoldingKeys
 */

async function syncPortfolioIncome(
  supabase,
  accessToken,
  userId,
  syncRunId,
  portfolioRole,
  portfolioId,
  portfolioHoldingKeys,
) {
  try {
    const incomePairs = await syncIncomeForHoldings(supabase, accessToken, portfolioHoldingKeys)

    const incomeRows = incomePairs
      .map((pair) =>
        pair
          ? {
              user_id: userId,
              portfolio_role: portfolioRole,
              portfolio_external_id: portfolioId,
              holding_external_id: pair.holding_external_id,
              income_external_id: pair.normalized.income_external_id,
              paid_on: pair.normalized.paid_on,
              amount: pair.normalized.amount,
              currency: pair.normalized.currency,
              kind: pair.normalized.kind,
              raw: pair.normalized.raw,
              sync_run_id: syncRunId,
            }
          : null,
      )
      .filter(Boolean)

    const dedupedIncome = dedupeRowsBy(
      /** @type {any[]} */ (incomeRows),
      (r) => `${r.user_id}|${r.portfolio_role}|${r.holding_external_id}|${r.income_external_id}`,
    )

    await upsertChunks(supabase, 'sharesight_income_events', dedupedIncome, UPSERT_INCOME_ON)

    return null
  } catch (error) {
    return /** @type {string} */ (`Income import failed (${portfolioRole}): ${formatErrorBestEffort(error)}`)
  }
}

/**
 * @param {SupabaseClient} supabase
 * @param {{ trigger: 'app_load'|'interval'|'manual', onProgress?: (label: string) => void }} args
 */

export async function syncSharesightPortfolios(supabase, args) {
  const attemptAt = new Date().toISOString()

  const { data: userData, error: userErr } = await supabase.auth.getUser()
  if (userErr) throw userErr

  const userId = userData?.user?.id
  if (!userId) throw new Error('You must be signed in to sync Sharesight data.')

  await patchSharesightSyncMeta(supabase, {
    last_sync_attempt_at: attemptAt,
  })

  const { core, satellite } = getSharesightPortfolioUuids()

  /** @type {string | undefined} */
  let accessToken
  try {
    const ensured = await ensureSharesightAccessToken(supabase)

    accessToken = ensured.accessToken
    seedSharesightAccessMemoryFromRow(ensured.row)
  } catch (error) {
    const message = formatErrorBestEffort(error)

    await patchSharesightSyncMeta(supabase, {
      last_sync_error: message,
    })

    throw error
  }

  /** @type {any} */
  let portfoliosPayload = null

  try {
    portfoliosPayload = await sharesightAuthorizedFetch(accessToken, 'api/v2/portfolios.json', { supabase })

    logSharesightRaw('[sharesight-raw] portfolios', { endpoint: 'api/v2/portfolios.json' }, portfoliosPayload)
  } catch (error) {
    console.warn('[sharesight-raw] portfolios fetch failed', {
      endpoint: 'api/v2/portfolios.json',
      error: formatErrorBestEffort(error),
    })
  }

  const inceptionByPortfolioId = indexPortfolioInceptionDates(portfoliosPayload)

  /** @type {PortfolioTarget[]} */
  const targets = [
    {
      portfolioRole: 'core',
      portfolioExternalId: core,
      inceptionDate: inceptionByPortfolioId.get(core) ?? '2000-01-01',
    },
    {
      portfolioRole: 'satellite',
      portfolioExternalId: satellite,
      inceptionDate: inceptionByPortfolioId.get(satellite) ?? '2000-01-01',
    },
  ]

  const { data: runRow, error: runErr } = await supabase
    .from('sharesight_sync_runs')
    .insert({
      user_id: userId,
      status: 'running',
      trigger: args.trigger,
    })
    .select('id')
    .single()

  if (runErr) throw runErr

  const syncRunId = runRow.id

  /** @type {string[]} */
  const partialWarnings = []

  /** When true, `{ finalizeSharesightSyncRun + throw }` already ran — skip duplicate finalization in `catch`. */
  let finalizedThisSyncRun = false

  try {
    const report = typeof args.onProgress === 'function' ? args.onProgress : /** @param {string} _m */ () => {}

    /** Dual labels mirror the Sharesight workloads (parallel per portfolio vs sequential UI copy). */

    report('Syncing holdings (core, then satellite)…')

    /** Core then satellite — sequential to reduce parallel 401 pressure. */

    const phase1 = []

    for (const target of targets) {
      const pr = await syncPortfolioHoldingsCashPerf(
        supabase,
        /** @type {string} */ (accessToken),
        userId,
        syncRunId,
        target,
      )

      phase1.push(pr)
    }

    for (const p of phase1) partialWarnings.push(...p.warnings)

    const holdingsSucceededForAllTargets = phase1.every((prt) => prt.holdingsOk)

    if (holdingsSucceededForAllTargets) {
      report('Syncing income & distributions…')

      for (const prt of phase1) {
        const iw = await syncPortfolioIncome(
          supabase,
          /** @type {string} */ (accessToken),
          userId,
          syncRunId,
          prt.portfolioRole,
          prt.portfolioId,
          prt.portfolioHoldingKeys,
        )

        if (typeof iw === 'string') partialWarnings.push(iw)
      }
    }

    const mergedWarnings = partialWarnings.filter(Boolean)

    if (!holdingsSucceededForAllTargets) {
      const summary =
        mergedWarnings.filter((w) => w.startsWith('Holdings sync failed')).join(' | ') ||
        mergedWarnings.join(' | ') ||
        'Holdings sync failed for one or more portfolios.'

      await patchSharesightSyncMeta(supabase, {
        last_sync_error: mergedWarnings.length ? mergedWarnings.join(' | ') : summary,
      })

      await finalizeSharesightSyncRun(supabase, syncRunId, {
        status: 'error',
        error_message: mergedWarnings.length ? mergedWarnings.join(' | ') : summary,
      })

      finalizedThisSyncRun = true

      throw new Error(summary)
    }

    try {
      report('Applying watchlist promotions…')

      await promoteWatchlistMatchesAfterSync(supabase, userId)
    } catch (e) {
      partialWarnings.push(`Watchlist promotion: ${formatErrorBestEffort(e)}`)
    }

    const finalWarnings = partialWarnings.filter(Boolean)

    await patchSharesightSyncMeta(supabase, {
      last_successful_sync_at: new Date().toISOString(),
      last_sync_error: finalWarnings.length ? finalWarnings.join(' | ') : null,
    })

    await finalizeSharesightSyncRun(supabase, syncRunId, {
      status: finalWarnings.length ? 'partial' : 'success',
      error_message: finalWarnings.length ? finalWarnings.join(' | ') : null,
    })

    report('Complete')

    finalizedThisSyncRun = true

    return {
      syncRunId,
      ok: true,
      partialWarnings: finalWarnings,
    }
  } catch (error) {
    const message = formatErrorBestEffort(error)

    if (error instanceof SharesightSuspendedError && !finalizedThisSyncRun) {
      await patchSharesightSyncMeta(supabase, {
        last_sync_error: message,
      })

      await finalizeSharesightSyncRun(supabase, syncRunId, {
        status: 'partial',
        error_message: message,
      })

      throw error
    }

    if (!finalizedThisSyncRun) {
      await patchSharesightSyncMeta(supabase, {
        last_sync_error: message,
      })

      await finalizeSharesightSyncRun(supabase, syncRunId, {
        status: 'error',
        error_message: message,
      })
    }

    throw error
  }
}

/**
 * Saves tokens after OAuth completes and clears reconnect-required flags best-effort.
 *
 * @param {SupabaseClient} supabase
 * @param {import('./oauth.js').SharesightTokenResponse} tokenPayload
 */
export async function persistFreshSharesightOAuthTokens(supabase, tokenPayload) {
  const { data: existing } = await fetchSharesightOAuthRow(supabase)

  const fromPayload =
    typeof tokenPayload.refresh_token === 'string' && tokenPayload.refresh_token.trim()
      ? tokenPayload.refresh_token.trim()
      : null

  /** Some token responses omit `refresh_token`; never clear a previously stored refresh token. */
  const refreshTokenNext = fromPayload ?? (typeof existing?.refresh_token === 'string' ? existing.refresh_token : null)

  await upsertSharesightOAuthRow(supabase, {
    access_token: tokenPayload.access_token,
    refresh_token: refreshTokenNext,
    token_type: tokenPayload.token_type,
    expires_in: tokenPayload.expires_in,
    reconnect_required: false,
    clear_auth_error: true,
  })

  setSharesightAccessMemoryToken(tokenPayload.access_token, tokenPayload.expires_in)
}

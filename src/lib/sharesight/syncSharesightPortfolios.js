/** @typedef {import('@supabase/supabase-js').SupabaseClient} SupabaseClient */

import { ensureSharesightAccessToken } from './tokenSession.js'
import { sharesightAuthorizedFetch } from './sharesightHttp.js'
import { getSharesightPortfolioUuids } from './runtimeEnv.js'
import {
  normalizeHolding,
  normalizeTrade,
  normalizePayout,
  extractCashBalancesFromValuationPayload,
} from './normalizePayloads.js'
import {
  patchSharesightSyncMeta,
  upsertSharesightOAuthRow,
} from './oauthCredentialsRepository.js'
import { mapWithConcurrency } from './asyncPool.js'

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
 * @typedef {{ portfolioRole: 'core'|'satellite', portfolioExternalId: string }} PortfolioTarget
 */

/**
 * Best-effort: pull payouts for holdings (distribution / income tracking).
 *
 * @param {string} accessToken
 * @param {{ holding_external_id: string }[]} holdings
 */
async function syncIncomeForHoldings(accessToken, holdings) {
  const incomeRowsToInsert = await mapWithConcurrency(5, holdings, async (h) => {
    const payoutsJson = /** @type {any} */ (
      await sharesightAuthorizedFetch(accessToken, `api/v3/holdings/${encodeURIComponent(h.holding_external_id)}/payouts`)
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
 * @param {SupabaseClient} supabase
 * @param {{ trigger: 'app_load'|'interval'|'manual' }} args
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

  /** @type {PortfolioTarget[]} */
  const targets = [
    { portfolioRole: 'core', portfolioExternalId: core },
    { portfolioRole: 'satellite', portfolioExternalId: satellite },
  ]

  /** @type {string | undefined} */
  let accessToken
  try {
    const ensured = await ensureSharesightAccessToken(supabase)

    accessToken = ensured.accessToken
  } catch (error) {
    const message = formatErrorBestEffort(error)

    await patchSharesightSyncMeta(supabase, {
      last_sync_error: message,
    })

    throw error
  }

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
    /** If any portfolio fails deletes + holdings fetch/upsert, we do not advance "last successful" metadata. */
    let holdingsSucceededForAllTargets = true

    for (const target of targets) {
      const portfolioId = target.portfolioExternalId
      const portfolioRole = target.portfolioRole

      const safePortfolioPath = encodeURIComponent(portfolioId)

      // Purge previous snapshot rows for this portfolio slice (holdings/trades/etc. refreshed each run).
      const deleteEq = async (/** @type {string} */ table) => {
        const { error } = await supabase
          .from(table)
          .delete()
          .eq('user_id', userId)
          .eq('portfolio_role', portfolioRole)
          .eq('portfolio_external_id', portfolioId)

        if (error) throw error
      }

      /** @type {{ holding_external_id: string }[]} */
      let portfolioHoldingKeys = []

      try {
        await deleteEq('sharesight_holdings')
        await deleteEq('sharesight_trades')
        await deleteEq('sharesight_cash_balances')
        await deleteEq('sharesight_performance_snapshots')
        await deleteEq('sharesight_income_events')

        /** @type {any} */
        const holdingsPayload = /** @type {any} */ (
          await sharesightAuthorizedFetch(accessToken, `api/v3/portfolios/${safePortfolioPath}/holdings`)
        )

        const holdingsRaw = Array.isArray(holdingsPayload?.holdings)
          ? holdingsPayload.holdings
          : Array.isArray(holdingsPayload)
            ? holdingsPayload
            : []

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
              cost_basis: normalized.cost_basis,
              unrealized_gain_loss: normalized.unrealized_gain_loss,
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

        await upsertChunks(supabase, 'sharesight_holdings', dedupedHoldings, UPSERT_HOLDINGS_ON)
      } catch (error) {
        holdingsSucceededForAllTargets = false
        partialWarnings.push(`Holdings sync failed (${portfolioRole}): ${formatErrorBestEffort(error)}`)

        portfolioHoldingKeys = []
        continue
      }

      // Trades (paginated best-effort; upsert tolerates overlap / re-runs)
      /** @type {any[]} */
      const tradesAll = []

      try {
        for (let page = 1; page <= 250; page += 1) {
          /** @type {any} */
          const tradesPayload = /** @type {any} */ (
            await sharesightAuthorizedFetch(accessToken, `api/v3/portfolios/${safePortfolioPath}/trades.json`, {
              searchParams: { page },
            })
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
      } catch (error) {
        partialWarnings.push(`Trades import failed (${portfolioRole}): ${formatErrorBestEffort(error)}`)
      }

      // Portfolio valuation → cash balances (broker cash extraction is best-effort)
      try {
        const valuationPayload = await sharesightAuthorizedFetch(
          accessToken,
          `api/v2/portfolios/${safePortfolioPath}/valuation.json`,
        )

        const cashRowsRaw = extractCashBalancesFromValuationPayload(valuationPayload).map((c) => ({
          user_id: userId,
          portfolio_role: portfolioRole,
          portfolio_external_id: portfolioId,
          account_key: c.account_key,
          label: c.label,
          currency: c.currency ?? '',
          balance: c.balance,
          raw: c.raw,
          sync_run_id: syncRunId,
        }))

        const dedupedCash = dedupeRowsBy(
          /** @type {any[]} */ (cashRowsRaw),
          (r) => `${r.user_id}|${r.portfolio_role}|${r.portfolio_external_id}|${r.account_key}|${r.currency}`,
        )

        await upsertChunks(supabase, 'sharesight_cash_balances', dedupedCash, UPSERT_CASH_ON)
      } catch (error) {
        partialWarnings.push(`Valuation / cash balances import failed (${portfolioRole}): ${formatErrorBestEffort(error)}`)
      }

      // Performance over time (full JSON retained for downstream charting UI)
      try {
        /** @type {any} */
        const performancePayload = await sharesightAuthorizedFetch(
          accessToken,
          `api/v2.1/portfolios/${safePortfolioPath}/performance.json`,
          {
            searchParams: {
              start_date: '2000-01-01',
              end_date: isoDateUtc(),
            },
          },
        )

        const endDate = isoDateUtc()

        await upsertChunks(
          supabase,
          'sharesight_performance_snapshots',
          [
            {
              user_id: userId,
              portfolio_role: portfolioRole,
              portfolio_external_id: portfolioId,
              start_date: '2000-01-01',
              end_date: endDate,
              payload: performancePayload,
              sync_run_id: syncRunId,
            },
          ],
          UPSERT_PERFORMANCE_ON,
          10,
        )
      } catch (error) {
        partialWarnings.push(`Performance import failed (${portfolioRole}): ${formatErrorBestEffort(error)}`)
      }

      // Income events (requires per-holding calls)
      try {
        const incomePairs = await syncIncomeForHoldings(accessToken, portfolioHoldingKeys)

        const incomeRows = incomePairs.map((pair) =>
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
        ).filter(Boolean)

        const dedupedIncome = dedupeRowsBy(
          /** @type {any[]} */ (incomeRows),
          (r) => `${r.user_id}|${r.portfolio_role}|${r.holding_external_id}|${r.income_external_id}`,
        )

        await upsertChunks(supabase, 'sharesight_income_events', dedupedIncome, UPSERT_INCOME_ON)
      } catch (error) {
        partialWarnings.push(`Income import failed (${portfolioRole}): ${formatErrorBestEffort(error)}`)
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

    await patchSharesightSyncMeta(supabase, {
      last_successful_sync_at: new Date().toISOString(),
      last_sync_error: mergedWarnings.length ? mergedWarnings.join(' | ') : null,
    })

    await finalizeSharesightSyncRun(supabase, syncRunId, {
      status: mergedWarnings.length ? 'partial' : 'success',
      error_message: mergedWarnings.length ? mergedWarnings.join(' | ') : null,
    })

    finalizedThisSyncRun = true

    return {
      syncRunId,
      ok: true,
      partialWarnings: mergedWarnings,
    }
  } catch (error) {
    const message = formatErrorBestEffort(error)

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
  await upsertSharesightOAuthRow(supabase, {
    access_token: tokenPayload.access_token,
    refresh_token: tokenPayload.refresh_token,
    token_type: tokenPayload.token_type,
    expires_in: tokenPayload.expires_in,
    reconnect_required: false,
    clear_auth_error: true,
  })
}

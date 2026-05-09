import { resolveQuoteIdentity } from '../market/sharesightHoldingFx.js'

import { isCashLikeHolding } from '../satellite/satelliteMerge.js'

/**
 * @param {string|null|undefined} fmp
 * @param {string|null|undefined} ex
 */
function symbolMatchKey(fmp, ex) {
  return `${`${fmp ?? ''}`.trim().toLowerCase()}|${`${ex ?? ''}`.trim().toLowerCase()}`
}

/**
 * @param {Record<string, unknown>} w
 */
function mergedExtraFromWatchlist(w) {
  const base =
    w.extra && typeof w.extra === 'object'
      ? { ...(/** @type {Record<string, unknown>} */ (w.extra)) }
      : {}

  if (typeof w.asset_class === 'string' && w.asset_class.trim()) base.asset_class = w.asset_class.trim()

  base.auto_monitor = w.auto_monitor === true

  if (typeof w.fmp_company_description === 'string') base.fmp_company_description = w.fmp_company_description

  if (w.fmp_metrics && typeof w.fmp_metrics === 'object') base.fmp_metrics = w.fmp_metrics

  if (typeof w.fmp_metrics_fetched_at === 'string') base.fmp_metrics_fetched_at = w.fmp_metrics_fetched_at

  base.promoted_from_watchlist_id = w.id

  return base
}

/**
 * @typedef {import('@supabase/supabase-js').SupabaseClient} SupabaseClient
 */

/**
 * @param {SupabaseClient} supabase
 * @param {string} userId
 * @param {string} wid
 * @param {string} pid
 */

async function migrateWatchlistScorecardsToPosition(supabase, userId, wid, pid) {
  const { data: wlVers } = await supabase
    .from('scorecard_versions')
    .select('id, version_number')
    .eq('user_id', userId)
    .eq('watchlist_item_id', wid)
    .order('version_number', { ascending: true })

  const list = wlVers ?? []

  if (list.length === 0) return

  const { data: maxRow } = await supabase
    .from('scorecard_versions')
    .select('version_number')
    .eq('user_id', userId)
    .eq('position_id', pid)
    .order('version_number', { ascending: false })
    .limit(1)
    .maybeSingle()

  const maxPn = Number.isFinite(Number(maxRow?.version_number)) ? Number(maxRow.version_number) : 0

  if (maxPn === 0) {
    const { error } = await supabase
      .from('scorecard_versions')
      .update({ position_id: pid, watchlist_item_id: null })
      .eq('watchlist_item_id', wid)
      .eq('user_id', userId)

    if (error) throw error

    return
  }

  let next = maxPn + 1

  for (const row of list) {
    const id = Reflect.get(row, 'id')

    if (typeof id !== 'string') continue

    const { error } = await supabase
      .from('scorecard_versions')
      .update({ position_id: pid, watchlist_item_id: null, version_number: next })
      .eq('id', id)

    if (error) throw error

    next += 1
  }
}

/**
 * When a Sharesight satellite holding appears for an active watchlist symbol, migrate to `positions`.
 *
 * @param {SupabaseClient} supabase
 * @param {string} userId
 */

export async function promoteWatchlistMatchesAfterSync(supabase, userId) {
  const { data: holdings, error: hErr } = await supabase
    .from('sharesight_holdings')
    .select('*')
    .eq('user_id', userId)
    .eq('portfolio_role', 'satellite')

  if (hErr) throw hErr

  const { data: watchlistRows, error: wErr } = await supabase
    .from('watchlist_items')
    .select('*')
    .eq('user_id', userId)
    .eq('archived', false)
    .is('moved_to_position_id', null)

  if (wErr) throw wErr

  /** @type {Record<string, unknown>[]} */
  const wlList = [...(watchlistRows ?? [])]

  for (const h of holdings ?? []) {
    const ho = /** @type {Record<string, unknown>} */ (h)

    if (
      isCashLikeHolding({
        instrument_symbol: ho.instrument_symbol,
        instrument_name: ho.instrument_name,
      })
    )
      continue

    const id = resolveQuoteIdentity({
      instrument_symbol: `${ho.instrument_symbol ?? ''}`.trim(),
      raw:
        ho.raw && typeof ho.raw === 'object'
          ? /** @type {Record<string, unknown>} */ (ho.raw)
          : {},
    })

    const hk = `${ho.holding_external_id ?? ''}`.trim()

    if (!hk) continue

    const wlIdx = wlList.findIndex(
      /** @returns {boolean} */
      (row) =>
        symbolMatchKey(Reflect.get(row, 'fmp_symbol'), Reflect.get(row, 'exchange_short_name')) ===
        symbolMatchKey(id.fmpSymbol, id.exchangeShortName),
    )

    if (wlIdx < 0) continue

    const w = /** @type {Record<string, unknown>} */ (wlList[wlIdx])

    wlList.splice(wlIdx, 1)

    const wid = `${w.id ?? ''}`

    if (!wid) continue

    const { data: existing } = await supabase
      .from('positions')
      .select('id')
      .eq('user_id', userId)
      .eq('sharesight_holding_key', hk)
      .maybeSingle()

    const now = new Date().toISOString()

    const cur = `${`${w.currency ?? ''}`.trim().toUpperCase() || `${ho.currency ?? ''}`.trim().toUpperCase() || 'USD'}`
    /** @type {string} */
    let positionId

    if (existing?.id) {
      positionId = `${existing.id}`
    } else {
      const insertRow = {
        user_id: userId,
        kind: 'satellite',
        fmp_symbol: `${w.fmp_symbol ?? ''}`.trim(),
        exchange_short_name: `${w.exchange_short_name ?? ''}`.trim(),
        yahoo_symbol: `${w.yahoo_symbol ?? ''}`.trim(),
        display_ticker: `${w.display_ticker ?? w.fmp_symbol ?? ''}`.trim(),
        currency: cur,
        name: typeof w.name === 'string' ? w.name : null,
        sharesight_holding_key: hk,
        sharesight_portfolio_key:
          ho.portfolio_external_id != null && `${ho.portfolio_external_id}`.trim() ? `${ho.portfolio_external_id}`.trim() : null,
        awaiting_analysis: w.awaiting_analysis === true,
        archived: false,
        closed: false,
        buy_zones: Array.isArray(w.buy_zones) ? w.buy_zones : [],
        exit_triggers: Array.isArray(w.exit_triggers) ? w.exit_triggers : [],
        extra: mergedExtraFromWatchlist(w),
        sharesight_payload: ho.raw && typeof ho.raw === 'object' ? ho.raw : {},
      }

      const { data: ins, error: insErr } = await supabase.from('positions').insert(insertRow).select('id').single()

      if (insErr) throw insErr

      positionId = `${ins.id}`
    }

    await migrateWatchlistScorecardsToPosition(supabase, userId, wid, positionId)

    const { error: posPatchErr } = await supabase
      .from('positions')
      .update({
        buy_zones: Array.isArray(w.buy_zones) ? w.buy_zones : [],
        exit_triggers: Array.isArray(w.exit_triggers) ? w.exit_triggers : [],
        awaiting_analysis: w.awaiting_analysis === true,
        extra: mergedExtraFromWatchlist(w),
        updated_at: now,
      })
      .eq('id', positionId)
      .eq('user_id', userId)

    if (posPatchErr) throw posPatchErr

    const { error: annErr } = await supabase
      .from('announcements')
      .update({ position_id: positionId, watchlist_item_id: null })
      .eq('watchlist_item_id', wid)
      .eq('user_id', userId)

    if (annErr) throw annErr

    const { error: wlArch } = await supabase
      .from('watchlist_items')
      .update({
        archived: true,
        moved_to_position_id: positionId,
        updated_at: now,
      })
      .eq('id', wid)
      .eq('user_id', userId)

    if (wlArch) throw wlArch
  }
}

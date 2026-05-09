/**
 * Assembles a bounded JSON payload for the portfolio briefing Triad (Gemini → Claude).
 *
 * @param {{
 *   dashboard: Record<string, unknown>
 *   satelliteCards: Record<string, unknown>[]
 *   dca: { baseWeeklyAud?: number, totalWeekly?: number, rows?: unknown[], weightSum?: number }
 *   announcements: Record<string, unknown>[]
 * }} p
 */

export function buildPortfolioBriefingContext(p) {
  const dash = /** @type {Record<string, unknown>} */ (p.dashboard ?? {})

  const positions = Array.isArray(dash.positions) ? /** @type {Record<string, unknown>[]} */ (dash.positions) : []

  const latestByPid =
    dash.latestScoreByPid && typeof dash.latestScoreByPid === 'object'
      ? /** @type {Record<string, Record<string, unknown>>} */ (dash.latestScoreByPid)
      : {}

  const mergedRows = Array.isArray(dash.mergedRows) ? /** @type {Record<string, unknown>[]} */ (dash.mergedRows) : []

  const satellitePositions = (p.satelliteCards ?? []).slice(0, 60).map((c) => {
    const row = /** @type {Record<string, unknown>} */ (c)

    const pos = row.position && typeof row.position === 'object' ? /** @type {Record<string, unknown>} */ (row.position) : null

    const pid = typeof row.positionId === 'string' ? row.positionId : pos && typeof pos.id === 'string' ? pos.id : ''

    const sc = pid ? latestByPid[pid] : undefined

    const genAt = sc && typeof sc.generated_at === 'string' ? sc.generated_at : null

    return {
      ticker: row.ticker,
      display_name: row.displayName,
      position_id: pid || null,
      overall_score: typeof row.overallScore === 'number' ? row.overallScore : null,
      tier_label: row.tier,
      awaiting_analysis: Boolean(row.awaitingAnalysis),
      target_guidance_pct: typeof row.targetGuidancePct === 'number' ? row.targetGuidancePct : null,
      actual_weight_pct: typeof row.actualWeightPct === 'number' ? row.actualWeightPct : null,
      drift_pct: typeof row.driftPct === 'number' ? row.driftPct : null,
      allocation_override_pct: typeof row.allocationOverridePct === 'number' ? row.allocationOverridePct : null,
      synopsis: typeof row.synopsis === 'string' ? row.synopsis.slice(0, 400) : null,
      buy_zones: pos && Array.isArray(pos.buy_zones) ? pos.buy_zones : [],
      exit_triggers: pos && Array.isArray(pos.exit_triggers) ? pos.exit_triggers : [],
      last_scorecard_generated_at: genAt,
      days_since_last_analysis: daysSinceIso(genAt),
    }
  })

  const watchlist = Array.isArray(dash.watchlistItems)
    ? /** @type {Record<string, unknown>[]} */ (dash.watchlistItems)
        .slice(0, 40)
        .map((w) => {
          const wid = `${w.id ?? ''}`

          const byWid =
            dash.latestScoreByWid && typeof dash.latestScoreByWid === 'object'
              ? /** @type {Record<string, Record<string, unknown>>} */ (dash.latestScoreByWid)
              : {}

          const sc = wid ? byWid[wid] : undefined

          const genAt = sc && typeof sc.generated_at === 'string' ? sc.generated_at : null

          return {
            id: wid,
            ticker: w.display_ticker ?? w.fmp_symbol,
            name: w.name,
            exchange: w.exchange_short_name,
            asset_class: w.asset_class,
            auto_monitor: w.auto_monitor === true,
            awaiting_analysis: w.awaiting_analysis === true,
            last_scorecard_generated_at: genAt,
            days_since_last_analysis: daysSinceIso(genAt),
          }
        })
    : []

  const quotes = mergedRows.slice(0, 80).map((m) => ({
    role: m.portfolio_role,
    symbol: m.instrument_symbol ?? m.yahoo_symbol,
    yahoo: m.yahoo_symbol,
    last_native: m.display_native ?? m.last_price,
    chg_pct: m.change_percent,
    aud: m.display_aud,
    cash_like: m.is_cash_like === true,
  }))

  const broker = dash.broker && typeof dash.broker === 'object' ? /** @type {Record<string, unknown>} */ (dash.broker) : {}

  const dca = p.dca && typeof p.dca === 'object' ? p.dca : {}

  const ann = (p.announcements ?? []).slice(0, 40).map((a) => ({
    headline: a.headline,
    ticker: a.display_ticker ?? a.fmp_symbol,
    published_at: a.published_at,
    price_sensitive: a.price_sensitive,
  }))

  return {
    compiled_at: new Date().toISOString(),
    portfolio_totals: {
      total_portfolio_aud: num(dash.totalPortfolioAud),
      invested_ex_cash_aud: num(dash.investedExCashAud),
      invested_core_aud: num(dash.investedCoreAud),
      invested_satellite_aud: num(dash.investedSatelliteAud),
      total_cash_aud: num(dash.totalCashAud),
      external_cash_aud: num(dash.externalCashAud),
      core_target_pct: num(dash.coreTargetPct),
      satellite_target_pct: num(dash.satelliteTargetPct),
      actual_core_pct_invested: num(dash.actualCorePctInvested),
      actual_sat_pct_invested: num(dash.actualSatPctInvested),
      day_move_aud: num(dash.dayMoveAud),
      day_pct_on_invested: num(dash.dayPctOnInvested),
      unrealised_gain_aud: num(dash.unrealisedAud),
    },
    broker_cash_breakdown: broker,
    satellite_positions: satellitePositions,
    satellite_orphan_watch: (p.satelliteCards ?? [])
      .filter((c) => /** @type {Record<string, unknown>} */ (c).holding && !/** @type {Record<string, unknown>} */ (c).position)
      .slice(0, 20)
      .map((c) => {
        const row = /** @type {Record<string, unknown>} */ (c)

        return { ticker: row.ticker, note: 'Holding without linked Supabase position row' }
      }),
    watchlist_candidates: watchlist,
    live_quotes_sample: quotes,
    weekly_dca: {
      base_aud: typeof dca.baseWeeklyAud === 'number' ? dca.baseWeeklyAud : null,
      total_scheduled_aud: typeof dca.totalWeekly === 'number' ? dca.totalWeekly : null,
      weight_sum_pct: typeof dca.weightSum === 'number' ? dca.weightSum : null,
      rows: Array.isArray(dca.rows) ? dca.rows : [],
    },
    recent_announcements: ann,
  }
}

/** @param {unknown} v */

function num(v) {
  const n = typeof v === 'number' ? v : Number.parseFloat(`${v ?? ''}`)
  return Number.isFinite(n) ? n : null
}

/** @param {string|null|undefined} iso */

function daysSinceIso(iso) {
  if (!iso || typeof iso !== 'string') return null

  const t = new Date(iso.trim()).getTime()

  if (!Number.isFinite(t)) return null

  return Math.max(0, Math.floor((Date.now() - t) / 86400000))
}

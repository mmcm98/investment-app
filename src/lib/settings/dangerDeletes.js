/**
 * Sequential destructive wipes for Danger Zone actions (manual confirmation in UI required).
 *
 * @param {import('@supabase/supabase-js').SupabaseClient} supabase
 * @param {string} userId
 */

/**
 * @param {{ error: unknown }} res
 */

function unwrap(res) {
  if (res.error) throw res.error instanceof Error ? res.error : new Error(`${res.error}`)
}

export async function clearUnattachedAnnouncements(supabase, userId) {
  const { error } = await supabase
    .from('announcements')
    .delete()
    .eq('user_id', userId)
    .is('catalyst_scorecard_version_id', null)

  if (error) throw error
}

/**
 * @param {import('@supabase/supabase-js').SupabaseClient} supabase
 * @param {string} userId
 */

export async function clearBriefingHistory(supabase, userId) {
  const { error } = await supabase.from('portfolio_briefings').delete().eq('user_id', userId)

  if (error) throw error
}

/**
 * @param {import('@supabase/supabase-js').SupabaseClient} supabase
 * @param {string} userId
 */

export async function clearScoreHistory(supabase, userId) {
  unwrap(await supabase.from('gemini_research_artefacts').delete().eq('user_id', userId))

  unwrap(await supabase.from('research_logs').delete().eq('user_id', userId))

  unwrap(await supabase.from('scorecard_versions').delete().eq('user_id', userId))
}

/**
 * Local investment + Sharesight mirrored rows — CONFIRM gated in UI only.
 *
 * @param {import('@supabase/supabase-js').SupabaseClient} supabase
 * @param {string} userId
 * @param {{ includeOAuth?: boolean }} [opts]
 */

export async function deleteAllPortfolioProjectData(supabase, userId, opts = {}) {
  const includeOAuth = Boolean(opts.includeOAuth)

  unwrap(await supabase.from('announcements').delete().eq('user_id', userId))

  unwrap(await supabase.from('allocation_overrides').delete().eq('user_id', userId))

  unwrap(await supabase.from('gemini_research_artefacts').delete().eq('user_id', userId))

  unwrap(await supabase.from('research_logs').delete().eq('user_id', userId))

  unwrap(await supabase.from('portfolio_briefings').delete().eq('user_id', userId))

  unwrap(await supabase.from('dca_history').delete().eq('user_id', userId))

  unwrap(await supabase.from('scorecard_versions').delete().eq('user_id', userId))

  unwrap(await supabase.from('positions').delete().eq('user_id', userId))

  unwrap(await supabase.from('watchlist_items').delete().eq('user_id', userId))

  unwrap(await supabase.from('core_etfs').delete().eq('user_id', userId))

  unwrap(await supabase.from('exchange_registry').delete().eq('user_id', userId))

  unwrap(await supabase.from('sharesight_income_events').delete().eq('user_id', userId))

  unwrap(await supabase.from('sharesight_trades').delete().eq('user_id', userId))

  unwrap(await supabase.from('sharesight_performance_snapshots').delete().eq('user_id', userId))

  unwrap(await supabase.from('sharesight_cash_balances').delete().eq('user_id', userId))

  unwrap(await supabase.from('sharesight_holdings').delete().eq('user_id', userId))

  unwrap(await supabase.from('sharesight_sync_runs').delete().eq('user_id', userId))

  if (includeOAuth) unwrap(await supabase.from('sharesight_oauth_credentials').delete().eq('user_id', userId))

  unwrap(
    await supabase.from('user_settings').upsert(
      {
        user_id: userId,
        preferences: {},
        core_target_pct: 72,
        satellite_target_pct: 28,
        weekly_dca_base_aud: 350,
        external_cash_aud: 0,
        global_api_pause: false,
        tier_schedules: null,
        reanalysis_days: 90,
        refire_days_after_dismiss: 30,
        announcement_retention_days: 30,
        score_version_cap: 10,
        briefing_retention: 'all',
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'user_id' },
    ),
  )
}

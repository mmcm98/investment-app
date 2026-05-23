import { runDirectTriadAnalysis } from '../analysis/directTriadAnalysis.js'

/**
 * Claude suggest + run scoring for watchlist instruments (Gemini cache via research_logs).
 *
 * @param {import('@supabase/supabase-js').SupabaseClient} supabase
 * @param {string} watchlistItemId
 */
export async function runWatchlistFullReanalysis(supabase, watchlistItemId) {
  const suggest = /** @type {Record<string, unknown>} */ (
    await runDirectTriadAnalysis(supabase, {
      watchlistItemId,
      step: 'suggest-framework',
    })
  )

  if (suggest.ok !== true) throw new Error('Framework suggestion failed')

  const sug = suggest.suggestion && typeof suggest.suggestion === 'object' ? /** @type {Record<string, unknown>} */ (suggest.suggestion) : null

  const fkRaw = sug ? sug.framework_key : null

  const fk = typeof fkRaw === 'string' ? fkRaw.trim() : ''

  if (!fk) throw new Error('Missing suggested framework')

  return runDirectTriadAnalysis(supabase, {
    watchlistItemId,
    step: 'run-analysis',
    confirmedFrameworkKey: fk,
  })
}

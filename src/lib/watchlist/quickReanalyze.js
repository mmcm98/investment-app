import { postTriadAnalysis } from '../analysis/triadClient.js'

/**
 * Claude suggest + run scoring for watchlist instruments (Gemini reused per triad caches).
 *
 * @param {{ accessToken: string }} session
 * @param {string} watchlistItemId
 */

export async function runWatchlistFullReanalysis(session, watchlistItemId) {
  const suggest = /** @type {Record<string, unknown>} */ (
    await postTriadAnalysis({ step: 'suggest-framework', watchlistItemId }, session)
  )

  if (suggest.ok !== true) throw new Error('Framework suggestion failed')

  const sug = suggest.suggestion && typeof suggest.suggestion === 'object' ? /** @type {Record<string, unknown>} */ (suggest.suggestion) : null

  const fkRaw = sug ? sug.framework_key : null

  const fk = typeof fkRaw === 'string' ? fkRaw.trim() : ''

  if (!fk) throw new Error('Missing suggested framework')

  return postTriadAnalysis({ step: 'run-analysis', watchlistItemId, confirmedFrameworkKey: fk }, session)
}

/** @param {unknown} value */
function text(value) {
  return typeof value === 'string' && value.trim() ? value.trim() : ''
}

/** @param {string} textBody */
function parseJsonFromModel(textBody) {
  let text = `${textBody ?? ''}`.trim()
  text = text.replace(/^```(?:json)?\s*/i, '').replace(/\s*```\s*$/, '').trim()

  const start = text.indexOf('{')
  const end = text.lastIndexOf('}')
  if (start === -1 || end === -1) {
    throw new Error('Model response did not contain valid JSON')
  }

  text = text.slice(start, end + 1)
  try {
    return JSON.parse(text)
  } catch {
    console.log('[direct-triad] FAILED to parse JSON. Raw text:', text)
    throw new Error('Model response did not contain valid JSON')
  }
}

/** @param {unknown} raw */
function frameworkKeyFromRecommendation(raw) {
  const s = text(raw).toLowerCase().replace(/-/g, '_').replace(/\s+/g, '_')
  if (s.includes('regular')) return 'regular_stocks'
  if (s.includes('thematic')) return 'thematic_etfs'
  if (s.includes('fund') || s.includes('lic')) return 'fund_managers_lic'
  if (s.includes('speculative')) return 'speculative'
  if (s.includes('alternative') || s.includes('_pe')) return 'alternatives_pe'
  return 'regular_stocks'
}

/** @param {unknown} raw */
function normalizeFrameworkKey(raw) {
  return text(raw).toLowerCase().replace(/-/g, '_').replace(/\s+/g, '_')
}

/** @param {string} key */
function frameworkLabelForKey(key) {
  const m = {
    regular_stocks: 'Regular stocks',
    thematic_etfs: 'Thematic ETFs',
    fund_managers_lic: 'Fund managers / LICs',
    speculative: 'Speculative stocks',
    alternatives_pe: 'Alternative investments / PE',
  }
  return m[/** @type {keyof typeof m} */ (key)] ?? key
}

/**
 * @param {string} ticker
 * @param {string} company
 * @param {string} exchange
 */
function buildGeminiPrompt(ticker, company, exchange) {
  return `Research ${ticker} (${company}) listed on ${exchange}.
Keep all field values concise — 1-2 sentences maximum. Do not exceed 1500 total tokens. Return ONLY valid JSON, no markdown fences.
Return ONLY a JSON object with these exact fields, no other text:
{
  "ticker": "${ticker}",
  "company": "${company}",
  "research_date": "${new Date().toISOString().split('T')[0]}",
  "thesis_summary": "2-3 sentences",
  "competitive_moat": "1 sentence",
  "financials_commentary": "1 sentence",
  "key_risks": ["risk1", "risk2", "risk3"],
  "recent_developments": "1 sentence",
  "management_quality": "1 sentence",
  "growth_runway": "1 sentence",
  "valuation_commentary": "1 sentence",
  "technical_summary": "1 sentence",
  "sentiment": "positive | neutral | negative",
  "recommended_framework": "Regular Stock | Thematic ETF | Fund Manager / LIC | Speculative Stock | Alternative / PE"
}`
}

/**
 * @param {Record<string, unknown>} geminiJson
 */
function buildClaudePrompt(geminiJson) {
  return [
    'Using the Gemini research JSON below, return ONLY one valid JSON object. No markdown, no prose.',
    'Return ONLY valid JSON, no markdown fences, no prose. The research_paper field should be detailed but stay under 6000 tokens.',
    'Schema:',
    '{"framework":"string","overall_score":0-100,"tier":1-5,"tier_label":"string"}',
    'framework should be a human-readable framework name aligned with Gemini recommended_framework.',
    'overall_score is 0-100. tier is 1-5 where higher is stronger conviction.',
    `Gemini JSON:\n${JSON.stringify(geminiJson)}`,
  ].join('\n\n')
}

/**
 * @param {string} prompt
 */
async function fetchGeminiResearch(prompt) {
  const apiKey = `${import.meta.env.VITE_GEMINI_API_KEY ?? ''}`.trim()
  if (!apiKey) throw new Error('VITE_GEMINI_API_KEY is not configured.')

  const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`
  console.log('[direct-triad] calling:', url)
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: { maxOutputTokens: 4000, temperature: 0.2 },
    }),
  })
  console.log('[direct-triad] response status:', res.status, 'url:', url)

  const text = await res.text()
  if (!res.ok) {
    console.log('[direct-triad] error response body:', text)
    throw new Error(`Gemini failed (${res.status}): ${text}`)
  }

  const data = JSON.parse(text)

  const textOut = data?.candidates?.[0]?.content?.parts?.[0]?.text ?? ''
  console.log('[direct-triad] raw Gemini text:', textOut.slice(0, 500))
  return parseJsonFromModel(textOut)
}

/**
 * @param {string} prompt
 */
async function fetchClaudeScorecard(prompt) {
  const url = '/api/anthropic-proxy'
  console.log('[direct-triad] calling:', url)
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      model: 'claude-sonnet-4-6',
      max_tokens: 8000,
      messages: [{ role: 'user', content: prompt }],
    }),
  })
  console.log('[direct-triad] response status:', res.status, 'url:', url)

  const text = await res.text()
  if (!res.ok) {
    console.log('[direct-triad] error response body:', text)
    throw new Error(`Claude failed (${res.status}): ${text}`)
  }

  const data = JSON.parse(text)

  const textOut =
    data?.content?.filter((b) => b?.type === 'text').map((b) => b.text).join('\n') ?? ''
  return parseJsonFromModel(textOut)
}

/**
 * @param {import('@supabase/supabase-js').SupabaseClient} supabase
 * @param {string} userId
 * @param {string} tickerTag
 */
async function loadCachedGemini(supabase, userId, tickerTag) {
  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString()
  const { data, error } = await supabase
    .from('research_logs')
    .select('id, raw_gemini_json')
    .eq('user_id', userId)
    .eq('ticker', tickerTag)
    .gte('timestamp', sevenDaysAgo)
    .order('timestamp', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (error) throw error
  if (!data?.raw_gemini_json) return null
  return { id: data.id, gemini: data.raw_gemini_json }
}

/**
 * @param {import('@supabase/supabase-js').SupabaseClient} supabase
 * @param {string} userId
 * @param {string} tickerTag
 * @param {unknown} geminiJson
 */
async function saveGeminiLog(supabase, userId, tickerTag, geminiJson) {
  const { data, error } = await supabase
    .from('research_logs')
    .insert({
      user_id: userId,
      ticker: tickerTag,
      raw_gemini_json: geminiJson,
      claude_synthesis_status: 'pending',
    })
    .select('id')
    .single()

  if (error) throw error
  return data.id
}

/**
 * @param {import('@supabase/supabase-js').SupabaseClient} supabase
 * @param {string} userId
 * @param {string} tickerTag
 * @param {string} ticker
 * @param {string} company
 * @param {string} exchange
 * @param {(message: string) => void} progress
 */
async function obtainGeminiJson(supabase, userId, tickerTag, ticker, company, exchange, progress) {
  progress('Checking Gemini cache...')
  const cached = await loadCachedGemini(supabase, userId, tickerTag)
  const cacheHit = Boolean(cached)
  console.log('[direct-triad] cache check:', cacheHit ? 'HIT' : 'MISS')

  if (cached) {
    return { geminiJson: cached.gemini, researchLogId: cached.id }
  }

  progress('Gathering research with Gemini...')
  const prompt = buildGeminiPrompt(ticker, company, exchange)
  const geminiJson = await fetchGeminiResearch(prompt)
  const researchLogId = await saveGeminiLog(supabase, userId, tickerTag, geminiJson)
  console.log('[direct-triad] Gemini complete')
  return { geminiJson, researchLogId }
}

/**
 * @param {unknown} geminiJson
 * @param {Record<string, unknown>} claudeJson
 * @param {string} frameworkKey
 */
function buildScorecardArtifacts(geminiJson, claudeJson, frameworkKey) {
  const overallScore = Number(claudeJson.overall_score)
  const frameworkLabel =
    text(claudeJson.framework) || text(/** @type {Record<string, unknown>} */ (geminiJson).recommended_framework)
  const tier = claudeJson.tier
  const tierLabel = text(claudeJson.tier_label)

  const scorecardForUi = {
    framework: frameworkLabel || frameworkKey,
    overall_score: Number.isFinite(overallScore) ? overallScore : null,
    tier,
    tier_label: tierLabel,
    gemini_research: geminiJson,
  }

  const researchPaper = {
    generated_at: new Date().toISOString(),
    gemini_model: 'gemini-2.5-flash',
    claude_model: 'claude-sonnet-4-6',
    markdown: text(/** @type {Record<string, unknown>} */ (geminiJson).thesis_summary),
    body_md: text(/** @type {Record<string, unknown>} */ (geminiJson).thesis_summary),
  }

  return { overallScore, frameworkLabel, scorecardForUi, researchPaper }
}

/**
 * @param {import('@supabase/supabase-js').SupabaseClient} supabase
 * @param {Record<string, unknown>} holding
 * @param {string} userId
 */
async function ensurePositionForHolding(supabase, holding, userId, exchangeFallback = 'UNKNOWN') {
  const holdingKey = text(holding.holding_external_id)
  const { data: existing, error: existingErr } = await supabase
    .from('positions')
    .select('*')
    .eq('user_id', userId)
    .eq('sharesight_holding_key', holdingKey)
    .maybeSingle()

  if (existingErr) throw existingErr
  if (existing) return existing

  const symbol = text(holding.instrument_symbol).replace(/^ASX:/i, '') || holdingKey
  const exchange = text(holding.exchange_short_name) || exchangeFallback
  const yahoo = exchange === 'ASX' && !/\.AX$/i.test(symbol) ? `${symbol}.AX` : symbol

  const { data: inserted, error: insertErr } = await supabase
    .from('positions')
    .insert({
      user_id: userId,
      kind: 'satellite',
      fmp_symbol: symbol,
      exchange_short_name: exchange,
      yahoo_symbol: yahoo,
      display_ticker: symbol,
      currency: text(holding.currency) || 'AUD',
      name: text(holding.instrument_name) || symbol,
      sharesight_holding_key: holdingKey,
      sharesight_portfolio_key: text(holding.portfolio_external_id) || null,
      sharesight_payload: holding.raw && typeof holding.raw === 'object' ? holding.raw : {},
      awaiting_analysis: true,
      extra: {},
    })
    .select('*')
    .single()

  if (insertErr) throw insertErr
  return inserted
}

/**
 * @param {import('@supabase/supabase-js').SupabaseClient} supabase
 * @param {string} userId
 * @param {string} watchlistItemId
 */
async function loadWatchlistItem(supabase, userId, watchlistItemId) {
  const { data, error } = await supabase
    .from('watchlist_items')
    .select('*')
    .eq('id', watchlistItemId)
    .eq('user_id', userId)
    .eq('archived', false)
    .maybeSingle()

  if (error) throw error
  if (!data) throw new Error('Watchlist item not found.')
  return data
}

/**
 * @param {import('@supabase/supabase-js').SupabaseClient} supabase
 * @param {string} userId
 * @param {string} positionId
 */
async function loadPositionRow(supabase, userId, positionId) {
  const { data, error } = await supabase
    .from('positions')
    .select('*')
    .eq('id', positionId)
    .eq('user_id', userId)
    .maybeSingle()

  if (error) throw error
  if (!data) throw new Error('Position not found.')
  return data
}

/**
 * @typedef {{
 *   kind: 'holding' | 'watchlist' | 'position',
 *   parentId: string,
 *   ticker: string,
 *   company: string,
 *   exchange: string,
 *   tickerTag: string,
 *   row?: Record<string, unknown>,
 *   holding?: Record<string, unknown>,
 *   parentRow?: Record<string, unknown>,
 * }} AnalysisTarget
 */

/**
 * @param {import('@supabase/supabase-js').SupabaseClient} supabase
 * @param {string} userId
 * @param {{
 *   row?: Record<string, unknown>,
 *   holdingId?: string,
 *   watchlistItemId?: string,
 *   positionId?: string,
 * }} args
 * @returns {Promise<AnalysisTarget>}
 */
async function resolveAnalysisTarget(supabase, userId, args) {
  const wid = text(args.watchlistItemId)
  if (wid) {
    const wl = await loadWatchlistItem(supabase, userId, wid)
    const ticker = text(wl.fmp_symbol).toUpperCase()
    const company = text(wl.name) || ticker
    const exchange = text(wl.exchange_short_name) || 'UNKNOWN'
    return {
      kind: 'watchlist',
      parentId: wid,
      ticker,
      company,
      exchange,
      tickerTag: ticker,
      parentRow: wl,
    }
  }

  const pid = text(args.positionId)
  if (pid) {
    const pos = await loadPositionRow(supabase, userId, pid)
    const ticker = text(pos.fmp_symbol).toUpperCase()
    const company = text(pos.name) || ticker
    const exchange = text(pos.exchange_short_name) || 'UNKNOWN'
    return {
      kind: 'position',
      parentId: pid,
      ticker,
      company,
      exchange,
      tickerTag: ticker,
      parentRow: pos,
    }
  }

  const holdingId = text(args.holdingId)
  const row = args.row ?? {}
  let holding =
    row.holding && typeof row.holding === 'object' ? /** @type {Record<string, unknown>} */ (row.holding) : null

  if (!holding && holdingId) {
    const { data: loaded, error: holdingErr } = await supabase
      .from('sharesight_holdings')
      .select('*')
      .eq('user_id', userId)
      .eq('portfolio_role', 'satellite')
      .eq('holding_external_id', holdingId)
      .maybeSingle()
    if (holdingErr || !loaded) throw holdingErr ?? new Error('Holding not found.')
    holding = loaded
  }

  if (!holding) throw new Error('Holding not found.')

  const ticker = `${row.ticker ?? text(holding.instrument_symbol).replace(/^ASX:/i, '')}`.trim().toUpperCase()
  const company = `${row.displayName ?? text(holding.instrument_name) ?? ticker}`.trim()
  const exchange = `${row.exchange ?? row.exchangeShort ?? 'UNKNOWN'}`.trim()

  return {
    kind: 'holding',
    parentId: holdingId || text(holding.holding_external_id),
    ticker,
    company,
    exchange,
    tickerTag: ticker,
    row,
    holding,
  }
}

/**
 * @param {unknown} geminiJson
 */
function buildFrameworkSuggestion(geminiJson) {
  const g = /** @type {Record<string, unknown>} */ (geminiJson && typeof geminiJson === 'object' ? geminiJson : {})
  const frameworkKey = frameworkKeyFromRecommendation(g.recommended_framework)
  return {
    ok: true,
    suggestion: {
      framework_key: frameworkKey,
      framework_label: frameworkLabelForKey(frameworkKey),
      reason: text(g.thesis_summary) || 'Suggested from Gemini recommended_framework.',
    },
  }
}

/**
 * @param {import('@supabase/supabase-js').SupabaseClient} supabase
 * @param {string} userId
 * @param {AnalysisTarget} target
 * @param {string} frameworkKey
 * @param {Record<string, unknown>} scorecardForUi
 * @param {Record<string, unknown>} claudeJson
 * @param {Record<string, unknown>} researchPaper
 * @param {number} overallScore
 * @param {string|undefined} researchLogId
 */
async function persistScorecardVersion(
  supabase,
  userId,
  target,
  frameworkKey,
  scorecardForUi,
  claudeJson,
  researchPaper,
  overallScore,
  researchLogId,
) {
  const parentFilter =
    target.kind === 'watchlist'
      ? { column: 'watchlist_item_id', value: target.parentId }
      : { column: 'position_id', value: target.parentId }

  const { data: maxRow } = await supabase
    .from('scorecard_versions')
    .select('version_number')
    .eq('user_id', userId)
    .eq(parentFilter.column, parentFilter.value)
    .order('version_number', { ascending: false })
    .limit(1)
    .maybeSingle()

  const versionNumber = Number.isFinite(Number(maxRow?.version_number)) ? Number(maxRow.version_number) + 1 : 1

  const insertRow =
    target.kind === 'watchlist'
      ? {
          user_id: userId,
          watchlist_item_id: target.parentId,
          version_number: versionNumber,
          framework: frameworkKey,
          overall_score: Number.isFinite(overallScore) ? overallScore : null,
          payload: { ...scorecardForUi, claude: claudeJson },
          generated_at: new Date().toISOString(),
        }
      : {
          user_id: userId,
          position_id: target.parentId,
          version_number: versionNumber,
          framework: frameworkKey,
          overall_score: Number.isFinite(overallScore) ? overallScore : null,
          payload: { ...scorecardForUi, claude: claudeJson },
          generated_at: new Date().toISOString(),
        }

  const { data: scRow, error: scErr } = await supabase.from('scorecard_versions').insert(insertRow).select('id').single()
  if (scErr) throw scErr

  await supabase.from('research_paper_versions').insert({
    user_id: userId,
    scorecard_version_id: scRow.id,
    payload: { sections: [{ heading: 'Thesis', body_md: researchPaper.markdown }] },
    generated_at: new Date().toISOString(),
  })

  const parentRow = target.parentRow ?? {}
  const prevExtra =
    parentRow.extra && typeof parentRow.extra === 'object'
      ? { .../** @type {Record<string, unknown>} */ (parentRow.extra) }
      : {}

  const synopsis = researchPaper.markdown
  if (synopsis) prevExtra.synopsis = synopsis
  prevExtra.scorecard = scorecardForUi
  prevExtra.research_paper = researchPaper

  const table = target.kind === 'watchlist' ? 'watchlist_items' : 'positions'
  const { error: updErr } = await supabase
    .from(table)
    .update({
      awaiting_analysis: false,
      extra: prevExtra,
      updated_at: new Date().toISOString(),
    })
    .eq('id', target.parentId)
    .eq('user_id', userId)

  if (updErr) throw updErr

  if (researchLogId) {
    await supabase.from('research_logs').update({ claude_synthesis_status: 'success' }).eq('id', researchLogId)
  }

  return versionNumber
}

/**
 * @param {import('@supabase/supabase-js').SupabaseClient} supabase
 * @param {{
 *   row?: Record<string, unknown>,
 *   holdingId?: string,
 *   watchlistItemId?: string,
 *   positionId?: string,
 *   step?: 'suggest-framework' | 'run-analysis',
 *   confirmedFrameworkKey?: string,
 *   onProgress?: (message: string) => void,
 * }} args
 */
export async function runDirectTriadAnalysis(supabase, args) {
  const progress = (msg) => args.onProgress?.(msg)

  const { data: ud, error: userErr } = await supabase.auth.getUser()
  if (userErr || !ud?.user?.id) throw userErr ?? new Error('Not signed in.')
  const userId = ud.user.id

  const { data: settings } = await supabase
    .from('user_settings')
    .select('global_api_pause')
    .eq('user_id', userId)
    .maybeSingle()
  if (settings?.global_api_pause === true) throw new Error('API pause is active — analysis disabled.')

  const target = await resolveAnalysisTarget(supabase, userId, args)
  const step = args.step ?? 'run-analysis'

  const { geminiJson, researchLogId } = await obtainGeminiJson(
    supabase,
    userId,
    target.tickerTag,
    target.ticker,
    target.company,
    target.exchange,
    progress,
  )

  if (step === 'suggest-framework') {
    return buildFrameworkSuggestion(geminiJson)
  }

  progress('Synthesising scorecard with Claude...')
  const claudeJson = await fetchClaudeScorecard(buildClaudePrompt(/** @type {Record<string, unknown>} */ (geminiJson)))
  console.log('[direct-triad] Claude complete')

  const confirmedKey = normalizeFrameworkKey(args.confirmedFrameworkKey)
  const frameworkKey =
    confirmedKey && confirmedKey !== 'unknown'
      ? frameworkKeyFromRecommendation(confirmedKey)
      : frameworkKeyFromRecommendation(
          /** @type {Record<string, unknown>} */ (claudeJson).framework ??
            /** @type {Record<string, unknown>} */ (geminiJson).recommended_framework,
        )

  const { overallScore, frameworkLabel, scorecardForUi, researchPaper } = buildScorecardArtifacts(
    geminiJson,
    claudeJson,
    frameworkKey,
  )

  if (target.kind === 'holding') {
    progress('Saving results...')
    const holding = target.holding
    if (!holding) throw new Error('Holding not found.')

    const position = await ensurePositionForHolding(supabase, holding, userId, target.exchange)

    const { data: maxRow } = await supabase
      .from('scorecard_versions')
      .select('version_number')
      .eq('user_id', userId)
      .eq('position_id', position.id)
      .order('version_number', { ascending: false })
      .limit(1)
      .maybeSingle()

    const versionNumber = Number.isFinite(Number(maxRow?.version_number)) ? Number(maxRow.version_number) + 1 : 1

    const { data: scRow, error: scErr } = await supabase
      .from('scorecard_versions')
      .insert({
        user_id: userId,
        position_id: position.id,
        version_number: versionNumber,
        framework: frameworkKey,
        overall_score: Number.isFinite(overallScore) ? overallScore : null,
        payload: { ...scorecardForUi, claude: claudeJson },
        generated_at: new Date().toISOString(),
      })
      .select('id')
      .single()
    if (scErr) throw scErr

    await supabase.from('research_paper_versions').insert({
      user_id: userId,
      scorecard_version_id: scRow.id,
      payload: { sections: [{ heading: 'Thesis', body_md: researchPaper.markdown }] },
      generated_at: new Date().toISOString(),
    })

    const prevExtra =
      position.extra && typeof position.extra === 'object'
        ? { .../** @type {Record<string, unknown>} */ (position.extra) }
        : {}

    const nextExtra = {
      ...prevExtra,
      scorecard: scorecardForUi,
      research_paper: researchPaper,
    }

    await supabase
      .from('positions')
      .update({
        awaiting_analysis: false,
        extra: nextExtra,
        updated_at: new Date().toISOString(),
      })
      .eq('id', position.id)
      .eq('user_id', userId)

    if (researchLogId) {
      await supabase.from('research_logs').update({ claude_synthesis_status: 'success' }).eq('id', researchLogId)
    }

    return {
      ok: true,
      version_number: versionNumber,
      overall_score: Number.isFinite(overallScore) ? overallScore : null,
      framework: frameworkLabel,
      tier: scorecardForUi.tier_label || scorecardForUi.tier,
    }
  }

  progress('Saving results...')
  const versionNumber = await persistScorecardVersion(
    supabase,
    userId,
    target,
    frameworkKey,
    scorecardForUi,
    claudeJson,
    researchPaper,
    overallScore,
    researchLogId,
  )

  return {
    ok: true,
    version_number: versionNumber,
    overall_score: Number.isFinite(overallScore) ? overallScore : null,
    framework: frameworkLabel,
    tier: scorecardForUi.tier_label || scorecardForUi.tier,
  }
}

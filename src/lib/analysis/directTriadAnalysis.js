/** @param {unknown} value */
function text(value) {
  return typeof value === 'string' && value.trim() ? value.trim() : ''
}

/** @param {string} textBody */
function parseJsonFromModel(textBody) {
  let body = `${textBody ?? ''}`.trim()
  if (body.startsWith('```')) body = body.replace(/^```[a-zA-Z]*\n?/, '').replace(/```\s*$/, '')
  return JSON.parse(body)
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

/**
 * @param {string} ticker
 * @param {string} company
 * @param {string} exchange
 */
function buildGeminiPrompt(ticker, company, exchange) {
  return `Research ${ticker} (${company}) listed on ${exchange}.
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
      generationConfig: { maxOutputTokens: 1000, temperature: 0.3 },
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
  return parseJsonFromModel(textOut)
}

/**
 * @param {string} prompt
 */
async function fetchClaudeScorecard(prompt) {
  const apiKey = `${import.meta.env.VITE_ANTHROPIC_API_KEY ?? ''}`.trim()
  if (!apiKey) throw new Error('VITE_ANTHROPIC_API_KEY is not configured.')

  const url = 'https://api.anthropic.com/v1/messages'
  console.log('[direct-triad] calling:', url)
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      model: 'claude-sonnet-4-6',
      max_tokens: 4000,
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
 * @param {{
 *   row: Record<string, unknown>,
 *   holdingId: string,
 *   onProgress?: (message: string) => void,
 * }} args
 */
export async function runDirectTriadAnalysis(supabase, { row, holdingId, onProgress }) {
  const progress = (msg) => onProgress?.(msg)

  const { data: ud, error: userErr } = await supabase.auth.getUser()
  if (userErr || !ud?.user?.id) throw userErr ?? new Error('Not signed in.')
  const userId = ud.user.id

  const { data: settings } = await supabase
    .from('user_settings')
    .select('global_api_pause')
    .eq('user_id', userId)
    .maybeSingle()
  if (settings?.global_api_pause === true) throw new Error('API pause is active — analysis disabled.')

  const holding =
    row?.holding && typeof row.holding === 'object'
      ? /** @type {Record<string, unknown>} */ (row.holding)
      : null

  if (!holding) {
    const { data: loaded, error: holdingErr } = await supabase
      .from('sharesight_holdings')
      .select('*')
      .eq('user_id', userId)
      .eq('portfolio_role', 'satellite')
      .eq('holding_external_id', holdingId)
      .maybeSingle()
    if (holdingErr || !loaded) throw holdingErr ?? new Error('Holding not found.')
    return runDirectTriadAnalysis(supabase, { row: { ...row, holding: loaded }, holdingId, onProgress })
  }

  const ticker = `${row?.ticker ?? text(holding.instrument_symbol).replace(/^ASX:/i, '')}`.trim().toUpperCase()
  const company = `${row?.displayName ?? text(holding.instrument_name) ?? ticker}`.trim()
  const exchange = `${row?.exchange ?? row?.exchangeShort ?? 'UNKNOWN'}`.trim()
  const tickerTag = ticker

  progress('Checking Gemini cache...')
  const cached = await loadCachedGemini(supabase, userId, tickerTag)
  /** @type {unknown} */
  let geminiJson
  /** @type {string|undefined} */
  let researchLogId

  if (cached) {
    geminiJson = cached.gemini
    researchLogId = cached.id
  } else {
    progress('Gathering research with Gemini...')
    const prompt = buildGeminiPrompt(ticker, company, exchange)
    geminiJson = await fetchGeminiResearch(prompt)
    researchLogId = await saveGeminiLog(supabase, userId, tickerTag, geminiJson)
  }

  progress('Synthesising scorecard with Claude...')
  const claudeJson = await fetchClaudeScorecard(buildClaudePrompt(/** @type {Record<string, unknown>} */ (geminiJson)))

  const overallScore = Number(claudeJson.overall_score)
  const frameworkLabel = text(claudeJson.framework) || text(/** @type {Record<string, unknown>} */ (geminiJson).recommended_framework)
  const frameworkKey = frameworkKeyFromRecommendation(frameworkLabel)
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

  progress('Saving results...')
  const position = await ensurePositionForHolding(supabase, holding, userId, exchange)

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
    version_number: versionNumber,
    overall_score: Number.isFinite(overallScore) ? overallScore : null,
    framework: frameworkLabel,
    tier: tierLabel || tier,
  }
}

import { buildClaudeScorecardPrompt, buildGeminiDeepResearchPrompt } from './triadPrompts.js'

const GEMINI_MODEL = 'gemini-2.5-pro'
const CLAUDE_MODEL = 'claude-sonnet-4-6'
const MAX_OUTPUT_TOKENS = 32000

const VALID_FRAMEWORK_KEYS = [
  'regular_stocks',
  'thematic_etfs',
  'fund_managers_lic',
  'speculative',
  'alternatives_pe',
]

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
    console.log('[direct-triad] FAILED to parse JSON. First 500:', text.slice(0, 500))
    console.log('[direct-triad] FAILED to parse JSON. Last 500:', text.slice(-500))
    console.log('[direct-triad] FAILED to parse JSON. Total length:', text.length)
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

/** @param {string} raw */
function slugSectionId(raw) {
  return text(raw)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_|_$/g, '')
}

/** @param {number} stars @param {number} maxStars */
function starsToScorePct(stars, maxStars) {
  if (!Number.isFinite(stars) || !Number.isFinite(maxStars) || maxStars <= 0) return 0
  return Math.round((stars / maxStars) * 100)
}

/**
 * @param {Record<string, unknown>} claudeJson
 * @param {string} frameworkKey
 */
function normalizeScorecardItems(claudeJson, frameworkKey) {
  const starsMax = frameworkKey === 'regular_stocks' ? 5 : 4

  if (Array.isArray(claudeJson.items) && claudeJson.items.length > 0) {
    return /** @type {Record<string, unknown>[]} */ (claudeJson.items).map((raw, idx) => {
      const it = raw && typeof raw === 'object' ? /** @type {Record<string, unknown>} */ (raw) : {}
      const awarded = Number(it.stars_awarded)
      const max = Number(it.stars_max) || starsMax
      const sectionId = text(it.section_id) || slugSectionId(it.title) || `section_${idx + 1}`
      const itemNum = Number(it.item_number) || idx + 1
      const title = text(it.title) || text(it.item_name) || `Item ${itemNum}`
      return {
        item_key: text(it.item_key) || `${sectionId}_${itemNum}`,
        section_id: sectionId,
        item_number: itemNum,
        title,
        stars_awarded: Number.isFinite(awarded) ? awarded : null,
        stars_max: max,
        score_pct: Number.isFinite(Number(it.score_pct)) ? Number(it.score_pct) : starsToScorePct(awarded, max),
        rationale: text(it.rationale),
      }
    })
  }

  const sections = Array.isArray(claudeJson.sections) ? claudeJson.sections : []
  /** @type {Record<string, unknown>[]} */
  const flat = []

  for (const secRaw of sections) {
    if (!secRaw || typeof secRaw !== 'object') continue
    const sec = /** @type {Record<string, unknown>} */ (secRaw)
    const sectionId = slugSectionId(sec.section_name) || `section_${sec.section_number ?? flat.length + 1}`
    const secItems = Array.isArray(sec.items) ? sec.items : []

    for (const itemRaw of secItems) {
      if (!itemRaw || typeof itemRaw !== 'object') continue
      const it = /** @type {Record<string, unknown>} */ (itemRaw)
      const awarded = Number(it.stars_awarded)
      const max = Number(it.stars_max) || starsMax
      const itemNum = Number(it.item_number) || flat.length + 1
      const title = text(it.item_name) || text(it.title) || `Item ${itemNum}`
      flat.push({
        item_key: `${sectionId}_${itemNum}`,
        section_id: sectionId,
        item_number: itemNum,
        title,
        stars_awarded: Number.isFinite(awarded) ? awarded : null,
        stars_max: max,
        score_pct: Number.isFinite(Number(it.score_pct)) ? Number(it.score_pct) : starsToScorePct(awarded, max),
        rationale: text(it.rationale),
      })
    }
  }

  return flat
}

/**
 * @param {Record<string, unknown>} claudeJson
 */
function normalizeSectionScores(claudeJson) {
  if (Array.isArray(claudeJson.section_scores) && claudeJson.section_scores.length > 0) {
    return /** @type {Record<string, unknown>[]} */ (claudeJson.section_scores)
  }

  const sections = Array.isArray(claudeJson.sections) ? claudeJson.sections : []
  return sections
    .filter((s) => s && typeof s === 'object')
    .map((secRaw) => {
      const sec = /** @type {Record<string, unknown>} */ (secRaw)
      return {
        section_id: slugSectionId(sec.section_name) || `section_${sec.section_number ?? ''}`,
        title: text(sec.section_name),
        weight_pct: Number(sec.weight_pct),
        score_pct: Number(sec.section_score_pct),
        notes: text(sec.notes) || '',
      }
    })
}

/**
 * @param {Record<string, unknown>} claudeJson
 */
function buildResearchPaperFromClaude(claudeJson) {
  const md = text(claudeJson.research_paper_markdown)
  if (md) return md

  const outline = claudeJson.research_paper_outline
  if (outline && typeof outline === 'object') {
    const sections = Reflect.get(outline, 'sections')
    if (Array.isArray(sections)) {
      return sections
        .filter((s) => s && typeof s === 'object')
        .map((s) => {
          const o = /** @type {Record<string, unknown>} */ (s)
          const heading = text(o.heading) || 'Section'
          const body = text(o.body_md)
          return `## ${heading}\n\n${body}`
        })
        .join('\n\n')
    }
  }

  return text(claudeJson.synopsis)
}

/**
 * @param {Record<string, unknown>} claudeJson
 */
function researchPaperSectionsPayload(claudeJson, fallbackMd) {
  const outline = claudeJson.research_paper_outline
  if (outline && typeof outline === 'object') {
    const sections = Reflect.get(outline, 'sections')
    if (Array.isArray(sections) && sections.length > 0) {
      return { sections }
    }
  }

  return { sections: [{ heading: 'Research paper', body_md: fallbackMd }] }
}

/**
 * @param {string} prompt
 */
async function fetchGeminiResearch(prompt) {
  const apiKey = `${import.meta.env.VITE_GEMINI_API_KEY ?? ''}`.trim()
  if (!apiKey) throw new Error('VITE_GEMINI_API_KEY is not configured.')

  const url = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${apiKey}`
  console.log('[direct-triad] calling:', url)
  const body = {
    contents: [{ parts: [{ text: prompt }] }],
    tools: [{ google_search: {} }],
    generationConfig: { maxOutputTokens: MAX_OUTPUT_TOKENS, temperature: 0.2 },
  }
  console.log('[direct-triad] Gemini request body:', JSON.stringify(body).slice(0, 2000))
  const geminiStart = Date.now()
  console.log('[direct-triad] Gemini START at:', new Date().toISOString())
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  console.log('[direct-triad] response status:', res.status, 'url:', url)

  const text = await res.text()
  const geminiDuration = Date.now() - geminiStart
  console.log('[direct-triad] Gemini DURATION ms:', geminiDuration)
  console.log('[direct-triad] Gemini raw text length:', text.length)
  console.log('[direct-triad] Gemini raw text first 500:', text.slice(0, 500))
  if (!res.ok) {
    console.log('[direct-triad] error response body:', text)
    throw new Error(`Gemini failed (${res.status}): ${text}`)
  }

  const data = JSON.parse(text)

  console.log('[direct-triad] Gemini groundingMetadata present:', !!data?.candidates?.[0]?.groundingMetadata)
  console.log(
    '[direct-triad] Gemini search queries used:',
    data?.candidates?.[0]?.groundingMetadata?.searchEntryPoint || 'none',
  )

  const parts = data?.candidates?.[0]?.content?.parts ?? []
  const textOut = (Array.isArray(parts) ? parts : [])
    .map((p) => (p && typeof p === 'object' && 'text' in p ? String(p.text) : ''))
    .join('\n')
  console.log('[direct-triad] raw Gemini text:', textOut.slice(0, 500))
  return parseJsonFromModel(textOut)
}

/**
 * @param {string} prompt
 */
async function fetchClaudeScorecard(prompt) {
  const url = '/api/anthropic-proxy'
  console.log('[direct-triad] calling:', url)
  const body = {
    model: CLAUDE_MODEL,
    max_tokens: 16000,
    messages: [{ role: 'user', content: prompt }],
  }
  console.log('[direct-triad] Claude request body length:', JSON.stringify(body).length)
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
    },
    body: JSON.stringify(body),
  })
  console.log('[direct-triad] response status:', res.status, 'url:', url)

  const text = await res.text()
  console.log('[direct-triad] Claude raw text length:', text.length)
  console.log('[direct-triad] Claude raw text first 1000:', text.slice(0, 1000))
  if (!res.ok) {
    console.error('[direct-triad] Claude response status:', res.status, res.statusText)
    console.log('[direct-triad] error response body:', text)
    throw new Error(`Claude failed (${res.status}): ${text}`)
  }

  const data = JSON.parse(text)

  console.log('[direct-triad] Claude stop_reason:', data?.stop_reason)
  console.log('[direct-triad] Claude usage:', JSON.stringify(data?.usage))

  const textOut =
    data?.content?.filter((b) => b?.type === 'text').map((b) => b.text).join('\n') ?? ''
  const parsedJson = parseJsonFromModel(textOut)
  console.log('[direct-triad] Claude parsed keys:', Object.keys(parsedJson))
  console.log('[direct-triad] Claude sections count:', parsedJson?.sections?.length)
  console.log('[direct-triad] Claude items count:', parsedJson?.items?.length)
  return parsedJson
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

  progress('Gathering deep research with Gemini Pro (web search)...')
  const prompt = buildGeminiDeepResearchPrompt(ticker, company, exchange)
  const geminiJson = await fetchGeminiResearch(prompt)
  console.log('[direct-triad] Gemini complete')
  console.log('[direct-triad] post-Gemini: about to save to research_logs')
  const researchLogId = await saveGeminiLog(supabase, userId, tickerTag, geminiJson)
  console.log('[direct-triad] post-Gemini: saved to research_logs')
  return { geminiJson, researchLogId }
}

/**
 * @param {unknown} geminiJson
 * @param {Record<string, unknown>} claudeJson
 * @param {string} frameworkKey
 */
function buildScorecardArtifacts(geminiJson, claudeJson, frameworkKey) {
  const overallScore = Number(claudeJson.overall_score ?? claudeJson.overall_score_pct)
  const frameworkLabel =
    text(claudeJson.framework) || frameworkLabelForKey(frameworkKey) || text(/** @type {Record<string, unknown>} */ (geminiJson).recommended_framework)
  const tier = claudeJson.tier
  const tierLabel = text(claudeJson.tier_label)
  const synopsis = text(claudeJson.synopsis) || text(claudeJson.synopsis_one_liner)
  const items = normalizeScorecardItems(claudeJson, frameworkKey)
  const sectionScores = normalizeSectionScores(claudeJson)
  const buyZones = Array.isArray(claudeJson.buy_zones_native) ? claudeJson.buy_zones_native : []
  const exitTriggers = Array.isArray(claudeJson.exit_triggers) ? claudeJson.exit_triggers : []
  const researchMd = buildResearchPaperFromClaude(claudeJson)

  const scorecardForUi = {
    framework: frameworkLabel || frameworkKey,
    framework_key: frameworkKey,
    overall_score: Number.isFinite(overallScore) ? overallScore : null,
    overall_score_pct: Number.isFinite(overallScore) ? overallScore : null,
    tier,
    tier_label: tierLabel,
    synopsis_one_liner: text(claudeJson.synopsis_one_liner) || synopsis,
    items,
    section_scores: sectionScores,
    buy_zones_native: buyZones,
    exit_triggers: exitTriggers,
    gemini_research: geminiJson,
  }

  const researchPaper = {
    generated_at: new Date().toISOString(),
    gemini_model: GEMINI_MODEL,
    claude_model: CLAUDE_MODEL,
    markdown: researchMd,
    body_md: researchMd,
    outline: researchPaperSectionsPayload(claudeJson, researchMd),
  }

  return { overallScore, frameworkLabel, scorecardForUi, researchPaper, buyZones, exitTriggers, researchPaperPayload: researchPaperSectionsPayload(claudeJson, researchMd) }
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
  const reason =
    text(g.business_overview)?.slice(0, 500) ||
    text(g.competitive_moat)?.slice(0, 400) ||
    'Suggested from Gemini deep research (recommended_framework).'
  return {
    ok: true,
    suggestion: {
      framework_key: frameworkKey,
      framework_label: frameworkLabelForKey(frameworkKey),
      reason,
    },
  }
}

/** @param {string} confirmedKey @param {Record<string, unknown>} claudeJson @param {unknown} geminiJson */
function resolveFrameworkKey(confirmedKey, claudeJson, geminiJson) {
  if (confirmedKey && VALID_FRAMEWORK_KEYS.includes(confirmedKey)) return confirmedKey
  if (confirmedKey) {
    const mapped = frameworkKeyFromRecommendation(confirmedKey)
    if (VALID_FRAMEWORK_KEYS.includes(mapped)) return mapped
  }
  const fromClaude = normalizeFrameworkKey(claudeJson.framework_key ?? claudeJson.framework)
  if (VALID_FRAMEWORK_KEYS.includes(fromClaude)) return fromClaude
  return frameworkKeyFromRecommendation(
    claudeJson.framework ?? /** @type {Record<string, unknown>} */ (geminiJson).recommended_framework,
  )
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
  researchPaperPayload,
  overallScore,
  researchLogId,
  buyZones,
  exitTriggers,
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
    payload: researchPaperPayload,
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
      buy_zones: buyZones,
      exit_triggers: exitTriggers,
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

  try {
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

    console.log('[direct-triad] step: obtaining Gemini JSON')
    const { geminiJson, researchLogId } = await obtainGeminiJson(
      supabase,
      userId,
      target.tickerTag,
      target.ticker,
      target.company,
      target.exchange,
      progress,
    )
    console.log(
      '[direct-triad] step: Gemini JSON obtained, keys:',
      Object.keys(/** @type {Record<string, unknown>} */ (geminiJson && typeof geminiJson === 'object' ? geminiJson : {})),
    )

    if (step === 'suggest-framework') {
      return buildFrameworkSuggestion(geminiJson)
    }

    const confirmedKey = normalizeFrameworkKey(args.confirmedFrameworkKey)
    const frameworkKey =
      step === 'run-analysis' && confirmedKey && confirmedKey !== 'unknown'
        ? resolveFrameworkKey(confirmedKey, {}, /** @type {Record<string, unknown>} */ (geminiJson))
        : resolveFrameworkKey(
            '',
            {},
            /** @type {Record<string, unknown>} */ (geminiJson),
          )

    progress('Synthesising item-level scorecard with Claude...')
    console.log('[direct-triad] step: building Claude prompt')
    const claudePrompt = buildClaudeScorecardPrompt(
      frameworkKey,
      frameworkLabelForKey(frameworkKey),
      target.ticker,
      target.company,
      /** @type {Record<string, unknown>} */ (geminiJson),
    )
    console.log('[direct-triad] step: calling Claude')
    const claudeJson = await fetchClaudeScorecard(claudePrompt)
    console.log('[direct-triad] Claude complete')

  const resolvedFrameworkKey = resolveFrameworkKey(
    confirmedKey,
    /** @type {Record<string, unknown>} */ (claudeJson),
    geminiJson,
  )

  const { overallScore, frameworkLabel, scorecardForUi, researchPaper, buyZones, exitTriggers, researchPaperPayload } =
    buildScorecardArtifacts(geminiJson, claudeJson, resolvedFrameworkKey)

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
        framework: resolvedFrameworkKey,
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
      payload: researchPaperPayload,
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
        buy_zones: buyZones,
        exit_triggers: exitTriggers,
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
    resolvedFrameworkKey,
    scorecardForUi,
    claudeJson,
    researchPaper,
    researchPaperPayload,
    overallScore,
    researchLogId,
    buyZones,
    exitTriggers,
  )

  return {
    ok: true,
    version_number: versionNumber,
    overall_score: Number.isFinite(overallScore) ? overallScore : null,
    framework: frameworkLabel,
    tier: scorecardForUi.tier_label || scorecardForUi.tier,
  }
  } catch (err) {
    console.error('[direct-triad] PIPELINE ERROR:', err?.message, err?.stack)
    throw err
  }
}

import Anthropic from '@anthropic-ai/sdk'
import { GoogleGenerativeAI } from '@google/generative-ai'
import { readAnalysisEnv } from './_lib/env.mjs'
import { createUserSupabase } from './_lib/supabaseUser.mjs'
import {
  FRAMEWORK_KEYS,
  FRAMEWORK_RULES_FOR_CACHE,
  RESPONSE_SCHEMA_HINT,
  frameworkLabel,
} from './_lib/frameworkDefinitions.mjs'
import { fetchFmpFundamentalsSnapshot } from './_lib/fmpSnapshot.mjs'
import {
  canonicalSymbolKey,
  extractAnthropicText,
  geminiPayloadFromRow,
  parseJsonFromModel,
} from './_lib/orchestratorHelpers.mjs'
import { assertGlobalApiNotPaused } from './_lib/globalApiPause.mjs'

function readNodeEnv() {
  return typeof process !== 'undefined' && process.env ? process.env : {}
}

function tickerTagFromRow(pos) {
  const t = String(pos.display_ticker || pos.fmp_symbol || '').trim().toUpperCase()
  return t || 'UNKNOWN'
}

/** @param {unknown} value */
function textOrEmpty(value) {
  return typeof value === 'string' && value.trim() ? value.trim() : ''
}

/** @param {unknown} raw */
function marketCodeFromRaw(raw) {
  const o = raw && typeof raw === 'object' ? /** @type {Record<string, unknown>} */ (raw) : null
  const inst = o && Reflect.get(o, 'instrument')
  const instObj = inst && typeof inst === 'object' ? /** @type {Record<string, unknown>} */ (inst) : null

  return textOrEmpty(Reflect.get(o ?? {}, 'market_code') ?? Reflect.get(instObj ?? {}, 'market_code')).toUpperCase()
}

/** @param {unknown} holding */
function inferExchangeFromHolding(holding) {
  const h = holding && typeof holding === 'object' ? /** @type {Record<string, unknown>} */ (holding) : {}
  const raw = Reflect.get(h, 'raw')
  const market = marketCodeFromRaw(raw)

  if (market === 'ASX') return 'ASX'
  if (market === 'LSE') return 'LSE'
  if (market) return market

  return 'UNKNOWN'
}

/** @param {unknown} symbol @param {unknown} exchange */
function inferYahooSymbol(symbol, exchange) {
  const s = textOrEmpty(symbol).replace(/^ASX:/i, '')
  const ex = textOrEmpty(exchange).toUpperCase()

  if (!s) return ''
  if (ex === 'ASX' && !/\.AX$/i.test(s)) return `${s}.AX`
  if (ex === 'LSE' && !/\.L$/i.test(s)) return `${s}.L`

  return s
}

/** @param {unknown} raw */
function normalizeFrameworkKey(raw) {
  return String(raw ?? '')
    .trim()
    .toLowerCase()
    .replace(/-/g, '_')
    .replace(/\s+/g, '_')
}

/** @param {unknown} raw */
function frameworkKeyFromGeminiRecommendation(raw) {
  const s = normalizeFrameworkKey(raw)

  if (s === 'regular_stock' || s === 'regular_stocks') return 'regular_stocks'
  if (s === 'thematic_etf' || s === 'thematic_etfs') return 'thematic_etfs'
  if (s === 'fund_manager_lic' || s === 'fund_manager_lics' || s === 'fund_managers_lic') return 'fund_managers_lic'
  if (s === 'speculative_stock' || s === 'speculative_stocks' || s === 'speculative') return 'speculative'
  if (s === 'alternative_pe' || s === 'alternative_investments_pe' || s === 'alternatives_pe') return 'alternatives_pe'

  return ''
}

async function userVersionCap(supabase, userId) {
  const { data } = await supabase.from('user_settings').select('preferences').eq('user_id', userId).maybeSingle()

  const p = data?.preferences && typeof data.preferences === 'object' ? data.preferences : null

  if (p && p.score_version_cap != null) {
    const n = typeof p.score_version_cap === 'number' ? p.score_version_cap : Number.parseInt(`${p.score_version_cap}`, 10)

    if (Number.isFinite(n) && n > 0) return n
  }

  return 10
}

async function loadPosition(supabase, positionId, userId) {
  const { data, error } = await supabase
    .from('positions')
    .select('*')
    .eq('id', positionId)
    .eq('user_id', userId)
    .maybeSingle()

  if (error) throw error

  if (!data) {
    const e = new Error('position_not_found')

    e.code = 'not_found'

    throw e
  }

  return data
}

async function loadWatchlistItem(supabase, watchlistItemId, userId) {
  const { data, error } = await supabase
    .from('watchlist_items')
    .select('*')
    .eq('id', watchlistItemId)
    .eq('user_id', userId)
    .eq('archived', false)
    .maybeSingle()

  if (error) throw error

  if (!data) {
    const e = new Error('watchlist_item_not_found')

    e.code = 'not_found'

    throw e
  }

  return data
}

async function loadSatelliteHolding(supabase, holdingId, userId) {
  const { data, error } = await supabase
    .from('sharesight_holdings')
    .select('*')
    .eq('user_id', userId)
    .eq('portfolio_role', 'satellite')
    .eq('holding_external_id', holdingId)
    .maybeSingle()

  if (error) throw error

  if (!data) {
    const e = new Error('holding_not_found')

    e.code = 'not_found'

    throw e
  }

  return data
}

async function ensurePositionForHolding(supabase, holding, userId) {
  const holdingKey = String(holding.holding_external_id ?? '').trim()

  const { data: existing, error: existingErr } = await supabase
    .from('positions')
    .select('*')
    .eq('user_id', userId)
    .eq('sharesight_holding_key', holdingKey)
    .maybeSingle()

  if (existingErr) throw existingErr
  if (existing) return existing

  const symbol = textOrEmpty(holding.instrument_symbol).replace(/^ASX:/i, '') || holdingKey
  const exchange = inferExchangeFromHolding(holding)
  const yahoo = inferYahooSymbol(symbol, exchange) || symbol
  const now = new Date().toISOString()

  const { data: inserted, error: insertErr } = await supabase
    .from('positions')
    .insert({
      user_id: userId,
      kind: 'satellite',
      fmp_symbol: symbol,
      exchange_short_name: exchange,
      yahoo_symbol: yahoo,
      display_ticker: symbol,
      currency: textOrEmpty(holding.currency) || 'AUD',
      name: textOrEmpty(holding.instrument_name) || symbol,
      sharesight_holding_key: holdingKey,
      sharesight_portfolio_key: textOrEmpty(holding.portfolio_external_id) || null,
      sharesight_payload: holding.raw && typeof holding.raw === 'object' ? holding.raw : {},
      archived: false,
      closed: holding.closed === true,
      awaiting_analysis: true,
      extra: {
        created_from: 'sharesight_holding_analysis',
        created_from_holding_id: holdingKey,
      },
      updated_at: now,
    })
    .select('*')
    .single()

  if (insertErr) throw insertErr

  return inserted
}

async function pruneVersions(supabase, userId, positionId, cap) {
  const { data: rows, error } = await supabase
    .from('scorecard_versions')
    .select('id, version_number')
    .eq('user_id', userId)
    .eq('position_id', positionId)
    .order('version_number', { ascending: true })

  if (error) throw error

  if (!rows?.length || rows.length < cap) return

  const toDrop = rows.length - cap + 1

  for (let i = 0; i < toDrop; i++) {
    const { error: dErr } = await supabase.from('scorecard_versions').delete().eq('id', rows[i].id)

    if (dErr) throw dErr
  }
}

async function pruneVersionsWatchlist(supabase, userId, watchlistItemId, cap) {
  const { data: rows, error } = await supabase
    .from('scorecard_versions')
    .select('id, version_number')
    .eq('user_id', userId)
    .eq('watchlist_item_id', watchlistItemId)
    .order('version_number', { ascending: true })

  if (error) throw error

  if (!rows?.length || rows.length < cap) return

  const toDrop = rows.length - cap + 1

  for (let i = 0; i < toDrop; i++) {
    const { error: dErr } = await supabase.from('scorecard_versions').delete().eq('id', rows[i].id)

    if (dErr) throw dErr
  }
}

/**
 * Exactly one parent id allowed.
 *
 * @param {Record<string, unknown>} body
 * @returns {{ kind: 'position' | 'watchlist' | 'holding', id: string } | null}
 */
function resolveAnalysisParent(body) {
  const pid = typeof body.positionId === 'string' ? body.positionId.trim() : ''
  const wid = typeof body.watchlistItemId === 'string' ? body.watchlistItemId.trim() : ''
  const hid = typeof body.holdingId === 'string' ? body.holdingId.trim() : ''

  if ([pid, wid, hid].filter(Boolean).length > 1) return null
  if (pid) return { kind: 'position', id: pid }
  if (wid) return { kind: 'watchlist', id: wid }
  if (hid) return { kind: 'holding', id: hid }

  return null
}

async function materializeAnalysisParent(supabase, userId, parent) {
  if (parent.kind !== 'holding') return parent

  const holding = await loadSatelliteHolding(supabase, parent.id, userId)
  const position = await ensurePositionForHolding(supabase, holding, userId)

  return { kind: /** @type {const} */ ('position'), id: String(position.id) }
}

async function loadAnalysisRow(supabase, userId, parent) {
  if (parent.kind === 'position') {
    return { kind: /** @type {const} */ ('position'), row: await loadPosition(supabase, parent.id, userId) }
  }

  return { kind: /** @type {const} */ ('watchlist'), row: await loadWatchlistItem(supabase, parent.id, userId) }
}

async function resolveGeminiJson({ supabase, userId, canonicalKey, tickerTag, pos, cfg, forceRefresh }) {
  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString()

  const { data: recentLog } = await supabase
    .from('research_logs')
    .select('id, raw_gemini_json')
    .eq('user_id', userId)
    .eq('ticker', tickerTag)
    .gte('timestamp', sevenDaysAgo)
    .order('timestamp', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (recentLog?.raw_gemini_json && !forceRefresh) {
    return { gemini: recentLog.raw_gemini_json, source: 'research_logs_7d', researchLogId: recentLog.id }
  }

  if (!cfg.geminiApiKey) throw new Error('GEMINI_API_KEY missing')

  const { data: cacheRow } = await supabase
    .from('gemini_research_artefacts')
    .select('*')
    .eq('user_id', userId)
    .eq('canonical_symbol_key', canonicalKey)
    .eq('task_type', 'stock_research')
    .gte('fetched_at', sevenDaysAgo)
    .maybeSingle()

  const cached = cacheRow ? geminiPayloadFromRow(cacheRow) : null

  if (cached && !forceRefresh) {
    return { gemini: cached, source: 'gemini_cache_7d', researchLogId: null }
  }

  const prompt = [
    'Research this listed security and return ONLY one valid JSON object. No markdown, no prose outside JSON.',
    `ticker=${pos.fmp_symbol}, company=${pos.name ?? pos.display_ticker ?? pos.fmp_symbol}, exchange=${pos.exchange_short_name}.`,
    'Schema:',
    '{"ticker":string,"company":string,"research_date":string,"thesis_summary":string,"competitive_moat":string,"financials_commentary":string,"key_risks":string[],"recent_developments":string,"management_quality":string,"growth_runway":string,"valuation_commentary":string,"technical_summary":string,"sentiment":"positive|neutral|negative","recommended_framework":"Regular Stock|Thematic ETF|Fund Manager / LIC|Speculative Stock|Alternative / PE"}',
    'Use Gemini for broad research. Distill findings for Claude; do not include raw source dumps.',
  ].join(' ')

  const genAi = new GoogleGenerativeAI(cfg.geminiApiKey)

  const model = genAi.getGenerativeModel({
    model: cfg.geminiModel,
    generationConfig: { responseMimeType: 'application/json' },
  })

  const gRes = await model.generateContent(prompt)

  const parsed = JSON.parse(gRes.response.text())

  const { data: inserted, error: logErr } = await supabase
    .from('research_logs')
    .insert({
      user_id: userId,
      ticker: tickerTag,
      raw_gemini_json: parsed,
      claude_synthesis_status: 'pending',
    })
    .select('id')
    .single()

  if (logErr) throw logErr

  const { error: upErr } = await supabase.from('gemini_research_artefacts').upsert(
    {
      user_id: userId,
      canonical_symbol_key: canonicalKey,
      task_type: 'stock_research',
      model: cfg.geminiModel,
      payload: parsed,
      fetched_at: new Date().toISOString(),
    },
    { onConflict: 'user_id,canonical_symbol_key,task_type' },
  )

  if (upErr) throw upErr

  return { gemini: parsed, source: 'gemini_live', researchLogId: inserted.id }
}

async function runSuggestFramework(cfg, supabase, userId, parent) {
  await assertGlobalApiNotPaused(supabase, userId)

  if (!cfg.anthropicApiKey) return { ok: false, code: 'missing_key', message: 'ANTHROPIC_API_KEY' }

  const { row: pos } = await loadAnalysisRow(supabase, userId, parent)

  const fmp = await fetchFmpFundamentalsSnapshot(String(pos.fmp_symbol), cfg.fmpApiKey)

  const client = new Anthropic({ apiKey: cfg.anthropicApiKey })

  const list = FRAMEWORK_KEYS.map((k) => `- ${k}: ${frameworkLabel(k)}`).join('\n')

  const assetClass = typeof pos.asset_class === 'string' ? pos.asset_class : null

  const msg = await client.messages.create({
    model: cfg.claudeModel,
    max_tokens: 900,
    messages: [
      {
        role: 'user',
        content: [
          'Pick one framework_key from the list.',
          list,
          'framework_key MUST be exactly one enum string.',
          `Instrument: ${JSON.stringify({ name: pos.name, fmp_symbol: pos.fmp_symbol, exchange: pos.exchange_short_name, currency: pos.currency ?? null, asset_class: assetClass })}`,
          fmp ? `FMP profile snippet: ${JSON.stringify(fmp)}` : '',
          'Reply JSON ONLY: {"framework_key":string,"reason":string} reason max ~400 chars.',
        ]
          .filter(Boolean)
          .join('\n'),
      },
    ],
  })

  const out = parseJsonFromModel(extractAnthropicText(msg))

  const fk = normalizeFrameworkKey(out.framework_key)

  if (!FRAMEWORK_KEYS.includes(fk)) {
    return { ok: false, code: 'bad_framework', message: 'invalid framework_key from Claude' }
  }

  return {
    ok: true,
    step: 'suggest-framework',
    suggestion: {
      framework_key: fk,
      framework_label: frameworkLabel(fk),
      reason: String(out.reason || ''),
    },
  }
}

/**
 * @param {{ kind: 'position' | 'watchlist', id: string }} parent
 */
async function runFullAnalysis(cfg, supabase, userId, parent, confirmedFrameworkKey, forceRefreshGemini) {
  await assertGlobalApiNotPaused(supabase, userId)

  if (!cfg.anthropicApiKey) return { ok: false, code: 'missing_key', message: 'ANTHROPIC_API_KEY' }

  const { row: pos } = await loadAnalysisRow(supabase, userId, parent)

  const tag = tickerTagFromRow(pos)

  const canKey = canonicalSymbolKey(String(pos.exchange_short_name), String(pos.fmp_symbol))

  const gemBundle = await resolveGeminiJson({
    supabase,
    userId,
    canonicalKey: canKey,
    tickerTag: tag,
    pos,
    cfg,
    forceRefresh: !!forceRefreshGemini,
  })

  const fkIn =
    normalizeFrameworkKey(confirmedFrameworkKey) ||
    frameworkKeyFromGeminiRecommendation(gemBundle.gemini?.recommended_framework) ||
    frameworkKeyFromGeminiRecommendation(gemBundle.gemini?.instrument_type_guess)

  if (!FRAMEWORK_KEYS.includes(fkIn)) {
    return { ok: false, code: 'bad_framework', message: 'confirmedFrameworkKey invalid and Gemini recommended_framework missing/invalid' }
  }

  const researchLogId = gemBundle.researchLogId

  try {
    const fmpSnap = await fetchFmpFundamentalsSnapshot(String(pos.fmp_symbol), cfg.fmpApiKey)

    const cap = await userVersionCap(supabase, userId)

    if (parent.kind === 'position') {
      await pruneVersions(supabase, userId, parent.id, cap)
    } else {
      await pruneVersionsWatchlist(supabase, userId, parent.id, cap)
    }

    const maxQ =
      parent.kind === 'position'
        ? await supabase
            .from('scorecard_versions')
            .select('version_number')
            .eq('position_id', parent.id)
            .eq('user_id', userId)
            .order('version_number', { ascending: false })
            .limit(1)
            .maybeSingle()
        : await supabase
            .from('scorecard_versions')
            .select('version_number')
            .eq('watchlist_item_id', parent.id)
            .eq('user_id', userId)
            .order('version_number', { ascending: false })
            .limit(1)
            .maybeSingle()

    const maxRow = maxQ.data
    const maxErr = maxQ.error

    if (maxErr) throw maxErr

    const nextV = Number.isFinite(Number(maxRow?.version_number)) ? Number(maxRow.version_number) + 1 : 1

    const client = new Anthropic({ apiKey: cfg.anthropicApiKey })

    const cacheBlock = [
      {
        type: 'text',
        text: FRAMEWORK_RULES_FOR_CACHE + '\n\n' + RESPONSE_SCHEMA_HINT,
        cache_control: { type: 'ephemeral' },
      },
    ]

    const currencyVal = Reflect.get(pos, 'currency')

    const assetClassHint = typeof pos.asset_class === 'string' ? pos.asset_class : null

    const userText = [
      `Active framework_key: ${fkIn} (${frameworkLabel(fkIn)}).`,
      'Use the Gemini recommended framework as the basis and this active framework only. Produce checklist item count: 60 if regular_stocks else 40.',
      assetClassHint ? `User-declared asset_class for this instrument: ${assetClassHint}. Reflect this in framing where relevant.` : '',
      `Gemini JSON:\n${JSON.stringify(gemBundle.gemini)}`,
      `FMP snapshot:\n${JSON.stringify(fmpSnap ?? {})}`,
      `Instrument meta:\n${JSON.stringify({ currency: currencyVal ?? null, yahoo_symbol: pos.yahoo_symbol, name: pos.name })}`,
      'Return ONLY the scorecard JSON matching RESPONSE_SCHEMA_HINT.',
    ]
      .filter(Boolean)
      .join('\n\n')

    const claudeMsg = await client.messages.create({
      model: cfg.claudeModel,
      max_tokens: 16000,
      system: cacheBlock,
      messages: [{ role: 'user', content: userText }],
    })

    const scorecardJson = parseJsonFromModel(extractAnthropicText(claudeMsg))

    const overall = Number(scorecardJson.overall_score_pct)

    const synopsis = String(scorecardJson.synopsis_one_liner || '')

    const buyZones = Array.isArray(scorecardJson.buy_zones_native) ? scorecardJson.buy_zones_native : []

    const exits = Array.isArray(scorecardJson.exit_triggers) ? scorecardJson.exit_triggers : []

    const paper =
      scorecardJson.research_paper_outline && typeof scorecardJson.research_paper_outline === 'object'
        ? scorecardJson.research_paper_outline
        : { sections: [] }

    const insertSc = /** @type {Record<string, unknown>} */ ({
      user_id: userId,
      version_number: nextV,
      framework: fkIn,
      overall_score: Number.isFinite(overall) ? overall : null,
      payload: scorecardJson,
      generated_at: new Date().toISOString(),
      ...(parent.kind === 'position' ? { position_id: parent.id } : { watchlist_item_id: parent.id }),
    })

    const { data: insertedSc, error: scErr } = await supabase.from('scorecard_versions').insert(insertSc).select('id').single()

    if (scErr) throw scErr

    const scId = insertedSc.id

    const { error: rpErr } = await supabase.from('research_paper_versions').insert({
      user_id: userId,
      scorecard_version_id: scId,
      payload: paper,
      generated_at: new Date().toISOString(),
    })

    if (rpErr) throw rpErr

    const extraBase = pos.extra && typeof pos.extra === 'object' ? { .../** @type {Record<string, unknown>} */ (pos.extra) } : {}

    if (synopsis) extraBase.synopsis = synopsis

    if (parent.kind === 'position') {
      const { error: posErr } = await supabase
        .from('positions')
        .update({
          awaiting_analysis: false,
          buy_zones: buyZones,
          exit_triggers: exits,
          extra: extraBase,
          updated_at: new Date().toISOString(),
        })
        .eq('id', parent.id)
        .eq('user_id', userId)

      if (posErr) throw posErr
    } else {
      const { error: wlErr } = await supabase
        .from('watchlist_items')
        .update({
          awaiting_analysis: false,
          buy_zones: buyZones,
          exit_triggers: exits,
          extra: extraBase,
          updated_at: new Date().toISOString(),
        })
        .eq('id', parent.id)
        .eq('user_id', userId)

      if (wlErr) throw wlErr
    }

    if (researchLogId) {
      await supabase.from('research_logs').update({ claude_synthesis_status: 'success' }).eq('id', researchLogId)
    }

    return {
      ok: true,
      step: 'run-analysis',
      scorecard_version_id: scId,
      version_number: nextV,
      overall_score: overall,
      synopsis,
      gemini_source: gemBundle.source,
      buy_zones_unlocked: Number.isFinite(overall) && overall >= 65,
    }
  } catch (err) {
    if (researchLogId) {
      await supabase.from('research_logs').update({ claude_synthesis_status: 'failed' }).eq('id', researchLogId)
    }

    throw err
  }
}

async function dispatch(body, env, authHeader) {
  const cfg = readAnalysisEnv(env)

  if (!cfg.supabaseUrl || !cfg.supabaseAnonKey) {
    return { ok: false, code: 'config', message: 'Supabase URL/anon key missing on server' }
  }

  const ctx = createUserSupabase(cfg.supabaseUrl, cfg.supabaseAnonKey, authHeader)

  if (ctx.error) return { ok: false, code: ctx.error }

  const supabase = ctx.supabase

  const { data: ud, error: uErr } = await supabase.auth.getUser()

  if (uErr || !ud?.user?.id) return { ok: false, code: 'unauthorized' }

  const userId = ud.user.id

  const step = typeof body.step === 'string' ? body.step.trim() : ''

  const parent = resolveAnalysisParent(body ?? {})

  if (!parent) {
    return { ok: false, code: 'bad_request', message: 'Exactly one of positionId, watchlistItemId, or holdingId required' }
  }

  const analysisParent = await materializeAnalysisParent(supabase, userId, parent)

  if (step === 'suggest-framework') {
    return await runSuggestFramework(cfg, supabase, userId, analysisParent)
  }

  if (step === 'run-analysis') {
    return await runFullAnalysis(cfg, supabase, userId, analysisParent, body.confirmedFrameworkKey, body.forceRefreshGemini === true)
  }

  return { ok: false, code: 'bad_request', message: 'unknown step' }
}

export default async function handler(req, res) {
  const env = readNodeEnv()

  const secret = `${env.ANALYSIS_API_SECRET ?? ''}`.trim()

  const incomingSecret = `${req.headers['x-analysis-secret'] ?? req.headers['X-Analysis-Secret'] ?? ''}`.trim()

  if (secret && incomingSecret !== secret) {
    res.statusCode = 403

    res.setHeader('Content-Type', 'application/json')

    res.end(JSON.stringify({ ok: false, error: 'forbidden' }))

    return
  }

  if (req.method !== 'POST') {
    res.statusCode = 405

    res.setHeader('Content-Type', 'application/json')

    res.end(JSON.stringify({ ok: false, error: 'method_not_allowed' }))

    return
  }

  const chunks = []

  for await (const chunk of req) chunks.push(chunk)

  const raw = Buffer.concat(chunks).toString('utf8')

  /** @type {Record<string, unknown>} */
  let body

  try {
    body = raw.trim() ? JSON.parse(raw) : {}
  } catch {
    res.statusCode = 400

    res.setHeader('Content-Type', 'application/json')

    res.end(JSON.stringify({ ok: false, error: 'invalid_json' }))

    return
  }

  try {
    const auth = typeof req.headers.authorization === 'string' ? req.headers.authorization : ''

    const out = await dispatch(body ?? {}, env, auth)

    res.statusCode = 200

    res.setHeader('Content-Type', 'application/json')

    res.end(JSON.stringify(out))
  } catch (e) {
    const code = e && typeof e === 'object' && Reflect.get(e, 'code') === 'api_paused' ? 'api_paused' : 'error'

    const status = code === 'api_paused' ? 423 : 500

    res.statusCode = status

    res.setHeader('Content-Type', 'application/json')

    res.end(
      JSON.stringify({
        ok: false,
        code,
        message: e instanceof Error ? e.message : String(e),
      }),
    )
  }
}

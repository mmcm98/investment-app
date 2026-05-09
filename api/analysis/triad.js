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

function readNodeEnv() {
  return typeof process !== 'undefined' && process.env ? process.env : {}
}

function tickerTagFromPosition(pos) {
  const t = String(pos.display_ticker || pos.fmp_symbol || '').trim().toUpperCase()
  return t || 'UNKNOWN'
}

/** @param {unknown} raw */
function normalizeFrameworkKey(raw) {
  return String(raw ?? '')
    .trim()
    .toLowerCase()
    .replace(/-/g, '_')
    .replace(/\s+/g, '_')
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

async function assertNotPaused(supabase, userId) {
  const { data } = await supabase.from('user_settings').select('global_api_pause').eq('user_id', userId).maybeSingle()

  if (data?.global_api_pause === true) {
    const e = new Error('global_api_pause')

    e.code = 'api_paused'

    throw e
  }
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

async function resolveGeminiJson({ supabase, userId, canonicalKey, tickerTag, pos, cfg, forceRefresh }) {
  const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString()

  const { data: recentLog } = await supabase
    .from('research_logs')
    .select('id, raw_gemini_json')
    .eq('ticker', tickerTag)
    .gte('timestamp', oneHourAgo)
    .order('timestamp', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (recentLog?.raw_gemini_json && !forceRefresh) {
    return { gemini: recentLog.raw_gemini_json, source: 'research_logs_1h', researchLogId: recentLog.id }
  }

  if (!cfg.geminiApiKey) throw new Error('GEMINI_API_KEY missing')

  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString()

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
    'Return one JSON object for stock_research (CLAUDE.md). schema_version=1 integer.',
    `ticker=${pos.fmp_symbol}, exchange=${pos.exchange_short_name}.`,
    'instrument_type_guess: regular_stock | thematic_etf | fund_manager_lic | speculative | alternative_pe | unknown.',
    'Include: thesis_summary, business_overview, moat_commentary, financial_summary_commentary, capital_allocation_commentary, valuation_commentary, scenario_outline, peers_commentary, risks, recent_developments, catalysts, management_governance_signals, sentiment, data_gaps_for_fmp_fields, sources[].',
    'JSON only.',
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

async function runSuggestFramework(cfg, supabase, userId, positionId) {
  await assertNotPaused(supabase, userId)

  if (!cfg.anthropicApiKey) return { ok: false, code: 'missing_key', message: 'ANTHROPIC_API_KEY' }

  const pos = await loadPosition(supabase, positionId, userId)

  const fmp = await fetchFmpFundamentalsSnapshot(String(pos.fmp_symbol), cfg.fmpApiKey)

  const client = new Anthropic({ apiKey: cfg.anthropicApiKey })

  const list = FRAMEWORK_KEYS.map((k) => `- ${k}: ${frameworkLabel(k)}`).join('\n')

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
          `Position: ${JSON.stringify({ name: pos.name, fmp_symbol: pos.fmp_symbol, exchange: pos.exchange_short_name, currency: pos.currency })}`,
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

async function runFullAnalysis(cfg, supabase, userId, positionId, confirmedFrameworkKey, forceRefreshGemini) {
  await assertNotPaused(supabase, userId)

  const fkIn = normalizeFrameworkKey(confirmedFrameworkKey)

  if (!FRAMEWORK_KEYS.includes(fkIn)) {
    return { ok: false, code: 'bad_framework', message: 'confirmedFrameworkKey invalid' }
  }

  if (!cfg.anthropicApiKey) return { ok: false, code: 'missing_key', message: 'ANTHROPIC_API_KEY' }

  const pos = await loadPosition(supabase, positionId, userId)

  const tag = tickerTagFromPosition(pos)

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

  const researchLogId = gemBundle.researchLogId

  try {
    const fmpSnap = await fetchFmpFundamentalsSnapshot(String(pos.fmp_symbol), cfg.fmpApiKey)

    const cap = await userVersionCap(supabase, userId)

    await pruneVersions(supabase, userId, positionId, cap)

    const { data: maxRow } = await supabase
      .from('scorecard_versions')
      .select('version_number')
      .eq('position_id', positionId)
      .eq('user_id', userId)
      .order('version_number', { ascending: false })
      .limit(1)
      .maybeSingle()

    const nextV = Number.isFinite(Number(maxRow?.version_number)) ? Number(maxRow.version_number) + 1 : 1

    const client = new Anthropic({ apiKey: cfg.anthropicApiKey })

    const cacheBlock = [
      {
        type: 'text',
        text: FRAMEWORK_RULES_FOR_CACHE + '\n\n' + RESPONSE_SCHEMA_HINT,
        cache_control: { type: 'ephemeral' },
      },
    ]

    const userText = [
      `Active framework_key: ${fkIn} (${frameworkLabel(fkIn)}).`,
      'Use this framework only. Produce checklist item count: 60 if regular_stocks else 40.',
      `Gemini JSON:\n${JSON.stringify(gemBundle.gemini)}`,
      `FMP snapshot:\n${JSON.stringify(fmpSnap ?? {})}`,
      `Position meta:\n${JSON.stringify({ currency: pos.currency, yahoo_symbol: pos.yahoo_symbol, name: pos.name })}`,
      'Return ONLY the scorecard JSON matching RESPONSE_SCHEMA_HINT.',
    ].join('\n\n')

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

    const { data: insertedSc, error: scErr } = await supabase
      .from('scorecard_versions')
      .insert({
        user_id: userId,
        position_id: positionId,
        version_number: nextV,
        framework: fkIn,
        overall_score: Number.isFinite(overall) ? overall : null,
        payload: scorecardJson,
        generated_at: new Date().toISOString(),
      })
      .select('id')
      .single()

    if (scErr) throw scErr

    const scId = insertedSc.id

    const { error: rpErr } = await supabase.from('research_paper_versions').insert({
      user_id: userId,
      scorecard_version_id: scId,
      payload: paper,
      generated_at: new Date().toISOString(),
    })

    if (rpErr) throw rpErr

    const extra = pos.extra && typeof pos.extra === 'object' ? { ...pos.extra } : {}

    if (synopsis) extra.synopsis = synopsis

    const { error: posErr } = await supabase
      .from('positions')
      .update({
        awaiting_analysis: false,
        buy_zones: buyZones,
        exit_triggers: exits,
        extra,
        updated_at: new Date().toISOString(),
      })
      .eq('id', positionId)
      .eq('user_id', userId)

    if (posErr) throw posErr

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

  const positionId = typeof body.positionId === 'string' ? body.positionId.trim() : ''

  if (!positionId) return { ok: false, code: 'bad_request', message: 'positionId required' }

  if (step === 'suggest-framework') {
    return await runSuggestFramework(cfg, supabase, userId, positionId)
  }

  if (step === 'run-analysis') {
    return await runFullAnalysis(
      cfg,
      supabase,
      userId,
      positionId,
      body.confirmedFrameworkKey,
      body.forceRefreshGemini === true,
    )
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

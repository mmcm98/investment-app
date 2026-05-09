import Anthropic from '@anthropic-ai/sdk'

import { GoogleGenerativeAI } from '@google/generative-ai'

import { readAnalysisEnv } from './_lib/env.mjs'

import { createUserSupabase } from './_lib/supabaseUser.mjs'

import { assertGlobalApiNotPaused } from './_lib/globalApiPause.mjs'

import { loadClaudeMdForBriefingCache } from './_lib/loadClaudeMdForCache.mjs'

import { extractAnthropicText, parseJsonFromModel } from './_lib/orchestratorHelpers.mjs'

function readNodeEnv() {
  return typeof process !== 'undefined' && process.env ? process.env : {}
}

const BRIEFING_TICKER = 'PORTFOLIO_BRIEFING'

const STATIC_BRIEFING_RULES = `
You are the Thinker in the Triad (CLAUDE.md). Synthesize a portfolio briefing for the user.

Output requirements (strict):
- Reply with JSON ONLY (no markdown fences). Schema:
{
  "briefing_title": string,
  "page_1_snapshot_markdown": string,
  "page_2_attention_markdown": string,
  "page_3_market_markdown": string
}

Content requirements:
- page_1_snapshot_markdown: Portfolio snapshot — health, core vs satellite allocation vs targets, cash (broker + external if in context), high-level DCA status, total value context.
- page_2_attention_markdown: What needs attention — buy zones, exit triggers, material announcements or catalysts if present in context, positions needing re-analysis (stale scorecard), drift vs guidance where data exists.
- page_3_market_markdown: Market context and outlook — use Gemini research JSON (macro, FX, sector themes) plus position-specific developments; end with "This week" action bullets (concrete, user-specific).

Style: professional, concise, Australian English where natural. Use markdown headings (##) and bullet lists inside each page string.
`.trim()

/**
 * @param {Record<string, unknown>} body
 * @param {Record<string,string|undefined>} env
 * @param {string} authHeader
 */

async function runBriefing(body, env, authHeader) {
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

  await assertGlobalApiNotPaused(supabase, userId)

  const context = body.context && typeof body.context === 'object' ? body.context : null

  if (!context) return { ok: false, code: 'bad_request', message: 'context object required' }

  if (!cfg.geminiApiKey) return { ok: false, code: 'missing_key', message: 'GEMINI_API_KEY' }

  if (!cfg.anthropicApiKey) return { ok: false, code: 'missing_key', message: 'ANTHROPIC_API_KEY' }

  const genAi = new GoogleGenerativeAI(cfg.geminiApiKey)

  const gemModel = genAi.getGenerativeModel({
    model: cfg.geminiModel,
    generationConfig: { responseMimeType: 'application/json' },
  })

  const gemPrompt = [
    'You are the Researcher (Gemini Pro). Return JSON only.',
    'schema_version: 1 (integer).',
    'Task: portfolio_briefing_research for the holdings and watchlist described in the next JSON block.',
    'Include keys: macro_and_policy_outlook (string), fx_and_rates_commentary (string), sector_themes (string),',
    'position_developments: array of { ticker, materiality: "no_change"|"minor"|"material", summary (string), sources_hint (string) } for EACH symbol in app_context.satellite_positions and major core equity tickers if identifiable,',
    'recent_risk_flags (string), notable_catalysts_week (string).',
    'Use app_context only for symbol list and weights — do not invent holdings. If unknown, say data gap.',
    `App context JSON:\n${JSON.stringify(context)}`,
  ].join(' ')

  /** @type {string|null} */

  let researchLogId = null

  try {
    const gRes = await gemModel.generateContent(gemPrompt)

    const geminiJson = parseJsonFromModel(gRes.response.text())

    const { data: logRow, error: logErr } = await supabase
      .from('research_logs')
      .insert({
        user_id: userId,
        ticker: BRIEFING_TICKER,
        raw_gemini_json: geminiJson,
        claude_synthesis_status: 'pending',
      })
      .select('id')
      .single()

    if (logErr) throw logErr

    researchLogId = logRow?.id != null ? String(logRow.id) : null

    const claudeMd = loadClaudeMdForBriefingCache()

    const cacheBlock = [
      {
        type: 'text',
        text:
          (claudeMd.trim() ? `${claudeMd.slice(0, 120_000)}\n\n` : '') +
            STATIC_BRIEFING_RULES,
        cache_control: { type: 'ephemeral' },
      },
    ]

    const userPayload = [
      'Synthesize the three-page briefing from the following data.',
      `Compiled app context (JSON):\n${JSON.stringify(context)}`,
      `Gemini research JSON:\n${JSON.stringify(geminiJson)}`,
      'Follow STATIC_BRIEFING_RULES in the cached system block. JSON only in reply.',
    ].join('\n\n')

    const client = new Anthropic({ apiKey: cfg.anthropicApiKey })

    const claudeMsg = await client.messages.create({
      model: cfg.briefingClaudeModel,
      max_tokens: 12000,
      system: cacheBlock,
      messages: [{ role: 'user', content: userPayload }],
    })

    const out = parseJsonFromModel(extractAnthropicText(claudeMsg))

    const title = String(out.briefing_title || 'Portfolio briefing')

    const p1 = String(out.page_1_snapshot_markdown || '')

    const p2 = String(out.page_2_attention_markdown || '')

    const p3 = String(out.page_3_market_markdown || '')

    const bodyMd = [p1, p2, p3].join('\n\n---\n\n')

    const metricsSnapshot = {
      schema_version: 1,
      gemini_research: geminiJson,
      research_log_id: researchLogId,
      briefing_claude_model: cfg.briefingClaudeModel,
      gemini_model: cfg.geminiModel,
      pages: [
        { id: 'snapshot', title: 'Portfolio snapshot' },
        { id: 'attention', title: 'What needs attention' },
        { id: 'market', title: 'Market context & outlook' },
      ],
      context_compiled_at: context.compiled_at ?? null,
    }

    const { data: br, error: brErr } = await supabase
      .from('portfolio_briefings')
      .insert({
        user_id: userId,
        title,
        body_md: bodyMd,
        metrics_snapshot: metricsSnapshot,
        generated_at: new Date().toISOString(),
      })
      .select('id, generated_at, title, body_md, metrics_snapshot')
      .single()

    if (brErr) throw brErr

    if (researchLogId) {
      await supabase.from('research_logs').update({ claude_synthesis_status: 'success' }).eq('id', researchLogId)
    }

    return {
      ok: true,
      briefing: br,
      pages: {
        page_1_snapshot_markdown: p1,
        page_2_attention_markdown: p2,
        page_3_market_markdown: p3,
      },
    }
  } catch (err) {
    if (researchLogId) {
      await supabase.from('research_logs').update({ claude_synthesis_status: 'failed' }).eq('id', researchLogId)
    }

    throw err
  }
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

    const out = await runBriefing(body ?? {}, env, auth)

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

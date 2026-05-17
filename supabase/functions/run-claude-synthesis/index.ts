import { createClient } from 'npm:@supabase/supabase-js@2'

declare const EdgeRuntime: { waitUntil: (promise: Promise<unknown>) => void }

const FRAMEWORK_RULES = `
Universal: buy zones unlock at score >=65%; below 65% allocation haircut 0.5x.
Regular stocks: 60 items, sections/weights: Competitive moat 20, Profitability & returns 20, Balance sheet 12, Cash flow & capital allocation 12, Management & governance 8, Growth runway 8, Valuation 10, Risk & red flags 7, Technical analysis 3.
Thematic ETFs: 40 items, Theme integrity 35, Holdings valuation 20, Fund structure & cost 20, Performance & risk 15, Portfolio fit 10.
Fund managers / LICs: 40 items, Alpha generation 30, Manager quality & process 25, Structure & fees 25, Portfolio fit & governance 20.
Speculative stocks: 40 items, Thesis clarity & catalyst 30, Survivability & runway 25, Asymmetric payoff 25, Management & red flags 20.
Alternative investments / PE: 40 items, Access & structure 25, Manager & strategy 30, Deal quality & returns 25, Fees/transparency/red flags 20.
`

const RESPONSE_SCHEMA = `
Return JSON only:
{
 "framework_key": string,
 "overall_score_pct": number,
 "synopsis_one_liner": string,
 "section_scores": [{"section_id":string,"title":string,"weight_pct":number,"score_pct":number,"notes":string}],
 "items": [{"item_key":string,"section_id":string,"title":string,"stars_awarded":number,"stars_max":number,"score_pct":number,"rationale":string}],
 "buy_zones_native": [{"label":string,"floor_price_native":number,"rationale":string}],
 "exit_triggers": [{"label":string,"condition_native":string,"rationale":string}],
 "research_paper_outline": {"sections":[{"heading":string,"body_md":string}]}
}
`

function env(name: string) {
  return Deno.env.get(name)?.trim() ?? ''
}

function text(value: unknown) {
  return typeof value === 'string' && value.trim() ? value.trim() : ''
}

function marketCode(raw: unknown) {
  const obj = raw && typeof raw === 'object' ? raw as Record<string, unknown> : {}
  const inst = obj.instrument && typeof obj.instrument === 'object' ? obj.instrument as Record<string, unknown> : {}
  return text(obj.market_code ?? inst.market_code).toUpperCase()
}

function inferExchange(holding: Record<string, unknown>) {
  return marketCode(holding.raw) || 'UNKNOWN'
}

function inferYahoo(symbol: string, exchange: string) {
  if (exchange === 'ASX' && !/\.AX$/i.test(symbol)) return `${symbol}.AX`
  if (exchange === 'LSE' && !/\.L$/i.test(symbol)) return `${symbol}.L`
  return symbol
}

function frameworkKey(raw: unknown) {
  const s = text(raw).toLowerCase().replace(/-/g, '_').replace(/\s+/g, '_')
  if (s === 'regular_stock' || s === 'regular_stocks') return 'regular_stocks'
  if (s === 'thematic_etf' || s === 'thematic_etfs') return 'thematic_etfs'
  if (s === 'fund_manager_lic' || s === 'fund_manager_lics' || s === 'fund_managers_lic') return 'fund_managers_lic'
  if (s === 'speculative_stock' || s === 'speculative_stocks' || s === 'speculative') return 'speculative'
  if (s === 'alternative_pe' || s === 'alternative_investments_pe' || s === 'alternatives_pe') return 'alternatives_pe'
  return ''
}

function parseJson(textBody: string) {
  let body = textBody.trim()
  if (body.startsWith('```')) body = body.replace(/^```[a-zA-Z]*\n?/, '').replace(/```\s*$/, '')
  return JSON.parse(body)
}

function userSupabase(req: Request) {
  return createClient(env('SUPABASE_URL'), env('SUPABASE_ANON_KEY'), {
    global: { headers: { Authorization: req.headers.get('Authorization') ?? '' } },
    auth: { persistSession: false, autoRefreshToken: false },
  })
}

async function failJob(req: Request, jobId: string, error: unknown) {
  const supabase = userSupabase(req)
  await supabase
    .from('analysis_jobs')
    .update({
      status: 'failed',
      error: error instanceof Error ? error.message : String(error),
      updated_at: new Date().toISOString(),
    })
    .eq('id', jobId)
}

async function claudeSynthesis(geminiJson: Record<string, unknown>, meta: Record<string, unknown>) {
  const apiKey = env('ANTHROPIC_API_KEY') || env('ANTHROPIC_API_SECRET')
  if (!apiKey) throw new Error('ANTHROPIC_API_KEY missing')

  const model = env('CLAUDE_ANALYSIS_MODEL') || 'claude-sonnet-4-6'
  const fk = frameworkKey(geminiJson.recommended_framework) || 'regular_stocks'
  const prompt = [
    `Active framework_key: ${fk}.`,
    'Use Gemini JSON only as the research source. Score each section and create checklist items.',
    FRAMEWORK_RULES,
    RESPONSE_SCHEMA,
    `Gemini JSON:\n${JSON.stringify(geminiJson)}`,
    `Instrument meta:\n${JSON.stringify(meta)}`,
  ].join('\n\n')

  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model,
      max_tokens: 16000,
      messages: [{ role: 'user', content: prompt }],
    }),
  })

  if (!res.ok) throw new Error(`Claude failed (${res.status}): ${await res.text()}`)

  const json = await res.json()
  return parseJson(json.content?.filter((b: Record<string, unknown>) => b.type === 'text').map((b: Record<string, unknown>) => b.text).join('\n') ?? '')
}

async function runClaude(req: Request, jobId: string) {
  const supabase = userSupabase(req)
  const { data: userData, error: userError } = await supabase.auth.getUser()
  if (userError || !userData.user?.id) throw userError ?? new Error('unauthorized')

  const userId = userData.user.id
  const { data: settings } = await supabase.from('user_settings').select('global_api_pause').eq('user_id', userId).maybeSingle()
  if (settings?.global_api_pause === true) throw new Error('global_api_pause')

  const { data: job, error: jobError } = await supabase.from('analysis_jobs').select('*').eq('id', jobId).eq('user_id', userId).maybeSingle()
  if (jobError || !job) throw jobError ?? new Error('job_not_found')
  if (!job.raw_gemini_json) throw new Error('raw_gemini_json missing')

  const { data: holding, error: holdingError } = await supabase
    .from('sharesight_holdings')
    .select('*')
    .eq('user_id', userId)
    .eq('portfolio_role', 'satellite')
    .eq('holding_external_id', job.holding_id)
    .maybeSingle()

  if (holdingError || !holding) throw holdingError ?? new Error('holding_not_found')

  const ticker = text(holding.instrument_symbol).replace(/^ASX:/i, '') || text(job.holding_id)
  const exchange = inferExchange(holding)
  const company = text(holding.instrument_name) || ticker
  const geminiJson = job.raw_gemini_json as Record<string, unknown>
  const scorecard = await claudeSynthesis(geminiJson, {
    ticker,
    company,
    exchange,
    currency: holding.currency ?? null,
    yahoo_symbol: inferYahoo(ticker, exchange),
  })
  const overall = Number(scorecard.overall_score_pct)
  const buyZones = Array.isArray(scorecard.buy_zones_native) ? scorecard.buy_zones_native : []
  const exits = Array.isArray(scorecard.exit_triggers) ? scorecard.exit_triggers : []
  const paper = scorecard.research_paper_outline && typeof scorecard.research_paper_outline === 'object' ? scorecard.research_paper_outline : { sections: [] }

  const { data: existingPosition } = await supabase.from('positions').select('*').eq('user_id', userId).eq('sharesight_holding_key', job.holding_id).maybeSingle()
  let position = existingPosition

  if (!position) {
    const { data: insertedPosition, error: posError } = await supabase
      .from('positions')
      .insert({
        user_id: userId,
        kind: 'satellite',
        fmp_symbol: ticker,
        exchange_short_name: exchange,
        yahoo_symbol: inferYahoo(ticker, exchange),
        display_ticker: ticker,
        currency: holding.currency ?? 'AUD',
        name: company,
        sharesight_holding_key: job.holding_id,
        sharesight_portfolio_key: holding.portfolio_external_id ?? null,
        sharesight_payload: holding.raw ?? {},
        awaiting_analysis: true,
        buy_zones: [],
        exit_triggers: [],
        extra: {},
      })
      .select('*')
      .single()
    if (posError) throw posError
    position = insertedPosition
  }

  const { data: maxRow } = await supabase
    .from('scorecard_versions')
    .select('version_number')
    .eq('user_id', userId)
    .eq('position_id', position.id)
    .order('version_number', { ascending: false })
    .limit(1)
    .maybeSingle()
  const version = Number.isFinite(Number(maxRow?.version_number)) ? Number(maxRow.version_number) + 1 : 1

  const { data: sc, error: scError } = await supabase
    .from('scorecard_versions')
    .insert({
      user_id: userId,
      position_id: position.id,
      version_number: version,
      framework: frameworkKey(scorecard.framework_key) || frameworkKey(geminiJson.recommended_framework) || 'regular_stocks',
      overall_score: Number.isFinite(overall) ? overall : null,
      payload: scorecard,
      generated_at: new Date().toISOString(),
    })
    .select('id')
    .single()
  if (scError) throw scError

  await supabase.from('research_paper_versions').insert({
    user_id: userId,
    scorecard_version_id: sc.id,
    payload: paper,
    generated_at: new Date().toISOString(),
  })

  const extra = position.extra && typeof position.extra === 'object' ? position.extra : {}
  const nextExtra = {
    ...extra,
    scorecard,
    research_paper: {
      ...paper,
      generated_at: new Date().toISOString(),
      gemini_model: env('GEMINI_RESEARCH_MODEL') || 'gemini-2.5-flash',
      claude_model: env('CLAUDE_ANALYSIS_MODEL') || 'claude-sonnet-4-6',
    },
  }

  await supabase
    .from('positions')
    .update({
      awaiting_analysis: false,
      buy_zones: buyZones,
      exit_triggers: exits,
      extra: nextExtra,
      updated_at: new Date().toISOString(),
    })
    .eq('id', position.id)
    .eq('user_id', userId)

  const holdingExtra = holding.extra && typeof holding.extra === 'object' ? holding.extra : {}
  await supabase
    .from('sharesight_holdings')
    .update({
      extra: { ...holdingExtra, scorecard, research_paper: nextExtra.research_paper, buy_zones: buyZones, exit_triggers: exits },
    })
    .eq('id', holding.id)
    .eq('user_id', userId)

  await supabase
    .from('research_logs')
    .update({ claude_synthesis_status: 'success' })
    .eq('user_id', userId)
    .eq('ticker', ticker.toUpperCase())
    .eq('claude_synthesis_status', 'pending')

  await supabase
    .from('analysis_jobs')
    .update({
      status: 'complete',
      result: {
        scorecard_version_id: sc.id,
        version_number: version,
        position_id: position.id,
        overall_score: overall,
      },
      error: null,
      updated_at: new Date().toISOString(),
    })
    .eq('id', jobId)
    .eq('user_id', userId)
}

Deno.serve(async (req) => {
  try {
    const body = await req.json()
    const jobId = text(body.job_id)
    if (!jobId) return new Response(JSON.stringify({ ok: false, error: 'job_id required' }), { status: 400 })

    const task = runClaude(req, jobId).catch((error) => failJob(req, jobId, error))
    EdgeRuntime.waitUntil(task)

    return new Response(JSON.stringify({ ok: true, accepted: true }), {
      headers: { 'Content-Type': 'application/json' },
    })
  } catch (error) {
    return new Response(JSON.stringify({ ok: false, error: error instanceof Error ? error.message : String(error) }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    })
  }
})

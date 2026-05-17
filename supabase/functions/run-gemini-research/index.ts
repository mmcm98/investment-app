import { createClient } from 'npm:@supabase/supabase-js@2'

declare const EdgeRuntime: { waitUntil: (promise: Promise<unknown>) => void }

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

async function geminiResearch(input: { ticker: string; company: string; exchange: string }) {
  const apiKey = env('GEMINI_API_KEY') || env('GOOGLE_GEMINI_API_KEY')
  if (!apiKey) throw new Error('GEMINI_API_KEY missing')

  const model = env('GEMINI_RESEARCH_MODEL') || 'gemini-2.5-flash'
  const prompt = [
    'Research this listed security and return ONLY valid JSON. No markdown.',
    `ticker=${input.ticker}, company=${input.company}, exchange=${input.exchange}.`,
    'Schema: {"ticker":string,"company":string,"research_date":string,"thesis_summary":string,"competitive_moat":string,"financials_commentary":string,"key_risks":string[],"recent_developments":string,"management_quality":string,"growth_runway":string,"valuation_commentary":string,"technical_summary":string,"sentiment":"positive|neutral|negative","recommended_framework":"Regular Stock|Thematic ETF|Fund Manager / LIC|Speculative Stock|Alternative / PE"}',
  ].join('\n')

  const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [{ role: 'user', parts: [{ text: prompt }] }],
      generationConfig: { responseMimeType: 'application/json' },
    }),
  })

  if (!res.ok) throw new Error(`Gemini failed (${res.status}): ${await res.text()}`)

  const json = await res.json()
  return parseJson(json.candidates?.[0]?.content?.parts?.[0]?.text ?? '')
}

async function invokeClaude(req: Request, jobId: string) {
  const url = `${env('SUPABASE_URL').replace(/\/$/, '')}/functions/v1/run-claude-synthesis`
  const resp = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: req.headers.get('Authorization') ?? '',
    },
    body: JSON.stringify({ job_id: jobId }),
  })

  if (!resp.ok) throw new Error(`Claude dispatch failed (${resp.status}): ${await resp.text()}`)
}

async function runGemini(req: Request, jobId: string, holdingIdFromBody: string) {
  const supabase = userSupabase(req)
  const { data: userData, error: userError } = await supabase.auth.getUser()
  if (userError || !userData.user?.id) throw userError ?? new Error('unauthorized')

  const userId = userData.user.id
  const { data: settings } = await supabase.from('user_settings').select('global_api_pause').eq('user_id', userId).maybeSingle()
  if (settings?.global_api_pause === true) throw new Error('global_api_pause')

  const { data: job, error: jobError } = await supabase.from('analysis_jobs').select('*').eq('id', jobId).eq('user_id', userId).maybeSingle()
  if (jobError || !job) throw jobError ?? new Error('job_not_found')

  const holdingId = holdingIdFromBody || text(job.holding_id)
  const { data: holding, error: holdingError } = await supabase
    .from('sharesight_holdings')
    .select('*')
    .eq('user_id', userId)
    .eq('portfolio_role', 'satellite')
    .eq('holding_external_id', holdingId)
    .maybeSingle()

  if (holdingError || !holding) throw holdingError ?? new Error('holding_not_found')

  const ticker = text(holding.instrument_symbol).replace(/^ASX:/i, '') || holdingId
  const exchange = inferExchange(holding)
  const company = text(holding.instrument_name) || ticker
  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString()
  const { data: cachedLog } = await supabase
    .from('research_logs')
    .select('raw_gemini_json')
    .eq('user_id', userId)
    .eq('ticker', ticker.toUpperCase())
    .gte('timestamp', sevenDaysAgo)
    .order('timestamp', { ascending: false })
    .limit(1)
    .maybeSingle()

  let geminiJson = cachedLog?.raw_gemini_json

  if (!geminiJson) {
    geminiJson = await geminiResearch({ ticker, company, exchange })
    const { error: logError } = await supabase.from('research_logs').insert({
      user_id: userId,
      ticker: ticker.toUpperCase(),
      raw_gemini_json: geminiJson,
      claude_synthesis_status: 'pending',
    })
    if (logError) throw logError
  }

  const { error: updateError } = await supabase
    .from('analysis_jobs')
    .update({
      raw_gemini_json: geminiJson,
      status: 'gemini_complete',
      error: null,
      updated_at: new Date().toISOString(),
    })
    .eq('id', jobId)
    .eq('user_id', userId)

  if (updateError) throw updateError

  await invokeClaude(req, jobId)
}

Deno.serve(async (req) => {
  console.log('[run-gemini-research] env check:', {
    hasGeminiKey: !!Deno.env.get('GEMINI_API_KEY'),
    hasAnthropicKey: !!Deno.env.get('ANTHROPIC_API_KEY'),
    hasSupabaseUrl: !!Deno.env.get('SUPABASE_URL'),
    hasServiceKey: !!Deno.env.get('SUPABASE_SERVICE_ROLE_KEY'),
  })

  try {
    const body = await req.json()
    const jobId = text(body.job_id)
    const holdingId = text(body.holdingId)
    if (!jobId || !holdingId) {
      return new Response(JSON.stringify({ ok: false, error: 'job_id and holdingId required' }), { status: 400 })
    }

    const task = runGemini(req, jobId, holdingId).catch((error) => failJob(req, jobId, error))
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

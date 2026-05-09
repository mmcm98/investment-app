import { GoogleGenerativeAI } from '@google/generative-ai'

import { readAnalysisEnv } from './_lib/env.mjs'

import { createUserSupabase } from './_lib/supabaseUser.mjs'

import { assertGlobalApiNotPaused } from './_lib/globalApiPause.mjs'

function readNodeEnv() {
  return typeof process !== 'undefined' && process.env ? process.env : {}
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

  const watchlistItemId = typeof body.watchlistItemId === 'string' ? body.watchlistItemId.trim() : ''

  if (!watchlistItemId) return { ok: false, code: 'bad_request', message: 'watchlistItemId required' }

  await assertGlobalApiNotPaused(supabase, userId)

  const { data: row, error: wErr } = await supabase
    .from('watchlist_items')
    .select('*')
    .eq('id', watchlistItemId)
    .eq('user_id', userId)
    .eq('archived', false)
    .maybeSingle()

  if (wErr) throw wErr

  if (!row) return { ok: false, code: 'not_found', message: 'watchlist item missing' }

  if (!cfg.geminiApiKey) return { ok: false, code: 'missing_key', message: 'GEMINI_API_KEY' }

  const sym = `${row.fmp_symbol ?? ''}`.trim()

  const ex = `${row.exchange_short_name ?? ''}`.trim()

  const nm = `${row.name ?? ''}`.trim()

  const prompt = [
    `Search recent (~120 day) announcements and disclosures likely material for equity investors.`,
    `Symbol ${sym}, exchange ${ex}, company ${nm}.`,
    'Return JSON ONLY: {"items":[{"headline":string,"body":string|null,"published_at":string|null,"source":"web_search_estimate","price_sensitive":boolean|null}]}',
    'Max 10 items; no URLs required; summarize each headline in plain language.',
    'Mark source as "web_search_estimate" for every row.',
  ].join(' ')

  const genAi = new GoogleGenerativeAI(cfg.geminiApiKey)

  const model = genAi.getGenerativeModel({
    model: cfg.geminiFlashModel,
    generationConfig: { responseMimeType: 'application/json' },
  })

  const gRes = await model.generateContent(prompt)

  /** @type {unknown} */

  let parsed

  try {
    parsed = JSON.parse(gRes.response.text())
  } catch {
    return { ok: false, code: 'bad_payload', message: 'Gemini did not return valid JSON' }
  }

  const items = parsed && typeof parsed === 'object' && parsed !== null && Array.isArray(Reflect.get(parsed, 'items'))
    ? /** @type {unknown[]} */ (Reflect.get(parsed, 'items'))
    : []

  const nowIso = new Date().toISOString()

  /** @type {Record<string, unknown>[]} */

  const rows = []

  for (const it of items.slice(0, 10)) {
    if (!it || typeof it !== 'object') continue

    const o = /** @type {Record<string, unknown>} */ (it)

    const headlineRaw = Reflect.get(o, 'headline')

    const headline = typeof headlineRaw === 'string' && headlineRaw.trim() ? headlineRaw.trim() : ''

    if (!headline) continue

    const bodyTxt = Reflect.get(o, 'body')

    const published = Reflect.get(o, 'published_at')

    const ps = Reflect.get(o, 'price_sensitive')

    /** @type {string | null} */
    let pubIso = null

    if (typeof published === 'string' && published.trim()) {
      const d = new Date(published.trim())

      if (Number.isFinite(d.getTime())) pubIso = d.toISOString()
    }

    rows.push({
      user_id: userId,
      watchlist_item_id: watchlistItemId,
      fmp_symbol: sym,
      exchange_short_name: ex,
      display_ticker: row.display_ticker ?? sym,
      source: 'gemini_flash_estimate',
      source_url: null,
      headline,
      body: typeof bodyTxt === 'string' ? bodyTxt : null,
      published_at: pubIso,
      price_sensitive: typeof ps === 'boolean' ? ps : null,
      raw_payload: {
        gemini_flash: true,
        model: cfg.geminiFlashModel,
        fetched_at: nowIso,
      },
    })
  }

  if (rows.length > 0) {
    const { error: insErr } = await supabase.from('announcements').insert(rows)

    if (insErr) throw insErr
  }

  return { ok: true, inserted: rows.length }
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

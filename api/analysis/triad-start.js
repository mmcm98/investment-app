import { readAnalysisEnv } from './_lib/env.mjs'
import { createUserSupabase } from './_lib/supabaseUser.mjs'

function readNodeEnv() {
  return typeof process !== 'undefined' && process.env ? process.env : {}
}

/** @param {import('http').IncomingMessage} req */
async function readJson(req) {
  const chunks = []
  for await (const chunk of req) chunks.push(chunk)
  const raw = Buffer.concat(chunks).toString('utf8')
  return raw.trim() ? JSON.parse(raw) : {}
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

  try {
    const cfg = readAnalysisEnv(env)
    const ctx = createUserSupabase(cfg.supabaseUrl, cfg.supabaseAnonKey, typeof req.headers.authorization === 'string' ? req.headers.authorization : '')

    if (ctx.error) {
      res.statusCode = 401
      res.setHeader('Content-Type', 'application/json')
      res.end(JSON.stringify({ ok: false, code: ctx.error }))
      return
    }

    const { data: ud, error: userErr } = await ctx.supabase.auth.getUser()
    if (userErr || !ud?.user?.id) throw userErr ?? new Error('unauthorized')

    const body = await readJson(req)
    const holdingId = `${body.holdingId ?? ''}`.trim()
    if (!holdingId) throw new Error('holdingId required')

    const { data: job, error: jobErr } = await ctx.supabase
      .from('analysis_jobs')
      .insert({
        user_id: ud.user.id,
        holding_id: holdingId,
        status: 'pending',
      })
      .select('id')
      .single()

    if (jobErr) throw jobErr

    const edgeUrl = `${cfg.supabaseUrl.replace(/\/$/, '')}/functions/v1/run-gemini-research`
    const edgeResp = await fetch(edgeUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${ctx.accessToken}`,
      },
      body: JSON.stringify({ job_id: job.id, holdingId }),
    })

    if (!edgeResp.ok) {
      await ctx.supabase
        .from('analysis_jobs')
        .update({ status: 'failed', error: `Edge dispatch failed (${edgeResp.status})`, updated_at: new Date().toISOString() })
        .eq('id', job.id)
      throw new Error(`Edge dispatch failed (${edgeResp.status})`)
    }

    res.statusCode = 200
    res.setHeader('Content-Type', 'application/json')
    res.end(JSON.stringify({ ok: true, job_id: job.id }))
  } catch (error) {
    res.statusCode = 500
    res.setHeader('Content-Type', 'application/json')
    res.end(JSON.stringify({ ok: false, error: error instanceof Error ? error.message : String(error) }))
  }
}

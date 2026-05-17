import { readAnalysisEnv } from './_lib/env.mjs'
import { createUserSupabase } from './_lib/supabaseUser.mjs'

function readNodeEnv() {
  return typeof process !== 'undefined' && process.env ? process.env : {}
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

  if (req.method !== 'GET') {
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

    const url = new URL(req.url ?? '', 'http://localhost')
    const jobId = `${url.searchParams.get('job_id') ?? ''}`.trim()
    if (!jobId) throw new Error('job_id required')

    const { data, error } = await ctx.supabase
      .from('analysis_jobs')
      .select('id, status, result, error, created_at, updated_at')
      .eq('id', jobId)
      .maybeSingle()

    if (error) throw error
    if (!data) {
      res.statusCode = 404
      res.setHeader('Content-Type', 'application/json')
      res.end(JSON.stringify({ ok: false, error: 'job_not_found' }))
      return
    }

    res.statusCode = 200
    res.setHeader('Content-Type', 'application/json')
    res.end(JSON.stringify({ ok: true, job: data }))
  } catch (error) {
    res.statusCode = 500
    res.setHeader('Content-Type', 'application/json')
    res.end(JSON.stringify({ ok: false, error: error instanceof Error ? error.message : String(error) }))
  }
}

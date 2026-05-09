import { randomUUID } from 'node:crypto'

import { dispatchMarketRpc, summarizeMarketEnvForLogs } from './_lib/handlers.mjs'

/**
 * POST body JSON: `{ op: 'quotes'|'fx'|'ath'|'tickerSearch'|'chartHistory', … }`
 * Env:
 * - **Server (Vercel / Node):** `FMP_API_KEY` (recommended) or legacy `VITE_FMP_*` mirrored into the function runtime.
 * - Optional `MARKET_API_SECRET` — client must send matching `x-market-secret`.
 *
 * See `server/dev-market-api.mjs` for local development (same dispatcher).
 */

function readEnv() {
  return typeof process !== 'undefined' && process.env ? process.env : {}
}

/**
 * Legacy Vercel Node-style handler (readable stream req).
 *
 * @param {import('http').IncomingMessage} req

 * @param {import('http').ServerResponse} res
 */

export default async function handler(req, res) {
  const env = readEnv()

  const secret = `${env.MARKET_API_SECRET ?? ''}`.trim()

  const incomingSecret = `${req.headers['x-market-secret'] ?? req.headers['X-Market-Secret'] ?? ''}`

  if (secret && incomingSecret.trim() !== secret) {
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

  const rawBody = Buffer.concat(chunks).toString('utf8')

  /** @type {Record<string, unknown>} */
  let parsed

  try {
    parsed = rawBody.trim() ? /** @type {Record<string, unknown>} */ (JSON.parse(rawBody)) : {}
  } catch {
    res.statusCode = 400
    res.setHeader('Content-Type', 'application/json')
    res.end(JSON.stringify({ ok: false, error: 'invalid_json' }))

    return
  }

  const reqId = randomUUID()

  const opRaw = parsed && typeof parsed.op === 'string' ? `${parsed.op}`.trim() : ''

  console.info('[market/batch]', { reqId, op: opRaw || 'missing_op', diag: summarizeMarketEnvForLogs(env) })

  const started = typeof performance !== 'undefined' ? performance.now() : Date.now()

  try {
    const out = await dispatchMarketRpc(parsed ?? {}, env)

    const elapsed =
      (typeof performance !== 'undefined' ? performance.now() : Date.now()) - started

    console.info('[market/batch]', {
      reqId,
      op: opRaw || 'missing_op',
      ok: Reflect.get(out, 'ok') === true ? true : Reflect.get(out, 'ok'),
      ms: Math.round(elapsed),
    })

    res.statusCode = 200
    res.setHeader('Content-Type', 'application/json')

    res.end(JSON.stringify(out))
  } catch (e) {
    console.error('[market/batch]', {
      reqId,
      op: opRaw || 'missing_op',
      err: `${e}`,

      stack: e instanceof Error ? e.stack : undefined,
    })

    res.statusCode = 500
    res.setHeader('Content-Type', 'application/json')
    res.end(JSON.stringify({ ok: false, error: `${e}` }))
  }
}

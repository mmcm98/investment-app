import { dispatchMarketRpc } from './_lib/handlers.mjs'

/**
 * POST body JSON: `{ op: 'quotes'|'fx'|'ath'|'tickerSearch'|'chartHistory', … }`
 * Env: optional `MARKET_API_SECRET` — optional `x-market-secret` header must match.
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

  try {
    const out = await dispatchMarketRpc(parsed ?? {}, env)

    res.statusCode = 200
    res.setHeader('Content-Type', 'application/json')

    res.end(JSON.stringify(out))
  } catch (e) {
    res.statusCode = 500
    res.setHeader('Content-Type', 'application/json')
    res.end(JSON.stringify({ ok: false, error: `${e}` }))
  }
}

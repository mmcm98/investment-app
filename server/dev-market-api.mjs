/**
 * Dev-only sibling to `api/market/batch.js` — runs yahoo-finance2 + FMP fallback on localhost.
 *
 * Run `npm run dev:market-api` before Vite dev; vite proxies `/api/market/batch` → `/market/batch`.
 */
import http from 'node:http'
import { dispatchMarketRpc } from '../api/market/_lib/handlers.mjs'

const PORT = Number.parseInt(`${process.env.MARKET_DEV_PORT ?? '8790'}`, 10)

async function readBody(req) {
  const chunks = []

  for await (const chunk of req) chunks.push(chunk)

  return Buffer.concat(chunks).toString('utf8')
}

const server = http.createServer(async (req, res) => {
  if (req.method === 'OPTIONS') {
    res.writeHead(204)
    res.end()

    return
  }

  if (req.url !== '/market/batch' && req.url !== '/market/batch/') {
    res.statusCode = 404
    res.setHeader('Content-Type', 'text/plain')
    res.end('Not found')

    return
  }

  if (req.method !== 'POST') {
    res.statusCode = 405
    res.setHeader('Content-Type', 'application/json')
    res.end(JSON.stringify({ ok: false, error: 'method_not_allowed' }))

    return
  }

  const secret = `${process.env.MARKET_API_SECRET ?? ''}`.trim()
  const headerSecretRaw = Reflect.get(req.headers, 'x-market-secret')
  const headerSecret = `${typeof headerSecretRaw === 'string' ? headerSecretRaw : ''}`.trim()

  if (secret && headerSecret !== secret) {
    res.statusCode = 403
    res.setHeader('Content-Type', 'application/json')
    res.end(JSON.stringify({ ok: false, error: 'forbidden' }))

    return
  }

  const rawText = await readBody(req)

  let body

  try {
    body = rawText.trim() ? JSON.parse(rawText) : {}
  } catch {
    res.statusCode = 400
    res.setHeader('Content-Type', 'application/json')
    res.end(JSON.stringify({ ok: false, error: 'invalid_json' }))

    return
  }

  try {
    const out = await dispatchMarketRpc(/** @type {Record<string, unknown>} */ (body ?? {}), process.env)

    res.statusCode = 200
    res.setHeader('Content-Type', 'application/json')
    res.end(JSON.stringify(out))
  } catch (e) {
    res.statusCode = 500
    res.setHeader('Content-Type', 'application/json')
    res.end(JSON.stringify({ ok: false, error: `${e}` }))
  }
})

server.listen(PORT, '127.0.0.1', () => {
  console.warn(`[dev-market-api] POST http://127.0.0.1:${PORT}/market/batch`)
})

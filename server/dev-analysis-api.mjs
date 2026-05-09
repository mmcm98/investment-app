/**
 * Dev sibling to `api/analysis/triad.js` — exposes the triad handler on localhost.
 *
 * Run `npm run dev:analysis-api` before Vite dev; vite proxies `/api/analysis/triad` → `/analysis/triad`.
 */
import http from 'node:http'
import handler from '../api/analysis/triad.js'

const PORT = Number.parseInt(`${process.env.ANALYSIS_DEV_PORT ?? '8791'}`, 10)

const server = http.createServer(async (req, res) => {
  if (req.method === 'OPTIONS') {
    res.writeHead(204)

    res.end()

    return
  }

  if (!req.url || !req.url.startsWith('/analysis/triad')) {
    res.statusCode = 404
    res.setHeader('Content-Type', 'text/plain')
    res.end('Not found')

    return
  }

  /** @type {import('node:http').IncomingMessage} */
  const nodeReq = req

  await handler(nodeReq, res)
})

server.listen(PORT, '127.0.0.1', () => {
  console.warn(`[dev-analysis-api] POST http://127.0.0.1:${PORT}/analysis/triad`)
})

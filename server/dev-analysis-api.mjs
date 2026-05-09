/**
 * Dev sibling to `api/analysis/triad.js` — exposes the triad handler on localhost.
 *
 * Run `npm run dev:analysis-api` before Vite dev; vite proxies `/api/analysis/triad` → `/analysis/triad`.
 */
import http from 'node:http'
import triadHandler from '../api/analysis/triad.js'
import watchlistFlashHandler from '../api/analysis/watchlistFlash.js'

const PORT = Number.parseInt(`${process.env.ANALYSIS_DEV_PORT ?? '8791'}`, 10)

const server = http.createServer(async (req, res) => {
  if (req.method === 'OPTIONS') {
    res.writeHead(204)

    res.end()

    return
  }

  const url = `${req.url ?? ''}`

  if (url.startsWith('/analysis/triad')) {
    await triadHandler(req, res)

    return
  }

  if (url.startsWith('/analysis/watchlist-flash')) {
    await watchlistFlashHandler(req, res)

    return
  }

  res.statusCode = 404
  res.setHeader('Content-Type', 'text/plain')
  res.end('Not found')
})

server.listen(PORT, '127.0.0.1', () => {
  console.warn(
    `[dev-analysis-api] triad POST http://127.0.0.1:${PORT}/analysis/triad · flash POST http://127.0.0.1:${PORT}/analysis/watchlist-flash`,
  )
})

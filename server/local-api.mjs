/**
 * Local API proxy — mirrors Vercel `/api/*` routes on port 3001.
 * Started via `npm run dev:server`; Vite proxies `/api/*` here.
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import express from 'express'
import triadHandler from '../api/analysis/triad.js'
import watchlistFlashHandler from '../api/analysis/watchlistFlash.js'
import portfolioBriefingHandler from '../api/analysis/portfolio-briefing.js'
import marketBatchHandler from '../api/market/batch.js'

const PORT = Number.parseInt(`${process.env.LOCAL_API_PORT ?? '3001'}`, 10)

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const rootDir = path.resolve(__dirname, '..')

/** @param {string} filePath */
function loadEnvFile(filePath) {
  if (!fs.existsSync(filePath)) return
  const text = fs.readFileSync(filePath, 'utf8')
  for (const line of text.split('\n')) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) continue
    const eq = trimmed.indexOf('=')
    if (eq <= 0) continue
    const key = trimmed.slice(0, eq).trim()
    let val = trimmed.slice(eq + 1).trim()
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1)
    }
    if (!(key in process.env) || `${process.env[key] ?? ''}`.trim() === '') {
      process.env[key] = val
    }
  }
}

loadEnvFile(path.join(rootDir, '.env'))
loadEnvFile(path.join(rootDir, '.env.local'))

/** @param {string} target @param {string[]} fallbacks */
function firstEnv(target, fallbacks) {
  for (const key of fallbacks) {
    const v = `${process.env[key] ?? ''}`.trim()
    if (v) {
      if (!process.env[target]) process.env[target] = v
      return v
    }
  }
  return ''
}

function bootstrapEnv() {
  firstEnv('ANTHROPIC_API_KEY', ['ANTHROPIC_API_KEY', 'ANTHROPIC_API_SECRET', 'VITE_ANTHROPIC_API_KEY'])
  firstEnv('GEMINI_API_KEY', ['GEMINI_API_KEY', 'GOOGLE_GEMINI_API_KEY', 'VITE_GEMINI_API_KEY'])
  firstEnv('FMP_API_KEY', ['FMP_API_KEY', 'VITE_FMP_API_KEY', 'VITE_FMP'])
  firstEnv('SUPABASE_URL', ['SUPABASE_URL', 'VITE_SUPABASE_URL'])
  firstEnv('SUPABASE_ANON_KEY', ['SUPABASE_ANON_KEY', 'VITE_SUPABASE_ANON_KEY'])
  firstEnv('SHARESIGHT_CLIENT_ID', ['SHARESIGHT_CLIENT_ID', 'VITE_SHARESIGHT_CLIENT_ID_DEV', 'VITE_SHARESIGHT_CLIENT_ID_PROD'])
  firstEnv('SHARESIGHT_CLIENT_SECRET', [
    'SHARESIGHT_CLIENT_SECRET',
    'VITE_SHARESIGHT_CLIENT_SECRET_DEV',
    'VITE_SHARESIGHT_CLIENT_SECRET_PROD',
  ])
}

bootstrapEnv()

const app = express()

app.use((req, res, next) => {
  req.setTimeout(0)
  res.setTimeout(0)
  next()
})

app.use('/api', (req, res, next) => {
  if (req.method === 'OPTIONS') {
    res.sendStatus(204)
    return
  }
  next()
})

/**
 * @param {(req: import('http').IncomingMessage, res: import('http').ServerResponse) => Promise<void>|void} handler
 */
function wrapNodeHandler(handler) {
  return (req, res) => {
    Promise.resolve(handler(req, res)).catch((err) => {
      if (!res.headersSent) {
        res.status(500).json({ ok: false, error: err?.message ?? String(err) })
      }
    })
  }
}

app.post('/api/anthropic-proxy', express.json({ limit: '10mb' }), async (req, res) => {
  const apiKey =
    `${process.env.ANTHROPIC_API_KEY ?? ''}`.trim() ||
    `${process.env.ANTHROPIC_API_SECRET ?? ''}`.trim() ||
    `${process.env.VITE_ANTHROPIC_API_KEY ?? ''}`.trim()

  if (!apiKey) {
    res.status(500).json({ error: 'ANTHROPIC_API_KEY missing' })
    return
  }

  try {
    const upstream = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json',
      },
      body: JSON.stringify(req.body),
    })

    res.status(upstream.status)
    res.setHeader('Content-Type', upstream.headers.get('content-type') || 'application/json')
    res.setHeader('Cache-Control', 'no-cache')
    res.flushHeaders()

    if (upstream.body) {
      const reader = upstream.body.getReader()
      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        res.write(value)
      }
    }
    res.end()
  } catch (err) {
    if (!res.headersSent) {
      res.status(500).json({ error: err?.message ?? String(err) })
    }
  }
})

app.post('/api/analysis/triad', wrapNodeHandler(triadHandler))
app.post('/api/analysis/watchlist-flash', wrapNodeHandler(watchlistFlashHandler))
app.post('/api/analysis/portfolio-briefing', wrapNodeHandler(portfolioBriefingHandler))
app.post('/api/market/batch', wrapNodeHandler(marketBatchHandler))

app.use('/api', (_req, res) => {
  res.status(404).json({ ok: false, error: 'not_found' })
})

const server = app.listen(PORT, '127.0.0.1', () => {
  console.log(`Local API server on http://localhost:${PORT}`)
  console.log('  POST /api/anthropic-proxy')
  console.log('  POST /api/analysis/triad')
  console.log('  POST /api/analysis/watchlist-flash')
  console.log('  POST /api/analysis/portfolio-briefing')
  console.log('  POST /api/market/batch')
})

server.setTimeout(0)
if ('requestTimeout' in server) server.requestTimeout = 0
if ('headersTimeout' in server) server.headersTimeout = 0

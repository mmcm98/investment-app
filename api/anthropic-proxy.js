export const config = {
  maxDuration: 300,
}

function readNodeEnv() {
  return typeof process !== 'undefined' && process.env ? process.env : {}
}

/** @param {import('http').IncomingMessage} req */
async function readJsonBody(req) {
  const chunks = []
  for await (const chunk of req) chunks.push(chunk)
  const raw = Buffer.concat(chunks).toString('utf8')
  return raw.trim() ? JSON.parse(raw) : {}
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.statusCode = 405
    res.end()
    return
  }

  const env = readNodeEnv()
  const apiKey = `${env.ANTHROPIC_API_KEY ?? ''}`.trim() || `${env.ANTHROPIC_API_SECRET ?? ''}`.trim()
  if (!apiKey) {
    res.statusCode = 500
    res.setHeader('Content-Type', 'application/json')
    res.end(JSON.stringify({ error: 'ANTHROPIC_API_KEY missing on server' }))
    return
  }

  try {
    const body = await readJsonBody(req)
    const r = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json',
      },
      body: JSON.stringify(body),
    })

    const text = await r.text()
    res.statusCode = r.status
    res.setHeader('Content-Type', 'application/json')
    res.end(text)
  } catch (error) {
    res.statusCode = 500
    res.setHeader('Content-Type', 'application/json')
    res.end(JSON.stringify({ error: error instanceof Error ? error.message : String(error) }))
  }
}

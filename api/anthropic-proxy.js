export const config = {
  maxDuration: 300,
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.statusCode = 405
    res.end()
    return
  }

  const env = process.env
  const apiKey = (env.ANTHROPIC_API_KEY ?? '').trim() || (env.ANTHROPIC_API_SECRET ?? '').trim()
  if (!apiKey) {
    res.statusCode = 500
    res.end(JSON.stringify({ error: 'ANTHROPIC_API_KEY missing' }))
    return
  }

  try {
    const chunks = []
    for await (const chunk of req) chunks.push(chunk)
    const body = JSON.parse(Buffer.concat(chunks).toString('utf8'))

    const r = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json',
      },
      body: JSON.stringify(body),
    })

    res.statusCode = r.status
    res.setHeader('Content-Type', r.headers.get('content-type') || 'application/json')

    if (r.body) {
      const reader = r.body.getReader()
      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        res.write(value)
      }
    }
    res.end()
  } catch (error) {
    res.statusCode = 500
    res.end(JSON.stringify({ error: error?.message || String(error) }))
  }
}

export const config = {
  runtime: 'edge',
  maxDuration: 300,
}

export default async function handler(req) {
  if (req.method !== 'POST') {
    return new Response(null, { status: 405 })
  }

  const apiKey = (process.env.ANTHROPIC_API_KEY ?? '').trim() || (process.env.ANTHROPIC_API_SECRET ?? '').trim()
  if (!apiKey) {
    return new Response(JSON.stringify({ error: 'ANTHROPIC_API_KEY missing' }), {
      status: 500,
      headers: { 'content-type': 'application/json' },
    })
  }

  try {
    const body = await req.json()

    const upstream = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json',
      },
      body: JSON.stringify(body),
    })

    return new Response(upstream.body, {
      status: upstream.status,
      headers: {
        'content-type': upstream.headers.get('content-type') || 'application/json',
        'cache-control': 'no-cache, no-transform',
      },
    })
  } catch (error) {
    return new Response(JSON.stringify({ error: error?.message || String(error) }), {
      status: 500,
      headers: { 'content-type': 'application/json' },
    })
  }
}

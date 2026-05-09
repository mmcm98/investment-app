/** @typedef {{ step: string, positionId: string }} TriadSuggestBody */
/** @typedef {TriadSuggestBody & { confirmedFrameworkKey: string, forceRefreshGemini?: boolean }} TriadRunBody */

/**
 * @param {TriadSuggestBody | TriadRunBody} body
 * @param {{ accessToken: string }} session
 */
export async function postTriadAnalysis(body, session) {
  const secret = `${import.meta.env.VITE_ANALYSIS_API_SECRET ?? ''}`.trim()

  /** @type {Record<string, string>} */
  const headers = {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${session.accessToken}`,
  }

  if (secret) headers['x-analysis-secret'] = secret

  const res = await fetch('/api/analysis/triad', {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  })

  const text = await res.text()

  /** @type {unknown} */
  let json

  try {
    json = text.trim() ? JSON.parse(text) : null
  } catch {
    throw new Error(`Triad API returned non-JSON (${res.status})`)
  }

  if (!res.ok) {
    const msg =
      json && typeof json === 'object' && json !== null && 'message' in json
        ? String(Reflect.get(json, 'message'))
        : `HTTP ${res.status}`

    const err = new Error(msg)

    if (json && typeof json === 'object' && json !== null && 'code' in json) {
      Reflect.set(err, 'code', Reflect.get(json, 'code'))
    }

    throw err
  }

  return json
}

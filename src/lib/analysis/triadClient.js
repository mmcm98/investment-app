/**
 * Exactly one parent id (`positionId`, `watchlistItemId`, or `holdingId`).
 *
 * @typedef {{ step: string, positionId?: string, watchlistItemId?: string, holdingId?: string }} TriadSuggestBody
 * @typedef {TriadSuggestBody & { confirmedFrameworkKey: string, forceRefreshGemini?: boolean }} TriadRunBody
 */

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

/**
 * @param {{ holdingId: string }} body
 * @param {{ accessToken: string }} session
 */
export async function startTriadAnalysis(body, session) {
  const data = await requestTriadJson('/api/analysis/triad-start', {
    method: 'POST',
    body,
    accessToken: session.accessToken,
  })
  return { ok: true, job_id: data && typeof data === 'object' ? Reflect.get(data, 'job_id') : undefined }
}

/**
 * @param {string} jobId
 * @param {{ accessToken: string }} session
 */
export async function getTriadAnalysisJob(jobId, session) {
  const status = await requestTriadJson(`/api/analysis/triad-status?job_id=${encodeURIComponent(jobId)}`, {
    method: 'GET',
    accessToken: session.accessToken,
  })
  console.log('[triad-status] result:', JSON.stringify(status))
  return status
}

/**
 * @param {string} path
 * @param {{ method: 'GET'|'POST', accessToken: string, body?: unknown }} opts
 */
async function requestTriadJson(path, opts) {
  const secret = `${import.meta.env.VITE_ANALYSIS_API_SECRET ?? ''}`.trim()

  /** @type {Record<string, string>} */
  const headers = {
    Authorization: `Bearer ${opts.accessToken}`,
  }

  if (opts.body !== undefined) headers['Content-Type'] = 'application/json'
  if (secret) headers['x-analysis-secret'] = secret

  const res = await fetch(path, {
    method: opts.method,
    headers,
    body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
  })
  const text = await res.text()

  if (path === '/api/analysis/triad-start') {
    console.log('[triad-start] status:', res.status)
    console.log('[triad-start] raw response:', text)
  }

  /** @type {unknown} */
  let json

  try {
    json = text.trim() ? JSON.parse(text) : null
  } catch {
    throw new Error(`Triad API returned non-JSON (${res.status})`)
  }

  if (!res.ok) {
    const msg =
      json && typeof json === 'object' && json !== null && 'error' in json
        ? String(Reflect.get(json, 'error'))
        : `HTTP ${res.status}`

    throw new Error(msg)
  }

  return json
}

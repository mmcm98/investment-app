export function canonicalSymbolKey(ex, sym) {
  return `${String(ex ?? '').trim().toUpperCase()}:${String(sym ?? '').trim().toUpperCase()}`
}

/** @param {unknown} row */
export function geminiPayloadFromRow(row) {
  if (!row || typeof row !== 'object') return null
  const o = /** @type {Record<string, unknown>} */ (row)
  const p = o.payload
  if (p && typeof p === 'object') return /** @type {Record<string, unknown>} */ (p)
  return o
}

/** @param {unknown} msg */

export function extractAnthropicText(msg) {
  if (!msg || typeof msg !== 'object') return ''

  const content = Reflect.get(/** @type {Record<string, unknown>} */ (msg), 'content')

  if (!Array.isArray(content)) return ''

  return content
    .map((b) => {
      if (!b || typeof b !== 'object') return ''
      const bb = /** @type {Record<string, unknown>} */ (b)

      if (bb.type === 'text' && typeof bb.text === 'string') return bb.text

      return ''
    })
    .join('\n')
    .trim()
}

/** @param {string} text */

export function parseJsonFromModel(text) {
  let t = String(text || '').trim()

  if (t.startsWith('```')) {
    t = t.replace(/^```[a-zA-Z]*\n?/, '').replace(/```\s*$/, '')
  }

  return /** @type {Record<string, unknown>} */ (JSON.parse(t))
}

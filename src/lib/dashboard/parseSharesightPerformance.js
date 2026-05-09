/** @typedef {{ isoDate: string, value: number }} PerfPoint */

const DATE_KEYS = /^(date|trade_date|end_date|valuation_date|reporting_date)$/i

const VALUE_KEYS = /^(portfolio_value|value|valuation|closing_value|balance|performance|capital_gain|opening_value)$/i

/**
 * Pull the best numeric field from one object (prefer valuation-like columns).
 *
 * @param {Record<string, unknown>} obj
 */
function pickValueFromRecord(obj) {
  /** @type {number|null} */
  let fallbackNum = null

  const keys = Object.keys(obj)

  for (const k of keys) {
    if (DATE_KEYS.test(k)) continue

    const v = Reflect.get(obj, k)

    const num =
      typeof v === 'number' && Number.isFinite(v)
        ? v
        : typeof v === 'string'
          ? Number.parseFloat(v)
          : Number.NaN

    if (!Number.isFinite(num)) continue

    if (VALUE_KEYS.test(k)) return num

    if (fallbackNum == null) fallbackNum = num
  }

  return fallbackNum
}

/** @param {unknown} raw */
export function coerceIsoDay(raw) {
  if (!raw && raw !== 0) return null

  if (typeof raw === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(raw.trim())) return raw.trim()

  const d =
    raw instanceof Date ? raw : typeof raw === 'number' ? new Date(raw * (raw > 1e12 ? 1 : 1000)) : new Date(`${raw}`)

  if (!(d instanceof Date) || !Number.isFinite(d.getTime())) return null

  return d.toISOString().slice(0, 10)
}

/** @param {unknown} candidate */
export function coercePointArray(candidate) {
  if (!Array.isArray(candidate) || candidate.length < 3) return null

  /** @type {PerfPoint[]} */
  const out = []

  for (const row of candidate) {
    if (!row || typeof row !== 'object') continue

    const o = /** @type {Record<string, unknown>} */ (row)

    /** @type {string|null} */
    let iso = null

    for (const k of Object.keys(o)) {
      if (!DATE_KEYS.test(k)) continue

      iso = coerceIsoDay(o[k])

      if (iso) break
    }

    if (!iso) continue

    const val = pickValueFromRecord(o)

    if (val == null || !Number.isFinite(val)) continue

    out.push({ isoDate: iso, value: val })
  }

  out.sort((a, b) => (a.isoDate < b.isoDate ? -1 : 1))

  return out.length >= 3 ? out : null
}

/**
 * Recursive walk attempting to locate the largest plausible time series.
 *
 * @param {unknown} payload Sharesight portfolio performance payload (opaque).
 */
export function extractSharesightValueSeries(payload) {
  /** @type {PerfPoint[] | null} */
  let best = null

  /**
   * @param {unknown} node
   * @param {number} depth
   */
  function walk(node, depth) {
    if (!node || typeof node !== 'object' || depth > 12) return

    // Direct array blob
    if (Array.isArray(node)) {
      const asPoints = coercePointArray(node)

      if (asPoints && (!best || asPoints.length > best.length)) best = asPoints

      for (const it of node) walk(it, depth + 1)

      return
    }

    /** @type {Record<string, unknown>} */
    const o = /** @type {Record<string, unknown>} */ (node)

    for (const v of Object.values(o)) walk(v, depth + 1)

    return
  }

  walk(payload, 0)

  return best
}

/**
 * Forward-fill Sharesight-derived series to aligned dates (constant carry).
 *
 * @param {PerfPoint[]|null|undefined} series
 * @param {string[]} datesSorted
 */

export function alignSeries(series, datesSorted) {
  /** @type {Record<string, number>} */
  const out = {}

  if (!series || series.length === 0) return out

  const sorted = [...series].sort((x, y) => (x.isoDate < y.isoDate ? -1 : 1))

  let cursor = sorted[0].value ?? 0
  let j = 0

  for (const day of datesSorted) {
    while (j < sorted.length && sorted[j].isoDate <= day) {
      cursor = sorted[j].value

      j += 1
    }

    out[day] = cursor
  }

  return out
}

/**
 * @param {PerfPoint[]|null} a
 * @param {PerfPoint[]|null} b
 */
export function mergeSeriesSum(a, b) {
  /** @type {Record<string, number>} */
  const sums = {}

  for (const s of [a, b]) {
    if (!s) continue

    for (const p of s) {
      sums[p.isoDate] = (sums[p.isoDate] ?? 0) + p.value
    }
  }

  const keys = Object.keys(sums).sort()

  return keys.map((isoDate) => ({ isoDate, value: sums[isoDate] }))
}


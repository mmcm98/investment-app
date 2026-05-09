/** @typedef {import('./defaultTierSchedules.js').DcaTierBand} DcaTierBand */

/**
 * Non‑negative % below ATH: ((ATH − price) / ATH) × 100.
 *
 * @param {number | null | undefined} price
 * @param {number | null | undefined} ath
 */
export function distanceFromAthPercent(price, ath) {
  const p = typeof price === 'number' && Number.isFinite(price) ? price : NaN
  const a = typeof ath === 'number' && Number.isFinite(ath) ? ath : NaN
  if (!Number.isFinite(p) || !Number.isFinite(a) || a <= 0 || p <= 0) return null
  return Math.max(0, ((a - p) / a) * 100)
}

/**
 * Validates tier bands from DB. Last row must use `maxPct: null` (open tail).
 *
 * @param {unknown} raw
 * @returns {DcaTierBand[] | null}
 */
export function parseTierBands(raw) {
  if (!Array.isArray(raw) || raw.length === 0) return null

  /** @type {DcaTierBand[]} */
  const out = []

  for (const row of raw) {
    if (!row || typeof row !== 'object') return null
    const o = /** @type {Record<string, unknown>} */ (row)
    const maxPctRaw = Reflect.get(o, 'maxPct')
    const multRaw = Reflect.get(o, 'multiplier')
    const maxPct =
      maxPctRaw === null ? null : typeof maxPctRaw === 'number' && Number.isFinite(maxPctRaw) ? maxPctRaw : NaN
    const multiplier = typeof multRaw === 'number' && Number.isFinite(multRaw) ? multRaw : NaN
    if ((maxPct !== null && !Number.isFinite(maxPct)) || !Number.isFinite(multiplier)) return null
    out.push({ maxPct, multiplier })
  }

  if (out[out.length - 1]?.maxPct !== null) return null

  let sawNull = false
  for (const band of out) {
    if (band.maxPct === null) sawNull = true
    else if (sawNull) return null
  }

  const finite = out.map((b) => b.maxPct).filter((m) => m !== null)
  for (let i = 1; i < finite.length; i += 1) {
    const a = finite[i - 1]
    const b = finite[i]
    if (typeof a !== 'number' || typeof b !== 'number' || b <= a) return null
  }

  return out
}

/**
 * @param {number | null} distancePct
 * @param {DcaTierBand[]} bands
 */
export function matchTier(distancePct, bands) {
  const empty = {
    multiplier: null,
    bandLabel: '—',
    multLabel: '—',
    bandMinPct: null,
    bandMaxPct: null,
  }

  if (distancePct == null || !Number.isFinite(distancePct)) return empty
  if (!bands.length) return empty

  let prevExclusive = 0

  for (const band of bands) {
    const cap = band.maxPct
    const mult = band.multiplier

    if (cap === null) {
      return {
        multiplier: mult,
        bandMinPct: prevExclusive,
        bandMaxPct: null,
        bandLabel: `>${truncateSmart(prevExclusive)}% below ATH`,
        multLabel: `${fmtMult(mult)}×`,
      }
    }

    if (distancePct <= cap) {
      return {
        multiplier: mult,
        bandMinPct: prevExclusive,
        bandMaxPct: cap,
        bandLabel: bandRangeLabel(prevExclusive, cap),
        multLabel: `${fmtMult(mult)}×`,
      }
    }

    prevExclusive = cap
  }

  const last = bands[bands.length - 1]
  return {
    multiplier: last.multiplier,
    bandMinPct: prevExclusive,
    bandMaxPct: null,
    bandLabel: `>${truncateSmart(prevExclusive)}% below ATH`,
    multLabel: `${fmtMult(last.multiplier)}×`,
  }
}

/** @param {number} mult */
export function fmtMult(mult) {
  const s = `${Number(mult)}`
  if (!s.includes('.')) return s
  return s.replace(/(\.\d*?[1-9])0+$/, '$1').replace(/\.$/, '')
}

/** @param {number} lo @param {number} hi */
export function bandRangeLabel(lo, hi) {
  if (lo === 0) return `0–${truncateSmart(hi)}%`
  return `>${truncateSmart(lo)}%–${truncateSmart(hi)}%`
}

/** @param {number} v */
export function truncateSmart(v) {
  const rounded = Math.round(v * 10000) / 10000
  return rounded % 1 === 0 ? `${rounded}` : `${rounded}`
}

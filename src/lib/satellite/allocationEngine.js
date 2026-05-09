/** Haircut threshold — CLAUDE.md §4 satellite allocation (guidance); Settings may override via preferences. */
export const ALLOCATION_HAIRCUT_THRESHOLD = 65

/**
 * @typedef {{ haircut_threshold?: number, haircut_multiplier?: number }} AllocationRuleOpts
 */

/**
 * @param {number | null | undefined} rawScore
 * @param {AllocationRuleOpts} [opts]
 */
export function adjustedScoreFromRaw(rawScore, opts) {
  if (rawScore == null || !Number.isFinite(Number(rawScore))) return 0

  const r = Number(rawScore)

  const th = typeof opts?.haircut_threshold === 'number' && Number.isFinite(opts.haircut_threshold) ? opts.haircut_threshold : ALLOCATION_HAIRCUT_THRESHOLD

  const mul = typeof opts?.haircut_multiplier === 'number' && Number.isFinite(opts.haircut_multiplier) ? opts.haircut_multiplier : 0.5

  return r < th ? r * mul : r
}

/**
 * @typedef {{
 *   positionId: string
 *   rawScore: number | null
 *   manualTargetPct: number | null
 *   manualActive: boolean
 * }} SatelliteAllocEntry
 */

/**
 * Guidance targets that sum to ~100% when valid. Overrides lock fixed bands; remaining normalises by adjusted scores.
 *
 * @param {SatelliteAllocEntry[]} entries
 * @param {AllocationRuleOpts} [ruleOpts]
 */
export function computeSatelliteTargetAllocations(entries, ruleOpts) {
  /** @type {Record<string, number>} */
  const out = {}

  let sumOverrides = 0

  /** @type {Set<string>} */
  const overrideIds = new Set()

  for (const e of entries) {
    if (e.manualActive && typeof e.manualTargetPct === 'number' && Number.isFinite(e.manualTargetPct)) {
      const clamped = Math.min(100, Math.max(0, e.manualTargetPct))

      out[e.positionId] = clamped
      overrideIds.add(e.positionId)
      sumOverrides += clamped
    }
  }

  const remainderValid = sumOverrides <= 100 + 1e-6

  let budget = remainderValid ? Math.max(0, 100 - sumOverrides) : 0

  const rest = entries.filter((e) => !overrideIds.has(e.positionId))

  const sumAdj = rest.reduce((s, e) => s + adjustedScoreFromRaw(e.rawScore, ruleOpts), 0)

  if (rest.length > 0) {
    if (sumAdj > 0) {
      for (const e of rest) {
        const w = adjustedScoreFromRaw(e.rawScore, ruleOpts)

        out[e.positionId] = (w / sumAdj) * budget
      }
    } else {
      const slice = budget / rest.length

      for (const e of rest) {
        out[e.positionId] = slice
      }
    }
  }

  fixSumTo100(out, entries.map((e) => e.positionId))

  return { targetsByPositionId: out, sumOverrides, remainderValid }
}

/**
 * @param {Record<string, number>} weights
 * @param {string[]} ids
 */
function fixSumTo100(weights, ids) {
  let sum = 0

  for (const id of ids) {
    sum += weights[id] ?? 0
  }

  const diff = 100 - sum

  if (Math.abs(diff) < 1e-9) return

  /** @type {string | null} */
  let pick = null

  let best = -Infinity

  for (const id of ids) {
    const v = weights[id] ?? 0

    if (v >= best) {
      best = v
      pick = id
    }
  }

  if (pick) weights[pick] = (weights[pick] ?? 0) + diff
}

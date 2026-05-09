/**
 * Universal satellite tier labels (guidance) — CLAUDE.md scoring thresholds.
 *
 * @param {number | null | undefined} overallScore
 * @param {{ buyZoneUnlockThreshold?: number, highConvictionThreshold?: number }} [opts]
 */
export function universalTierFromScore(overallScore, opts) {
  if (overallScore == null || !Number.isFinite(Number(overallScore))) return null

  const s = Number(overallScore)

  const high = opts?.highConvictionThreshold ?? 78

  const gate = opts?.buyZoneUnlockThreshold ?? 65

  if (s >= high) return 'High conviction'

  if (s >= gate) return 'Qualified'

  return 'Haircut'
}

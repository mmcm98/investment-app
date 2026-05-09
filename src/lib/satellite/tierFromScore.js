/**
 * Universal satellite tier labels (guidance) — CLAUDE.md scoring thresholds.
 *
 * @param {number | null | undefined} overallScore
 */
export function universalTierFromScore(overallScore) {
  if (overallScore == null || !Number.isFinite(Number(overallScore))) return null

  const s = Number(overallScore)

  if (s >= 78) return 'High conviction'

  if (s >= 65) return 'Qualified'

  return 'Haircut'
}

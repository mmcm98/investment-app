/** ISO week bucket e.g. 2026-W19 (UTC-based, Monday week start via Thursday trick). */
export function isoWeekKey(d = new Date()) {
  const target = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()))
  const dayNum = target.getUTCDay() || 7

  target.setUTCDate(target.getUTCDate() + 4 - dayNum)

  const yearStart = new Date(Date.UTC(target.getUTCFullYear(), 0, 1))
  const weekNo = Math.ceil(((target.getTime() - yearStart.getTime()) / 86400000 + 1) / 7)

  const y = target.getUTCFullYear()

  return `${y}-W${String(weekNo).padStart(2, '0')}`
}

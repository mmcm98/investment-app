/**
 * @param {Date} [now]
 * @returns {string} YYYY-MM-DD in Australia/Sydney civil date
 */
export function sydneyWallDateIso(now = new Date()) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Australia/Sydney',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(now)

  const y = parts.find((p) => p.type === 'year')?.value
  const m = parts.find((p) => p.type === 'month')?.value
  const d = parts.find((p) => p.type === 'day')?.value

  return `${y}-${m}-${d}`
}

/**
 * Minutes from local Sydney midnight (approximate for scheduling; Intl gives wall time).
 *
 * @param {Date} [now]
 */
export function sydneyMinutesSinceMidnight(now = new Date()) {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Australia/Sydney',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
    weekday: 'short',
  }).formatToParts(now)

  const wd = parts.find((p) => p.type === 'weekday')?.value ?? ''
  const weekend = wd === 'Sat' || wd === 'Sun' || wd === 'Saturday' || wd === 'Sunday'

  if (weekend) return { weekend: true, minutes: 0 }

  const hh = Number.parseInt(parts.find((p) => p.type === 'hour')?.value ?? '0', 10)
  const mm = Number.parseInt(parts.find((p) => p.type === 'minute')?.value ?? '0', 10)

  return { weekend: false, minutes: hh * 60 + mm }
}

/**
 * ATH refresh window (Sydney, weekdays): after ASX cash close (~16:05) **or**
 * quietly before the open (~07:00–10:00) so Mondays still catch Friday’s missed run while the job date guard prevents repeats.
 *
 * @param {Date} [now]
 */
export function shouldRunDailyAthJob(now = new Date()) {
  const wallWeekdayParts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Australia/Sydney',
    weekday: 'short',
  }).formatToParts(now)

  const wd = wallWeekdayParts.find((p) => p.type === 'weekday')?.value ?? ''
  const dayOfWeekMonday = wd === 'Mon' || wd === 'Mon.' || wd === 'Monday'

  const wallClock = sydneyMinutesSinceMidnight(now)

  if (wallClock.weekend) return false

  const open = 10 * 60

  /** 16:05 Sydney */
  const afterClose = wallClock.minutes >= 16 * 60 + 5

  /** Monday pre-open backlog window only (avoids weekday-morning ATH spam). */
  const mondayMorningCatchUp = dayOfWeekMonday && wallClock.minutes >= 7 * 60 && wallClock.minutes < open

  return afterClose || mondayMorningCatchUp
}

/**
 * Static exchange sessions from INVESTMENT_APP_FRAMEWORK §10.15 (Australia/Sydney baseline).
 * Drives five-minute quote refresh eligibility per listing venue.
 */

/** @typedef {{
 *   exchangeKey: string
 *   label: string
 *   timezoneIANA: string
 *   openHour: number
 *   openMinute: number
 *   closeHour: number
 *   closeMinute: number
 * }} ExchangeSession */

/** Exchange keys map to inferred FMP `exchangeShortName` families ({@link mapFmpExchangeToSession}). */
export const EXCHANGE_SESSIONS = /** @type {const} */ ({
  ASX: {
    exchangeKey: 'ASX',
    label: 'ASX',
    timezoneIANA: 'Australia/Sydney',
    openHour: 10,
    openMinute: 0,
    closeHour: 16,
    closeMinute: 0,
  },
  LSE: {
    exchangeKey: 'LSE',
    label: 'LSE',
    timezoneIANA: 'Europe/London',
    openHour: 8,
    openMinute: 0,
    closeHour: 16,
    closeMinute: 30,
  },
  NYSE: {
    exchangeKey: 'NYSE',
    label: 'NYSE',
    timezoneIANA: 'America/New_York',
    openHour: 9,
    openMinute: 30,
    closeHour: 16,
    closeMinute: 0,
  },
  NASDAQ: {
    exchangeKey: 'NASDAQ',
    label: 'NASDAQ',
    timezoneIANA: 'America/New_York',
    openHour: 9,
    openMinute: 30,
    closeHour: 16,
    closeMinute: 0,
  },
  TSX: {
    exchangeKey: 'TSX',
    label: 'TSX',
    timezoneIANA: 'America/Toronto',
    openHour: 9,
    openMinute: 30,
    closeHour: 16,
    closeMinute: 0,
  },
})

/**
 * Normalize FMP / inferred exchange hints to a {@link ExchangeSession} key.
 *
 * @param {string | null | undefined} exchangeShortName
 * @returns {keyof typeof EXCHANGE_SESSIONS}
 */
export function mapFmpExchangeToSession(exchangeShortName) {
  const v = `${exchangeShortName ?? ''}`.trim().toUpperCase()

  if (!v) return 'ASX'

  if (v === 'AU' || v === 'ASX' || v.includes('AUSTRAL')) return 'ASX'

  if (v === 'LSE' || v === 'LON' || v === 'GB' || v.includes('LONDON')) return 'LSE'

  if (v === 'NASDAQ' || v === 'NMS' || v === 'NASDAQ GS' || v === 'NASDAQ GLOBAL SELECT') return 'NASDAQ'

  if (v === 'NYSE' || v === 'NYQ' || v === 'NASDAQ OTHER' || v === 'NASDAQ CM') return 'NYSE'

  if (v === 'TSX' || v === 'TOR' || v === 'TSE') return 'TSX'

  // Default: Aussie base portfolio context
  return 'ASX'
}

/**
 * Minute-of-week (Mon=0,Sun=6 weekday from formatter) unavailable — use Intl weekday indices.
 *
 * @param {Date} now
 * @param {ExchangeSession} session
 */
export function isWithinRegularSession(now, session) {
  /** @type {Intl.DateTimeFormatOptions} */
  const opts = { timeZone: session.timezoneIANA, hour: 'numeric', minute: 'numeric', hour12: false, weekday: 'short' }

  const parts = new Intl.DateTimeFormat('en-US', opts).formatToParts(now)

  const hour = Number.parseInt(parts.find((p) => p.type === 'hour')?.value ?? 'NaN', 10)
  const minute = Number.parseInt(parts.find((p) => p.type === 'minute')?.value ?? 'NaN', 10)
  const weekday = parts.find((p) => p.type === 'weekday')?.value ?? ''

  const satOrSun =
    weekday === 'Sat' || weekday === 'Sun' ||
    weekday === 'Saturday' || weekday === 'Sunday'

  if (satOrSun) return false

  const openM = session.openHour * 60 + session.openMinute
  const closeM = session.closeHour * 60 + session.closeMinute

  const nowM = hour * 60 + minute

  return nowM >= openM && nowM <= closeM
}

/**
 * Whether live quote polling should tick for holdings listed on `exchangeShortName`.
 *
 * @param {string | undefined | null} exchangeShortName
 * @param {Date} [now]
 */
export function isLivePriceWindowActiveForExchange(exchangeShortName, now = new Date()) {
  const key = mapFmpExchangeToSession(exchangeShortName)
  const session = EXCHANGE_SESSIONS[key]

  return isWithinRegularSession(now, session)
}

/**
 * Returns true when any tracked exchange requires live refresh (market open anywhere in the set).
 *
 * @param {Iterable<string>} exchangeShortNames
 * @param {Date} [now]
 */
export function anyExchangeNeedsLiveQuotes(exchangeShortNames, now = new Date()) {
  let any = false

  for (const ex of exchangeShortNames) {
    if (isLivePriceWindowActiveForExchange(ex, now)) {
      any = true

      break
    }
  }

  return any
}

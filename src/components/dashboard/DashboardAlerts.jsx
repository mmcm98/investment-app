import { motion } from 'framer-motion'
import { Link } from 'react-router-dom'
import { tickersLooselyEqual } from '../../lib/dca/tickerMatch.js'
import { isoWeekKey } from '../../lib/dashboard/isoWeek.js'
import { useDashboardClock } from '../../hooks/useDashboardClock.js'

/** @param {Record<string, unknown>|null} pos */
function buyZonesOf(pos) {
  const bz = pos && Array.isArray(Reflect.get(pos, 'buy_zones')) ? Reflect.get(pos, 'buy_zones') : []

  return /** @type {Record<string, unknown>[]} */ (bz ?? [])
}

/** @param {Record<string, unknown>|null} pos */
function exitsOf(pos) {
  const ex = pos && Array.isArray(Reflect.get(pos, 'exit_triggers')) ? Reflect.get(pos, 'exit_triggers') : []

  return /** @type {Record<string, unknown>[]} */ (ex ?? [])
}

/**
 * @param {string} yahoo
 * @param {string} fmp
 * @param {{ portfolio_role?: string, yahoo_symbol?: string|null, instrument_symbol?: string|null, display_native?: number|null }[]} mergedRows
 */
function quoteForPosition(yahoo, fmp, mergedRows) {
  const sat = mergedRows.filter((m) => `${m.portfolio_role ?? ''}`.toLowerCase() === 'satellite')

  for (const row of sat) {
    if (yahoo && tickersLooselyEqual(row.yahoo_symbol, yahoo)) return row

    if (fmp && tickersLooselyEqual(row.instrument_symbol, fmp)) return row
  }

  return null
}

/**
 * @typedef {{ key: string, tone: 'red'|'green'|'amber'|'blue'|'orange', title: string, body: string, href?: string, onDismiss?: () => void }} DashboardAlertRow
 */

/**
 * @param {{
 * positions: Record<string, unknown>[]
 * mergedRows: { portfolio_role?: string, yahoo_symbol?: string|null, instrument_symbol?: string|null, display_native?: number|null }[]
 * latestScoreByPid: Record<string, Record<string, unknown>>
 * dashboardPrefs: import('../../lib/dashboard/dashboardPrefs.js').DashboardPrefsBucket
 * persistPrefs: (patch: Record<string, unknown>) => Promise<void>
 * weeklyDcaBaseAud: number
}} props
 */
export function DashboardAlerts({ positions, mergedRows, latestScoreByPid, dashboardPrefs, persistPrefs, weeklyDcaBaseAud }) {
  const nowMs = useDashboardClock()

  const week = isoWeekKey()

  const dismissedExit = dashboardPrefs.dismissed_exit_positions ?? {}
  const dismissedBuy = dashboardPrefs.dismissed_buy_zone_keys ?? {}
  const dismissedRe = dashboardPrefs.dismissed_reanalysis ?? {}

  const annSnoozeUntil = dashboardPrefs.announcements_snoozed_until ? Date.parse(`${dashboardPrefs.announcements_snoozed_until}`) : NaN

  const announcementsVisible = !Number.isFinite(annSnoozeUntil) || annSnoozeUntil < nowMs

  /** @type {DashboardAlertRow[]} */
  const exitRows = []

  /** @type {DashboardAlertRow[]} */
  const buyRows = []

  /** @type {DashboardAlertRow[]} */
  const dcaRows = []

  /** @type {DashboardAlertRow[]} */
  const annRows = []

  /** @type {DashboardAlertRow[]} */
  const reRows = []

  for (const pos of positions) {
    const pid = `${Reflect.get(pos, 'id')}`

    const ticker = `${Reflect.get(pos, 'display_ticker') ?? Reflect.get(pos, 'fmp_symbol') ?? ''}`.trim()
    const yahoo = `${Reflect.get(pos, 'yahoo_symbol') ?? ''}`.trim()
    const fmp = `${Reflect.get(pos, 'fmp_symbol') ?? ''}`.trim()

    const exits = exitsOf(pos)

    if (exits.length > 0 && !dismissedExit[pid]) {
      exitRows.push({
        key: `exit-${pid}`,
        tone: 'red',
        title: 'Exit trigger',
        body: `${ticker}: review ${exits.length} exit condition(s); confirm plan before trading.`,
        href: `/satellite/position/${pid}`,
        onDismiss: async () => {
          await persistPrefs({ dismissed_exit_positions: { ...dismissedExit, [pid]: new Date().toISOString() } })
        },
      })
    }

    const sc = latestScoreByPid[pid]

    const score = sc && typeof Reflect.get(sc, 'overall_score') === 'number' ? Number(Reflect.get(sc, 'overall_score')) : null

    const awaiting = Boolean(Reflect.get(pos, 'awaiting_analysis'))

    const monitor = !awaiting && score != null && score >= 65

    const q = quoteForPosition(yahoo, fmp, mergedRows)

    const native = q && typeof q.display_native === 'number' ? q.display_native : null

    if (monitor && native != null) {
      const zones = buyZonesOf(pos)

      zones.forEach((z, idx) => {
        const floorRaw = Reflect.get(z, 'floor_price_native')
        const floor = typeof floorRaw === 'number' ? floorRaw : Number.parseFloat(`${floorRaw ?? ''}`)

        if (!Number.isFinite(floor)) return

        const bkey = `${pid}:${idx}`

        if (dismissedBuy[bkey]) return

        if (native <= floor) {
          buyRows.push({
            key: `bz-${bkey}`,
            tone: 'green',
            title: 'Buy zone',
            body: `${ticker}: native ${native.toFixed(4)} is at/below ${floor.toFixed(4)} (${`${Reflect.get(z, 'label') ?? 'level'}`}). FX movement does not influence this alert.`,
            href: `/satellite/position/${pid}`,
            onDismiss: async () => {
              await persistPrefs({ dismissed_buy_zone_keys: { ...dismissedBuy, [bkey]: new Date().toISOString() } })
            },
          })
        }
      })
    }

    const reDismissedAt = dismissedRe[pid]

    const reDismissedMs = reDismissedAt ? Date.parse(reDismissedAt) : NaN

    const reCooldownOk = !Number.isFinite(reDismissedMs) || nowMs - reDismissedMs > 30 * 24 * 60 * 60 * 1000

    let stale = false

    if (sc && typeof Reflect.get(sc, 'generated_at') === 'string')
      stale = nowMs - Date.parse(`${Reflect.get(sc, 'generated_at')}`) > 90 * 24 * 60 * 60 * 1000

    const needsRe = reCooldownOk && (awaiting || !sc || stale)

    if (needsRe) {
      reRows.push({
        key: `re-${pid}`,
        tone: 'orange',
        title: 'Re-analysis recommended',
        body: `${ticker}: awaiting scorecard / thesis may be stale.`,
        href: `/satellite/position/${pid}`,
        onDismiss: async () => {
          await persistPrefs({ dismissed_reanalysis: { ...dismissedRe, [pid]: new Date().toISOString() } })
        },
      })
    }
  }

  if (weeklyDcaBaseAud > 0 && dashboardPrefs.dca_week_dismissed_iso !== week) {
    dcaRows.push({
      key: `dca-${week}`,
      tone: 'amber',
      title: 'DCA this week',
      body: `Check core ETF ladders (${week}). Guidance only — Tuesdays are suggested, not enforced.`,
      onDismiss: async () => {
        await persistPrefs({ dca_week_dismissed_iso: week })
      },
    })
  }

  if (announcementsVisible) {
    annRows.push({
      key: 'announce-placeholder',
      tone: 'blue',
      title: 'Announcements',
      body: 'Priority 2 channel — catalyst notices will land here (placeholder).',
      onDismiss: async () => {
        const until = new Date()

        until.setHours(until.getHours() + 24)

        await persistPrefs({ announcements_snoozed_until: until.toISOString() })
      },
    })
  }

  /** Priority: exit → buy → DCA → announcement → re-analysis */

  const actionableCore = [...exitRows, ...buyRows, ...dcaRows, ...reRows]

  if (actionableCore.length === 0) return null

  /** @type {DashboardAlertRow[]} */
  const ordered = [...exitRows, ...buyRows, ...dcaRows]

  if (announcementsVisible) ordered.push(...annRows)

  ordered.push(...reRows)

  /** @type {Record<string, string>} */
  const accents = {
    red: '#EF4444',
    green: '#22C55E',
    amber: '#F59E0B',
    blue: '#4DB8FF',
    orange: '#EA580C',
  }

  return (
    <section className="space-y-3">
      {ordered.map((a) => (
        <motion.div
          key={a.key}
          layout
          initial={{ opacity: 0, y: 4 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.2, ease: 'easeOut' }}
          className="flex flex-wrap items-start gap-3 rounded-lg border border-[rgba(255,255,255,0.06)] bg-[#111118] py-4 pl-5 pr-4"
          style={{ boxShadow: `inset 4px 0 0 0 ${accents[a.tone]}` }}
        >
          <div className="min-w-0 flex-1">
            <p className={`text-[10px] font-semibold uppercase tracking-wide`} style={{ color: accents[a.tone] }}>
              {a.title}
            </p>

            <p className="mt-2 text-sm text-[#C8C8D8]">{a.body}</p>

            {a.href ? (
              <Link className="mt-3 inline-flex font-mono text-xs text-[#79CBFF] hover:text-[#4DB8FF]" to={a.href}>
                Open →
              </Link>
            ) : null}
          </div>

          {a.onDismiss ? (
            <button
              type="button"
              className="shrink-0 rounded-md border border-[rgba(255,255,255,0.12)] px-2 py-1 font-mono text-[10px] text-[#9090A8] hover:border-[rgba(255,255,255,0.2)]"
              onClick={() => void a.onDismiss?.()}
            >
              Dismiss
            </button>
          ) : null}
        </motion.div>
      ))}
    </section>
  )
}

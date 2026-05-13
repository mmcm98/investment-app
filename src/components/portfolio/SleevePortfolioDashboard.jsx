import { useEffect, useMemo, useState } from 'react'
import {
  CartesianGrid,
  Cell,
  Legend,
  Line,
  LineChart,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import { useInvTheme } from '../../context/InvThemeContext.jsx'
import { useSleeveHoldingsOverview } from '../../hooks/useSleeveHoldingsOverview.js'
import { postChartHistory } from '../../lib/market/marketApi.js'
import { alignSeries } from '../../lib/dashboard/parseSharesightPerformance.js'

/** @typedef {{ isoDate: string, value: number }} PerfPoint */

const DONUT_COLORS = ['#4DB8FF', '#79CBFF', '#22C55E', '#F59E0B', '#A78BFA', '#F472B6', '#38BDF8', '#FBBF24']

/**
 * @param {'1M'|'3M'|'6M'|'1Y'|'2Y'|'ALL'} p
 */
function sliceStartIso(p) {
  const d = new Date()

  if (p === 'ALL') return '1990-01-01'

  const months = /** @type {Record<string, number>} */ ({
    '1M': 1,
    '3M': 3,
    '6M': 6,
    '1Y': 12,
    '2Y': 24,
  })

  d.setMonth(d.getMonth() - (months[p] ?? 12))

  return d.toISOString().slice(0, 10)
}

/**
 * @param {Record<string, number>} pointsByDay
 * @param {string[]} datesSorted
 */
function pctFromFirst(pointsByDay, datesSorted) {
  const firstDay = datesSorted[0]
  const base = firstDay != null ? pointsByDay[firstDay] : null

  if (base == null || !Number.isFinite(base) || base === 0) return /** @type {Record<string, number>} */ ({})

  /** @type {Record<string, number>} */
  const out = {}

  for (const day of datesSorted) {
    const v = pointsByDay[day]

    if (typeof v !== 'number' || !Number.isFinite(v)) continue

    out[day] = ((v - base) / Math.abs(base)) * 100
  }

  return out
}

/** @param {number | null | undefined} n */
function fmtAud(n) {
  if (n == null || !Number.isFinite(n)) return '—'

  return n.toLocaleString('en-AU', {
    style: 'currency',
    currency: 'AUD',
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  })
}

/** @param {number | null | undefined} n */
function fmtAud2(n) {
  if (n == null || !Number.isFinite(n)) return '—'

  return n.toLocaleString('en-AU', {
    style: 'currency',
    currency: 'AUD',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })
}

/** @param {number | null | undefined} n */
function fmtPct(n) {
  if (n == null || !Number.isFinite(n)) return '—'

  return `${n >= 0 ? '+' : ''}${n.toFixed(2)}%`
}

/**
 * @param {{
 *   portfolioRole: 'core'|'satellite'
 *   perfSeries: PerfPoint[] | null
 *   benchSymbol: string
 *   dashboardHydrated: boolean
 * }} props
 */
export function SleevePortfolioDashboard({ portfolioRole, perfSeries, benchSymbol, dashboardHydrated }) {
  const theme = useInvTheme()

  const ov = useSleeveHoldingsOverview(portfolioRole)

  const period = /** @type {const} */ ('1Y')

  const startIso = useMemo(() => sliceStartIso(period), [period])

  const [benchSeries, setBenchSeries] = useState(/** @type {PerfPoint[]} */ ([]))

  useEffect(() => {
    const sym = `${benchSymbol ?? ''}`.trim() || 'VGS.AX'

    void postChartHistory(sym, period)
      .then((out) => {
        const pts = Reflect.get(out ?? {}, 'points')
        const arr = Array.isArray(pts) ? pts : []

        setBenchSeries(
          arr
            .map((/** @type {Record<string, unknown>} */ r) => ({
              isoDate: `${r.t}`,
              value: typeof r.close === 'number' ? r.close : Number.parseFloat(`${r.close}`),
            }))
            .filter((r) => r.isoDate >= startIso && Number.isFinite(r.value)),
        )
      })
      .catch(() => setBenchSeries([]))
  }, [benchSymbol, period, startIso])

  const perfChartRows = useMemo(() => {
    const sleeve = perfSeries?.filter((p) => p.isoDate >= startIso) ?? []

    /** @type {Set<string>} */
    const dates = new Set()

    for (const p of sleeve) dates.add(p.isoDate)

    for (const p of benchSeries) dates.add(p.isoDate)

    const sorted = Array.from(dates).sort((a, b) => (a < b ? -1 : 1))

    if (sorted.length === 0) return []

    const sleeveAligned = alignSeries(sleeve.length ? sleeve : null, sorted)
    const benchAligned = alignSeries(benchSeries.length ? benchSeries : null, sorted)

    const sleevePct = pctFromFirst(sleeveAligned, sorted)
    const benchPct = pctFromFirst(benchAligned, sorted)

    return sorted.map((d) => ({
      d,
      sleeve: sleevePct[d] ?? null,
      bench: benchPct[d] ?? null,
    }))
  }, [perfSeries, benchSeries, startIso])

  const axisStroke = theme.light ? 'rgba(0,0,0,0.35)' : 'rgba(255,255,255,0.18)'
  const gridStroke = theme.light ? 'rgba(0,0,0,0.06)' : 'rgba(255,255,255,0.06)'

  const sleeveLabel = portfolioRole === 'core' ? 'Core (Sharesight)' : 'Satellite (Sharesight)'

  return (
    <section className={`space-y-6 rounded-xl border ${theme.borderSubtle} bg-[#111118] p-5 shadow-[inset_0_1px_0_rgba(255,255,255,0.04)]`}>
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="font-sans text-sm font-semibold uppercase tracking-wide text-[#9090A8]">Sleeve overview</h2>

          <p className={`mt-1 font-mono text-[11px] ${theme.tertiary}`}>
            Values merge <span className="text-[#79CBFF]">sharesight_holdings</span> with live quotes where available.
          </p>
        </div>

        {ov.pricesUpdating ? (
          <span className="font-mono text-[10px] text-[#79CBFF]">Refreshing quotes…</span>
        ) : (
          <span className={`font-mono text-[10px] ${theme.tertiary}`}>Quotes idle</span>
        )}
      </header>

      {ov.loadError ? (
        <p className="rounded-lg border border-[rgba(239,68,68,0.35)] bg-[rgba(239,68,68,0.08)] px-3 py-2 font-mono text-xs text-[#FECACA]">
          {ov.loadError}
        </p>
      ) : null}

      <div className="grid gap-4 sm:grid-cols-3">
        <div className="rounded-lg border border-[rgba(255,255,255,0.06)] bg-[#0A0A0F] px-4 py-3">
          <p className="font-mono text-[10px] uppercase tracking-wide text-[#505068]">Total sleeve value</p>

          <p className="mt-1 font-mono text-xl font-semibold tabular-nums text-[#F0F0F8]">{fmtAud(ov.totals.sleeveValue)}</p>
        </div>

        <div className="rounded-lg border border-[rgba(255,255,255,0.06)] bg-[#0A0A0F] px-4 py-3">
          <p className="font-mono text-[10px] uppercase tracking-wide text-[#505068]">Cost basis (sum)</p>

          <p className="mt-1 font-mono text-xl font-semibold tabular-nums text-[#F0F0F8]">{fmtAud(ov.totals.sleeveCost)}</p>
        </div>

        <div className="rounded-lg border border-[rgba(255,255,255,0.06)] bg-[#0A0A0F] px-4 py-3">
          <p className="font-mono text-[10px] uppercase tracking-wide text-[#505068]">Unrealised P&amp;L</p>

          <p
            className={`mt-1 font-mono text-xl font-semibold tabular-nums ${
              ov.totals.sleeveUgl >= 0 ? 'text-[#22C55E]' : 'text-[#EF4444]'
            }`}
          >
            {fmtAud2(ov.totals.sleeveUgl)}
          </p>
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_280px]">
        <div className="min-h-[260px]">
          <p className="mb-2 font-mono text-[10px] uppercase tracking-wide text-[#505068]">Allocation (% of sleeve value)</p>

          {ov.donutSlices.length === 0 ? (
            <p className={`rounded-lg border border-[rgba(255,255,255,0.06)] px-4 py-8 text-center text-sm ${theme.muted}`}>
              No priced positions yet — confirm Sharesight sync and live quotes.
            </p>
          ) : (
            <div className="h-[260px] w-full">
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie
                    data={ov.donutSlices}
                    dataKey="value"
                    nameKey="name"
                    cx="50%"
                    cy="50%"
                    innerRadius={58}
                    outerRadius={88}
                    paddingAngle={2}
                  >
                    {ov.donutSlices.map((_, i) => (
                      <Cell key={`c-${i}`} fill={DONUT_COLORS[i % DONUT_COLORS.length]} stroke="rgba(10,10,15,0.9)" strokeWidth={1} />
                    ))}
                  </Pie>

                  <Tooltip
                    formatter={(v, _n, p) => [
                      `${fmtAud2(Number(v))} (${(p && p.payload && p.payload.pct != null ? p.payload.pct : 0).toFixed(1)}%)`,
                      'Value',
                    ]}
                    contentStyle={{
                      background: '#1A1A24',
                      border: '1px solid rgba(255,255,255,0.08)',
                      borderRadius: 8,
                      fontFamily: 'DM Mono, ui-monospace, monospace',
                      fontSize: 11,
                      color: '#F0F0F8',
                    }}
                  />

                  <Legend
                    verticalAlign="bottom"
                    wrapperStyle={{ fontFamily: 'DM Mono, ui-monospace, monospace', fontSize: 10, color: '#9090A8' }}
                  />
                </PieChart>
              </ResponsiveContainer>
            </div>
          )}
        </div>

        <div className="min-h-[260px]">
          <p className="mb-2 font-mono text-[10px] uppercase tracking-wide text-[#505068]">
            Performance vs benchmark ({`${benchSymbol || 'VGS.AX'}`.trim()})
          </p>

          {!dashboardHydrated ? (
            <div className={`flex h-[220px] items-center justify-center rounded-lg border border-[rgba(255,255,255,0.06)] text-xs ${theme.muted}`}>
              Loading dashboard data…
            </div>
          ) : perfChartRows.length === 0 ? (
            <div className={`flex h-[220px] items-center justify-center rounded-lg border border-[rgba(255,255,255,0.06)] text-xs ${theme.muted}`}>
              No performance series for this sleeve yet.
            </div>
          ) : (
            <div className="h-[260px] w-full">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={perfChartRows} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke={gridStroke} />

                  <XAxis dataKey="d" tick={{ fill: '#505068', fontSize: 9, fontFamily: 'DM Mono, monospace' }} stroke={axisStroke} />

                  <YAxis
                    tick={{ fill: '#505068', fontSize: 9, fontFamily: 'DM Mono, monospace' }}
                    stroke={axisStroke}
                    tickFormatter={(v) => `${v}%`}
                  />

                  <Tooltip
                    contentStyle={{
                      background: '#1A1A24',
                      border: '1px solid rgba(255,255,255,0.08)',
                      borderRadius: 8,
                      fontFamily: 'DM Mono, ui-monospace, monospace',
                      fontSize: 11,
                      color: '#F0F0F8',
                    }}
                    formatter={(v) => (typeof v === 'number' && Number.isFinite(v) ? `${v.toFixed(2)}%` : '—')}
                  />

                  <Line type="monotone" dataKey="sleeve" name={sleeveLabel} stroke="#4DB8FF" dot={false} strokeWidth={2} connectNulls />

                  <Line type="monotone" dataKey="bench" name="Benchmark" stroke="#F59E0B" dot={false} strokeWidth={1.5} connectNulls />

                  <Legend wrapperStyle={{ fontFamily: 'DM Mono, monospace', fontSize: 10, color: '#9090A8' }} />
                </LineChart>
              </ResponsiveContainer>
            </div>
          )}
        </div>
      </div>

      <div>
        <p className="mb-3 font-mono text-[10px] uppercase tracking-wide text-[#505068]">Positions</p>

        {!ov.hydrated ? (
          <p className={`rounded-lg border border-[rgba(255,255,255,0.06)] px-4 py-6 text-center text-sm ${theme.muted}`}>
            Loading holdings from Supabase…
          </p>
        ) : ov.rows.length === 0 && ov.closedCount === 0 ? (
          <p className={`rounded-lg border border-[rgba(255,255,255,0.06)] px-4 py-6 text-center text-sm ${theme.muted}`}>
            No rows in <span className="font-mono text-[#79CBFF]">sharesight_holdings</span> for this sleeve yet.
          </p>
        ) : ov.rows.length === 0 ? (
          <p className={`rounded-lg border border-[rgba(255,255,255,0.06)] px-4 py-6 text-center text-sm ${theme.muted}`}>
            No open positions — all holdings in this sleeve are closed in Sharesight (see below).
          </p>
        ) : null}

        <div className="grid gap-4 md:grid-cols-2">
          {ov.rows.map((r) => (
            <article
              key={r.rowKey}
              className={`rounded-xl border ${theme.borderSubtle} bg-[#0A0A0F] p-4 shadow-[inset_0_1px_0_rgba(255,255,255,0.03)]`}
            >
              <div className="flex flex-wrap items-start justify-between gap-2 border-b border-[rgba(255,255,255,0.06)] pb-3">
                <div className="min-w-0">
                  <p className="font-mono text-sm font-medium text-[#79CBFF]">{r.ticker}</p>

                  <p className="mt-0.5 line-clamp-2 font-sans text-xs text-[#D6D6E8]">{r.name}</p>

                  {r.cashLike ? (
                    <p className="mt-1 font-mono text-[10px] uppercase tracking-wide text-[#505068]">Cash-like — excluded from sleeve total</p>
                  ) : null}
                </div>
              </div>

              <dl className="mt-3 grid grid-cols-2 gap-x-3 gap-y-2 font-mono text-[11px] tabular-nums text-[#9090A8] md:grid-cols-3">
                <div>
                  <dt className="text-[10px] uppercase tracking-wide text-[#505068]">Price</dt>

                  <dd className="mt-0.5 text-sm text-[#F0F0F8]">
                    {r.displayNative != null && Number.isFinite(Number(r.displayNative))
                      ? `${Number(r.displayNative).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 4 })} ${r.quoteCurrency}`

                      : '—'}
                  </dd>
                </div>

                <div>
                  <dt className="text-[10px] uppercase tracking-wide text-[#505068]">Qty</dt>

                  <dd className="mt-0.5 text-sm text-[#F0F0F8]">{r.quantity != null ? r.quantity.toLocaleString() : '—'}</dd>
                </div>

                <div>
                  <dt className="text-[10px] uppercase tracking-wide text-[#505068]">Value (AUD)</dt>

                  <dd className="mt-0.5 text-sm text-[#F0F0F8]">{fmtAud2(r.valueAud)}</dd>
                </div>

                <div>
                  <dt className="text-[10px] uppercase tracking-wide text-[#505068]">Cost basis</dt>

                  <dd className="mt-0.5 text-sm text-[#F0F0F8]">{fmtAud2(r.costBasis)}</dd>
                </div>

                <div className="md:col-span-2">
                  <dt className="text-[10px] uppercase tracking-wide text-[#505068]">Unrealised G/L</dt>

                  <dd
                    className={`mt-0.5 text-sm ${
                      r.unrealisedAud != null && r.unrealisedAud >= 0 ? 'text-[#22C55E]' : 'text-[#EF4444]'
                    }`}
                  >
                    {fmtAud2(r.unrealisedAud)} <span className="text-[#505068]">·</span>{' '}
                    <span className={r.unrealisedPct != null && r.unrealisedPct >= 0 ? 'text-[#22C55E]' : 'text-[#EF4444]'}>
                      {fmtPct(r.unrealisedPct)}
                    </span>
                  </dd>
                </div>
              </dl>
            </article>
          ))}
        </div>

        {ov.closedCount > 0 ? (
          <details className={`mt-6 rounded-xl border ${theme.borderSubtle} bg-[#0A0A0F] p-4`}>
            <summary className="cursor-pointer font-mono text-xs font-medium text-[#9090A8] hover:text-[#F0F0F8]">
              Closed positions ({ov.closedCount})
            </summary>

            <p className={`mt-2 text-xs ${theme.muted}`}>
              Fully closed or zero-quantity holdings from Sharesight — excluded from sleeve totals and live pricing.
            </p>

            <div className="mt-4 grid gap-4 md:grid-cols-2">
              {ov.closedRows.map((r) => (
                <article
                  key={r.rowKey}
                  className={`rounded-xl border border-[rgba(255,255,255,0.04)] bg-[#111118] p-4 opacity-90`}
                >
                  <div className="flex flex-wrap items-start justify-between gap-2 border-b border-[rgba(255,255,255,0.06)] pb-3">
                    <div className="min-w-0">
                      <p className="font-mono text-sm font-medium text-[#505068]">{r.ticker}</p>

                      <p className="mt-0.5 line-clamp-2 font-sans text-xs text-[#9090A8]">{r.name}</p>

                      <p className="mt-1 font-mono text-[10px] uppercase tracking-wide text-[#505068]">Closed</p>
                    </div>
                  </div>

                  <dl className="mt-3 grid grid-cols-2 gap-x-3 gap-y-2 font-mono text-[11px] tabular-nums text-[#9090A8] md:grid-cols-3">
                    <div>
                      <dt className="text-[10px] uppercase tracking-wide text-[#505068]">Qty</dt>

                      <dd className="mt-0.5 text-sm text-[#F0F0F8]">{r.quantity != null ? r.quantity.toLocaleString() : '—'}</dd>
                    </div>

                    <div>
                      <dt className="text-[10px] uppercase tracking-wide text-[#505068]">Value (AUD)</dt>

                      <dd className="mt-0.5 text-sm text-[#F0F0F8]">{fmtAud2(r.valueAud)}</dd>
                    </div>
                  </dl>
                </article>
              ))}
            </div>
          </details>
        ) : null}
      </div>
    </section>
  )
}

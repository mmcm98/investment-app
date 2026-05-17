import { Cell, Pie, PieChart, ResponsiveContainer, Tooltip } from 'recharts'
import { SatellitePositionsTable } from '../components/satellite/SatellitePositionsTable.jsx'
import { useSatellitePortfolio } from '../hooks/useSatellitePortfolio.js'
import { useInvTheme } from '../context/InvThemeContext.jsx'
import { DataStaleBanner } from '../components/ui/DataStaleBanner.jsx'
import { Skeleton } from '../components/ui/Skeleton.jsx'

const DONUT_COLORS = ['#4DB8FF', '#79CBFF', '#22C55E', '#F59E0B', '#A78BFA', '#F472B6', '#38BDF8', '#FBBF24']

/** @param {unknown} v */
function numFin(v) {
  if (typeof v === 'number' && Number.isFinite(v)) return v
  const n = Number.parseFloat(`${v ?? ''}`)
  return Number.isFinite(n) ? n : null
}

/** @param {number|null|undefined} n */
function fmtAud(n) {
  if (n == null || !Number.isFinite(Number(n))) return '—'
  return Number(n).toLocaleString('en-AU', { style: 'currency', currency: 'AUD', minimumFractionDigits: 2 })
}

/** @param {number|null|undefined} n */
function fmtPct(n) {
  if (n == null || !Number.isFinite(Number(n))) return ''
  return `${Number(n).toFixed(2)}%`
}

/** @param {Record<string, unknown>[]} rows */
function openPositionRows(rows) {
  return rows.filter((row) => !row.rowClosed && !row.isCashLike)
}

/** @param {Record<string, unknown>[]} rows */
function portfolioSummary(rows) {
  let valueAud = 0
  let capitalGainAud = 0

  for (const row of openPositionRows(rows)) {
    const value = numFin(row.valueAud)
    const gain = numFin(row.capitalGainAud)

    if (value != null) valueAud += value
    if (gain != null) capitalGainAud += gain
  }

  return { valueAud, capitalGainAud }
}

/** @param {Record<string, unknown>[]} rows */
function allocationSlices(rows) {
  const openRows = openPositionRows(rows)
  const total = openRows.reduce((sum, row) => sum + (numFin(row.valueAud) ?? 0), 0)

  if (total <= 0) return []

  return openRows
    .map((row) => {
      const value = numFin(row.valueAud) ?? 0

      return {
        name: `${row.ticker ?? '—'}`.trim() || '—',
        value,
        pct: (value / total) * 100,
      }
    })
    .filter((row) => row.value > 0)
}

export function SatellitePortfolio() {
  const sp = useSatellitePortfolio()
  const theme = useInvTheme()
  const rows = /** @type {Record<string, unknown>[]} */ (sp.tableCards ?? [])
  const summary = portfolioSummary(rows)
  const slices = allocationSlices(rows)

  async function onToggleAud(e) {
    await sp.setPrefShowAud(e.target.checked)
  }

  return (
    <div className={`mx-auto flex w-full max-w-screen-2xl flex-col gap-6 px-6 py-10 pb-24 lg:pb-10 ${theme.fg}`}>
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-[22px] font-semibold">Satellite portfolio</h1>
          <p className={`mt-2 max-w-[82ch] text-sm ${theme.muted}`}>
            Guidance-only allocation from scores. Sharesight satellite holdings are the spine; Supabase positions carry
            locked FMP/Yahoo symbols and analysis state.
          </p>
        </div>
        <label className="flex cursor-pointer items-center gap-2 text-xs text-[#9090A8]">
          <input type="checkbox" checked={sp.showAudParenthetical} onChange={(e) => void onToggleAud(e)} />
          Show AUD parenthetical
        </label>
      </header>

      {!sp.satelliteHydrated ? (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <Skeleton className="min-h-[140px] rounded-xl" />
          <Skeleton className="min-h-[260px] rounded-xl" />
          <Skeleton className="min-h-[260px] rounded-xl md:col-span-2" />
        </div>
      ) : null}

      {sp.loadError ? (
        <DataStaleBanner
          message={sp.loadError}
          context={
            sp.hasRecoverableSatelliteData
              ? 'Showing last loaded satellite holdings, allocations, and scores.'
              : 'Awaiting successful load — Sharesight holdings may appear once sync completes.'
          }
        />
      ) : null}

      {!sp.remainderValid ? (
        <div className="rounded-xl border border-[rgba(245,158,11,0.35)] bg-[rgba(245,158,11,0.08)] px-4 py-3 text-sm text-[#FCD34D]">
          Manual allocation overrides sum to {fmtPct(sp.sumOverrides)} (&gt;100%). Normalise overrides in Supabase —
          remaining budget cannot be computed.
        </div>
      ) : null}

      <section className="rounded-xl border border-[rgba(255,255,255,0.06)] bg-[#111118] px-4 py-3">
        <div className="flex flex-wrap gap-8 font-mono text-xs text-[#F0F0F8]">
          <div>
            <span className="text-[10px] uppercase tracking-wide text-[#505068]">Portfolio value</span>
            <div className="mt-0.5 text-base">{fmtAud(summary.valueAud)}</div>
          </div>
          <div>
            <span className="text-[10px] uppercase tracking-wide text-[#505068]">Live capital gain</span>
            <div className={`mt-0.5 text-base ${summary.capitalGainAud >= 0 ? 'text-[#22C55E]' : 'text-[#EF4444]'}`}>
              {fmtAud(summary.capitalGainAud)}
            </div>
          </div>
        </div>
      </section>

      <section className="rounded-xl border border-[rgba(255,255,255,0.06)] bg-[#111118] p-5">
        <div className="mb-3 flex items-center justify-between gap-3">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-[#9090A8]">Allocation</h2>
          <span className="font-mono text-[10px] uppercase tracking-wide text-[#505068]">Open positions by AUD value</span>
        </div>
        {slices.length === 0 ? (
          <p className={`rounded-lg border border-[rgba(255,255,255,0.06)] px-4 py-8 text-center text-sm ${theme.muted}`}>
            No priced open positions yet.
          </p>
        ) : (
          <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_320px]">
            <div className="h-[280px]">
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie data={slices} dataKey="value" nameKey="name" cx="50%" cy="50%" innerRadius={62} outerRadius={96} paddingAngle={2}>
                    {slices.map((_, i) => (
                      <Cell key={`slice-${i}`} fill={DONUT_COLORS[i % DONUT_COLORS.length]} stroke="rgba(10,10,15,0.9)" strokeWidth={1} />
                    ))}
                  </Pie>
                  <Tooltip
                    formatter={(value, _name, item) => [
                      `${fmtAud(Number(value))} (${(item?.payload?.pct ?? 0).toFixed(1)}%)`,
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
                </PieChart>
              </ResponsiveContainer>
            </div>
            <div className="space-y-2 self-center">
              {slices.map((slice, i) => (
                <div key={slice.name} className="flex items-center justify-between gap-3 rounded-lg bg-[#0A0A0F] px-3 py-2 font-mono text-xs">
                  <span className="flex min-w-0 items-center gap-2">
                    <span className="h-2.5 w-2.5 rounded-full" style={{ background: DONUT_COLORS[i % DONUT_COLORS.length] }} />
                    <span className="truncate text-[#F0F0F8]">{slice.name}</span>
                  </span>
                  <span className="text-[#9090A8]">{slice.pct.toFixed(1)}%</span>
                </div>
              ))}
            </div>
          </div>
        )}
      </section>

      {sp.satelliteHydrated && rows.length > 0 ? (
        <SatellitePositionsTable tableCards={rows} onTypeChange={sp.savePositionType} />
      ) : null}

      {sp.satelliteHydrated && rows.length === 0 ? (
        <p className={`text-sm ${theme.muted}`}>No satellite holdings in Sharesight yet (or nothing to show in the table).</p>
      ) : null}
    </div>
  )
}

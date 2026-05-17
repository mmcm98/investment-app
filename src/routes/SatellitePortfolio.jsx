import { SatellitePositionsTable } from '../components/satellite/SatellitePositionsTable.jsx'
import { useSatellitePortfolio } from '../hooks/useSatellitePortfolio.js'
import { useInvTheme } from '../context/InvThemeContext.jsx'
import { DataStaleBanner } from '../components/ui/DataStaleBanner.jsx'
import { Skeleton } from '../components/ui/Skeleton.jsx'

function fmtPct(n) {
  if (n == null || !Number.isFinite(Number(n))) return ''
  return `${Number(n).toFixed(2)}%`
}

export function SatellitePortfolio() {
  const sp = useSatellitePortfolio()

  const theme = useInvTheme()

  async function onToggleAud(e) {
    await sp.setPrefShowAud(e.target.checked)
  }

  return (
    <div className={`mx-auto flex w-full max-w-screen-2xl flex-col gap-6 px-6 py-10 pb-24 lg:pb-10 ${theme.fg}`}>
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-[22px] font-semibold">Satellite portfolio</h1>
          <p className={`mt-2 max-w-[82ch] text-sm ${theme.muted}`}>
            Guidance-only allocation from scores (65% haircut threshold). Sharesight satellite holdings are the spine;
            Supabase positions carry locked FMP/Yahoo symbols and analysis state.
          </p>
        </div>
        <label className="flex cursor-pointer items-center gap-2 text-xs text-[#9090A8]">
          <input type="checkbox" checked={sp.showAudParenthetical} onChange={(e) => void onToggleAud(e)} />
          Show AUD parenthetical
        </label>
      </header>

      {!sp.satelliteHydrated ? (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <Skeleton className="min-h-[220px] rounded-xl" />

          <Skeleton className="min-h-[220px] rounded-xl" />

          <Skeleton className="min-h-[220px] rounded-xl md:col-span-2" />
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

      {sp.satelliteHydrated && sp.tableCards && sp.tableCards.length > 0 ? (
        <SatellitePositionsTable
          tableCards={/** @type {Record<string, unknown>[]} */ (sp.tableCards ?? [])}
          onTypeChange={sp.savePositionType}
        />
      ) : null}

      {sp.satelliteHydrated && (!sp.tableCards || sp.tableCards.length === 0) ? (
        <p className={`text-sm ${theme.muted}`}>No satellite holdings in Sharesight yet (or nothing to show in the table).</p>
      ) : null}
    </div>
  )
}

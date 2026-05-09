import { useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import { useSharesightIntegration } from '../context/SharesightIntegrationContext.jsx'
import { useDashboardData } from '../hooks/useDashboardData.js'
import { useSatellitePortfolio } from '../hooks/useSatellitePortfolio.js'
import { DEFAULT_BASE_WEEKLY_AUD, numOr } from '../lib/dca/computeWeeklyDca.js'
import { PortfolioHealthBar } from '../components/dashboard/PortfolioHealthBar.jsx'
import { DashboardAlerts } from '../components/dashboard/DashboardAlerts.jsx'
import { PortfolioTrendChart } from '../components/dashboard/PortfolioTrendChart.jsx'
import { DashboardSatelliteStrip, DashboardWatchPanel } from '../components/dashboard/DashboardPositionGrid.jsx'
import { PortfolioBalanceSnapshot } from '../components/dashboard/PortfolioBalanceSnapshot.jsx'
import { DcaWidget } from '../components/DcaWidget.jsx'

export function DashboardHome() {
  const navigate = useNavigate()

  const ss = useSharesightIntegration()

  const dash = useDashboardData()

  const sp = useSatellitePortfolio()

  const weeklyDcaBaseAud = dash.settingsRow ? numOr(dash.settingsRow.weekly_dca_base_aud, DEFAULT_BASE_WEEKLY_AUD) : DEFAULT_BASE_WEEKLY_AUD

  const perfCore = useMemo(
    () => (dash.perfCoreSeries ? dash.perfCoreSeries.map((p) => ({ isoDate: p.isoDate, value: p.value })) : null),
    [dash.perfCoreSeries],
  )

  const perfSat = useMemo(
    () => (dash.perfSatSeries ? dash.perfSatSeries.map((p) => ({ isoDate: p.isoDate, value: p.value })) : null),
    [dash.perfSatSeries],
  )

  const perfTotal = useMemo(
    () =>
      dash.perfTotalMerged && dash.perfTotalMerged.length > 0
        ? dash.perfTotalMerged.map((p) => ({ isoDate: p.isoDate, value: p.value }))
        : null,
    [dash.perfTotalMerged],
  )

  return (
    <div className="mx-auto flex w-full max-w-[1200px] flex-col gap-8 px-4 pb-8 text-[#F0F0F8] lg:px-10">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-[22px] font-semibold">Dashboard</h1>

          <p className="mt-2 max-w-[76ch] text-sm text-[#9090A8]">
            First-line portfolio health sourced from Sharesight plus Supabase overlays. Alerts respect native currency for buy
            zones; FX feeds valuation only.

          </p>
        </div>

        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            className="rounded-md border border-[rgba(255,255,255,0.12)] px-3 py-2 font-mono text-xs hover:border-[rgba(77,184,255,0.65)] hover:text-[#79CBFF] disabled:cursor-not-allowed disabled:opacity-40"
            onClick={() => void ss.refreshSharesightNow()}
            disabled={ss.reconnectRequired || ss.isSyncing}
          >
            {ss.isSyncing ? 'Sync…' : 'Refresh'}
          </button>

          <button
            type="button"
            className="rounded-md border border-[rgba(255,255,255,0.12)] px-3 py-2 font-mono text-xs hover:border-[rgba(77,184,255,0.65)] hover:text-[#79CBFF] disabled:cursor-not-allowed disabled:opacity-40"
            disabled={!ss.supabaseConfigured}
            onClick={async () => {
              await ss.signOut()

              navigate('/login', { replace: true })
            }}
          >
            Sign out
          </button>
        </div>
      </header>

      {dash.settingsRow?.global_api_pause === true ? (
        <div className="rounded-lg border border-[rgba(239,68,68,0.45)] bg-[rgba(239,68,68,0.09)] px-4 py-3 text-sm text-[#EF4444]">
          Global API pause is enabled — Gemini and Claude calls are halted until you unset{' '}

          <span className="font-mono text-[11px]">global_api_pause</span> on <span className="font-mono text-[11px]">user_settings</span>.

        </div>
      ) : null}

      {(ss.surfaceError ?? ss.lastSyncError) && holdingsPresent(ss.holdingsCount) ? (
        <div className="rounded-lg border border-[rgba(245,158,11,0.35)] bg-[rgba(245,158,11,0.08)] px-4 py-3">
          <p className="text-[10px] font-semibold uppercase tracking-wide text-[#F59E0B]">Sharesight diagnostics</p>

          <pre className="mt-2 max-h-48 overflow-auto font-mono text-[11px] text-[#F0F0F8]">{ss.surfaceError ?? ss.lastSyncError}</pre>
        </div>
      ) : null}

      {dash.loadError ? (
        <div className="rounded-lg border border-[rgba(239,68,68,0.35)] px-4 py-3 font-mono text-xs text-[#EF4444]">{dash.loadError}</div>
      ) : null}

      {sp.loadError ? (
        <div className="rounded-lg border border-[rgba(239,68,68,0.35)] px-4 py-3 font-mono text-xs text-[#EF4444]">{sp.loadError}</div>
      ) : null}

      <PortfolioHealthBar
        totalPortfolioAud={dash.totalPortfolioAud}

        investedCoreAud={dash.investedCoreAud}

        investedSatelliteAud={dash.investedSatelliteAud}

        totalCashAud={dash.totalCashAud}

        externalCashAud={dash.externalCashAud}

        brokerLines={dash.broker.breakdown}

        dayMoveAud={dash.dayMoveAud}

        dayPctOnInvested={dash.dayPctOnInvested}

        coreTargetPct={dash.coreTargetPct}

        satelliteTargetPct={dash.satelliteTargetPct}

        actualCorePctInvested={dash.actualCorePctInvested}

        actualSatPctInvested={dash.actualSatPctInvested}

        lastSuccessfulSyncAt={dash.lastSuccessfulSyncAt}

        onSyncNow={() => void ss.refreshSharesightNow()}

        isSyncing={ss.isSyncing}
      />

      <DashboardAlerts
        positions={dash.positions}
        mergedRows={dash.mergedRows}
        latestScoreByPid={dash.latestScoreByPid}
        dashboardPrefs={dash.dashboardPrefs}
        persistPrefs={dash.persistPrefs}
        weeklyDcaBaseAud={weeklyDcaBaseAud}
      />

      <PortfolioTrendChart
        perfTotal={perfTotal}
        perfCore={perfCore}
        perfSat={perfSat}

        totalCashAud={dash.totalCashAud}

        unrealisedAud={dash.unrealisedAud}
      />

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <DashboardSatelliteStrip cards={sp.cards} />

        <DashboardWatchPanel rows={dash.watchlistItems} scores={dash.latestScoreByWid} />
      </div>

      <DcaWidget allowBaseEdit density="dashboard" />

      <PortfolioBalanceSnapshot
        coreTargetPct={dash.coreTargetPct}
        satelliteTargetPct={dash.satelliteTargetPct}
        actualCorePctInvested={dash.actualCorePctInvested}
        actualSatPctInvested={dash.actualSatPctInvested}
        investedCoreAud={dash.investedCoreAud}
        investedSatelliteAud={dash.investedSatelliteAud}
        bookCoreAud={dash.bookCoreAud}
        bookSatelliteAud={dash.bookSatelliteAud}
      />

      <details className="rounded-lg border border-[rgba(255,255,255,0.06)] bg-[#111118] px-4 py-3 text-xs text-[#9090A8]">
        <summary className="cursor-pointer font-semibold text-[#F0F0F8]">Developer snapshots</summary>

        <ul className="mt-3 list-disc space-y-2 pl-4">
          <li>
            Sharesight holdings count:{' '}

            <span className="font-mono">{typeof ss.holdingsCount === 'number' ? ss.holdingsCount : '—'}</span>
          </li>

          <li>
            Perf series points (total merged):{' '}

            <span className="font-mono">{dash.perfTotalMerged?.length ?? 0}</span>
          </li>

          <li>Local quote batch: ensure `npm run dev:market-api` is running for `/api/market/batch` in development.</li>
        </ul>
      </details>
    </div>
  )
}

function holdingsPresent(/** @type {number|null} */ count) {

  return typeof count === 'number' && Number.isFinite(count) && count > 0


}

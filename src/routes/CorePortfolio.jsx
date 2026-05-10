import { useMemo } from 'react'

import { ExternalLink } from 'lucide-react'

import { useLivePrices } from '../context/LivePricesContext.jsx'

import { useSharesightIntegration } from '../context/SharesightIntegrationContext.jsx'

import { useInvTheme } from '../context/InvThemeContext.jsx'

import { useDashboardData } from '../hooks/useDashboardData.js'

import { useWeeklyDca } from '../hooks/useWeeklyDca.js'

import { mergeUserPreferences } from '../lib/settings/mergeUserPreferences.js'

import { SleevePortfolioDashboard } from '../components/portfolio/SleevePortfolioDashboard.jsx'

import { actualCoreSleevePct } from '../lib/core/coreActualAllocation.js'

import { DataStaleBanner } from '../components/ui/DataStaleBanner.jsx'

import { MotionCard } from '../components/ui/MotionCard.jsx'

import { Skeleton } from '../components/ui/Skeleton.jsx'

/** @param {number | null | undefined} n */

function fmtAud(n) {
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

  return `${n.toFixed(2)}%`
}

/** @param {{ label: string, children?: import('react').ReactNode, mono?: boolean }} p */

function Metric({ label, children, mono = true }) {
  return (
    <div className="min-w-0">
      <p className="text-[10px] font-medium uppercase tracking-wide text-[#505068]">{label}</p>

      <div className={`mt-1 text-sm ${mono ? 'font-mono font-medium text-[#F0F0F8]' : 'font-sans text-[#D6D6E8]'}`}>{children}</div>
    </div>
  )
}

export function CorePortfolio() {
  const { userPresent, supabaseConfigured } = useSharesightIntegration()

  const theme = useInvTheme()

  const dash = useDashboardData()

  const dca = useWeeklyDca()

  const { mergedRows, pricesUpdating } = useLivePrices()

  const benchSymbol = useMemo(() => {
    const p = mergeUserPreferences(dash.settingsRow?.preferences)

    const s = p.benchmarks?.default_symbol

    return typeof s === 'string' && s.trim() ? s.trim() : 'VGS.AX'
  }, [dash.settingsRow?.preferences])

  const rowsWithActual = useMemo(
    () =>
      dca.rows.map((r) => ({
        ...r,
        actualSleevePct: actualCoreSleevePct(mergedRows, r.ticker),
      })),

    [dca.rows, mergedRows],
  )

  if (!supabaseConfigured || !userPresent) {
    return (
      <div className={`mx-auto w-full max-w-[1200px] space-y-4 px-4 py-6 pb-24 lg:px-10 lg:pb-10 ${theme.fg}`}>
        <h1 className="font-sans text-[22px] font-semibold">Core portfolio</h1>

        <p className={`text-sm ${theme.muted}`}>Sign in to view your core sleeve.</p>
      </div>
    )
  }

  if (!dca.weeklyDcaHydrated) {
    return (
      <div className={`mx-auto w-full max-w-[1200px] space-y-6 px-4 py-6 pb-24 lg:px-10 lg:pb-10 ${theme.fg}`}>
        <Skeleton className="h-8 w-[220px]" />

        <Skeleton className="h-4 max-w-xl" />

        <div className="space-y-4">
          <Skeleton className="h-[168px] w-full rounded-xl" />

          <Skeleton className="h-[168px] w-full rounded-xl" />

          <Skeleton className="h-[168px] w-full rounded-xl" />

        </div>
      </div>
    )
  }

  return (
    <div className={`mx-auto w-full max-w-[1200px] space-y-6 px-4 py-6 pb-24 lg:px-10 lg:pb-10 ${theme.fg}`}>
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="font-sans text-[22px] font-semibold">Core portfolio</h1>

          <p className={`mt-2 max-w-[76ch] text-sm ${theme.muted}`}>
            Active ETFs from <span className="font-mono text-[12px] text-[#79CBFF]">core_etfs</span> with live quotes, ATH distance, DCA
            tiers, and sleeve-level weights from Sharesight core holdings.

          </p>
        </div>

        <div className="text-right font-mono text-[10px] text-[#505068]">
          {pricesUpdating ? <span className="text-[#79CBFF]">Updating prices…</span> : <span>Quotes idle</span>}
        </div>
      </header>

      <SleevePortfolioDashboard
        portfolioRole="core"
        perfSeries={dash.perfCoreSeries}
        benchSymbol={benchSymbol}
        dashboardHydrated={dash.dashboardHydrated}
      />

      {dca.loadError ? (
        <DataStaleBanner
          message={dca.loadError}
          context={
            dca.hasRecoverableWeeklyDcaData
              ? 'Core ladder and tiers reflect the last loaded `core_etfs` + settings row.'
              : 'Could not hydrate core ETFs yet — retry after confirming RLS/network.'
          }
        />
      ) : null}

      {!dca.hasSettingsRow ? (
        <p className="rounded-lg border border-[rgba(255,255,255,0.06)] bg-[#111118] px-4 py-3 text-xs text-[#9090A8]">
          No <span className="font-mono">user_settings</span> row yet — weekly base defaults to{' '}

          <span className="font-mono text-[#F0F0F8]">A$350</span> until persisted.

        </p>
      ) : null}

      {Number.isFinite(dca.weightSum) && Math.abs(dca.weightSum - 100) > 0.05 ? (
        <div className="rounded-lg border border-[rgba(245,158,11,0.35)] bg-[rgba(245,158,11,0.08)] px-4 py-3 text-xs text-[#FCD34D]">
          Active core ETF target weights sum to <span className="font-mono">{dca.weightSum.toFixed(2)}%</span> — adjust in Settings §10.8
          for a 100% ladder.

        </div>
      ) : null}

      <div className="space-y-5">
        {rowsWithActual.length === 0 ? (
          <div className="rounded-xl border border-[rgba(255,255,255,0.06)] bg-[#111118] px-5 py-10 text-center text-sm text-[#9090A8]">
            No active core ETFs. Add non-archived rows in <span className="font-mono text-[#79CBFF]">core_etfs</span>.

          </div>
        ) : (
          rowsWithActual.map((r) => (
            <MotionCard
              key={r.ticker}
              className="rounded-xl border border-[rgba(255,255,255,0.06)] bg-[#111118] p-5 shadow-[inset_0_1px_0_rgba(255,255,255,0.04)] transition-colors duration-150 hover:border-[rgba(77,184,255,0.22)]"
            >
              <div className="flex flex-wrap items-start justify-between gap-3 border-b border-[rgba(255,255,255,0.06)] pb-4">
                <div className="min-w-0">
                  <p className="font-mono text-[13px] font-medium tracking-tight text-[#79CBFF]">{r.ticker}</p>

                  <h2 className="mt-1 font-sans text-sm font-semibold text-[#F0F0F8]">
                    {r.displayName && r.displayName.trim() ? r.displayName : '—'}

                  </h2>

                  <p className="mt-1 font-mono text-[10px] capitalize text-[#505068]">
                    Schedule: {r.scheduleLabel}

                    {!r.quoteMatched ? <span className="ml-2 text-[#F59E0B]">· no quote match</span> : null}

                  </p>
                </div>

                {r.providerPageUrl ? (
                  <a
                    href={r.providerPageUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1.5 rounded-md border border-[rgba(77,184,255,0.45)] px-3 py-2 font-mono text-[11px] text-[#79CBFF] transition-colors duration-150 hover:border-[rgba(77,184,255,0.75)] hover:bg-[rgba(77,184,255,0.08)]"
                  >
                    Provider

                    <ExternalLink className="h-3.5 w-3.5 opacity-80" aria-hidden />

                  </a>
                ) : null}

              </div>

              <div className="mt-4 grid grid-cols-2 gap-4 md:grid-cols-3 lg:grid-cols-4">
                <Metric label="Live price (AUD)">{fmtAud(r.priceAud)}</Metric>

                <Metric label="ATH (AUD)">{fmtAud(r.athAud)}</Metric>

                <Metric label="Distance from ATH">{fmtPct(r.distancePct)}</Metric>

                <Metric label="DCA tier" mono={false}>
                  <span className="font-mono text-sm font-medium text-[#F0F0F8]">{r.tierBandLabel}</span>

                </Metric>

                <Metric label="Tier multiplier">
                  {r.multiplier != null && Number.isFinite(r.multiplier)
                    ? `${r.multiplier}× (${r.multiplierLabel})`

                    : r.multiplierLabel}

                </Metric>

                <Metric label="This week (AUD)">
                  <span className="text-[#4DB8FF]">{r.multiplier === 0 ? fmtAud(0) : fmtAud(r.contributionAud)}</span>

                </Metric>

                <Metric label="Target weight %">
                  <span>{r.allocationPct.toFixed(2)}%</span>

                </Metric>

                <Metric label="Actual (core sleeve) %">

                  <span className={r.actualSleevePct != null ? 'text-[#22C55E]' : ''}>{fmtPct(r.actualSleevePct)}</span>

                </Metric>

                <Metric label="True exposure %">

                  <span>{r.trueExposurePct != null ? `${r.trueExposurePct.toFixed(2)}%` : '—'}</span>

                </Metric>

                <Metric label="Gearing multiple">
                  {r.gearingFromDb != null ? (
                    <span>{r.gearingFromDb.toFixed(2)}×</span>
                  ) : (
                    <span className="text-[#505068]">
                      Not set

                      <span className="mt-0.5 block font-mono text-[10px] text-[#404050]">using {r.gearingFactor.toFixed(2)}× default for maths</span>

                    </span>
                  )}

                </Metric>

              </div>

            </MotionCard>
          ))
        )}

      </div>

      {rowsWithActual.length > 0 ? (
        <footer className="rounded-xl border border-[rgba(77,184,255,0.35)] bg-[rgba(77,184,255,0.06)] px-5 py-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="text-[10px] font-medium uppercase tracking-wide text-[#505068]">Total weekly contribution (core)</p>

            <p className="font-mono text-xl font-medium text-[#4DB8FF]">{fmtAud(dca.totalWeekly)}</p>

          </div>

          <p className="mt-2 font-mono text-[10px] text-[#505068]">
            Base {fmtAud(dca.baseWeeklyAud)} · sums per-ETF contributions from <span className="text-[#9090A8]">useWeeklyDca</span>

          </p>

        </footer>
      ) : null}

    </div>
  )
}

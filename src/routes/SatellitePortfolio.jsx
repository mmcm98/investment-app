import { Link } from 'react-router-dom'
import { AddTickerCombobox } from '../components/satellite/AddTickerCombobox.jsx'
import { useSatellitePortfolio } from '../hooks/useSatellitePortfolio.js'
import { useInvTheme } from '../context/InvThemeContext.jsx'
import { DataStaleBanner } from '../components/ui/DataStaleBanner.jsx'
import { MotionCard } from '../components/ui/MotionCard.jsx'
import { Skeleton } from '../components/ui/Skeleton.jsx'

function fmtPct(n) {
  if (n == null || !Number.isFinite(Number(n))) return ''
  return `${Number(n).toFixed(2)}%`
}

function fmtPxNative(n, cur) {
  if (n == null || !Number.isFinite(Number(n))) return ''
  try {
    return `${Number(n).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 4 })} ${cur ?? ''}`.trim()
  } catch {
    return `${n}`
  }
}

function fmtAudParen(n) {
  if (n == null || !Number.isFinite(Number(n))) return ''
  return ` (${n.toLocaleString('en-AU', { style: 'currency', currency: 'AUD', minimumFractionDigits: 2 })})`
}

export function SatellitePortfolio() {
  const sp = useSatellitePortfolio()

  const theme = useInvTheme()

  async function onToggleAud(e) {
    await sp.setPrefShowAud(e.target.checked)
  }

  return (
    <div className={`mx-auto flex w-full max-w-[1200px] flex-col gap-6 px-4 py-10 pb-24 lg:pb-10 lg:px-10 ${theme.fg}`}>
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

      <AddTickerCombobox onCreated={() => void sp.refresh()} />

      <section className="grid grid-cols-1 gap-5 md:grid-cols-2">
        {sp.satelliteHydrated
          ? sp.cards.map((c) => {
          const q = c.mergedQuote
          /** @type {Record<string, unknown>|null} */
          const pos = /** @type {Record<string, unknown>|null} */ (c.position)
          const holding = /** @type {Record<string, unknown>|null} */ (c.holding)

          const currencyLabel =
            `${(pos && Reflect.get(pos, 'currency')) ?? ''}`.trim() ||
            `${holding ? Reflect.get(holding, 'currency') ?? '' : ''}`.trim() ||
            '—'

          const native =
            typeof q?.display_native === 'number'
              ? q.display_native
              : typeof q?.last_price === 'number'
                ? q.last_price
                : null
          const aud = typeof q?.display_aud === 'number' ? q.display_aud : null
          const chg = typeof q?.change_percent === 'number' ? q.change_percent : null

          const showMonitor = !c.awaitingAnalysis && c.overallScore != null && c.overallScore >= 65

          let buyZones = []
          if (Array.isArray(pos?.buy_zones)) buyZones = pos.buy_zones
          let exits = []
          if (Array.isArray(pos?.exit_triggers)) exits = pos.exit_triggers

          const href = c.positionId ? `/satellite/position/${c.positionId}` : null

          return (
            <MotionCard
              key={c.rowKey}
              className="flex flex-col rounded-xl border border-[rgba(255,255,255,0.06)] bg-[#111118] px-5 py-4 shadow-[inset_0_1px_0_rgba(255,255,255,0.04)]"
            >
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <div className="flex flex-wrap items-center gap-2">
                    <h2 className="font-mono text-lg text-[#4DB8FF]">{c.ticker}</h2>
                    {c.awaitingAnalysis ? (
                      <span className="rounded border border-[rgba(245,158,11,0.45)] px-2 py-0.5 font-mono text-[10px] uppercase tracking-wide text-[#FCD34D]">
                        Awaiting analysis
                      </span>
                    ) : null}
                    {c.assetClass ? (
                      <span className="rounded-full border border-[rgba(255,255,255,0.1)] bg-[#1A1A24] px-2 py-0.5 font-mono text-[10px] capitalize text-[#9090A8]">
                        {c.assetClass}
                      </span>
                    ) : null}
                  </div>

                  <p className="mt-1 text-sm text-[#F0F0F8]">{c.displayName}</p>
                  <p className="mt-2 line-clamp-3 text-xs leading-relaxed text-[#9090A8]">{c.synopsis}</p>
                </div>

                {href ? (
                  <Link
                    className="inline-flex min-h-[44px] shrink-0 items-center rounded-md border border-[rgba(255,255,255,0.12)] px-3 py-2 font-mono text-xs text-[#79CBFF] touch-manipulation hover:border-[rgba(77,184,255,0.55)]"
                    to={href}
                  >
                    Open
                  </Link>
                ) : (
                  <div className="shrink-0 font-mono text-[10px] text-[#505068]">
                    Link a Supabase row (add via search) for detail + allocation controls.
                  </div>
                )}
              </div>

              <dl className="mt-4 grid grid-cols-2 gap-x-4 gap-y-3 text-xs font-mono text-[#9090A8] md:grid-cols-4 tabular-nums">
                <div>
                  <dt className="font-mono text-[10px] uppercase tracking-wide text-[#505068]">Score</dt>
                  <dd className="mt-1 font-mono text-sm text-[#F0F0F8]">
                    {c.overallScore != null ? `${Number(c.overallScore).toFixed(1)}%` : '—'}
                  </dd>
                </div>
                <div>
                  <dt className="font-mono text-[10px] uppercase tracking-wide text-[#505068]">Tier</dt>
                  <dd className="mt-1 font-mono text-sm text-[#F0F0F8]">{c.tier ?? '—'}</dd>
                </div>
                <div>
                  <dt className="font-mono text-[10px] uppercase tracking-wide text-[#505068]">Live (native)</dt>
                  <dd className="mt-1 font-mono text-sm text-[#F0F0F8]">
                    {fmtPxNative(native, currencyLabel)}
                    {c.showAudPar && aud != null ? <span className="text-[#505068]">{fmtAudParen(aud)}</span> : null}
                    {chg != null && Number.isFinite(Number(chg)) ? (
                      <span className={`ml-2 font-mono text-[11px] ${Number(chg) >= 0 ? 'text-[#22C55E]' : 'text-[#EF4444]'}`}>
                        {Number(chg) >= 0 ? '+' : ''}
                        {Number(chg).toFixed(2)}%
                      </span>
                    ) : null}
                  </dd>
                </div>
                <div>
                  <dt className="font-mono text-[10px] uppercase tracking-wide text-[#505068]">Alloc (T / A / drift)</dt>
                  <dd className="mt-1 font-mono text-xs leading-snug text-[#F0F0F8]">
                    {fmtPct(c.targetGuidancePct)} tgt · {fmtPct(c.actualWeightPct)} actual
                    <span
                      className={`mt-0.5 block font-mono text-[11px] ${
                        c.driftPct != null && Math.abs(c.driftPct) > 10 ? 'text-[#F59E0B]' : 'text-[#505068]'
                      }`}
                    >
                      {c.driftPct != null ? `Δ ${c.driftPct >= 0 ? '+' : ''}${c.driftPct.toFixed(2)}% drift` : '—'}
                    </span>
                  </dd>
                </div>
              </dl>

              {c.positionId ? (
                <div className="mt-4 rounded-lg border border-[rgba(255,255,255,0.05)] bg-[#0A0A0F] px-3 py-2">
                  <p className="font-mono text-[10px] uppercase tracking-wide text-[#505068]">Manual target % (guidance)</p>
                  <form
                    className="mt-2 flex flex-wrap items-end gap-2"
                    onSubmit={(e) => {
                      e.preventDefault()
                      const fd = new FormData(e.currentTarget)
                      const raw = fd.get('ov')
                      if (raw === '' || raw == null) {
                        void sp.saveAllocationOverride(c.positionId, null, '')
                        return
                      }
                      const n = Number.parseFloat(`${raw}`)
                      if (!Number.isFinite(n)) return
                      const noteFd = fd.get('note')
                      void sp.saveAllocationOverride(c.positionId, n, typeof noteFd === 'string' ? noteFd : '')
                    }}
                  >
                    <input
                      name="ov"
                      type="number"
                      step="0.0001"
                      min={0}
                      max={100}
                      defaultValue={c.allocationOverridePct != null ? String(c.allocationOverridePct) : ''}
                      placeholder="Auto"
                      className="w-[120px] rounded border border-[rgba(255,255,255,0.12)] bg-[#1A1A24] px-2 py-1 font-mono text-xs"
                    />

                    <input
                      name="note"
                      type="text"
                      defaultValue={c.allocationOverrideNote ?? ''}
                      placeholder="Note (logged)"
                      className="min-w-[180px] flex-1 rounded border border-[rgba(255,255,255,0.12)] bg-[#1A1A24] px-2 py-1 font-mono text-xs"
                    />

                    <button
                      type="submit"
                      className="min-h-[44px] rounded-md bg-[#4DB8FF] px-3 py-2 font-mono text-xs font-semibold text-[#0A0A0F]"
                    >
                      Save
                    </button>

                    <button
                      type="button"
                      className="min-h-[44px] rounded-md border border-[rgba(255,255,255,0.12)] px-3 py-2 font-mono text-xs touch-manipulation"
                      onClick={() => void sp.saveAllocationOverride(c.positionId, null, '')}
                    >
                      Clear override
                    </button>
                  </form>
                </div>
              ) : (
                <div className="mt-4">
                  <AddTickerCombobox
                    prefilledSymbol={c.ticker === '—' ? '' : c.ticker}
                    sharesightHoldingExternalId={c.holding ? `${Reflect.get(c.holding, 'holding_external_id') ?? ''}` : null}
                    onCreated={() => void sp.refresh()}
                  />
                </div>
              )}

              {showMonitor && buyZones.length > 0 ? (
                <div className="mt-3 rounded-lg border border-[rgba(34,197,94,0.35)] bg-[rgba(34,197,94,0.06)] px-3 py-2 text-xs">
                  <span className="font-mono text-[10px] uppercase tracking-wide text-[#22C55E]">Buy zones active</span>
                  <p className="mt-2 text-[11px] text-[#A7F3D0]">
                    Compare prices and structural floors using the{' '}
                    <span className="font-semibold text-[#DCFCE7]">listing/native currency only</span> — not AUD equivalents.
                  </p>
                  <pre className="mt-2 max-h-[140px] overflow-auto font-mono text-[11px] text-[#F0F0F8] tabular-nums">
                    {JSON.stringify(buyZones, null, 2)}
                  </pre>
                </div>
              ) : buyZones.length > 0 ? (
                <div className="mt-3 rounded-lg border border-[rgba(255,255,255,0.05)] px-3 py-2 font-mono text-[10px] text-[#505068]">
                  Buy-zone monitoring suppressed until first scorecard exists and score is at least 65% (CLAUDE).
                </div>
              ) : null}

              {showMonitor && exits.length > 0 ? (
                <div className="mt-3 rounded-lg border border-[rgba(239,68,68,0.35)] bg-[rgba(239,68,68,0.06)] px-3 py-2 text-xs">
                  <span className="font-mono text-[10px] uppercase tracking-wide text-[#EF4444]">Exit triggers</span>
                  <pre className="mt-2 max-h-[120px] overflow-auto font-mono text-[11px] text-[#F0F0F8]">{JSON.stringify(exits, null, 2)}</pre>
                </div>
              ) : null}
            </MotionCard>
          )
          })
          : null}
      </section>

      {sp.satelliteHydrated && sp.cards.length === 0 ? (
        <p className={`text-sm ${theme.muted}`}>No satellite holdings in Sharesight yet (or everything filtered as cash-like).</p>
      ) : null}
    </div>
  )
}

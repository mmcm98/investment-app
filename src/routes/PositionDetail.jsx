import { Link, useParams } from 'react-router-dom'
import { useMemo } from 'react'
import { useLivePrices } from '../context/LivePricesContext.jsx'
import { usePositionDetail } from '../hooks/usePositionDetail.js'
import { tickersLooselyEqual } from '../lib/dca/tickerMatch.js'
import { numOrNull } from '../lib/satellite/satelliteMerge.js'

/** @param {Record<string, unknown>|null} p */
/** @returns {unknown} */
function rz(p, k) {
  return p && typeof p === 'object' ? Reflect.get(p, k) : undefined
}

export function PositionDetail() {
  const { id } = useParams()
  const det = usePositionDetail(id)
  const lp = useLivePrices()

  const yahoo = det.position ? `${rz(det.position, 'yahoo_symbol') ?? ''}`.trim() : ''
  const fmp = det.position ? `${rz(det.position, 'fmp_symbol') ?? ''}`.trim() : ''

  const quote = useMemo(() => {
    return lp.mergedRows.find(
      (m) =>
        `${m.portfolio_role ?? ''}`.toLowerCase() === 'satellite' &&
        (tickersLooselyEqual(m.yahoo_symbol, yahoo) || tickersLooselyEqual(m.instrument_symbol, fmp)),
    )
  }, [lp.mergedRows, yahoo, fmp])

  const overall = det.scorecardFull ? numOrNull(rz(det.scorecardFull, 'overall_score')) : null

  const awaiting = det.position ? Boolean(rz(det.position, 'awaiting_analysis')) : true

  const hasScorecard = Boolean(det.scorecardFull)

  const showBuyMonitor = !awaiting && overall != null && overall >= 65

  const buyZones = Array.isArray(rz(det.position, 'buy_zones')) ? /** @type {unknown[]} */ (rz(det.position, 'buy_zones')) : []

  const exits = Array.isArray(rz(det.position, 'exit_triggers')) ? /** @type {unknown[]} */ (rz(det.position, 'exit_triggers')) : []

  const cur = det.position ? `${rz(det.position, 'currency') ?? ''}`.trim() : '—'

  const native = quote && typeof quote.display_native === 'number' ? quote.display_native : quote && typeof quote.last_price === 'number' ? quote.last_price : null

  const aud = quote && typeof quote.display_aud === 'number' ? quote.display_aud : null

  const chg = quote && typeof quote.change_percent === 'number' ? quote.change_percent : null

  if (det.loadError) {
    return (
      <div className="p-10 font-mono text-sm text-[#EF4444]">
        {det.loadError}{' '}
        <Link className="text-[#79CBFF]" to="/satellite">
          Back
        </Link>
      </div>
    )
  }

  if (!det.position) {
    return (
      <div className="p-10 text-sm text-[#9090A8]">
        Position not found.{' '}
        <Link className="text-[#79CBFF]" to="/satellite">
          Satellite
        </Link>
      </div>
    )
  }

  return (
    <div className="mx-auto flex w-full max-w-[1200px] flex-col gap-6 p-10 text-[#F0F0F8]">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <Link className="font-mono text-xs text-[#79CBFF]" to="/satellite">
            ← Satellite
          </Link>

          <h1 className="mt-3 text-[22px] font-semibold">{`${rz(det.position, 'display_ticker') ?? fmp}`}</h1>

          <p className="mt-2 text-sm text-[#9090A8]">{`${rz(det.position, 'name') ?? ''}`}</p>
        </div>

        <div className="flex flex-col gap-2">
          <label className="font-mono text-[10px] uppercase tracking-wide text-[#505068]">Scorecard version</label>

          {det.versionManifest.length > 0 ? (
            <select
              className="min-w-[220px] rounded-lg border border-[rgba(255,255,255,0.12)] bg-[#1A1A24] px-3 py-2 font-mono text-xs"
              value={det.selectedVersionId ?? ''}
              onChange={(e) => void det.selectScorecardVersion(e.target.value)}
            >
              {det.versionManifest.map((v) => {
                const vid = `${rz(v, 'id')}`
                const vn = rz(v, 'version_number')
                const gen = rz(v, 'generated_at')
                return (
                  <option key={vid} value={vid}>
                    v{vn} · {gen ? `${gen}` : '—'}
                  </option>
                )
              })}
            </select>
          ) : (
            <p className="font-mono text-xs text-[#505068]">No scored versions yet (lazy-load when available).</p>
          )}

          {det.versionLoadError ? <p className="font-mono text-[11px] text-[#EF4444]">{det.versionLoadError}</p> : null}
        </div>
      </div>

      <section className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <div className="rounded-xl border border-[rgba(255,255,255,0.06)] bg-[#111118] px-5 py-4">
          <p className="text-[10px] font-semibold uppercase tracking-wide text-[#505068]">Live data</p>

          <dl className="mt-4 space-y-2 font-mono text-sm">
            <div className="flex justify-between gap-4 border-b border-[rgba(255,255,255,0.05)] pb-2">
              <dt className="text-[#505068]">Last (native)</dt>

              <dd>
                {native != null ? `${native.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 4 })} ${cur}` : '—'}

                {det.showAudParenthetical && aud != null ? (
                  <span className="text-xs text-[#505068]">
                    {' '}
                    (
                    {aud.toLocaleString('en-AU', { style: 'currency', currency: 'AUD', minimumFractionDigits: 2 })})
                  </span>
                ) : null}
              </dd>
            </div>

            <div className="flex justify-between gap-4 pb-2">
              <dt className="text-[#505068]">Daily Δ</dt>

              <dd className={chg != null && chg >= 0 ? 'text-[#22C55E]' : 'text-[#EF4444]'}>
                {chg != null ? `${chg >= 0 ? '+' : ''}${chg.toFixed(2)}%` : '—'}
              </dd>
            </div>

            <div className="flex justify-between gap-4 pb-2">
              <dt className="text-[#505068]">FMP / Yahoo (locked)</dt>

              <dd className="text-right text-[11px] text-[#79CBFF]">
                <div>{fmp}</div>

                <div>{yahoo}</div>
              </dd>
            </div>
          </dl>
        </div>

        <div className="rounded-xl border border-[rgba(255,255,255,0.06)] bg-[#111118] px-5 py-4">
          <p className="text-[10px] font-semibold uppercase tracking-wide text-[#505068]">Scorecard</p>

          {det.scorecardFull ? (
            <div className="mt-4 space-y-2 text-xs text-[#9090A8]">
              <div className="flex flex-wrap justify-between gap-2">
                <span>Framework · {`${rz(det.scorecardFull, 'framework') ?? ''}`}</span>

                <span className="font-mono text-[#4DB8FF]">
                  {overall != null ? `${overall.toFixed(1)}%` : '—'} overall
                </span>
              </div>

              <pre className="max-h-[320px] overflow-auto rounded-lg bg-[#0A0A0F] p-3 font-mono text-[11px] text-[#F0F0F8]">
                {JSON.stringify(rz(det.scorecardFull, 'payload') ?? {}, null, 2)}
              </pre>
            </div>
          ) : (
            <p className="mt-4 text-sm text-[#505068]">No scorecard for this selection yet.</p>
          )}
        </div>
      </section>

      <section className="rounded-xl border border-[rgba(255,255,255,0.06)] bg-[#111118] px-5 py-4">
        <p className="text-[10px] font-semibold uppercase tracking-wide text-[#505068]">Research paper</p>

        {det.researchFull ? (
          <pre className="mt-4 max-h-[460px] overflow-auto rounded-lg bg-[#0A0A0F] p-4 font-mono text-[11px] text-[#F0F0F8]">
            {JSON.stringify(rz(det.researchFull, 'payload') ?? {}, null, 2)}
          </pre>
        ) : (
          <p className="mt-4 text-sm text-[#505068]">{hasScorecard ? 'No research artefact tied to this version.' : 'Awaiting analysis.'}</p>
        )}
      </section>

      <section className="rounded-xl border border-[rgba(255,255,255,0.06)] bg-[#111118] px-5 py-4">
        <p className="text-[10px] font-semibold uppercase tracking-wide text-[#505068]">Buy zones & exit triggers</p>

        {showBuyMonitor && buyZones.length > 0 ? (
          <pre className="mt-4 max-h-[220px] overflow-auto rounded-lg border border-[rgba(34,197,94,0.25)] bg-[rgba(34,197,94,0.05)] p-3 font-mono text-[11px]">
            {JSON.stringify(buyZones, null, 2)}
          </pre>
        ) : buyZones.length > 0 ? (
          <p className="mt-4 font-mono text-[11px] text-[#505068]">
            Buy-zone monitoring suppressed until first scorecard and score is at least 65%.
          </p>
        ) : (
          <p className="mt-4 text-sm text-[#505068]">No buy zones stored.</p>
        )}

        {exits.length > 0 ? (
          <pre className="mt-4 max-h-[200px] overflow-auto rounded-lg border border-[rgba(239,68,68,0.25)] bg-[rgba(239,68,68,0.06)] p-3 font-mono text-[11px]">
            {JSON.stringify(exits, null, 2)}
          </pre>
        ) : (
          <p className="mt-4 text-sm text-[#505068]">No exit triggers stored.</p>
        )}
      </section>
    </div>
  )
}

import { useState } from 'react'
import { useSharesightIntegration } from '../context/SharesightIntegrationContext.jsx'
import { useWeeklyDca } from '../hooks/useWeeklyDca.js'

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

/** @typedef {{ allowBaseEdit?: boolean, density?: 'default'|'dashboard' }} DcaOpts */

/** @param {DcaOpts} [opts] */

export function DcaWidget(opts = {}) {
  const allowBaseEdit = Boolean(opts.allowBaseEdit)

  const density = opts.density ?? 'default'

  const supa = useSharesightIntegration()

  const dca = useWeeklyDca()

  /** @type {[string|null, import('react').Dispatch<import('react').SetStateAction<string|null>>]} */

  const [manualBaseDraft, setManualBaseDraft] = useState(null)

  const [baseErr, setBaseErr] = useState(/** @type {string|null} */ (null))

  const [busy, setBusy] = useState(false)

  const baseDraft = manualBaseDraft ?? dca.baseWeeklyAud.toFixed(2)

  const bindBaseDraft = /** @type {import('react').ChangeEventHandler<HTMLInputElement>} */ ((e) => {
    setManualBaseDraft(e.target.value)
  })

  if (!dca.supabaseConfigured || !dca.userPresent) return null

  const mt = density === 'dashboard' ? 'mt-0' : 'mt-8'

  return (
    <div className={`${mt} rounded-xl border border-[rgba(255,255,255,0.06)] bg-[#111118] px-5 py-4 shadow-[inset_0_1px_0_rgba(255,255,255,0.04)]`}>
      <div className="flex flex-wrap items-start justify-between gap-3 border-b border-[rgba(255,255,255,0.06)] pb-4">
        <div className="min-w-0 flex-1">
          <p className="text-[10px] font-medium uppercase tracking-wide text-[#505068]">Weekly DCA (core)</p>
          <p className="mt-2 text-xs text-[#9090A8]">
            Weekly base&nbsp;
            {allowBaseEdit ? (
              <span className="inline-flex flex-wrap items-center gap-2">
                <input
                  className="w-32 rounded border border-[rgba(255,255,255,0.12)] bg-[#1A1A24] px-2 py-1 font-mono text-xs text-[#F0F0F8]"
                  value={baseDraft}
                  onChange={bindBaseDraft}
                  inputMode="decimal"
                />

                <button
                  type="button"
                  disabled={busy}
                  className="rounded border border-[rgba(77,184,255,0.45)] px-2 py-1 font-mono text-[10px] text-[#79CBFF] disabled:opacity-40"
                  onClick={async () => {
                    setBaseErr(null)

                    const n = Number.parseFloat(baseDraft.replace(/,/g, ''))

                    if (!Number.isFinite(n) || n < 0 || n > 1_000_000) {
                      setBaseErr('Enter a plausible AUD amount.')

                      return
                    }

                    if (!supa.supabase) return

                    setBusy(true)

                    try {
                      const { data: ud } = await supa.supabase.auth.getUser()

                      const uid = ud.user?.id

                      if (!uid) throw new Error('Not signed in.')

                      const { error } = await supa.supabase
                        .from('user_settings')
                        .upsert(
                          {
                            user_id: uid,
                            weekly_dca_base_aud: n,
                            updated_at: new Date().toISOString(),
                          },

                          { onConflict: 'user_id' },

                        )

                      if (error) throw error

                      setManualBaseDraft(null)

                      dca.reloadWeeklyDca()
                    } catch (e) {
                      setBaseErr(e instanceof Error ? e.message : String(e))
                    } finally {
                      setBusy(false)
                    }
                  }}
                >
                  Save base
                </button>
              </span>

            ) : (
              <span className="font-mono text-[#F0F0F8]">{fmtAud(dca.baseWeeklyAud)}</span>
            )}
            {' '}
            · tier schedules via Supabase (Standard / GHHF / Custom) · 0× within 1.5% of ATH forfeits that sleeve (no redistribution).
          </p>

          {baseErr ? <p className="mt-2 font-mono text-[11px] text-[#EF4444]">{baseErr}</p> : null}
        </div>
        <div className="text-right">
          <p className="text-[10px] font-medium uppercase tracking-wide text-[#505068]">Total this week</p>
          <p className="mt-1 font-mono text-lg text-[#4DB8FF]">{fmtAud(dca.totalWeekly)}</p>
        </div>
      </div>

      {dca.loadError ? (
        <p className="mt-4 font-mono text-xs text-[#EF4444]">{dca.loadError}</p>
      ) : null}

      {!dca.hasSettingsRow ? (
        <p className="mt-4 text-xs text-[#9090A8]">
          No <span className="font-mono">user_settings</span> row yet — using default base{' '}
          <span className="font-mono text-[#F0F0F8]">A$350</span> and canonical Standard / GHHF ladders until you persist
          settings in Supabase.
        </p>
      ) : null}

      {Number.isFinite(dca.weightSum) && Math.abs(dca.weightSum - 100) > 0.05 ? (
        <div className="mt-4 rounded-lg border border-[rgba(245,158,11,0.35)] bg-[rgba(245,158,11,0.08)] px-3 py-2 text-xs text-[#FCD34D]">
          Active core ETF weights sum to <span className="font-mono">{dca.weightSum.toFixed(2)}%</span> (expected ~100%
          for allocation-of-core semantics).
        </div>
      ) : null}

      <div className="mt-5 overflow-x-auto">
        <table className="w-full min-w-[960px] border-collapse text-left text-sm">
          <thead>
            <tr className="border-b border-[rgba(255,255,255,0.06)] text-[10px] font-semibold uppercase tracking-wide text-[#505068]">
              <th className="py-3 pr-3 font-mono">ETF</th>
              <th className="py-3 pr-3">Schedule</th>
              <th className="py-3 pr-3 text-right font-mono">Alloc %</th>
              <th className="py-3 pr-3 text-right font-mono">Price</th>
              <th className="py-3 pr-3 text-right font-mono">ATH</th>
              <th className="py-3 pr-3 text-right font-mono">Δ ATH</th>
              <th className="py-3 pr-3">Tier</th>
              <th className="py-3 pr-3 font-mono">Mult</th>
              <th className="py-3 pr-3 text-right font-mono">Contrib.</th>
              <th className="py-3 pr-3 text-right font-mono" title="allocation × gearing (info only)">
                True exp. %
              </th>
            </tr>
          </thead>
          <tbody>
            {dca.rows.length === 0 ? (
              <tr>
                <td colSpan={10} className="py-6 text-xs text-[#9090A8]">
                  No active core ETFs in <span className="font-mono">core_etfs</span>. Add rows (non-archived) in Supabase
                  to drive DCA.
                </td>
              </tr>
            ) : (
              dca.rows.map((r) => (
                <tr
                  key={r.ticker}
                  className="border-b border-[rgba(255,255,255,0.04)] hover:bg-[rgba(255,255,255,0.02)]"
                >
                  <td className="py-3 pr-3 font-mono text-[#F0F0F8]">{r.ticker}</td>
                  <td className="py-3 pr-3 text-xs capitalize text-[#9090A8]">{r.scheduleLabel}</td>
                  <td className="py-3 pr-3 text-right font-mono text-xs text-[#9090A8]">
                    {r.allocationPct.toFixed(2)}%
                  </td>
                  <td className="py-3 pr-3 text-right font-mono text-[#F0F0F8]">{fmtAud(r.priceAud)}</td>
                  <td className="py-3 pr-3 text-right font-mono text-xs text-[#9090A8]">{fmtAud(r.athAud)}</td>
                  <td className="py-3 pr-3 text-right font-mono text-xs text-[#79CBFF]">{fmtPct(r.distancePct)}</td>
                  <td className="py-3 pr-3 text-xs text-[#C4C4D4]">{r.tierBandLabel}</td>
                  <td className="py-3 pr-3 font-mono text-xs text-[#F0F0F8]">{r.multiplierLabel}</td>
                  <td className="py-3 pr-3 text-right font-mono text-[#4DB8FF]">
                    {r.multiplier === 0 ? fmtAud(0) : fmtAud(r.contributionAud)}
                  </td>
                  <td className="py-3 pr-3 text-right font-mono text-[10px] text-[#505068]">
                    {r.trueExposurePct != null ? `${r.trueExposurePct.toFixed(2)}%` : '—'}
                    <span className="mt-0.5 block font-mono text-[9px] text-[#404050]">×{r.gearingFactor}</span>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {dca.rows.some((r) => !r.quoteMatched) ? (
        <p className="mt-3 text-[10px] text-[#505068]">
          Some tickers did not match a core holding quote cache row — sync Sharesight and refresh prices after symbols
          align.
        </p>
      ) : null}
    </div>
  )
}

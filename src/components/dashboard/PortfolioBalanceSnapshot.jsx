import { fmtAud } from '../../lib/dashboard/formatAud.js'

/**
 * @param {{
 * coreTargetPct: number
 * satelliteTargetPct: number
 * actualCorePctInvested: number|null
 * actualSatPctInvested: number|null
 * investedCoreAud: number
 * investedSatelliteAud: number
 * bookCoreAud: number
 * bookSatelliteAud: number
 * }} props
 */

export function PortfolioBalanceSnapshot({
  coreTargetPct,
  satelliteTargetPct,
  actualCorePctInvested,
  actualSatPctInvested,
  investedCoreAud,
  investedSatelliteAud,
  bookCoreAud,
  bookSatelliteAud,
}) {
  return (
    <section className="rounded-xl border border-[rgba(255,255,255,0.06)] bg-[#111118] px-4 py-5 shadow-[inset_0_1px_0_rgba(255,255,255,0.04)]">
      <p className="text-[14px] font-semibold text-[#F0F0F8]">Balance snapshot</p>

      <p className="mt-2 text-xs text-[#9090A8]">Present value vs targets (ex cash) and book value (AUD cost basis only).</p>

      <div className="mt-4 overflow-x-auto">
        <table className="w-full min-w-[640px] border-collapse text-left text-sm">
          <thead>
            <tr className="border-b border-[rgba(255,255,255,0.06)] text-[10px] font-semibold uppercase tracking-wide text-[#505068]">
              <th className="py-3 pr-3">Sleeve</th>

              <th className="py-3 pr-3 text-right font-mono">Target %</th>

              <th className="py-3 pr-3 text-right font-mono">Actual %</th>

              <th className="py-3 pr-3 text-right font-mono">Market (ex cash)</th>

              <th className="py-3 pr-3 text-right font-mono">Book (AUD)</th>
            </tr>
          </thead>

          <tbody className="font-mono text-xs text-[#F0F0F8]">
            <tr className="border-b border-[rgba(255,255,255,0.04)]">
              <td className="py-3 pr-3 text-[#C8C8D8]">Core</td>

              <td className="py-3 pr-3 text-right text-[#9090A8]">{coreTargetPct.toFixed(1)}%</td>

              <td className="py-3 pr-3 text-right text-[#4DB8FF]">{actualCorePctInvested != null ? `${actualCorePctInvested.toFixed(1)}%` : '—'}</td>

              <td className="py-3 pr-3 text-right">{fmtAud(investedCoreAud)}</td>

              <td className="py-3 pr-3 text-right text-[#9090A8]">{fmtAud(bookCoreAud)}</td>
            </tr>

            <tr>
              <td className="py-3 pr-3 text-[#C8C8D8]">Satellite</td>

              <td className="py-3 pr-3 text-right text-[#9090A8]">{satelliteTargetPct.toFixed(1)}%</td>

              <td className="py-3 pr-3 text-right text-[#4DB8FF]">{actualSatPctInvested != null ? `${actualSatPctInvested.toFixed(1)}%` : '—'}</td>

              <td className="py-3 pr-3 text-right">{fmtAud(investedSatelliteAud)}</td>

              <td className="py-3 pr-3 text-right text-[#9090A8]">{fmtAud(bookSatelliteAud)}</td>
            </tr>
          </tbody>
        </table>
      </div>
    </section>
  )
}

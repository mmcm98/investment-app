import { useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { fmtAud, fmtAudFull } from '../../lib/dashboard/formatAud.js'

/** @param {number|null|undefined} n */
function fmtPct1(n) {
  if (n == null || !Number.isFinite(Number(n))) return '—'

  return `${n >= 0 ? '+' : ''}${Number(n).toFixed(1)}%`
}

/**
 * @param {{
 * totalPortfolioAud: number
 * investedCoreAud: number
 * investedSatelliteAud: number
 * totalCashAud: number
 * externalCashAud: number
 * brokerLines: Array<{ portfolio_role: string, label: string, balance_aud: number }>
 * dayMoveAud: number
 * dayPctOnInvested: number|null
 * coreTargetPct: number
 * satelliteTargetPct: number
 * actualCorePctInvested: number|null
 * actualSatPctInvested: number|null
 * lastSuccessfulSyncAt: string|null
 * onSyncNow: () => void
 * isSyncing: boolean
 * syncPhaseLabel?: string | null
}} props
 */

export function PortfolioHealthBar(props) {
  const [cashOpen, setCashOpen] = useState(false)

  const syncLabel =
    props.lastSuccessfulSyncAt && Number.isFinite(Date.parse(props.lastSuccessfulSyncAt))
      ? new Date(props.lastSuccessfulSyncAt).toLocaleString(undefined, {
          dateStyle: 'medium',
          timeStyle: 'short',
        })
      : 'Never'

  return (
    <section className="rounded-xl border border-[rgba(255,255,255,0.06)] bg-[#111118] shadow-[inset_0_1px_0_rgba(255,255,255,0.04)]">
      <div className="grid grid-cols-1 gap-4 border-b border-[rgba(255,255,255,0.06)] p-4 md:grid-cols-2 xl:grid-cols-12 xl:gap-3 xl:p-5">
        <div className="xl:col-span-2">
          <p className="text-[10px] font-medium uppercase tracking-wide text-[#505068]">Portfolio value</p>

          <p className="mt-2 font-mono text-xl font-medium text-[#F0F0F8]">{fmtAud(props.totalPortfolioAud)}</p>
        </div>

        <div className="xl:col-span-2">
          <p className="text-[10px] font-medium uppercase tracking-wide text-[#505068]">Core (ex cash)</p>

          <p className="mt-2 font-mono text-base text-[#4DB8FF]">{fmtAud(props.investedCoreAud)}</p>
        </div>

        <div className="xl:col-span-2">
          <p className="text-[10px] font-medium uppercase tracking-wide text-[#505068]">Satellite (ex cash)</p>

          <p className="mt-2 font-mono text-base text-[#4DB8FF]">{fmtAud(props.investedSatelliteAud)}</p>
        </div>

        <button
          type="button"
          className="text-left xl:col-span-2 xl:rounded-md xl:bg-[rgba(255,255,255,0.02)] xl:px-3 xl:py-2 xl:ring-1 xl:ring-[rgba(77,184,255,0.25)] xl:hover:bg-[rgba(255,255,255,0.03)]"
          onClick={() => setCashOpen((v) => !v)}
          aria-expanded={cashOpen}
        >
          <p className="text-[10px] font-medium uppercase tracking-wide text-[#505068]">Total cash · tap</p>

          <div className="mt-2 flex flex-wrap items-baseline gap-2">
            <span className="font-mono text-base text-[#22C55E]">{fmtAud(props.totalCashAud)}</span>

            <span className="font-mono text-[10px] text-[#79CBFF]">{cashOpen ? '▴' : '▾'}</span>
          </div>
        </button>

        <div className="xl:col-span-2">
          <p className="text-[10px] font-medium uppercase tracking-wide text-[#505068]">Today (holdings Δ)</p>

          <div className="mt-2 flex flex-wrap items-baseline gap-2 font-mono text-sm">
            <span className={props.dayMoveAud >= 0 ? 'text-[#22C55E]' : 'text-[#EF4444]'}>{fmtAudFull(props.dayMoveAud)}</span>

            <span className={`text-[#9090A8] ${props.dayPctOnInvested == null ? 'opacity-50' : ''}`}>
              ({fmtPct1(props.dayPctOnInvested)})
            </span>
          </div>
        </div>

        <div className="border-t border-[rgba(255,255,255,0.06)] pt-4 md:border-t-0 md:pt-0 xl:col-span-2 xl:border-l xl:border-[rgba(255,255,255,0.06)] xl:pl-4 xl:pt-0">
          <p className="text-[10px] font-medium uppercase tracking-wide text-[#505068]">Last sync</p>

          <p className="mt-2 font-mono text-xs leading-snug text-[#9090A8]">{syncLabel}</p>

          {props.isSyncing && props.syncPhaseLabel ? (
            <p className="mt-2 font-mono text-[10px] leading-snug text-[#79CBFF]" aria-live="polite">
              {props.syncPhaseLabel}

            </p>
          ) : null}

          <button
            type="button"
            disabled={props.isSyncing}
            className="mt-3 rounded-md border border-[rgba(255,255,255,0.12)] px-2 py-1 font-mono text-[10px] text-[#79CBFF] hover:border-[rgba(77,184,255,0.45)] disabled:opacity-40"
            onClick={props.onSyncNow}
          >
            {props.isSyncing ? 'Syncing…' : 'Sync now'}
          </button>
        </div>
      </div>

      <AnimatePresence initial={false}>
        {cashOpen ? (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2, ease: 'easeOut' }}
            className="overflow-hidden border-b border-[rgba(255,255,255,0.06)]"
          >
            <div className="space-y-3 bg-[#0A0A0F] px-4 py-4">
              <p className="text-[10px] font-medium uppercase tracking-wide text-[#505068]">Cash breakdown</p>

              <ul className="space-y-2 font-mono text-xs text-[#C8C8D8]">
                <li className="flex justify-between gap-3 border-b border-[rgba(255,255,255,0.05)] pb-2">
                  <span className="text-[#9090A8]">External (Supabase)</span>

                  <span className="text-[#F0F0F8]">{fmtAudFull(props.externalCashAud)}</span>
                </li>

                {props.brokerLines.length === 0 ? (
                  <li className="text-[#505068]">No broker cash rows yet — run a Sharesight sync.</li>
                ) : (
                  props.brokerLines.map((l, i) => (
                    <li key={`${l.portfolio_role}-${l.label}-${i}`} className="flex justify-between gap-3">
                      <span className="text-[#9090A8]">
                        {l.portfolio_role} · {l.label}
                      </span>

                      <span>{fmtAudFull(l.balance_aud)}</span>
                    </li>
                  ))
                )}
              </ul>
            </div>
          </motion.div>
        ) : null}
      </AnimatePresence>

      <div className="grid grid-cols-1 gap-4 p-4 md:grid-cols-2">
        <div className="rounded-lg bg-[#0A0A0F] p-3">
          <p className="text-[10px] font-medium uppercase tracking-wide text-[#505068]">Core / satellite split (invested, ex cash)</p>

          <div className="mt-3 space-y-2 font-mono text-xs">
            <div className="flex justify-between gap-3">
              <span className="text-[#9090A8]">Target</span>

              <span className="text-[#F0F0F8]">
                {props.coreTargetPct.toFixed(0)}% / {props.satelliteTargetPct.toFixed(0)}%
              </span>
            </div>

            <div className="flex justify-between gap-3">
              <span className="text-[#9090A8]">Actual</span>

              <span className="text-[#4DB8FF]">
                {props.actualCorePctInvested != null ? `${props.actualCorePctInvested.toFixed(1)}%` : '—'} ·{' '}
                {props.actualSatPctInvested != null ? `${props.actualSatPctInvested.toFixed(1)}%` : '—'}
              </span>
            </div>
          </div>
        </div>

        <div className="rounded-lg bg-[#0A0A0F] p-3">
          <p className="text-[10px] font-medium uppercase tracking-wide text-[#505068]">Mix bar</p>

          <div className="mt-3 flex h-3 overflow-hidden rounded-full bg-[#1A1A24]">
            <div
              className="bg-[#4DB8FF]"
              style={{
                width: `${props.actualCorePctInvested != null ? Math.max(0, Math.min(100, props.actualCorePctInvested)) : 50}%`,
              }}
              title="Core"
            />

            <div
              className="bg-[#79CBFF]"
              style={{
                width: `${props.actualSatPctInvested != null ? Math.max(0, Math.min(100, props.actualSatPctInvested)) : 50}%`,
              }}
              title="Satellite"
            />
          </div>

          <p className="mt-2 font-mono text-[10px] text-[#505068]">Bar width reflects observed weights; numbers above are authoritative.</p>
        </div>
      </div>
    </section>
  )
}

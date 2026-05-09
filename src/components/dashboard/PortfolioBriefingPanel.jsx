import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import { motion } from 'framer-motion'

import { useSharesightIntegration } from '../../context/SharesightIntegrationContext.jsx'

import { useWeeklyDca } from '../../hooks/useWeeklyDca.js'

import { buildPortfolioBriefingContext } from '../../lib/briefing/buildPortfolioBriefingContext.js'

import { postPortfolioBriefing } from '../../lib/analysis/portfolioBriefingClient.js'

/** @param {{ md: string }} props */

function BriefingMarkdown({ md }) {
  return <div className="whitespace-pre-wrap font-sans text-sm leading-relaxed text-[#D6D6E8]">{md}</div>
}

/**
 * @param {{
 *   dashboard: Record<string, unknown> & {
 *     settingsRow?: Record<string, unknown> | null
 *     reload?: () => Promise<void> | void
 *   }
 *   satelliteCards: Record<string, unknown>[]
 * }} props
 */

export function PortfolioBriefingPanel({ dashboard, satelliteCards }) {
  const { supabase, userPresent } = useSharesightIntegration()

  const dca = useWeeklyDca()

  const [history, setHistory] = useState(/** @type {Record<string, unknown>[]} */ ([]))

  const [historyError, setHistoryError] = useState(/** @type {string|null} */ (null))

  const [selectedId, setSelectedId] = useState(/** @type {string|null} */ (null))

  const [compareId, setCompareId] = useState(/** @type {string|null} */ (null))

  const [phase, setPhase] = useState(/** @type {'idle'|'running'|'error'} */ ('idle'))

  const [errorText, setErrorText] = useState(/** @type {string|null} */ (null))

  const [progressPct, setProgressPct] = useState(0)

  const printRef = useRef(/** @type {HTMLDivElement|null} */ (null))

  const paused = dashboard.settingsRow?.global_api_pause === true

  const loadHistory = useCallback(async () => {
    if (!supabase || !userPresent) return

    setHistoryError(null)

    try {
      const { data: ud } = await supabase.auth.getUser()

      const uid = ud.user?.id

      if (!uid) return

      const { data, error } = await supabase
        .from('portfolio_briefings')
        .select('id, title, generated_at, body_md, metrics_snapshot')
        .eq('user_id', uid)
        .order('generated_at', { ascending: false })
        .limit(48)

      if (error) throw error

      const rows = /** @type {Record<string, unknown>[]} */ (data ?? [])

      setHistory(rows)

      setSelectedId((prev) => {
        if (prev && rows.some((r) => `${r.id}` === prev)) return prev

        return rows[0]?.id != null ? `${rows[0].id}` : null
      })
    } catch (e) {
      setHistoryError(e instanceof Error ? e.message : String(e))
    }
  }, [supabase, userPresent])

  useEffect(() => {
    void loadHistory()
  }, [loadHistory])

  const selected = useMemo(
    () => history.find((h) => `${h.id}` === selectedId) ?? null,

    [history, selectedId],
  )

  const compareRow = useMemo(
    () => history.find((h) => `${h.id}` === compareId) ?? null,

    [history, compareId],
  )

  const sessionBearer = async () => {
    if (!supabase) return null

    const { data, error } = await supabase.auth.getSession()

    if (error || !data.session?.access_token) return null

    return { accessToken: data.session.access_token }
  }

  const runGenerate = async () => {
    if (paused) {
      setErrorText('API pause is enabled — briefing generation is blocked.')

      return
    }

    if (!supabase) return

    setPhase('running')

    setErrorText(null)

    setProgressPct(5)

    const tick = window.setInterval(() => {
      setProgressPct((p) => Math.min(96, p + 1.1))
    }, 1200)

    try {
      const { data: ud } = await supabase.auth.getUser()

      const uid = ud.user?.id

      if (!uid) throw new Error('Not signed in')

      const { data: ann, error: annErr } = await supabase
        .from('announcements')
        .select('headline, display_ticker, fmp_symbol, published_at, price_sensitive')
        .eq('user_id', uid)
        .order('published_at', { ascending: false })
        .limit(45)

      if (annErr) throw annErr

      const context = buildPortfolioBriefingContext({
        dashboard,
        satelliteCards,
        dca: {
          baseWeeklyAud: dca.baseWeeklyAud,
          totalWeekly: dca.totalWeekly,
          rows: dca.rows,
          weightSum: dca.weightSum,
        },
        announcements: /** @type {Record<string, unknown>[]} */ (ann ?? []),
      })

      const sess = await sessionBearer()

      if (!sess) throw new Error('Not signed in')

      const out = /** @type {Record<string, unknown>} */ (await postPortfolioBriefing({ context }, sess))

      if (out.ok !== true) throw new Error('Briefing did not complete')

      setProgressPct(100)

      await loadHistory()

      const br = out.briefing && typeof out.briefing === 'object' ? /** @type {Record<string, unknown>} */ (out.briefing) : null

      if (br && typeof br.id === 'string') {
        setSelectedId(br.id)
      }

      await dashboard.reload?.()

      setPhase('idle')
    } catch (e) {
      setPhase('error')

      setErrorText(e instanceof Error ? e.message : String(e))
    } finally {
      window.clearInterval(tick)

      queueMicrotask(() => setProgressPct(0))
    }
  }

  const exportPdf = () => {
    if (!printRef.current) return

    window.print()
  }

  const pagesSplit = selected && typeof selected.body_md === 'string' ? `${selected.body_md}`.split(/\n\n---\n\n/) : []

  return (
    <section className="rounded-xl border border-[rgba(255,255,255,0.06)] bg-[#111118] px-5 py-4">
      <div className="flex flex-wrap items-start justify-between gap-4 border-b border-[rgba(255,255,255,0.06)] pb-4">
        <div>
          <p className="text-[10px] font-semibold uppercase tracking-wide text-[#505068]">Portfolio briefing</p>

          <p className="mt-2 max-w-[76ch] text-xs text-[#9090A8]">
            Triad workflow: Gemini Pro gathers structured research (saved to <span className="font-mono">research_logs</span>), then Claude
            Opus synthesises three pages (~60–120s). Uses cached <span className="font-mono">CLAUDE.md</span> rules on the server.
          </p>
        </div>

        <button
          type="button"
          disabled={paused || phase === 'running' || !userPresent}
          className="rounded-lg bg-[#4DB8FF] px-4 py-2 font-mono text-xs font-semibold text-[#0A0A0F] disabled:cursor-not-allowed disabled:opacity-40"
          onClick={() => void runGenerate()}
        >
          {phase === 'running' ? 'Generating…' : 'Generate portfolio briefing'}
        </button>
      </div>

      {phase === 'running' ? (
        <div className="mt-4 space-y-2">
          <p className="font-mono text-[11px] text-[#79CBFF]">Running briefing Triad (Gemini research → Claude synthesis)…</p>

          <div className="h-2 w-full overflow-hidden rounded-full bg-[rgba(255,255,255,0.06)]">
            <motion.div
              className="h-full rounded-full bg-[linear-gradient(90deg,#79CBFF,#4DB8FF)]"
              initial={{ width: '0%' }}
              animate={{ width: `${Math.max(14, progressPct)}%` }}
              transition={{ duration: 0.35, ease: 'easeOut' }}
            />
          </div>

          <p className="font-mono text-[10px] text-[#505068]">Typical wall time 60–120 seconds.</p>
        </div>
      ) : null}

      {phase === 'error' && errorText ? (
        <p className="mt-4 font-mono text-xs text-[#EF4444]">
          {errorText}{' '}
          <button type="button" className="text-[#79CBFF] underline" onClick={() => setPhase('idle')}>
            Dismiss
          </button>
        </p>
      ) : null}

      {historyError ? <p className="mt-4 font-mono text-[11px] text-[#EF4444]">{historyError}</p> : null}

      <div className="mt-6 flex flex-wrap gap-4">
        <label className="flex flex-col gap-1 font-mono text-[10px] text-[#505068]">
          Current briefing

          <select
            className="min-w-[220px] rounded-lg border border-[rgba(255,255,255,0.12)] bg-[#1A1A24] px-3 py-2 font-mono text-[11px] text-[#F0F0F8]"
            value={selectedId ?? ''}
            onChange={(e) => setSelectedId(e.target.value || null)}
          >
            <option value="">—</option>
            {history.map((h) => {
              const id = `${h.id}`
              const t = `${h.generated_at ?? h.title ?? ''}`.slice(0, 19)
              const title = `${h.title ?? 'Briefing'}`

              return (
                <option key={id} value={id}>
                  {t} · {title.slice(0, 48)}
                </option>
              )
            })}
          </select>
        </label>

        <label className="flex flex-col gap-1 font-mono text-[10px] text-[#505068]">
          Compare with

          <select
            className="min-w-[220px] rounded-lg border border-[rgba(255,255,255,0.12)] bg-[#1A1A24] px-3 py-2 font-mono text-[11px] text-[#F0F0F8]"
            value={compareId ?? ''}
            onChange={(e) => setCompareId(e.target.value || null)}
          >
            <option value="">— none —</option>
            {history.map((h) => {
              const id = `${h.id}`

              if (id === selectedId) return null

              const t = `${h.generated_at ?? ''}`.slice(0, 19)

              return (
                <option key={id} value={id}>
                  {t} · {`${h.title ?? ''}`.slice(0, 42)}
                </option>
              )
            })}
          </select>
        </label>

        <div className="flex flex-wrap items-end gap-2">
          <button
            type="button"
            disabled={!selected}
            className="rounded-lg border border-[rgba(255,255,255,0.12)] px-3 py-2 font-mono text-[11px] disabled:opacity-40"
            onClick={exportPdf}
          >
            Export PDF (print)
          </button>
        </div>
      </div>

      <div ref={printRef} className="print-briefing mt-6 space-y-8">
        {compareRow && selected ? (
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            <div className="rounded-lg border border-[rgba(255,255,255,0.08)] bg-[#0A0A0F] p-4">
              <p className="font-mono text-[10px] uppercase tracking-wide text-[#505068]">Selected</p>

              <p className="mt-2 font-mono text-xs text-[#79CBFF]">{`${selected.title ?? ''}`}</p>

              <p className="font-mono text-[10px] text-[#505068]">{`${selected.generated_at ?? ''}`}</p>

              <div className="mt-4 max-h-[420px] overflow-auto">
                <BriefingMarkdown md={typeof selected.body_md === 'string' ? selected.body_md : ''} />
              </div>
            </div>

            <div className="rounded-lg border border-[rgba(255,255,255,0.08)] bg-[#0A0A0F] p-4">
              <p className="font-mono text-[10px] uppercase tracking-wide text-[#505068]">Compare</p>

              <p className="mt-2 font-mono text-xs text-[#79CBFF]">{`${compareRow.title ?? ''}`}</p>

              <p className="font-mono text-[10px] text-[#505068]">{`${compareRow.generated_at ?? ''}`}</p>

              <div className="mt-4 max-h-[420px] overflow-auto">
                <BriefingMarkdown md={typeof compareRow.body_md === 'string' ? compareRow.body_md : ''} />
              </div>
            </div>
          </div>
        ) : selected ? (
          <div className="space-y-6">
            <div>
              <p className="font-mono text-xs text-[#79CBFF]">{`${selected.title ?? 'Briefing'}`}</p>

              <p className="font-mono text-[10px] text-[#505068]">{`${selected.generated_at ?? ''}`}</p>
            </div>

            {pagesSplit.length >= 3 ? (
              <div className="grid gap-6 lg:grid-cols-3">
                <article className="rounded-lg border border-[rgba(77,184,255,0.2)] bg-[#0A0A0F] p-4">
                  <p className="font-mono text-[10px] uppercase tracking-wide text-[#505068]">Page 1 · Snapshot</p>

                  <div className="mt-3 max-h-[360px] overflow-auto">
                    <BriefingMarkdown md={pagesSplit[0] ?? ''} />
                  </div>
                </article>

                <article className="rounded-lg border border-[rgba(245,158,11,0.25)] bg-[#0A0A0F] p-4">
                  <p className="font-mono text-[10px] uppercase tracking-wide text-[#505068]">Page 2 · Attention</p>

                  <div className="mt-3 max-h-[360px] overflow-auto">
                    <BriefingMarkdown md={pagesSplit[1] ?? ''} />
                  </div>
                </article>

                <article className="rounded-lg border border-[rgba(34,197,94,0.22)] bg-[#0A0A0F] p-4">
                  <p className="font-mono text-[10px] uppercase tracking-wide text-[#505068]">Page 3 · Market</p>

                  <div className="mt-3 max-h-[360px] overflow-auto">
                    <BriefingMarkdown md={pagesSplit[2] ?? ''} />
                  </div>
                </article>
              </div>
            ) : (
              <div className="max-h-[520px] overflow-auto rounded-lg border border-[rgba(255,255,255,0.08)] bg-[#0A0A0F] p-4">
                <BriefingMarkdown md={typeof selected.body_md === 'string' ? selected.body_md : ''} />
              </div>
            )}
          </div>
        ) : (
          <p className="text-sm text-[#505068]">No briefings yet — generate one to populate history.</p>
        )}
      </div>

      <style>{`
        @media print {
          body * { visibility: hidden; }
          .print-briefing, .print-briefing * { visibility: visible; }
          .print-briefing { position: absolute; left: 0; top: 0; width: 100%; padding: 16px; background: #fff; color: #111; }
        }
      `}</style>
    </section>
  )
}

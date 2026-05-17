import { useMemo, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { useSharesightIntegration } from '../context/SharesightIntegrationContext.jsx'
import { useSatellitePortfolio } from '../hooks/useSatellitePortfolio.js'
import { getTriadAnalysisJob, startTriadAnalysis } from '../lib/analysis/triadClient.js'

const TABS = /** @type {const} */ ([
  { id: 'scorecard', label: 'Scorecard' },
  { id: 'research', label: 'Research Paper' },
  { id: 'buyZones', label: 'Buy Zones' },
  { id: 'exitTriggers', label: 'Exit Triggers' },
])

/** @param {unknown} v */
function numFin(v) {
  if (typeof v === 'number' && Number.isFinite(v)) return v
  const n = Number.parseFloat(`${v ?? ''}`)
  return Number.isFinite(n) ? n : null
}

/** @param {number|null|undefined} n @param {string} cur */
function fmtNative(n, cur) {
  if (n == null || !Number.isFinite(Number(n))) return '—'
  const c = `${cur ?? ''}`.trim()
  return `${Number(n).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 4 })}${c ? ` ${c}` : ''}`
}

/** @param {Record<string, unknown>|null|undefined} o @param {string} key */
function getObj(o, key) {
  const v = o && typeof o === 'object' ? Reflect.get(o, key) : null
  return v && typeof v === 'object' && !Array.isArray(v) ? /** @type {Record<string, unknown>} */ (v) : null
}

/** @param {Record<string, unknown>|null|undefined} o @param {string} key */
function getArr(o, key) {
  const v = o && typeof o === 'object' ? Reflect.get(o, key) : null
  return Array.isArray(v) ? v : []
}

/** @param {unknown} value */
function asText(value) {
  return typeof value === 'string' && value.trim() ? value.trim() : ''
}

/** @param {Record<string, unknown>|null|undefined} row */
function rowExtra(row) {
  const pos = row && typeof row === 'object' ? Reflect.get(row, 'position') : null
  const extra = pos && typeof pos === 'object' ? Reflect.get(/** @type {Record<string, unknown>} */ (pos), 'extra') : null
  return extra && typeof extra === 'object' ? /** @type {Record<string, unknown>} */ (extra) : {}
}

/** @param {Record<string, unknown>|null|undefined} row */
function positionRow(row) {
  const pos = row && typeof row === 'object' ? Reflect.get(row, 'position') : null
  return pos && typeof pos === 'object' ? /** @type {Record<string, unknown>} */ (pos) : null
}

/** @param {unknown} scorecard */
function sectionScores(scorecard) {
  const direct = getArr(/** @type {Record<string, unknown>} */ (scorecard), 'sections')
  if (direct.length) return direct
  const bySection = getObj(/** @type {Record<string, unknown>} */ (scorecard), 'section_scores')
  if (!bySection) return []
  return Object.entries(bySection).map(([name, score]) => ({ name, score }))
}

/** @param {unknown} scorecard */
function itemScores(scorecard) {
  const direct = getArr(/** @type {Record<string, unknown>} */ (scorecard), 'items')
  if (direct.length) return direct
  const byItem = getObj(/** @type {Record<string, unknown>} */ (scorecard), 'item_scores')
  if (!byItem) return []
  return Object.entries(byItem).map(([name, score]) => ({ name, score }))
}

function EmptyState({ children }) {
  return (
    <div className="rounded-xl border border-dashed border-[rgba(255,255,255,0.12)] bg-[#0A0A0F] px-5 py-10 text-center text-sm text-[#9090A8]">
      {children}
    </div>
  )
}

function analysisProgressMessage(elapsedSeconds) {
  if (elapsedSeconds < 20) return 'Gathering research with Gemini...'
  if (elapsedSeconds < 60) return 'Synthesising scorecard with Claude...'
  return 'Finalising results...'
}

function analysisStatusMessage(status, elapsedSeconds) {
  if (status === 'gemini_complete') return 'Synthesising scorecard with Claude...'
  if (status === 'pending') return 'Gathering research with Gemini...'
  return analysisProgressMessage(elapsedSeconds)
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

export function SatellitePositionAnalysis() {
  const params = useParams()
  const navigate = useNavigate()
  const { supabase } = useSharesightIntegration()
  const sp = useSatellitePortfolio()
  const [tab, setTab] = useState(/** @type {(typeof TABS)[number]['id']} */ ('scorecard'))
  const [analysisPhase, setAnalysisPhase] = useState(/** @type {'idle'|'running'|'done'|'error'} */ ('idle'))
  const [analysisMessage, setAnalysisMessage] = useState('')
  const [analysisElapsed, setAnalysisElapsed] = useState(0)

  const routeId = `${params.id ?? params.holdingId ?? ''}`.trim()
  const rows = useMemo(() => /** @type {Record<string, unknown>[]} */ (sp.tableCards ?? []), [sp.tableCards])

  const row = useMemo(() => {
    return (
      rows.find((r) => `${r.holdingId ?? ''}` === routeId) ??
      rows.find((r) => `${r.id ?? ''}` === routeId) ??
      rows.find((r) => `${r.sharesight_id ?? ''}` === routeId) ??
      rows.find((r) => `${r.positionId ?? ''}` === routeId) ??
      rows.find((r) => `${Reflect.get(/** @type {Record<string, unknown>} */ (r.holding ?? {}), 'holding_external_id') ?? ''}` === routeId) ??
      rows.find((r) => `${r.rowKey ?? ''}` === routeId) ??
      null
    )
  }, [routeId, rows])

  const extra = rowExtra(row)
  const pos = positionRow(row)
  const quote = row?.mergedQuote && typeof row.mergedQuote === 'object' ? /** @type {Record<string, unknown>} */ (row.mergedQuote) : null
  const currentPrice = numFin(quote?.display_native ?? quote?.last_price)
  const currency = `${row?.quoteCurrency ?? pos?.currency ?? ''}`.trim()
  const scorecard = getObj(extra, 'scorecard') ?? getObj(extra, 'latest_scorecard')
  const research = getObj(extra, 'research_paper') ?? getObj(extra, 'research')
  const buyZones = getArr(extra, 'buy_zones')
  const exitTriggers = getArr(extra, 'exit_triggers')
  const hasScorecard = Boolean(scorecard || row?.hasScorecard)
  const awaitingAnalysis = Boolean(row?.awaitingAnalysis || !hasScorecard)
  const overallScore = numFin(scorecard?.overall_score ?? row?.overallScore)
  const framework = `${scorecard?.framework ?? row?.assetClass ?? '—'}`.trim() || '—'
  const tier = `${scorecard?.tier ?? row?.tier ?? '—'}`.trim() || '—'
  const generatedAt = asText(research?.generated_at ?? research?.date_generated ?? research?.created_at)
  const modelUsed = asText(research?.model ?? research?.models ?? research?.gemini_model ?? research?.claude_model)
  const markdown = asText(research?.markdown ?? research?.body_md ?? research?.content)
  const runHoldingId = `${row?.holdingId ?? row?.id ?? row?.sharesight_id ?? routeId}`.trim()
  const runDisabled = analysisPhase === 'running' || !runHoldingId

  async function runAnalysis() {
    if (!supabase || !runHoldingId) return

    setAnalysisPhase('running')
    setAnalysisElapsed(0)
    setAnalysisMessage(analysisProgressMessage(0))

    /** @type {ReturnType<typeof setInterval> | null} */
    let timer = null
    try {
      const { data, error } = await supabase.auth.getSession()
      if (error) throw error

      const token = data.session?.access_token
      if (!token) throw new Error('Not signed in.')

      const started = Date.now()
      timer = setInterval(() => {
        const elapsed = Math.floor((Date.now() - started) / 1000)
        setAnalysisElapsed(elapsed)
        setAnalysisMessage(analysisProgressMessage(elapsed))
      }, 1000)

      const start = await startTriadAnalysis({ holdingId: runHoldingId }, { accessToken: token })
      const jobId = start && typeof start === 'object' ? `${Reflect.get(start, 'job_id') ?? ''}`.trim() : ''
      if (!jobId) throw new Error('Triad job was not created.')

      while (Date.now() - started < 180_000) {
        await sleep(3000)
        const status = await getTriadAnalysisJob(jobId, { accessToken: token })
        const job = status && typeof status === 'object' ? Reflect.get(status, 'job') : null
        const jobObj = job && typeof job === 'object' ? /** @type {Record<string, unknown>} */ (job) : null
        const state = `${jobObj?.status ?? ''}`
        const elapsed = Math.floor((Date.now() - started) / 1000)

        setAnalysisElapsed(elapsed)
        setAnalysisMessage(analysisStatusMessage(state, elapsed))

        if (state === 'complete') {
          if (timer) clearInterval(timer)
          timer = null
          const result = jobObj?.result && typeof jobObj.result === 'object' ? /** @type {Record<string, unknown>} */ (jobObj.result) : {}
          setAnalysisPhase('done')
          setAnalysisElapsed(Math.floor((Date.now() - started) / 1000))
          setAnalysisMessage(
            `Analysis complete. Version ${Reflect.get(result, 'version_number') ?? '—'} created with overall score ${Reflect.get(result, 'overall_score') ?? '—'}%.`,
          )
          await sp.refresh?.()
          return
        }

        if (state === 'failed') {
          throw new Error(`${jobObj?.error ?? 'Analysis failed.'}`)
        }
      }

      throw new Error('Analysis timed out after 180 seconds. Try again.')
    } catch (error) {
      if (timer) clearInterval(timer)
      setAnalysisPhase('error')
      setAnalysisMessage(error?.message || error?.error || String(error) || 'Unknown error')
    }
  }

  if (sp.satelliteHydrated && !row) {
    return (
      <div className="mx-auto flex w-full max-w-screen-2xl flex-col gap-4 px-6 py-10 text-[#F0F0F8]">
        <Link className="font-mono text-xs text-[#79CBFF]" to="/satellite">
          ← Back to satellite
        </Link>
        <div className="rounded-xl border border-[rgba(255,255,255,0.06)] bg-[#111118] px-5 py-6 text-sm text-[#9090A8]">
          Position not found.
        </div>
      </div>
    )
  }

  return (
    <div className="mx-auto flex w-full max-w-screen-2xl flex-col gap-6 px-6 py-10 pb-24 text-[#F0F0F8] lg:pb-10">
      <header className="rounded-xl border border-[rgba(255,255,255,0.06)] bg-[#111118] p-5">
        <button type="button" className="font-mono text-xs text-[#79CBFF]" onClick={() => navigate('/satellite')}>
          ← Back to satellite
        </button>
        <div className="mt-4 flex flex-wrap items-start justify-between gap-4">
          <div>
            <div className="flex flex-wrap items-center gap-3">
              <h1 className="text-[22px] font-semibold">{`${row?.ticker ?? '—'}`}</h1>
              {awaitingAnalysis ? (
                <span className="rounded border border-[rgba(245,158,11,0.35)] bg-[rgba(245,158,11,0.1)] px-2 py-1 font-mono text-[10px] uppercase tracking-wide text-[#F59E0B]">
                  Awaiting analysis
                </span>
              ) : null}
            </div>
            <p className="mt-1 text-sm text-[#9090A8]">{`${row?.displayName ?? '—'}`}</p>
            <div className="mt-3 flex flex-wrap gap-4 font-mono text-xs text-[#9090A8]">
              <span>Exchange: <span className="text-[#F0F0F8]">{`${row?.exchange ?? row?.exchangeShort ?? '—'}`}</span></span>
              <span>Current price: <span className="text-[#F0F0F8]">{fmtNative(currentPrice, currency)}</span></span>
            </div>
          </div>
          <div className="flex flex-col items-end gap-2">
            <button
              type="button"
              disabled={runDisabled}
              onClick={() => void runAnalysis()}
              className={`rounded-lg border px-4 py-2 font-mono text-xs ${
                runDisabled
                  ? 'border-[rgba(255,255,255,0.08)] bg-[#1A1A24] text-[#505068]'
                  : 'border-[#4DB8FF] bg-[rgba(77,184,255,0.12)] text-[#79CBFF] hover:bg-[rgba(77,184,255,0.18)]'
              }`}
            >
              {analysisPhase === 'running' ? 'Running analysis...' : 'Run analysis'}
            </button>
            {analysisMessage ? (
              <div className="max-w-[360px] text-right">
                <p
                  className={`font-mono text-[10px] ${
                    analysisPhase === 'error' ? 'text-[#EF4444]' : analysisPhase === 'done' ? 'text-[#22C55E]' : 'text-[#9090A8]'
                  }`}
                >
                  {analysisPhase === 'running' ? `${analysisMessage} ${analysisElapsed}s elapsed` : analysisMessage}
                </p>
                {analysisPhase === 'running' ? (
                  <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-[#1A1A24]">
                    <div
                      className="h-full rounded-full bg-[#4DB8FF] transition-all"
                      style={{ width: `${Math.min(100, (analysisElapsed / 180) * 100)}%` }}
                    />
                  </div>
                ) : null}
                {analysisPhase === 'error' ? (
                  <button type="button" className="mt-2 font-mono text-[10px] text-[#79CBFF]" onClick={() => void runAnalysis()}>
                    Retry
                  </button>
                ) : null}
              </div>
            ) : null}
          </div>
        </div>
      </header>

      <div className="flex flex-wrap gap-2 border-b border-[rgba(255,255,255,0.08)]">
        {TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => setTab(t.id)}
            className={`border-b-2 px-4 py-3 text-sm ${
              tab === t.id
                ? 'border-[#4DB8FF] text-[#F0F0F8]'
                : 'border-transparent text-[#9090A8] hover:text-[#F0F0F8]'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === 'scorecard' ? (
        <section className="rounded-xl border border-[rgba(255,255,255,0.06)] bg-[#111118] p-5">
          <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
            <h2 className="text-sm font-semibold uppercase tracking-wide text-[#9090A8]">Scorecard</h2>
            <div className="flex flex-wrap gap-2">
              <select disabled className="rounded border border-[rgba(255,255,255,0.08)] bg-[#1A1A24] px-3 py-2 font-mono text-xs text-[#505068]">
                <option>Current version</option>
              </select>
              <button disabled className="rounded border border-[rgba(255,255,255,0.08)] bg-[#1A1A24] px-3 py-2 font-mono text-xs text-[#505068]">
                Re-analyse
              </button>
            </div>
          </div>
          {!scorecard ? (
            <EmptyState>No scorecard yet — click Run Analysis to generate</EmptyState>
          ) : (
            <div className="space-y-5">
              <div className="grid gap-3 md:grid-cols-3">
                <div className="rounded-lg bg-[#0A0A0F] px-4 py-3">
                  <p className="font-mono text-[10px] uppercase tracking-wide text-[#505068]">Framework</p>
                  <p className="mt-1 text-sm">{framework}</p>
                </div>
                <div className="rounded-lg bg-[#0A0A0F] px-4 py-3">
                  <p className="font-mono text-[10px] uppercase tracking-wide text-[#505068]">Overall score</p>
                  <p className="mt-1 font-mono text-lg text-[#4DB8FF]">{overallScore != null ? `${overallScore.toFixed(1)}%` : '—'}</p>
                </div>
                <div className="rounded-lg bg-[#0A0A0F] px-4 py-3">
                  <p className="font-mono text-[10px] uppercase tracking-wide text-[#505068]">Tier</p>
                  <p className="mt-1 text-sm">{tier}</p>
                </div>
              </div>
              <div>
                <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-[#9090A8]">Score by section</h3>
                {sectionScores(scorecard).length ? (
                  <div className="grid gap-2 md:grid-cols-2">
                    {sectionScores(scorecard).map((item, index) => (
                      <div key={index} className="flex justify-between rounded bg-[#0A0A0F] px-3 py-2 font-mono text-xs">
                        <span>{`${Reflect.get(/** @type {Record<string, unknown>} */ (item), 'name') ?? Reflect.get(/** @type {Record<string, unknown>} */ (item), 'section') ?? 'Section'}`}</span>
                        <span className="text-[#4DB8FF]">{`${Reflect.get(/** @type {Record<string, unknown>} */ (item), 'score') ?? '—'}`}</span>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="text-sm text-[#505068]">Section scores will appear here after analysis.</p>
                )}
              </div>
              <div>
                <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-[#9090A8]">Individual item scores</h3>
                {itemScores(scorecard).length ? (
                  <div className="space-y-2">
                    {itemScores(scorecard).map((item, index) => (
                      <div key={index} className="flex justify-between rounded bg-[#0A0A0F] px-3 py-2 font-mono text-xs">
                        <span>{`${Reflect.get(/** @type {Record<string, unknown>} */ (item), 'name') ?? Reflect.get(/** @type {Record<string, unknown>} */ (item), 'item') ?? 'Item'}`}</span>
                        <span className="text-[#4DB8FF]">{`${Reflect.get(/** @type {Record<string, unknown>} */ (item), 'score') ?? '—'}`}</span>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="text-sm text-[#505068]">Item scores will appear here after analysis.</p>
                )}
              </div>
            </div>
          )}
        </section>
      ) : null}

      {tab === 'research' ? (
        <section className="rounded-xl border border-[rgba(255,255,255,0.06)] bg-[#111118] p-5">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-[#9090A8]">Research Paper</h2>
          {!research ? (
            <EmptyState>No research paper yet — click Run Analysis to generate</EmptyState>
          ) : (
            <div className="mt-4 space-y-4">
              <div className="flex flex-wrap gap-4 font-mono text-xs text-[#9090A8]">
                <span>Date generated: <span className="text-[#F0F0F8]">{generatedAt || '—'}</span></span>
                <span>Model: <span className="text-[#F0F0F8]">{modelUsed || '—'}</span></span>
              </div>
              <article className="whitespace-pre-wrap rounded-lg bg-[#0A0A0F] p-4 text-sm leading-6 text-[#D6D6E8]">
                {markdown || JSON.stringify(research, null, 2)}
              </article>
            </div>
          )}
        </section>
      ) : null}

      {tab === 'buyZones' ? (
        <section className="rounded-xl border border-[rgba(255,255,255,0.06)] bg-[#111118] p-5">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-[#9090A8]">Buy Zones</h2>
          {!buyZones.length ? (
            <EmptyState>No buy zones set — these will be generated after first analysis</EmptyState>
          ) : (
            <div className="mt-4 space-y-3">
              {buyZones.map((zone, index) => {
                const z = /** @type {Record<string, unknown>} */ (zone)
                return (
                  <div key={index} className="rounded-lg bg-[#0A0A0F] px-4 py-3">
                    <p className="font-mono text-xs text-[#4DB8FF]">{`${z.label ?? (index === 0 ? 'Strong buy zone' : 'Buy zone')}`}</p>
                    <p className="mt-1 text-sm text-[#D6D6E8]">Price range: {`${z.low ?? z.from ?? '—'} – ${z.high ?? z.to ?? '—'} ${currency}`}</p>
                    <p className="mt-1 text-xs text-[#9090A8]">Current price vs zones: {fmtNative(currentPrice, currency)}</p>
                    <p className="mt-1 text-xs text-[#505068]">Last updated: {`${z.updated_at ?? z.last_updated ?? '—'}`}</p>
                  </div>
                )
              })}
            </div>
          )}
        </section>
      ) : null}

      {tab === 'exitTriggers' ? (
        <section className="rounded-xl border border-[rgba(255,255,255,0.06)] bg-[#111118] p-5">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-[#9090A8]">Exit Triggers</h2>
          {!exitTriggers.length ? (
            <EmptyState>No exit triggers set — these will be generated after first analysis</EmptyState>
          ) : (
            <div className="mt-4 space-y-3">
              {exitTriggers.map((trigger, index) => {
                const t = /** @type {Record<string, unknown>} */ (trigger)
                return (
                  <div key={index} className="rounded-lg bg-[#0A0A0F] px-4 py-3">
                    <p className="text-sm text-[#F0F0F8]">{`${t.description ?? t.trigger ?? 'Exit trigger'}`}</p>
                    <div className="mt-2 flex flex-wrap gap-4 font-mono text-xs text-[#9090A8]">
                      <span>Action: <span className="text-[#F0F0F8]">{`${t.action ?? 'Re-analyse'}`}</span></span>
                      <span>Status: <span className="text-[#F0F0F8]">{`${t.status ?? 'Not triggered'}`}</span></span>
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </section>
      ) : null}
    </div>
  )
}

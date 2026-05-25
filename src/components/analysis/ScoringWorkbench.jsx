import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useSharesightIntegration } from '../../context/SharesightIntegrationContext.jsx'
import { runDirectTriadAnalysis } from '../../lib/analysis/directTriadAnalysis.js'
import { ScoreRing } from './ScoreRing.jsx'

/** @param {Record<string, unknown>|null} p */
/** @returns {unknown} */
function rz(p, k) {
  return p && typeof p === 'object' ? Reflect.get(p, k) : undefined
}

/**
 * @param {{
 *   positionId?: string|null,
 *   watchlistItemId?: string|null,
 *   position: Record<string, unknown>|null,
 *   selectedVersionId: string|null,
 *   scorecardFull: Record<string, unknown>|null,
 *   versionManifest: Record<string, unknown>[],
 *   refreshDetail: () => void,
 * }} props
 */
export function ScoringWorkbench({
  positionId = null,
  watchlistItemId = null,
  position,
  selectedVersionId,
  scorecardFull,
  versionManifest,
  refreshDetail,
}) {
  const { supabase } = useSharesightIntegration()
  const analysisParentId = `${positionId ?? ''}`.trim() || `${watchlistItemId ?? ''}`.trim()
  const parentArgs = useMemo(
    () =>
      positionId != null && `${positionId}`.trim()
        ? { positionId: `${positionId}`.trim() }
        : { watchlistItemId: `${watchlistItemId ?? ''}`.trim() },
    [positionId, watchlistItemId],
  )

  const payload = scorecardFull && typeof rz(scorecardFull, 'payload') === 'object' ? rz(scorecardFull, 'payload') : null

  const items = useMemo(
    () => (Array.isArray(rz(payload, 'items')) ? /** @type {Record<string, unknown>[]} */ (rz(payload, 'items')) : []),
    [payload],
  )

  const sectionScores = useMemo(
    () => (Array.isArray(rz(payload, 'section_scores')) ? /** @type {Record<string, unknown>[]} */ (rz(payload, 'section_scores')) : []),
    [payload],
  )

  const overallRow = rz(scorecardFull, 'overall_score')
  const overallPayload = rz(payload, 'overall_score_pct')
  const overall =
    typeof overallRow === 'number'
      ? overallRow
      : typeof overallPayload === 'number'
        ? overallPayload
        : overallRow != null && Number.isFinite(Number(overallRow))
          ? Number(overallRow)
          : overallPayload != null && Number.isFinite(Number(overallPayload))
            ? Number(overallPayload)
            : null

  const synopsis = useMemo(() => {
    const ex = position && typeof rz(position, 'extra') === 'object' ? rz(position, 'extra') : null
    const fromPos = ex && typeof Reflect.get(ex, 'synopsis') === 'string' ? String(Reflect.get(ex, 'synopsis')) : ''
    const fromCard = rz(payload, 'synopsis_one_liner')
    return fromPos || (typeof fromCard === 'string' ? fromCard : '')
  }, [position, payload])

  const autoSuggestDone = useRef(false)
  useEffect(() => {
    autoSuggestDone.current = false
  }, [analysisParentId])

  const awaiting = position ? Boolean(rz(position, 'awaiting_analysis')) : false
  const hasScorecard = versionManifest.length > 0

  const [suggestion, setSuggestion] = useState(/** @type {Record<string, unknown>|null} */ (null))
  const [errorText, setErrorText] = useState(/** @type {string|null} */ (null))
  const [overrideMap, setOverrideMap] = useState(/** @type {Record<string, number>} */ ({}))
  const [forceFresh, setForceFresh] = useState(false)

  const [suggestPhase, setSuggestPhase] = useState(/** @type {'idle'|'running'|'done'|'error'} */ ('idle'))
  const [geminiPhase, setGeminiPhase] = useState(/** @type {'idle'|'running'|'done'|'error'} */ ('idle'))
  const [claudePhase, setClaudePhase] = useState(/** @type {'idle'|'running'|'done'|'error'} */ ('idle'))
  const [geminiLabel, setGeminiLabel] = useState('')
  const [claudeLabel, setClaudeLabel] = useState('')
  const [geminiElapsed, setGeminiElapsed] = useState(0)
  const [claudeElapsed, setClaudeElapsed] = useState(0)
  const [geminiDate, setGeminiDate] = useState(/** @type {string|null} */ (null))
  const [claudeDate, setClaudeDate] = useState(/** @type {string|null} */ (null))

  const hasGemini = geminiPhase === 'done' || geminiDate != null

  useEffect(() => {
    if (!supabase || !analysisParentId) return
    let cancelled = false
    void (async () => {
      const { data: ud } = await supabase.auth.getUser()
      const uid = ud?.user?.id
      if (!uid || cancelled) return

      const ticker =
        typeof rz(position, 'display_ticker') === 'string'
          ? String(rz(position, 'display_ticker'))
          : typeof rz(position, 'fmp_symbol') === 'string'
            ? String(rz(position, 'fmp_symbol'))
            : ''

      if (ticker) {
        const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString()
        const { data: rl } = await supabase
          .from('research_logs')
          .select('timestamp')
          .eq('user_id', uid)
          .eq('ticker', ticker)
          .gte('timestamp', sevenDaysAgo)
          .order('timestamp', { ascending: false })
          .limit(1)
          .maybeSingle()

        if (!cancelled && rl?.timestamp) {
          setGeminiPhase('done')
          setGeminiDate(rl.timestamp)
        }
      }

      if (!cancelled && hasScorecard && scorecardFull) {
        const gen = rz(scorecardFull, 'generated_at')
        if (typeof gen === 'string' && gen) setClaudeDate(gen)
        setClaudePhase('done')
      }
    })()
    return () => {
      cancelled = true
    }
  }, [supabase, analysisParentId, position, hasScorecard, scorecardFull])

  const loadOverrides = useCallback(async () => {
    if (!supabase || !selectedVersionId) {
      setOverrideMap({})
      return
    }
    const { data, error } = await supabase
      .from('score_override_events')
      .select('item_key, user_score, created_at')
      .eq('scorecard_version_id', selectedVersionId)
      .order('created_at', { ascending: true })

    if (error || !data) {
      setOverrideMap({})
      return
    }
    /** @type {Record<string, number>} */
    const m = {}
    for (const row of data) {
      const key = typeof row.item_key === 'string' ? row.item_key : ''
      if (key && typeof row.user_score === 'number' && Number.isFinite(row.user_score)) m[key] = row.user_score
    }
    setOverrideMap(m)
  }, [supabase, selectedVersionId])

  useEffect(() => {
    const t = window.setTimeout(() => {
      void loadOverrides()
    }, 0)
    return () => window.clearTimeout(t)
  }, [loadOverrides])

  const suggestOnce = useCallback(async () => {
    setErrorText(null)
    setSuggestPhase('running')
    if (!supabase) {
      setSuggestPhase('error')
      setErrorText('Not signed in.')
      return
    }
    try {
      const out = await runDirectTriadAnalysis(supabase, { step: 'suggest-framework', ...parentArgs })
      if (!out || typeof out !== 'object' || Reflect.get(out, 'ok') !== true) throw new Error('Unexpected suggest response')
      const sug = Reflect.get(out, 'suggestion')
      setSuggestion(sug && typeof sug === 'object' ? /** @type {Record<string, unknown>} */ (sug) : null)
      setSuggestPhase('done')
    } catch (e) {
      setSuggestPhase('error')
      setErrorText(e instanceof Error ? e.message : String(e))
    }
  }, [supabase, parentArgs])

  useEffect(() => {
    if (Boolean(position) && (versionManifest.length === 0 || awaiting) && !autoSuggestDone.current && suggestPhase === 'idle') {
      autoSuggestDone.current = true
      void suggestOnce()
    }
  }, [position, versionManifest.length, awaiting, suggestPhase, suggestOnce])

  const runGemini = useCallback(async () => {
    setErrorText(null)
    setGeminiPhase('running')
    setGeminiLabel('Running deep research with Gemini Pro...')
    setGeminiElapsed(0)
    const started = Date.now()
    const timer = setInterval(() => setGeminiElapsed(Math.floor((Date.now() - started) / 1000)), 1000)
    try {
      const out = await runDirectTriadAnalysis(supabase, {
        step: 'gemini-only',
        forceFreshResearch: forceFresh,
        ...parentArgs,
        onProgress: (m) => setGeminiLabel(m),
      })
      if (!out || Reflect.get(out, 'ok') !== true) throw new Error('Gemini research did not complete')
      setGeminiPhase('done')
      setGeminiDate(typeof Reflect.get(out, 'generated_at') === 'string' ? String(Reflect.get(out, 'generated_at')) : new Date().toISOString())
      setGeminiLabel('')
    } catch (e) {
      setGeminiPhase('error')
      setErrorText(e instanceof Error ? e.message : String(e))
    } finally {
      clearInterval(timer)
    }
  }, [supabase, parentArgs, forceFresh])

  const suggestedKey = suggestion && typeof rz(suggestion, 'framework_key') === 'string' ? String(rz(suggestion, 'framework_key')) : ''

  const runClaude = useCallback(async () => {
    setErrorText(null)
    setClaudePhase('running')
    setClaudeLabel('Analysing with Claude...')
    setClaudeElapsed(0)
    const started = Date.now()
    const timer = setInterval(() => setClaudeElapsed(Math.floor((Date.now() - started) / 1000)), 1000)
    try {
      const out = await runDirectTriadAnalysis(supabase, {
        step: 'claude-only',
        confirmedFrameworkKey: suggestedKey,
        ...parentArgs,
        onProgress: (m) => setClaudeLabel(m),
      })
      if (!out || Reflect.get(out, 'ok') !== true) throw new Error('Claude analysis did not complete')
      setClaudePhase('done')
      setClaudeDate(new Date().toISOString())
      setClaudeLabel('')
      refreshDetail()
    } catch (e) {
      setClaudePhase('error')
      setErrorText(e instanceof Error ? e.message : String(e))
    } finally {
      clearInterval(timer)
    }
  }, [supabase, parentArgs, suggestedKey, refreshDetail])

  if (!analysisParentId) return null

  const busy = geminiPhase === 'running' || claudePhase === 'running' || suggestPhase === 'running'

  return (
    <section className="rounded-xl border border-[rgba(255,255,255,0.06)] bg-[#111118] px-5 py-4">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="text-[10px] font-semibold uppercase tracking-wide text-[#505068]">Scoring triad</p>
          <p className="mt-2 max-w-[640px] text-sm text-[#9090A8]">
            Run Gemini research first, then Claude analysis. Investment thesis is generated separately on the Research Paper tab.
          </p>
        </div>
        <ScoreRing pct={overall} />
      </div>

      {synopsis ? <p className="mt-4 rounded-lg bg-[#0A0A0F] px-4 py-3 text-sm italic text-[#C8C8D8]">&ldquo;{synopsis}&rdquo;</p> : null}

      {/* Status indicators */}
      <div className="mt-5 space-y-1 font-mono text-[11px]">
        <p className={geminiPhase === 'done' ? 'text-[#22C55E]' : 'text-[#9090A8]'}>
          1. Gemini research:{' '}
          {geminiPhase === 'done'
            ? `Complete${geminiDate ? ` (${new Date(geminiDate).toLocaleDateString()})` : ''}`
            : geminiPhase === 'running'
              ? 'Running…'
              : 'Pending'}
        </p>
        <p className={claudePhase === 'done' ? 'text-[#22C55E]' : 'text-[#9090A8]'}>
          2. Claude scorecard:{' '}
          {claudePhase === 'done'
            ? `Complete${claudeDate ? ` (${new Date(claudeDate).toLocaleDateString()})` : ''}`
            : claudePhase === 'running'
              ? 'Running…'
              : 'Pending'}
        </p>
      </div>

      {/* Framework suggestion */}
      {suggestPhase === 'running' ? (
        <div className="mt-4 space-y-2">
          <p className="font-mono text-[11px] text-[#79CBFF]">Classifying with Gemini Flash…</p>
          <p className="font-mono text-[10px] text-[#505068]">Usually 2–5 seconds.</p>
        </div>
      ) : null}

      {(suggestPhase === 'done' || suggestion) && !busy ? (
        <div className="mt-4 space-y-3 rounded-lg border border-[rgba(121,203,255,0.22)] bg-[rgba(121,203,255,0.05)] px-4 py-3">
          <p className="text-sm font-medium text-[#F0F0F8]">Suggested framework</p>
          <p className="font-mono text-sm text-[#4DB8FF]">
            {String(rz(suggestion, 'framework_label') ?? suggestedKey)} <span className="text-[#505068]">({suggestedKey})</span>
          </p>
          <p className="text-sm text-[#C8C8D8]">{String(rz(suggestion, 'reason') ?? '')}</p>
        </div>
      ) : null}

      {/* Two-button flow */}
      <div className="mt-5 space-y-3">
        {/* Gemini button */}
        <div className="flex flex-wrap items-center gap-3">
          <button
            type="button"
            disabled={busy || (geminiPhase === 'done' && !forceFresh)}
            onClick={() => void runGemini()}
            className={`rounded-lg border px-4 py-2 font-mono text-xs font-semibold ${
              geminiPhase === 'done' && !forceFresh
                ? 'border-[rgba(34,197,94,0.35)] bg-[rgba(34,197,94,0.08)] text-[#22C55E]'
                : busy
                  ? 'border-[rgba(255,255,255,0.08)] bg-[#1A1A24] text-[#505068]'
                  : 'border-[#4DB8FF] bg-[rgba(77,184,255,0.12)] text-[#79CBFF] hover:bg-[rgba(77,184,255,0.18)]'
            }`}
          >
            {geminiPhase === 'done' && !forceFresh ? 'Gemini research complete ✓' : geminiPhase === 'running' ? 'Running Gemini…' : 'Complete Gemini Research'}
          </button>
          <label className="flex items-center gap-1.5 font-mono text-[10px] text-[#9090A8]">
            <input type="checkbox" checked={forceFresh} onChange={(e) => setForceFresh(e.target.checked)} className="accent-[#4DB8FF]" />
            Force fresh research
          </label>
        </div>

        {geminiPhase === 'running' ? (
          <div className="space-y-1">
            <p className="font-mono text-[10px] text-[#79CBFF]">
              {geminiLabel} {geminiElapsed}s elapsed
            </p>
            <div className="h-1.5 w-full overflow-hidden rounded-full bg-[rgba(255,255,255,0.06)]">
              <div className="h-full rounded-full bg-[#4DB8FF] transition-all" style={{ width: `${Math.min(100, (geminiElapsed / 180) * 100)}%` }} />
            </div>
            <p className="font-mono text-[10px] text-[#505068]">Typically 90–180 seconds.</p>
          </div>
        ) : null}

        {/* Claude button */}
        <div className="flex flex-wrap items-center gap-3">
          <button
            type="button"
            disabled={busy || !hasGemini || claudePhase === 'done'}
            onClick={() => void runClaude()}
            className={`rounded-lg border px-4 py-2 font-mono text-xs font-semibold ${
              claudePhase === 'done'
                ? 'border-[rgba(34,197,94,0.35)] bg-[rgba(34,197,94,0.08)] text-[#22C55E]'
                : !hasGemini || busy
                  ? 'border-[rgba(255,255,255,0.08)] bg-[#1A1A24] text-[#505068]'
                  : 'border-[#4DB8FF] bg-[rgba(77,184,255,0.12)] text-[#79CBFF] hover:bg-[rgba(77,184,255,0.18)]'
            }`}
          >
            {claudePhase === 'done' ? 'Claude analysis complete ✓' : claudePhase === 'running' ? 'Running Claude…' : 'Complete Claude Analysis'}
          </button>
          {!hasGemini && claudePhase !== 'done' ? <span className="font-mono text-[10px] text-[#505068]">Complete Gemini research first</span> : null}
        </div>

        {claudePhase === 'running' ? (
          <div className="space-y-1">
            <p className="font-mono text-[10px] text-[#79CBFF]">
              {claudeLabel} {claudeElapsed}s elapsed
            </p>
            <div className="h-1.5 w-full overflow-hidden rounded-full bg-[rgba(255,255,255,0.06)]">
              <div className="h-full rounded-full bg-[#4DB8FF] transition-all" style={{ width: `${Math.min(100, (claudeElapsed / 120) * 100)}%` }} />
            </div>
            <p className="font-mono text-[10px] text-[#505068]">Typically 60–90 seconds.</p>
          </div>
        ) : null}
      </div>

      {errorText ? (
        <p className="mt-4 font-mono text-sm text-[#EF4444]">
          {errorText}{' '}
          <button type="button" className="text-[#79CBFF] underline" onClick={() => setErrorText(null)}>
            Dismiss
          </button>
        </p>
      ) : null}

      <div className="mt-4 flex flex-wrap gap-2">
        <button
          type="button"
          className="rounded-lg border border-[rgba(255,255,255,0.12)] px-3 py-2 font-mono text-[11px]"
          disabled={busy}
          onClick={() => {
            setSuggestPhase('idle')
            void suggestOnce()
          }}
        >
          Re-classify framework
        </button>
      </div>

      {overall != null && overall < 65 ? (
        <p className="mt-4 font-mono text-[11px] text-[#F59E0B]">Score under 65%: allocation haircut applies and buy-zone monitoring stays locked until the gate clears.</p>
      ) : null}

      {sectionScores.length > 0 ? (
        <div className="mt-6">
          <p className="text-[10px] font-semibold uppercase tracking-wide text-[#505068]">Section scores</p>
          <ul className="mt-3 grid grid-cols-1 gap-2 md:grid-cols-2">
            {sectionScores.map((s, i) => {
              const sid = `${rz(s, 'section_id') ?? i}`
              const title = String(rz(s, 'title') ?? sid)
              const sp = rz(s, 'score_pct')
              const n = typeof sp === 'number' ? sp : Number(sp)
              return (
                <li key={sid} className="flex items-center justify-between gap-3 rounded-lg bg-[#0A0A0F] px-3 py-2 font-mono text-[11px]">
                  <span className="text-[#C8C8D8]">{title}</span>
                  <span className="text-[#4DB8FF]">{Number.isFinite(n) ? `${n.toFixed(1)}%` : '—'}</span>
                </li>
              )
            })}
          </ul>
        </div>
      ) : null}

      {items.length > 0 ? (
        <div className="mt-6">
          <p className="text-[10px] font-semibold uppercase tracking-wide text-[#505068]">Checklist</p>
          <ul className="mt-3 max-h-[520px] space-y-2 overflow-auto pr-1">
            {items.map((it, idx) => {
              const key = typeof rz(it, 'item_key') === 'string' ? String(rz(it, 'item_key')) : `item_${idx}`
              const title = String(rz(it, 'title') ?? key)
              const rationale = String(rz(it, 'rationale') ?? '')
              const rawScore = rz(it, 'score_pct')
              const claude = typeof rawScore === 'number' ? rawScore : Number(rawScore)
              const effective = overrideMap[key] != null && Number.isFinite(overrideMap[key]) ? overrideMap[key] : claude
              const stars = `${rz(it, 'stars_awarded') ?? '—'} / ${rz(it, 'stars_max') ?? '—'}`
              return (
                <li key={key} className="rounded-lg border border-[rgba(255,255,255,0.06)] bg-[#0A0A0F] p-3">
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div>
                      <p className="text-sm text-[#F0F0F8]">{title}</p>
                      <p className="mt-1 font-mono text-[10px] text-[#505068]">
                        {key} · stars {stars}
                      </p>
                    </div>
                    <div className="text-right font-mono text-[11px]">
                      <div className="text-[#4DB8FF]">Effective {Number.isFinite(effective) ? `${effective.toFixed(1)}%` : '—'}</div>
                      {overrideMap[key] != null ? <div className="text-[#505068]">Claude {Number.isFinite(claude) ? `${claude.toFixed(1)}%` : '—'}</div> : null}
                    </div>
                  </div>
                  {rationale ? <p className="mt-2 text-xs text-[#9090A8]">{rationale}</p> : null}
                  <OverrideRow itemKey={key} claudeScore={Number.isFinite(claude) ? claude : null} selectedVersionId={selectedVersionId} supabase={supabase} onLogged={loadOverrides} />
                </li>
              )
            })}
          </ul>
        </div>
      ) : scorecardFull ? (
        <p className="mt-4 text-sm text-[#505068]">Scorecard loaded but payload has no item list — open an older version or re-run analysis.</p>
      ) : (
        <p className="mt-4 text-sm text-[#505068]">No scorecard rows yet. Complete Gemini research then Claude analysis above.</p>
      )}
    </section>
  )
}

/**
 * @param {{
 *   itemKey: string,
 *   claudeScore: number|null,
 *   selectedVersionId: string|null,
 *   supabase: import('@supabase/supabase-js').SupabaseClient|null,
 *   onLogged: () => void,
 * }} props
 */
function OverrideRow({ itemKey, claudeScore, selectedVersionId, supabase, onLogged }) {
  const [scoreInput, setScoreInput] = useState('')
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  const [localErr, setLocalErr] = useState(/** @type {string|null} */ (null))

  const submit = async () => {
    setLocalErr(null)
    if (!supabase || !selectedVersionId) {
      setLocalErr('Select a scorecard version first.')
      return
    }
    const n = Number.parseFloat(scoreInput)
    if (!Number.isFinite(n) || n < 0 || n > 100) {
      setLocalErr('Enter a score between 0 and 100.')
      return
    }
    setBusy(true)
    try {
      const { data: ud, error: uErr } = await supabase.auth.getUser()
      if (uErr || !ud.user?.id) throw new Error('Not signed in')
      const { error } = await supabase.from('score_override_events').insert({
        user_id: ud.user.id,
        scorecard_version_id: selectedVersionId,
        item_key: itemKey,
        claude_score: claudeScore,
        user_score: n,
        note: note.trim() || null,
      })
      if (error) throw error
      setScoreInput('')
      setNote('')
      onLogged()
    } catch (e) {
      setLocalErr(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="mt-3 border-t border-[rgba(255,255,255,0.06)] pt-3">
      <p className="font-mono text-[10px] uppercase tracking-wide text-[#505068]">Manual override</p>
      <div className="mt-2 flex flex-wrap items-end gap-2">
        <label className="flex flex-col gap-1 font-mono text-[10px] text-[#9090A8]">
          Your score (0–100)
          <input
            className="w-28 rounded border border-[rgba(255,255,255,0.12)] bg-[#111118] px-2 py-1 text-xs text-[#F0F0F8]"
            value={scoreInput}
            onChange={(e) => setScoreInput(e.target.value)}
            inputMode="decimal"
          />
        </label>
        <label className="flex min-w-[200px] flex-1 flex-col gap-1 font-mono text-[10px] text-[#9090A8]">
          Note (optional)
          <input
            className="rounded border border-[rgba(255,255,255,0.12)] bg-[#111118] px-2 py-1 text-xs text-[#F0F0F8]"
            value={note}
            onChange={(e) => setNote(e.target.value)}
          />
        </label>
        <button
          type="button"
          disabled={busy || !selectedVersionId}
          className="rounded-lg bg-[rgba(255,255,255,0.08)] px-3 py-2 font-mono text-[11px] disabled:opacity-40"
          onClick={() => void submit()}
        >
          Log override
        </button>
      </div>
      {localErr ? <p className="mt-2 font-mono text-[11px] text-[#EF4444]">{localErr}</p> : null}
    </div>
  )
}

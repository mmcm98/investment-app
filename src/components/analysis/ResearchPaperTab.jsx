import { useCallback, useMemo, useState } from 'react'
import { motion } from 'framer-motion'
import { useSharesightIntegration } from '../../context/SharesightIntegrationContext.jsx'
import { runDirectTriadAnalysis } from '../../lib/analysis/directTriadAnalysis.js'

/** @param {unknown} v */
function asText(v) {
  return typeof v === 'string' && v.trim() ? v.trim() : ''
}

/**
 * @param {Record<string, unknown>|null|undefined} researchFull
 * @param {Record<string, unknown>|null|undefined} extraResearch
 */
function extractResearchMarkdown(researchFull, extraResearch) {
  const fromExtra = asText(extraResearch?.markdown) || asText(extraResearch?.body_md) || asText(extraResearch?.content)
  if (fromExtra) return fromExtra

  const payload = researchFull && typeof researchFull.payload === 'object' ? researchFull.payload : null
  if (!payload) return ''

  const sections = Array.isArray(Reflect.get(payload, 'sections')) ? Reflect.get(payload, 'sections') : []
  const parts = sections
    .map((s) => {
      if (!s || typeof s !== 'object') return ''
      const body = asText(Reflect.get(s, 'body_md'))
      const heading = asText(Reflect.get(s, 'heading'))
      if (body && heading) return `## ${heading}\n\n${body}`
      return body || heading
    })
    .filter(Boolean)

  if (parts.length) return parts.join('\n\n')

  return asText(Reflect.get(payload, 'body_md')) || asText(Reflect.get(payload, 'markdown'))
}

/**
 * @param {Record<string, unknown>|null|undefined} researchFull
 * @param {Record<string, unknown>|null|undefined} extraResearch
 */
function extractGeneratedAt(researchFull, extraResearch) {
  return (
    asText(extraResearch?.generated_at) ||
    asText(extraResearch?.date_generated) ||
    asText(researchFull?.generated_at) ||
    asText(researchFull?.created_at)
  )
}

/** @param {{ md: string }} props */
function ThesisMarkdown({ md }) {
  return <motion.div className="whitespace-pre-wrap font-sans text-sm leading-relaxed text-[#D6D6E8]">{md}</motion.div>
}

/**
 * @param {{
 *   hasScorecard: boolean,
 *   researchFull?: Record<string, unknown>|null,
 *   extraResearch?: Record<string, unknown>|null,
 *   positionId?: string|null,
 *   watchlistItemId?: string|null,
 *   holdingId?: string|null,
 *   row?: Record<string, unknown>|null,
 *   refreshDetail: () => void,
 * }} props
 */
export function ResearchPaperTab({
  hasScorecard,
  researchFull = null,
  extraResearch = null,
  positionId = null,
  watchlistItemId = null,
  holdingId = null,
  row = null,
  refreshDetail,
}) {
  const { supabase } = useSharesightIntegration()
  const [phase, setPhase] = useState(/** @type {'idle'|'generating'|'error'} */ ('idle'))
  const [progressLabel, setProgressLabel] = useState('')
  const [errorText, setErrorText] = useState(/** @type {string|null} */ (null))

  const markdown = useMemo(() => extractResearchMarkdown(researchFull, extraResearch), [researchFull, extraResearch])
  const generatedAt = useMemo(() => extractGeneratedAt(researchFull, extraResearch), [researchFull, extraResearch])
  const hasPaper = Boolean(markdown)

  const runGenerate = useCallback(async () => {
    setErrorText(null)
    setProgressLabel('Writing investment thesis with Claude...')
    setPhase('generating')

    if (!supabase) {
      setPhase('error')
      setErrorText('Not signed in.')
      return
    }

    try {
      const out = await runDirectTriadAnalysis(supabase, {
        step: 'generate-thesis',
        ...(holdingId
          ? { row: row ?? undefined, holdingId: `${holdingId}`.trim() }
          : positionId != null && `${positionId}`.trim()
            ? { positionId: `${positionId}`.trim() }
            : { watchlistItemId: `${watchlistItemId ?? ''}`.trim() }),
        onProgress: (message) => setProgressLabel(message),
      })

      if (!out || typeof out !== 'object' || Reflect.get(out, 'ok') !== true) {
        throw new Error('Thesis generation did not complete.')
      }

      setPhase('idle')
      setProgressLabel('')
      refreshDetail()
    } catch (e) {
      setPhase('error')
      setErrorText(e instanceof Error ? e.message : String(e))
    }
  }, [supabase, holdingId, row, positionId, watchlistItemId, refreshDetail])

  if (!hasScorecard) {
    return (
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        className="rounded-xl border border-dashed border-[rgba(255,255,255,0.12)] bg-[#0A0A0F] px-5 py-10 text-center text-sm text-[#9090A8]"
      >
        Run analysis first to generate the scorecard, then come back here for the investment thesis.
      </motion.div>
    )
  }

  if (!hasPaper) {
    return (
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        className="rounded-xl border border-[rgba(121,203,255,0.22)] bg-[rgba(121,203,255,0.05)] px-6 py-10 text-center"
      >
        {phase === 'generating' ? (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="space-y-4">
            <p className="font-mono text-sm text-[#79CBFF]">{progressLabel || 'Writing investment thesis with Claude...'}</p>
            <motion.div
              className="mx-auto h-2 max-w-md overflow-hidden rounded-full bg-[rgba(255,255,255,0.06)]"
              initial={{ opacity: 0.6 }}
              animate={{ opacity: 1 }}
            >
              <motion.div
                className="h-full rounded-full bg-[linear-gradient(90deg,#79CBFF,#4DB8FF)]"
                initial={{ width: '8%' }}
                animate={{ width: ['12%', '88%', '55%', '92%'] }}
                transition={{ duration: 90, ease: 'linear', repeat: Infinity }}
              />
            </motion.div>
            <p className="font-mono text-[10px] text-[#505068]">Uses cached Gemini research · typically 1–3 minutes</p>
          </motion.div>
        ) : (
          <>
            <p className="text-base font-medium text-[#F0F0F8]">Investment thesis not generated yet</p>
            <p className="mx-auto mt-2 max-w-md text-sm text-[#9090A8]">
              Uses cached research to write a comprehensive thesis (1–3 minutes)
            </p>
            <button
              type="button"
              onClick={() => void runGenerate()}
              className="mt-6 rounded-lg bg-[#4DB8FF] px-6 py-3 font-mono text-sm font-semibold text-[#0A0A0F] hover:bg-[#79CBFF]"
            >
              Generate Investment Thesis
            </button>
            {phase === 'error' && errorText ? (
              <p className="mt-4 font-mono text-sm text-[#EF4444]">
                {errorText}{' '}
                <button type="button" className="text-[#79CBFF] underline" onClick={() => void runGenerate()}>
                  Retry
                </button>
              </p>
            ) : null}
          </>
        )}
      </motion.div>
    )
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap gap-4 font-mono text-xs text-[#9090A8]">
          <span>
            Generated: <span className="text-[#F0F0F8]">{generatedAt || '—'}</span>
          </span>
        </div>
        <button
          type="button"
          disabled={phase === 'generating'}
          onClick={() => void runGenerate()}
          className="rounded-lg border border-[rgba(255,255,255,0.12)] px-4 py-2 font-mono text-xs text-[#79CBFF] hover:bg-[rgba(255,255,255,0.04)] disabled:opacity-50"
        >
          {phase === 'generating' ? 'Regenerating…' : 'Regenerate'}
        </button>
      </div>

      {phase === 'generating' ? (
        <p className="font-mono text-[11px] text-[#79CBFF]">{progressLabel || 'Writing investment thesis with Claude...'}</p>
      ) : null}

      {phase === 'error' && errorText ? (
        <p className="font-mono text-sm text-[#EF4444]">{errorText}</p>
      ) : null}

      <article className="rounded-lg bg-[#0A0A0F] p-5">
        <ThesisMarkdown md={markdown} />
      </article>
    </div>
  )
}

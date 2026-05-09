import { Link } from 'react-router-dom'

/** @param {number|null|undefined} aud */
function fmtAudPx(aud) {
  if (aud == null || !Number.isFinite(Number(aud))) return '—'

  return Number(aud).toLocaleString('en-AU', {
    style: 'currency',
    currency: 'AUD',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })
}

/**
 * @param {{ cards: Record<string, unknown>[] }} props
 */

export function DashboardSatelliteStrip({ cards }) {
  const top = cards.slice(0, 12)

  return (
    <div className="rounded-xl border border-[rgba(255,255,255,0.06)] bg-[#111118] p-4 shadow-[inset_0_1px_0_rgba(255,255,255,0.04)]">
      <p className="text-[14px] font-semibold text-[#F0F0F8]">Satellite positions</p>

      <p className="mt-2 text-xs text-[#9090A8]">Live prices merged with synced satellite holdings.</p>

      <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2">
        {top.length === 0 ? (
          <p className="text-sm text-[#505068]">No satellite holdings yet.</p>
        ) : (
          top.map((card) => {
            const cid = Reflect.get(card, 'positionId')

            const href = typeof cid === 'string' && cid ? `/satellite/position/${cid}` : '/satellite'

            const q = Reflect.get(card, 'mergedQuote')

            const aud = q && typeof Reflect.get(q, 'display_aud') === 'number' ? Reflect.get(q, 'display_aud') : null

            const chg =
              q && typeof Reflect.get(q, 'change_percent') === 'number'
                ? Number(Reflect.get(q, 'change_percent'))
                : null

            return (
              <article
                key={`${Reflect.get(card, 'rowKey')}`}
                className="rounded-lg border border-[rgba(255,255,255,0.06)] bg-[#0A0A0F] p-4 transition-colors duration-150 hover:border-[rgba(77,184,255,0.35)]"
              >
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <h3 className="font-mono text-base text-[#4DB8FF]">{`${Reflect.get(card, 'ticker')}`}</h3>

                    <p className="mt-1 line-clamp-2 text-sm text-[#C8C8D8]">{`${Reflect.get(card, 'displayName') ?? ''}`}</p>
                  </div>

                  <div className="text-right font-mono text-xs text-[#F0F0F8]">
                    <div>{fmtAudPx(aud)}</div>

                    <div className={`mt-1 ${chg != null && chg >= 0 ? 'text-[#22C55E]' : 'text-[#EF4444]'}`}>
                      {chg != null ? `${chg.toFixed(2)}%` : '—'}
                    </div>
                  </div>
                </div>

                <div className="mt-3 flex flex-wrap gap-3 font-mono text-[10px] uppercase tracking-wide">
                  <span className="text-[#505068]">
                    Tier <span className="text-[#F0F0F8]">{`${Reflect.get(card, 'tier') ?? '—'}`}</span>
                  </span>

                  <span className="text-[#505068]">
                    Score <span className="text-[#4DB8FF]">{`${Reflect.get(card, 'overallScore') ?? '—'}`}</span>
                  </span>
                </div>

                <Link
                  className="mt-3 inline-flex rounded-md border border-[rgba(255,255,255,0.12)] px-3 py-1 font-mono text-[11px] text-[#79CBFF]"
                  to={href}
                >
                  Details
                </Link>
              </article>
            )
          })
        )}
      </div>

      <Link className="mt-4 inline-block font-mono text-xs text-[#79CBFF]" to="/satellite">
        Satellite workspace →
      </Link>
    </div>
  )
}

/**
 * @param {{ rows: Record<string, unknown>[], scores: Record<string, Record<string, unknown>> }} props
 */

export function DashboardWatchPanel({ rows, scores }) {
  const enriched = rows
    .map((w) => {
      const wid = `${Reflect.get(w, 'id')}`

      const sc = scores[wid]

      const os = sc && typeof Reflect.get(sc, 'overall_score') === 'number' ? Number(Reflect.get(sc, 'overall_score')) : null

      const ticker = `${Reflect.get(w, 'display_ticker') ?? Reflect.get(w, 'fmp_symbol') ?? ''}`.trim() || '—'

      const nm = `${Reflect.get(w, 'name') ?? ''}`.trim()

      return { wid, ticker, name: nm || null, score: os }
    })
    .sort((a, b) => {
      if (a.score == null && b.score == null) return a.ticker.localeCompare(b.ticker)

      if (a.score == null) return 1

      if (b.score == null) return -1

      return (b.score ?? 0) - (a.score ?? 0)
    })
    .slice(0, 5)

  return (
    <div className="rounded-xl border border-[rgba(255,255,255,0.06)] bg-[#111118] p-4 shadow-[inset_0_1px_0_rgba(255,255,255,0.04)]">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-[14px] font-semibold text-[#F0F0F8]">Watchlist · top scores</p>

          <p className="mt-2 text-xs text-[#9090A8]">Latest scorecards attached to active watch tickers.</p>
        </div>

        <Link className="font-mono text-xs text-[#79CBFF]" to="/watchlist">
          Full list →
        </Link>
      </div>

      <ul className="mt-4 divide-y divide-[rgba(255,255,255,0.06)]">
        {enriched.length === 0 ? (
          <li className="py-4 text-sm text-[#505068]">Watchlist starts empty.</li>
        ) : (
          enriched.map((row) => (
            <li key={row.wid} className="flex items-center justify-between gap-4 py-3">
              <div>
                <p className="font-mono text-sm text-[#4DB8FF]">{row.ticker}</p>

                {row.name ? <p className="mt-1 line-clamp-2 text-xs text-[#9090A8]">{row.name}</p> : null}
              </div>

              <p className="font-mono text-sm text-[#F0F0F8]">{row.score != null ? `${row.score.toFixed(1)}%` : '—'}</p>
            </li>
          ))
        )}
      </ul>
    </div>
  )
}

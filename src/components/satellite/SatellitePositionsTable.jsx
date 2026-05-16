import { Fragment, useCallback, useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import { postEquityFacts, postFmpHistoricalPriceFull } from '../../lib/market/marketApi.js'
import { fmpInstrumentSymbol } from '../../lib/market/fmpInstrumentSymbol.js'

/** @param {unknown} v */
function numFin(v) {
  if (typeof v === 'number' && Number.isFinite(v)) return v
  const n = Number.parseFloat(`${v ?? ''}`)
  return Number.isFinite(n) ? n : null
}

/** @param {number|null|undefined} n */
function fmtAud(n) {
  if (n == null || !Number.isFinite(Number(n))) return '—'
  return Number(n).toLocaleString('en-AU', { style: 'currency', currency: 'AUD', minimumFractionDigits: 2 })
}

/** @param {number|null|undefined} n @param {string} cur */
function fmtNative(n, cur) {
  if (n == null || !Number.isFinite(Number(n))) return '—'
  const c = `${cur ?? ''}`.trim()
  return `${Number(n).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 4 })}${c ? ` ${c}` : ''}`
}

/** @param {number|null|undefined} n */
function fmtPct(n) {
  if (n == null || !Number.isFinite(Number(n))) return '—'
  return `${Number(n).toFixed(2)}%`
}

/**
 * @param {Record<string, unknown>} row
 */
function rowTickerExchange(row) {
  const t = `${row.ticker ?? '—'}`.trim() || '—'
  const ex =
    `${row.exchangeShort ?? ''}`.trim() ||
    (row.exchangeGroup === 'Cash Accounts' ? 'Cash' : `${row.exchangeGroup ?? ''}`.trim()) ||
    '—'
  return `${t} | ${ex}`
}

/**
 * @param {string} group
 */
function groupSortRank(group) {
  if (group === 'ASX') return 0
  if (group === 'LSE') return 1
  if (group === 'Cash Accounts') return 400
  return 100
}

/**
 * @param {Record<string, unknown>[]} tableCards
 * @param {boolean} includeClosed
 */
function buildGroupedRows(tableCards, includeClosed) {
  /** @type {Record<string, Record<string, unknown>[]>} */
  const by = {}
  for (const c of tableCards) {
    if (!includeClosed && c.rowClosed) continue
    const g = `${c.exchangeGroup ?? 'Other'}`
    if (!by[g]) by[g] = []
    by[g].push(c)
  }
  const keys = Object.keys(by).sort((a, b) => groupSortRank(a) - groupSortRank(b) || a.localeCompare(b))
  for (const k of keys) {
    by[k].sort((a, b) => {
      const ac = Boolean(a.rowClosed)
      const bc = Boolean(b.rowClosed)
      if (ac !== bc) return ac ? 1 : -1
      return `${a.ticker ?? ''}`.localeCompare(`${b.ticker ?? ''}`, undefined, { sensitivity: 'base' })
    })
  }
  return { keys, by }
}

/**
 * @param {Record<string, unknown>[]} rows
 */
function subtotalMetrics(rows) {
  let value = 0
  let gain = 0
  let cost = 0
  for (const r of rows) {
    const va = numFin(r.valueAud)
    const cg = numFin(r.capitalGainAud)
    const co = numFin(r.costBasis)
    if (va != null) value += va
    if (cg != null) gain += cg
    if (co != null) cost += co
  }
  const ret = cost > 0 && Number.isFinite(gain) ? (gain / cost) * 100 : null
  return { value, gain, ret }
}

/**
 * @param {{ row: Record<string, unknown>, open: boolean, period: string, onPeriod: (p: string) => void }} props
 */
function SatelliteRowInlineDetail({ row, open, period, onPeriod }) {
  const fmpSym = `${row.fmpSymbol ?? ''}`.trim()
  const ex = `${row.exchangeShort ?? ''}`.trim()
  const profileSym = `${row.fmpProfileSymbol ?? ''}`.trim() || fmpInstrumentSymbol(fmpSym, ex)

  const [loading, setLoading] = useState(false)
  const [err, setErr] = useState(/** @type {string|null} */ (null))
  const [points, setPoints] = useState(/** @type {{ t: string, close: number }[]> */ ([]))
  const [profile, setProfile] = useState(/** @type {Record<string, unknown>|null} */ (null))
  const [keyMetrics, setKeyMetrics] = useState(/** @type {Record<string, unknown>|null} */ (null))

  useEffect(() => {
    if (!open || !fmpSym) return undefined

    let cancelled = false

    queueMicrotask(() => {
      setLoading(true)
      setErr(null)
    })

    void (async () => {
      try {
        const [histRes, factsRes] = await Promise.all([
          postFmpHistoricalPriceFull(fmpSym, ex, period),
          profileSym ? postEquityFacts(profileSym) : Promise.resolve({ ok: false }),
        ])

        if (cancelled) return

        if (histRes && Reflect.get(histRes, 'ok') === true && Array.isArray(histRes.points)) {
          setPoints(/** @type {{ t: string, close: number }[]} */ (histRes.points))
        } else {
          setPoints([])
          const e = Reflect.get(histRes ?? {}, 'error')
          if (typeof e === 'string' && e) setErr(e)
        }

        if (factsRes && Reflect.get(factsRes, 'ok') === true) {
          const p = Reflect.get(factsRes, 'profile')
          setProfile(p && typeof p === 'object' ? /** @type {Record<string, unknown>} */ (p) : null)
          const km = Reflect.get(factsRes, 'key_metrics')
          setKeyMetrics(km && typeof km === 'object' ? /** @type {Record<string, unknown>} */ (km) : null)
        } else {
          setProfile(null)
          setKeyMetrics(null)
        }
      } catch (e) {
        if (!cancelled) {
          setErr(e instanceof Error ? e.message : String(e))
          setPoints([])
          setProfile(null)
          setKeyMetrics(null)
        }
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()

    return () => {
      cancelled = true
    }
  }, [open, fmpSym, ex, period, profileSym])

  const chartData = useMemo(
    () => points.map((p) => ({ date: p.t, close: p.close })),
    [points],
  )

  const cur = `${row.quoteCurrency ?? ''}`.trim() || 'USD'

  const periods = /** @type {const} */ (['3M', '6M', '1Y', '2Y'])

  if (!open) return null

  const mktCap = profile ? numFin(profile.mktCap) : null
  const pe = profile ? numFin(profile.pe) : null
  const eps = profile ? numFin(profile.eps) : null
  const divY =
    (keyMetrics ? numFin(keyMetrics.dividendYieldPercentageTTM ?? keyMetrics.dividendYieldPercentage) : null) ??
    (profile ? numFin(profile.dividendYield) : null)
  const range52 = profile ? `${profile.range ?? ''}`.trim() : ''
  const sector = profile ? `${profile.sector ?? ''}`.trim() : ''
  const industry = profile ? `${profile.industry ?? ''}`.trim() : ''
  const web = profile ? `${profile.website ?? ''}`.trim() : ''

  return (
    <tr className="bg-[#0A0A0F]">
      <td colSpan={10} className="border-t border-[rgba(255,255,255,0.08)] px-4 py-4">
        <div className="grid gap-4 lg:grid-cols-2">
          <div>
            <div className="mb-2 flex flex-wrap items-center gap-2">
              <span className="text-[10px] font-semibold uppercase tracking-wide text-[#505068]">Price (FMP)</span>
              <div className="flex gap-1">
                {periods.map((p) => (
                  <button
                    key={p}
                    type="button"
                    onClick={() => onPeriod(p)}
                    className={`rounded px-2 py-0.5 font-mono text-[10px] ${
                      period === p ? 'bg-[#4DB8FF] text-[#0A0A0F]' : 'border border-[rgba(255,255,255,0.12)] text-[#9090A8]'
                    }`}
                  >
                    {p}
                  </button>
                ))}
              </div>
            </div>
            <div className="h-[220px] w-full min-w-0">
              {loading ? (
                <p className="text-xs text-[#505068]">Loading chart…</p>
              ) : err ? (
                <p className="text-xs text-[#EF4444]">{err}</p>
              ) : chartData.length === 0 ? (
                <p className="text-xs text-[#505068]">No historical prices.</p>
              ) : (
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={chartData} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                    <CartesianGrid stroke="rgba(255,255,255,0.06)" strokeDasharray="3 3" />
                    <XAxis dataKey="date" tick={{ fill: '#505068', fontSize: 9 }} interval="preserveStartEnd" minTickGap={24} />
                    <YAxis
                      domain={['auto', 'auto']}
                      tick={{ fill: '#9090A8', fontSize: 10 }}
                      width={56}
                      tickFormatter={(v) => `${v}`}
                    />
                    <Tooltip
                      contentStyle={{
                        background: '#1A1A24',
                        border: '1px solid rgba(255,255,255,0.12)',
                        borderRadius: 6,
                        fontSize: 11,
                      }}
                      labelStyle={{ color: '#F0F0F8' }}
                      formatter={(v) => [`${v}`, `Close (${cur})`]}
                    />
                    <Line type="monotone" dataKey="close" stroke="#4DB8FF" strokeWidth={1.5} dot={false} isAnimationActive={false} />
                  </LineChart>
                </ResponsiveContainer>
              )}
            </div>
          </div>

          <div className="border-t border-[rgba(255,255,255,0.06)] pt-3 lg:border-t-0 lg:border-l lg:pl-4 lg:pt-0">
            <p className="text-[10px] font-semibold uppercase tracking-wide text-[#505068]">Key stats (FMP profile)</p>
            {loading ? (
              <p className="mt-2 text-xs text-[#505068]">Loading…</p>
            ) : (
              <dl className="mt-3 grid gap-2 font-mono text-xs text-[#C8C8D8]">
                <div className="flex justify-between gap-2">
                  <dt className="text-[#505068]">Market cap</dt>
                  <dd>{mktCap != null ? mktCap.toLocaleString() : '—'}</dd>
                </div>
                <div className="flex justify-between gap-2">
                  <dt className="text-[#505068]">52W range</dt>
                  <dd className="text-right">{range52 || '—'}</dd>
                </div>
                <div className="flex justify-between gap-2">
                  <dt className="text-[#505068]">P/E</dt>
                  <dd>{pe != null ? pe.toFixed(2) : '—'}</dd>
                </div>
                <div className="flex justify-between gap-2">
                  <dt className="text-[#505068]">EPS</dt>
                  <dd>{eps != null ? eps.toFixed(2) : '—'}</dd>
                </div>
                <div className="flex justify-between gap-2">
                  <dt className="text-[#505068]">Dividend yield</dt>
                  <dd>{divY != null ? fmtPct(divY) : '—'}</dd>
                </div>
                <div className="flex justify-between gap-2">
                  <dt className="text-[#505068]">Sector</dt>
                  <dd className="text-right">{sector || '—'}</dd>
                </div>
                <div className="flex justify-between gap-2">
                  <dt className="text-[#505068]">Industry</dt>
                  <dd className="text-right">{industry || '—'}</dd>
                </div>
                {web ? (
                  <div className="pt-1">
                    <a
                      href={web.startsWith('http') ? web : `https://${web}`}
                      target="_blank"
                      rel="noreferrer"
                      className="text-[#4DB8FF] hover:text-[#79CBFF]"
                    >
                      Website ↗
                    </a>
                  </div>
                ) : null}
              </dl>
            )}
          </div>
        </div>
      </td>
    </tr>
  )
}

/**
 * @param {{ tableCards: Record<string, unknown>[] }} props
 */
export function SatellitePositionsTable({ tableCards }) {
  const [includeClosed, setIncludeClosed] = useState(false)
  const [valueMode, setValueMode] = useState(/** @type {'aud'|'pct'} */ ('aud'))
  const [expandedKey, setExpandedKey] = useState(/** @type {string|null} */ (null))
  const [chartPeriod, setChartPeriod] = useState('1Y')

  const { keys, by } = useMemo(() => buildGroupedRows(tableCards, includeClosed), [tableCards, includeClosed])

  const visibleRows = useMemo(() => {
    const out = []
    for (const k of keys) out.push(...(by[k] ?? []))
    return out
  }, [keys, by])

  const denomAud = useMemo(() => {
    let s = 0
    for (const r of visibleRows) {
      const va = numFin(r.valueAud)
      if (va != null) s += va
    }
    return s
  }, [visibleRows])

  const summary = useMemo(() => {
    const t = subtotalMetrics(visibleRows)
    return {
      portfolioValue: t.value,
      capitalGain: t.gain,
      currencyGain: null,
      totalReturnPct: t.ret,
    }
  }, [visibleRows])

  const grand = useMemo(() => subtotalMetrics(visibleRows), [visibleRows])

  const toggleDetails = useCallback((rowKey) => {
    setExpandedKey((prev) => (prev === rowKey ? null : rowKey))
  }, [])

  const imgSrcForRow = useCallback((row) => {
    const base = `${row.fmpSymbol ?? ''}`.trim()
    if (!base) return ''
    const full = `${row.fmpProfileSymbol ?? ''}`.trim() || fmpInstrumentSymbol(base, `${row.exchangeShort ?? ''}`)
    return `https://financialmodelingprep.com/image-stock/${encodeURIComponent(full)}.png`
  }, [])

  return (
    <section className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-[rgba(255,255,255,0.06)] bg-[#111118] px-4 py-3">
        <div className="flex flex-wrap gap-6 font-mono text-xs text-[#F0F0F8]">
          <div>
            <span className="text-[10px] uppercase tracking-wide text-[#505068]">Portfolio value</span>
            <div className="mt-0.5 text-sm">{fmtAud(summary.portfolioValue)}</div>
          </div>
          <div>
            <span className="text-[10px] uppercase tracking-wide text-[#505068]">Capital gain</span>
            <div
              className={`mt-0.5 text-sm ${
                summary.capitalGain != null && summary.capitalGain >= 0 ? 'text-[#22C55E]' : 'text-[#EF4444]'
              }`}
            >
              {fmtAud(summary.capitalGain)}
            </div>
          </div>
          <div>
            <span className="text-[10px] uppercase tracking-wide text-[#505068]">Currency gain</span>
            <div className="mt-0.5 text-sm text-[#505068]">—</div>
          </div>
          <div>
            <span className="text-[10px] uppercase tracking-wide text-[#505068]">Total return</span>
            <div className="mt-0.5 text-sm">{fmtPct(summary.totalReturnPct)}</div>
          </div>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-4 text-xs">
        <label className="flex cursor-pointer items-center gap-2 text-[#9090A8]">
          <input type="checkbox" checked={includeClosed} onChange={(e) => setIncludeClosed(e.target.checked)} />
          Include closed positions
        </label>
        <div className="flex items-center gap-2">
          <span className="text-[10px] font-semibold uppercase tracking-wide text-[#505068]">Value</span>
          <div className="flex rounded border border-[rgba(255,255,255,0.12)] p-0.5">
            <button
              type="button"
              onClick={() => setValueMode('aud')}
              className={`rounded px-2 py-1 font-mono text-[10px] ${valueMode === 'aud' ? 'bg-[#22222F] text-[#4DB8FF]' : 'text-[#9090A8]'}`}
            >
              AU$
            </button>
            <button
              type="button"
              onClick={() => setValueMode('pct')}
              className={`rounded px-2 py-1 font-mono text-[10px] ${valueMode === 'pct' ? 'bg-[#22222F] text-[#4DB8FF]' : 'text-[#9090A8]'}`}
            >
              %
            </button>
          </div>
        </div>
        <div className="text-[10px] uppercase tracking-wide text-[#505068]">
          Group by: <span className="text-[#F0F0F8]">Market</span>
        </div>
      </div>

      <div className="overflow-x-auto rounded-xl border border-[rgba(255,255,255,0.06)] bg-[#111118]">
        <table className="w-full min-w-[1040px] border-collapse text-left text-sm">
          <thead>
            <tr className="border-b border-[rgba(255,255,255,0.08)] text-[10px] font-semibold uppercase tracking-wide text-[#505068]">
              <th className="px-3 py-2">Logo</th>
              <th className="px-3 py-2">Ticker | Exch</th>
              <th className="px-3 py-2">Company</th>
              <th className="px-3 py-2 text-right">Price</th>
              <th className="px-3 py-2 text-right">Avg buy</th>
              <th className="px-3 py-2 text-right">Qty</th>
              <th className="px-3 py-2 text-right">Value</th>
              <th className="px-3 py-2 text-right">Cap. gain</th>
              <th className="px-3 py-2 text-right">Return</th>
              <th className="px-3 py-2 text-right">Total return</th>
              <th className="px-3 py-2 text-right">Actions</th>
            </tr>
          </thead>
          <tbody>
            {keys.length === 0 ? (
              <tr>
                <td colSpan={11} className="px-4 py-8 text-center text-[#505068]">
                  No rows to display.
                </td>
              </tr>
            ) : null}
            {keys.map((group) => {
              const rows = by[group] ?? []
              const sub = subtotalMetrics(rows)
              return (
                <Fragment key={`grp:${group}`}>
                  <tr className="bg-[#1A1A24]">
                    <td colSpan={11} className="px-3 py-2 font-sans text-[13px] font-semibold text-[#F0F0F8]">
                      {group}
                    </td>
                  </tr>
                  {rows.map((row) => {
                    const rk = `${row.rowKey}`
                    const q = row.mergedQuote && typeof row.mergedQuote === 'object' ? /** @type {Record<string, unknown>} */ (row.mergedQuote) : null
                    const native =
                      q && typeof q.display_native === 'number'
                        ? q.display_native
                        : q && typeof q.last_price === 'number'
                          ? q.last_price
                          : null
                    const cur = `${row.quoteCurrency ?? ''}`.trim()
                    const closed = Boolean(row.rowClosed)
                    const pid = row.positionId ? `${row.positionId}` : ''
                    const hasSc = Boolean(row.hasScorecard)
                    const img = imgSrcForRow(row)
                    const letter = `${row.ticker ?? '?'}`.trim().charAt(0).toUpperCase() || '?'
                    const va = numFin(row.valueAud)
                    const pctOfPort = denomAud > 0 && va != null ? (va / denomAud) * 100 : null
                    const valueCell =
                      valueMode === 'aud' ? fmtAud(va) : pctOfPort != null ? fmtPct(pctOfPort) : '—'
                    return (
                      <Fragment key={rk}>
                        <tr
                          className={`border-b border-[rgba(255,255,255,0.04)] transition-colors hover:bg-[#22222F] ${
                            closed ? 'opacity-60' : ''
                          }`}
                        >
                          <td className="px-3 py-2 align-middle">
                            <div className="relative flex h-5 w-5 items-center justify-center overflow-hidden rounded-full bg-[#1A1A24] ring-1 ring-[rgba(255,255,255,0.08)]">
                              <span className="absolute inset-0 flex items-center justify-center font-mono text-[9px] font-semibold text-[#4DB8FF]">
                                {letter}
                              </span>
                              {img ? (
                                <img
                                  src={img}
                                  alt=""
                                  className="relative z-10 h-5 w-5 object-cover"
                                  onError={(e) => {
                                    e.currentTarget.style.visibility = 'hidden'
                                  }}
                                />
                              ) : null}
                            </div>
                          </td>
                          <td className="px-3 py-2 align-middle font-mono text-[13px] text-[#4DB8FF]">
                            <div className="flex flex-wrap items-center gap-2">
                              {rowTickerExchange(row)}
                              {closed ? (
                                <span className="rounded border border-[rgba(255,255,255,0.12)] bg-[#22222F] px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-wide text-[#9090A8]">
                                  Closed
                                </span>
                              ) : null}
                            </div>
                          </td>
                          <td className="max-w-[200px] px-3 py-2 align-middle text-[#F0F0F8]">
                            <span className="line-clamp-2">{`${row.displayName ?? ''}`}</span>
                          </td>
                          <td className="px-3 py-2 text-right font-mono text-xs text-[#F0F0F8]">{fmtNative(native, cur)}</td>
                          <td className="px-3 py-2 text-right font-mono text-xs text-[#C8C8D8]">
                            {fmtNative(row.avgBuyNative, cur)}
                          </td>
                          <td className="px-3 py-2 text-right font-mono text-xs text-[#C8C8D8]">
                            {row.quantity != null && Number.isFinite(Number(row.quantity)) ? `${row.quantity}` : '—'}
                          </td>
                          <td className="px-3 py-2 text-right font-mono text-xs text-[#F0F0F8]">{valueCell}</td>
                          <td
                            className={`px-3 py-2 text-right font-mono text-xs ${
                              numFin(row.capitalGainAud) != null && (numFin(row.capitalGainAud) ?? 0) >= 0
                                ? 'text-[#22C55E]'
                                : 'text-[#EF4444]'
                            }`}
                          >
                            {fmtAud(numFin(row.capitalGainAud))}
                          </td>
                          <td className="px-3 py-2 text-right font-mono text-xs text-[#C8C8D8]">{fmtPct(numFin(row.returnPct))}</td>
                          <td className="px-3 py-2 text-right font-mono text-xs text-[#C8C8D8]">{fmtPct(numFin(row.totalReturnPct))}</td>
                          <td className="px-3 py-2 text-right align-middle">
                            <div className="flex flex-wrap justify-end gap-1">
                              <button
                                type="button"
                                onClick={() => toggleDetails(rk)}
                                className="font-mono text-[11px] text-[#4DB8FF] hover:text-[#79CBFF]"
                              >
                                Details ↓
                              </button>
                              {pid ? (
                                hasSc ? (
                                  <Link className="font-mono text-[11px] text-[#4DB8FF] hover:text-[#79CBFF]" to={`/satellite/position/${pid}?tab=research`}>
                                    View Analysis →
                                  </Link>
                                ) : (
                                  <Link
                                    className="font-mono text-[11px] text-[#4DB8FF] hover:text-[#79CBFF]"
                                    to={`/satellite/position/${pid}?tab=scorecard`}
                                  >
                                    Analyse →
                                  </Link>
                                )
                              ) : null}
                            </div>
                          </td>
                        </tr>
                        {expandedKey === rk ? (
                          <SatelliteRowInlineDetail
                            row={row}
                            open
                            period={chartPeriod}
                            onPeriod={(p) => {
                              setChartPeriod(p)
                            }}
                          />
                        ) : null}
                      </Fragment>
                    )
                  })}
                  <tr className="bg-[#0A0A0F] font-mono text-xs text-[#9090A8]">
                    <td colSpan={6} className="px-3 py-2 text-right font-semibold text-[#F0F0F8]">
                      Subtotal · {group}
                    </td>
                    <td className="px-3 py-2 text-right">{fmtAud(sub.value)}</td>
                    <td
                      className={`px-3 py-2 text-right ${
                        sub.gain != null && sub.gain >= 0 ? 'text-[#22C55E]' : 'text-[#EF4444]'
                      }`}
                    >
                      {fmtAud(sub.gain)}
                    </td>
                    <td className="px-3 py-2 text-right">{fmtPct(sub.ret)}</td>
                    <td className="px-3 py-2" />
                  </tr>
                </Fragment>
              )
            })}
            {keys.length > 0 ? (
              <tr className="border-t border-[rgba(255,255,255,0.12)] bg-[#1A1A24] font-mono text-xs font-semibold text-[#F0F0F8]">
                <td colSpan={6} className="px-3 py-2 text-right">
                  Grand total
                </td>
                <td className="px-3 py-2 text-right">{fmtAud(grand.value)}</td>
                <td
                  className={
                    grand.gain != null && grand.gain >= 0 ? 'px-3 py-2 text-right text-[#22C55E]' : 'px-3 py-2 text-right text-[#EF4444]'
                  }
                >
                  {fmtAud(grand.gain)}
                </td>
                <td className="px-3 py-2 text-right">{fmtPct(grand.ret)}</td>
                <td className="px-3 py-2" />
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>

      <p className="text-[11px] leading-relaxed text-[#505068]">
        Manual allocation % overrides are available on each position&apos;s detail page — open via Analyse or View Analysis when a Supabase
        position is linked.
      </p>
    </section>
  )
}

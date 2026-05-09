import { useEffect, useMemo, useState } from 'react'
import {
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
  Line,
  LineChart,
  Legend,
} from 'recharts'
import { postChartHistory, postTickerSearch } from '../../lib/market/marketApi.js'
import { alignSeries } from '../../lib/dashboard/parseSharesightPerformance.js'

/** @typedef {{ isoDate: string, value: number }} PerfPoint */

const PERIODS = /** @type {const} */ (['1M', '3M', '6M', '1Y', '2Y', 'ALL'])

const DEFAULT_BENCH = 'VGS.AX'

/**
 * @param {'1M'|'3M'|'6M'|'1Y'|'2Y'|'ALL'} p
 */
function sliceStartIso(p) {
  const d = new Date()

  if (p === 'ALL') return '1990-01-01'

  const months = /** @type {Record<string, number>} */ ({
    '1M': 1,
    '3M': 3,
    '6M': 6,
    '1Y': 12,
    '2Y': 24,
  })

  d.setMonth(d.getMonth() - (months[p] ?? 12))

  return d.toISOString().slice(0, 10)
}

/**
 * @param {Record<string, number>} pointsByDay
 * @param {string[]} datesSorted
 */
function pctFromFirst(pointsByDay, datesSorted) {
  const firstDay = datesSorted[0]

  const base = firstDay != null ? pointsByDay[firstDay] : null

  if (base == null || !Number.isFinite(base) || base === 0) return /** @type {Record<string, number>} */ ({})

  /** @type {Record<string, number>} */
  const out = {}

  for (const d of datesSorted) {
    const v = pointsByDay[d]

    if (typeof v !== 'number' || !Number.isFinite(v)) continue

    out[d] = ((v - base) / Math.abs(base)) * 100
  }

  return out
}

/** @typedef {{ d: string, totalAud: number|null, coreAud: number|null, satelliteAud: number|null, benchAud: number|null, cashAud: number|null, unrealAud: number|null }} ChartDatum */

/**
 * @param {{
 * perfTotal: PerfPoint[]|null,
 * perfCore: PerfPoint[]|null,
 * perfSat: PerfPoint[]|null,
 * totalCashAud: number,
 * unrealisedAud: number,
 * }} props
 */
export function PortfolioTrendChart({ perfTotal, perfCore, perfSat, totalCashAud, unrealisedAud }) {
  const [period, setPeriod] = useState(/** @type {(typeof PERIODS)[number]} */ ('1Y'))

  const [scale, setScale] = useState(/** @type {'aud'|'pct'} */ ('aud'))

  const [benchSymbol, setBenchSymbol] = useState(DEFAULT_BENCH)

  const [benchDraft, setBenchDraft] = useState(DEFAULT_BENCH)

  const [searchQ, setSearchQ] = useState('')

  const [searchHits, setSearchHits] = useState(/** @type {{ symbol: string, name: string }[]} */ ([]))

  const [benchSeries, setBenchSeries] = useState(/** @type {{ isoDate: string, value: number }[]} */ ([]))

  const [visible, setVisible] = useState({
    total: true,
    core: true,
    satellite: true,
    cash: true,
    unrealised: false,
    benchmark: true,
  })

  const startIso = useMemo(() => sliceStartIso(period), [period])

  useEffect(() => {
    void postChartHistory(benchSymbol, period)
      .then((out) => {
        const pts = Reflect.get(out ?? {}, 'points')

        const arr = Array.isArray(pts) ? pts : []

        setBenchSeries(
          arr
            .map((/** @type {Record<string, unknown>} */ r) => ({
              isoDate: `${r.t}`,

              value: typeof r.close === 'number' ? r.close : Number.parseFloat(`${r.close}`),
            }))
            .filter((r) => r.isoDate >= startIso),
        )
      })
      .catch(() => setBenchSeries([]))
  }, [benchSymbol, period, startIso])

  useEffect(() => {
    const handle = window.setTimeout(() => {
      if (searchQ.trim().length < 2) {
        setSearchHits([])

        return
      }

      void postTickerSearch(searchQ.trim(), 8)
        .then((out) => {
          const hits = Array.isArray(Reflect.get(out ?? {}, 'results')) ? Reflect.get(out, 'results') : []

          setSearchHits(
            hits.map((/** @type {Record<string, unknown>} */ row) => ({
              symbol: `${row.symbol ?? ''}`,

              name: `${row.name ?? ''}`,
            })),
          )
        })

        .catch(() => setSearchHits([]))
    }, 250)

    return () => window.clearTimeout(handle)
  }, [searchQ])

  const mergedDates = useMemo(() => {
    /** @type {Set<string>} */
    const s = new Set()

    const pushArr = /** @param {PerfPoint[]|null|undefined} */ (arr) => {
      if (!arr) return

      for (const p of arr) {
        if (p.isoDate >= startIso) s.add(p.isoDate)
      }
    }

    pushArr(perfTotal)
    pushArr(perfCore)
    pushArr(perfSat)

    for (const pt of benchSeries) {
      if (pt.isoDate >= startIso) s.add(pt.isoDate)
    }

    return Array.from(s).sort((a, b) => (a < b ? -1 : 1))
  }, [perfTotal, perfCore, perfSat, benchSeries, startIso])

  /** @type {ChartDatum[]} */
  const chartRows = useMemo(() => {
    const dates =
      mergedDates.length > 0 ? mergedDates : [new Date().toISOString().slice(0, 10)].filter((x) => x >= startIso)

    const totalAligned = alignSeries(perfTotal, dates)

    const coreAligned = alignSeries(perfCore, dates)

    const satAligned = alignSeries(perfSat, dates)

    const benchAligned = alignSeries(benchSeries, dates)

    if (scale === 'aud') {
      return dates.map((d) => ({
        d,

        totalAud: typeof totalAligned[d] === 'number' ? totalAligned[d] : null,

        coreAud: typeof coreAligned[d] === 'number' ? coreAligned[d] : null,

        satelliteAud: typeof satAligned[d] === 'number' ? satAligned[d] : null,

        benchAud: typeof benchAligned[d] === 'number' ? benchAligned[d] : null,

        cashAud: totalCashAud,

        unrealAud: unrealisedAud,
      }))
    }

    const totalPct = pctFromFirst(totalAligned, dates)
    const corePct = pctFromFirst(coreAligned, dates)
    const satPct = pctFromFirst(satAligned, dates)
    const benchPct = pctFromFirst(benchAligned, dates)

    return dates.map((d) => ({
      d,

      totalAud: typeof totalPct[d] === 'number' ? totalPct[d] : null,

      coreAud: typeof corePct[d] === 'number' ? corePct[d] : null,

      satelliteAud: typeof satPct[d] === 'number' ? satPct[d] : null,

      benchAud: typeof benchPct[d] === 'number' ? benchPct[d] : null,

      cashAud: null,

      unrealAud: null,
    }))
  }, [mergedDates, perfTotal, perfCore, perfSat, benchSeries, scale, startIso, totalCashAud, unrealisedAud])

  const staleChart = mergedDates.length < 5

  /** @type {['total'|'core'|'satellite'|'cash'|'unrealised'|'benchmark', string][]} */
  const toggles = [
    ['total', 'Total'],
    ['core', 'Core'],
    ['satellite', 'Satellite'],
    ['cash', 'Cash'],
    ['unrealised', 'Unrealised'],
    ['benchmark', 'Benchmark'],
  ]

  return (
    <section className="rounded-xl border border-[rgba(255,255,255,0.06)] bg-[#111118] px-4 py-5">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-[14px] font-semibold tracking-tight text-[#F0F0F8]">Portfolio history</p>

          <p className="mt-2 max-w-[82ch] text-xs text-[#9090A8]">
            Total / Core / Satellite series are interpolated from synced Sharesight performance payloads. Cash &
            unrealised lines show current snapshots as flat references — switch to absolute dollars for fidelity. Benchmark
            from Yahoo closes.
          </p>
        </div>

        <div className="flex flex-wrap gap-2">
          {PERIODS.map((p) => (
            <button
              key={p}
              type="button"
              onClick={() => setPeriod(p)}
              className={`rounded-md px-2 py-1 font-mono text-[11px] ${
                period === p
                  ? 'border border-[rgba(77,184,255,0.55)] bg-[rgba(77,184,255,0.12)] text-[#79CBFF]'
                  : 'border border-transparent text-[#9090A8] hover:border-[rgba(255,255,255,0.08)]'
              }`}
            >
              {p}
            </button>
          ))}
        </div>
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-3">
        <div className="flex rounded-md border border-[rgba(255,255,255,0.12)] bg-[#0A0A0F] p-1">
          <button
            type="button"
            className={`rounded px-2 py-1 font-mono text-[11px] ${scale === 'aud' ? 'bg-[#1A1A24] text-[#F0F0F8]' : 'text-[#9090A8]'}`}
            onClick={() => setScale('aud')}
          >
            A$
          </button>

          <button
            type="button"
            className={`rounded px-2 py-1 font-mono text-[11px] ${scale === 'pct' ? 'bg-[#1A1A24] text-[#F0F0F8]' : 'text-[#9090A8]'}`}
            onClick={() => setScale('pct')}
          >
            % return
          </button>
        </div>

        <div className="relative flex flex-col gap-1">
          <label className="text-[10px] font-medium uppercase tracking-wide text-[#505068]">Benchmark</label>

          <div className="flex flex-wrap items-center gap-2">
            <input
              className="w-36 rounded-md border border-[rgba(255,255,255,0.12)] bg-[#1A1A24] px-2 py-1 font-mono text-xs text-[#F0F0F8]"
              value={benchDraft}
              onChange={(e) => setBenchDraft(e.target.value.toUpperCase())}
              onBlur={() => setBenchSymbol(benchDraft.trim() || DEFAULT_BENCH)}
            />

            <input
              className="w-44 rounded-md border border-[rgba(255,255,255,0.12)] bg-[#1A1A24] px-2 py-1 font-mono text-[10px] text-[#9090A8]"
              placeholder="Search symbol…"
              value={searchQ}
              onChange={(e) => setSearchQ(e.target.value)}
            />
          </div>

          {searchHits.length > 0 ? (
            <ul className="absolute left-0 top-full z-20 mt-1 max-h-48 w-72 overflow-auto rounded-md border border-[rgba(255,255,255,0.12)] bg-[#111118] py-1 text-xs shadow-lg">
              {searchHits.map((h) => (
                <li key={`${h.symbol}-${h.name}`}>
                  <button
                    type="button"
                    className="block w-full px-3 py-2 text-left font-mono text-[11px] text-[#F0F0F8] hover:bg-[#1A1A24]"
                    onClick={() => {
                      setBenchSymbol(h.symbol)

                      setBenchDraft(h.symbol)

                      setSearchQ('')

                      setSearchHits([])
                    }}
                  >
                    {h.symbol}
                    <span className="ml-2 text-[10px] text-[#505068]">{h.name}</span>
                  </button>
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      </div>

      <div className="mt-4 flex flex-wrap gap-3 font-mono text-[10px] text-[#9090A8]">
        {toggles.map(([k, label]) => (
          <label key={k} className="flex cursor-pointer items-center gap-1">
            <input
              type="checkbox"
              checked={Reflect.get(visible, k)}
              onChange={() => setVisible((v) => ({ ...v, [k]: !Reflect.get(v, k) }))}

              disabled={scale === 'pct' && (k === 'cash' || k === 'unrealised')}
            />

            <span>{label}</span>

            {scale === 'pct' && (k === 'cash' || k === 'unrealised') ? <span className="text-[#505068]">(A$ only)</span> : null}
          </label>
        ))}
      </div>

      {staleChart ? (
        <p className="mt-3 rounded-md border border-[rgba(245,158,11,0.35)] bg-[rgba(245,158,11,0.08)] px-3 py-2 text-xs text-[#FCD34D]">
          Few datapoints — ensure Sharesight performance sync succeeds.
        </p>
      ) : null}

      <div className="mt-4 h-[340px] w-full">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={chartRows}>
            <CartesianGrid stroke="rgba(255,255,255,0.06)" />

            <XAxis dataKey="d" stroke="#505068" tick={{ fill: '#505068', fontSize: 10 }} minTickGap={24} />

            <YAxis
              stroke="#505068"
              tick={{ fill: '#505068', fontSize: 10 }}
              domain={['auto', 'auto']}
              tickFormatter={(v) => (scale === 'aud' ? `${(v / 1000).toFixed(1)}k` : `${v}`)}
            />

            <Tooltip contentStyle={{ background: '#111118', border: '1px solid rgba(255,255,255,0.12)' }} />

            <Legend wrapperStyle={{ fontSize: '11px' }} />

            {visible.total ? <Line type="monotone" dot={false} dataKey="totalAud" stroke="#4DB8FF" name="Total" /> : null}

            {visible.core ? <Line type="monotone" dot={false} dataKey="coreAud" stroke="#79CBFF" name="Core" /> : null}

            {visible.satellite ? <Line type="monotone" dot={false} dataKey="satelliteAud" stroke="#22C55E" name="Satellite" /> : null}

            {visible.cash && scale === 'aud' ? (
              <Line type="monotone" dot={false} dataKey="cashAud" stroke="#F59E0B" name="Cash (ref)" />
            ) : null}

            {visible.unrealised && scale === 'aud' ? (
              <Line type="monotone" dot={false} dataKey="unrealAud" stroke="#C084FC" name="Unrealised (ref)" />
            ) : null}

            {visible.benchmark ? <Line type="monotone" dot={false} dataKey="benchAud" stroke="#9090A8" name={benchSymbol} /> : null}
          </LineChart>
        </ResponsiveContainer>
      </div>
    </section>
  )
}

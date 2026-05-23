import { Link } from 'react-router-dom'

import { useCallback, useEffect, useMemo, useState } from 'react'

import { useSharesightIntegration } from '../context/SharesightIntegrationContext.jsx'

import { useInvTheme } from '../context/InvThemeContext.jsx'

import { WatchlistAddTicker } from '../components/watchlist/WatchlistAddTicker.jsx'

import { DataStaleBanner } from '../components/ui/DataStaleBanner.jsx'

import { Skeleton } from '../components/ui/Skeleton.jsx'

import { postMarketBatch } from '../lib/market/marketApi.js'

import { postWatchlistFlash } from '../lib/analysis/watchlistFlashClient.js'

import { runWatchlistFullReanalysis } from '../lib/watchlist/quickReanalyze.js'

import { universalTierFromScore } from '../lib/satellite/tierFromScore.js'

import { numOrNull } from '../lib/satellite/satelliteMerge.js'

/** @returns {unknown} */

function rz(p, k) {
  return p && typeof p === 'object' ? Reflect.get(p, k) : undefined
}

/** @param {unknown} v */

function nz(v) {
  const n =
    typeof v === 'number' && Number.isFinite(v)
      ? v
      : v != null && Number.isFinite(Number(v))
        ? Number(v)
        : Number.parseFloat(`${v ?? ''}`)

  return Number.isFinite(n) ? n : null
}

/** @param {Record<string, unknown>|null} m */

/** @param {Record<string, unknown>|null} q */

function mergeQuoteProfile(m, q) {
  const profile = m && typeof m.profile === 'object' ? /** @type {Record<string, unknown>} */ (m.profile) : null

  const fromM = m && typeof m.quote === 'object' ? /** @type {Record<string, unknown>} */ (m.quote) : null

  const quote = fromM ?? (q && typeof q === 'object' ? q : null)

  const km = m && typeof m.key_metrics === 'object' ? /** @type {Record<string, unknown>} */ (m.key_metrics) : null

  return { profile, quote, key_metrics: km }
}

/** @param {unknown[]} scores */

/** @returns {Record<string, Record<string, unknown>>} */

function latestScoresByWatchlist(scores) {
  /** @type {Record<string, Record<string, unknown>>} */

  const by = {}

  for (const r of scores) {
    const row = /** @type {Record<string, unknown>} */ (r)

    const wid = row.watchlist_item_id

    if (typeof wid !== 'string') continue

    const vn = nz(row.version_number)

    const prev = by[wid]

    const prevN = prev ? nz(prev.version_number) : Number.NaN

    if (!prev || (vn != null && prevN != null && vn > prevN)) by[wid] = row
  }

  return by
}

const ASSET_CLASS_OPTIONS = [
  { value: '', label: '—' },
  { value: 'regular_stock', label: 'Regular stock' },
  { value: 'thematic_etf', label: 'Thematic ETF' },
  { value: 'fund_manager_lic', label: 'Fund / LIC' },
  { value: 'speculative', label: 'Speculative' },
  { value: 'alternative_pe', label: 'Alt / PE' },
  { value: 'unknown', label: 'Unknown' },
]

/**
 * @param {Record<string, unknown>} row
 * @param {Record<string, unknown>|null} sc
 */
function rowSynopsis(row, sc) {
  const ex = row.extra && typeof row.extra === 'object' ? /** @type {Record<string, unknown>} */ (row.extra) : null

  const syn = ex && typeof ex.synopsis === 'string' ? ex.synopsis.trim() : ''

  if (syn) return syn

  const pay = sc && typeof sc.payload === 'object' ? /** @type {Record<string, unknown>} */ (sc.payload) : null

  const one = pay && typeof pay.synopsis_one_liner === 'string' ? pay.synopsis_one_liner.trim() : ''

  if (one) return one

  const d = row.fmp_company_description

  return typeof d === 'string' ? d.trim().slice(0, 180) : '—'
}

/** @param {Record<string, unknown>|null} q */
function fmtPct(q, key) {
  if (!q) return null

  const n = nz(Reflect.get(q, key))

  return n
}

export function WatchlistPage() {
  const { supabase, userPresent } = useSharesightIntegration()

  const theme = useInvTheme()

  const [rows, setRows] = useState(/** @type {Record<string, unknown>[]} */ ([]))

  const [scores, setScores] = useState(/** @type {Record<string, unknown>[]} */ ([]))

  const [qxByYahoo, setQxByYahoo] = useState(/** @type {Record<string, Record<string, unknown>>} */ ({}))

  const [loadError, setLoadError] = useState(/** @type {string|null} */ (null))

  const [reloadTok, setReloadTok] = useState(0)

  const [watchlistHydrated, setWatchlistHydrated] = useState(false)

  const [flashBusy, setFlashBusy] = useState(/** @type {string|null} */ (null))

  const [reRunBusy, setReRunBusy] = useState(/** @type {string|null} */ (null))

  const [sort, setSort] = useState(/** @type {{ key: string, dir: 'asc'|'desc' }} */ ({ key: 'ticker', dir: 'asc' }))

  const [fAsset, setFAsset] = useState('')
  const [fTier, setFTier] = useState('')
  const [fExchange, setFExchange] = useState('')
  const [fScoreMin, setFScoreMin] = useState('')
  const [fScoreMax, setFScoreMax] = useState('')
  const [fAnalysed, setFAnalysed] = useState(/** @type {''|'yes'|'no'} */ (''))

  const reload = useCallback(() => {
    setReloadTok((n) => n + 1)
  }, [])

  useEffect(() => {
    if (!supabase || !userPresent) {
      queueMicrotask(() => {
        setRows([])
        setScores([])
        setLoadError(null)
        setWatchlistHydrated(false)
      })

      return undefined
    }

    let cancelled = false

    void (async () => {
      setLoadError(null)

      try {
        const { data: ud } = await supabase.auth.getUser()

        const uid = ud.user?.id

        if (!uid) return

        const { data: wl, error: wErr } = await supabase
          .from('watchlist_items')
          .select('*')
          .eq('user_id', uid)
          .eq('archived', false)
          .order('display_ticker', { ascending: true })

        if (wErr) throw wErr

        const list = /** @type {Record<string, unknown>[]} */ (wl ?? [])

        const ids = list.map((r) => `${r.id}`).filter(Boolean)

        const scRes =
          ids.length > 0
            ? await supabase
                .from('scorecard_versions')
                .select('id, watchlist_item_id, version_number, overall_score, framework, payload, generated_at')
                .eq('user_id', uid)
                .in('watchlist_item_id', ids)
            : { data: [], error: null }

        if (scRes.error) throw scRes.error

        if (cancelled) return

        setRows(list)

        setScores(/** @type {Record<string, unknown>[]} */ (scRes.data ?? []))
      } catch (e) {
        if (!cancelled) setLoadError(e instanceof Error ? e.message : String(e))
      } finally {
        if (!cancelled) setWatchlistHydrated(true)
      }
    })()

    return () => {
      cancelled = true
    }
  }, [supabase, userPresent, reloadTok])

  const latestByWl = useMemo(() => latestScoresByWatchlist(scores), [scores])

  const yahooList = useMemo(() => {
    const s = new Set()

    for (const r of rows) {
      const y = `${r.yahoo_symbol ?? ''}`.trim().toUpperCase()

      if (y) s.add(y)
    }

    return [...s]
  }, [rows])

  useEffect(() => {
    if (yahooList.length === 0) {
      queueMicrotask(() => setQxByYahoo({}))

      return undefined
    }

    let cancelled = false

    void (async () => {
      try {
        const items = rows.map((r) => ({
          yahooSymbol: `${r.yahoo_symbol ?? ''}`.trim().toUpperCase(),
          fmpSymbol: `${r.fmp_symbol ?? ''}`.trim(),
          exchangeShort: `${r.exchange_short_name ?? ''}`.trim(),
        }))

        const qResp = /** @type {Record<string, unknown>} */ (await postMarketBatch({ op: 'quotes', items }))

        if (cancelled) return

        const quotes = /** @type {Record<string, unknown>[]} */ (Reflect.get(qResp, 'quotes') ?? [])

        /** @type {Record<string, Record<string, unknown>>} */

        const map = {}

        for (const q of quotes) {
          const sym = `${Reflect.get(q, 'symbol') ?? ''}`.trim().toUpperCase()

          if (sym) map[sym] = /** @type {Record<string, unknown>} */ (q)
        }

        setQxByYahoo(map)
      } catch {
        if (!cancelled) setQxByYahoo({})
      }
    })()

    return () => {
      cancelled = true
    }
  }, [rows, yahooList.join('|')])

  const exchanges = useMemo(() => {
    const s = new Set()

    for (const r of rows) {
      const x = `${r.exchange_short_name ?? ''}`.trim()

      if (x) s.add(x)
    }

    return [...s].sort()
  }, [rows])

  const enriched = useMemo(() => {
    return rows.map((row) => {
      const id = `${row.id}`

      const sc = latestByWl[id] ?? null

      const yh = `${row.yahoo_symbol ?? ''}`.trim().toUpperCase()

      const qx = yh ? qxByYahoo[yh] ?? null : null

      const m = row.fmp_metrics && typeof row.fmp_metrics === 'object' ? /** @type {Record<string, unknown>} */ (row.fmp_metrics) : null

      const { profile, quote: qmQuote, key_metrics: km } = mergeQuoteProfile(m, qx)

      const quote = qmQuote ?? qx

      const overall = sc ? numOrNull(sc.overall_score) : null

      const tier = universalTierFromScore(overall)

      const profileSafe = profile && typeof profile === 'object' ? /** @type {Record<string, unknown>} */ (profile) : null

      const displayTier = overall == null ? null : tier === 'Haircut' ? 'Marginal' : tier

      const peTtm = nz(quote ? Reflect.get(quote, 'pe') : null) ?? nz(profileSafe ? Reflect.get(profileSafe, 'pe') : null)

      const peForward = nz(km ? Reflect.get(km, 'peRatio') : null)

      const mcap = nz(quote ? Reflect.get(quote, 'marketCap') : null) ?? nz(profileSafe ? Reflect.get(profileSafe, 'mktCap') : null)

      const revGrowth = nz(km ? Reflect.get(km, 'revenueGrowth') : null) ?? nz(km ? Reflect.get(km, 'revenuePerShareGrowth') : null)

      const yh52 = nz(quote ? Reflect.get(quote, 'yearHigh') : null)

      const yl52 = nz(quote ? Reflect.get(quote, 'yearLow') : null)

      const lastPx = nz(quote ? Reflect.get(quote, 'last') : null) ?? nz(quote ? Reflect.get(quote, 'price') : null)

      let distLow = null

      if (lastPx != null && yl52 != null && yl52 !== 0) distLow = ((lastPx - yl52) / yl52) * 100

      return {
        row,
        id,
        sc,
        overall,
        tier,
        displayTier,
        synopsis: rowSynopsis(row, sc),
        quote,
        profile: profileSafe,
        keyMetrics: km,
        peTtm,
        peForward,
        mcap,
        revGrowth,
        yh52,
        yl52,
        distLow,
        chg: fmtPct(quote, 'change_percent'),
        last: lastPx,
      }
    })
  }, [rows, latestByWl, qxByYahoo])

  const filtered = useMemo(() => {
    return enriched.filter((e) => {
      const ac = `${e.row.asset_class ?? ''}`.trim()

      if (fAsset && ac !== fAsset) return false

      if (fExchange && `${e.row.exchange_short_name ?? ''}`.trim() !== fExchange) return false

      if (fTier) {
        const label = e.displayTier ?? '—'

        if (label !== fTier) return false
      }

      if (fAnalysed === 'yes' && !e.sc) return false

      if (fAnalysed === 'no' && e.sc) return false

      const min = fScoreMin.trim() ? Number.parseFloat(fScoreMin) : null

      const max = fScoreMax.trim() ? Number.parseFloat(fScoreMax) : null

      if (min != null && Number.isFinite(min) && (e.overall == null || e.overall < min)) return false

      if (max != null && Number.isFinite(max) && (e.overall == null || e.overall > max)) return false

      return true
    })
  }, [enriched, fAsset, fExchange, fTier, fAnalysed, fScoreMin, fScoreMax])

  const sorted = useMemo(() => {
    const out = [...filtered]

    const dir = sort.dir === 'asc' ? 1 : -1

    const key = sort.key

    out.sort((a, b) => {
      /** @param {typeof a} x */
      const ticker = (x) => `${x.row.display_ticker ?? x.row.fmp_symbol ?? ''}`.trim().toUpperCase()

      if (key === 'ticker') return ticker(a).localeCompare(ticker(b)) * dir

      if (key === 'company') return `${a.row.name ?? ''}`.localeCompare(`${b.row.name ?? ''}`) * dir

      if (key === 'exchange') return `${a.row.exchange_short_name ?? ''}`.localeCompare(`${b.row.exchange_short_name ?? ''}`) * dir

      if (key === 'score') return ((a.overall ?? -1) - (b.overall ?? -1)) * dir

      if (key === 'tier') return `${a.displayTier ?? 'zzz'}`.localeCompare(`${b.displayTier ?? 'zzz'}`) * dir

      if (key === 'last') return ((a.last ?? -1) - (b.last ?? -1)) * dir

      if (key === 'chg') return ((a.chg ?? -999) - (b.chg ?? -999)) * dir

      if (key === 'mcap') return ((a.mcap ?? -1) - (b.mcap ?? -1)) * dir

      if (key === 'peTtm') return ((a.peTtm ?? -1) - (b.peTtm ?? -1)) * dir

      if (key === 'peFwd') return ((a.peForward ?? -1) - (b.peForward ?? -1)) * dir

      if (key === 'revG') return ((a.revGrowth ?? -999) - (b.revGrowth ?? -999)) * dir

      if (key === '52h') return ((a.yh52 ?? -1) - (b.yh52 ?? -1)) * dir

      if (key === '52l') return ((a.yl52 ?? -1) - (b.yl52 ?? -1)) * dir

      if (key === 'distL') return ((a.distLow ?? -999) - (b.distLow ?? -999)) * dir

      if (key === 'fw') return `${a.sc?.framework ?? ''}`.localeCompare(`${b.sc?.framework ?? ''}`) * dir

      if (key === 'gen') {
        const ta = a.sc?.generated_at ? new Date(`${a.sc.generated_at}`).getTime() : 0

        const tb = b.sc?.generated_at ? new Date(`${b.sc.generated_at}`).getTime() : 0

        return (ta - tb) * dir
      }

      return 0
    })

    return out
  }, [filtered, sort])

  const stats = useMemo(() => {
    let total = filtered.length

    let qualify = 0

    let high = 0

    let marginal = 0

    let unanalysed = 0

    for (const e of filtered) {
      if (!e.sc || e.overall == null) {
        unanalysed += 1

        continue
      }

      if (e.overall >= 78) high += 1
      else if (e.overall >= 65) qualify += 1
      else marginal += 1
    }

    return { total, qualify, high, marginal, unanalysed }
  }, [filtered])

  function toggleSort(key) {
    setSort((prev) => {
      if (prev.key === key) return { key, dir: prev.dir === 'asc' ? 'desc' : 'asc' }

      return { key, dir: 'asc' }
    })
  }

  /** @param {string} label */
  function th(label, key) {
    const active = sort.key === key

    return (
      <th className="whitespace-nowrap px-2 py-2 text-left font-mono text-[10px] uppercase tracking-wide text-[#505068]">
        <button type="button" className={active ? 'text-[#79CBFF]' : ''} onClick={() => toggleSort(key)}>
          {label}
          {active ? (sort.dir === 'asc' ? ' ↑' : ' ↓') : ''}
        </button>
      </th>
    )
  }

  async function sessionAccess() {
    if (!supabase) return null

    const { data, error } = await supabase.auth.getSession()

    if (error || !data.session?.access_token) return null

    return { accessToken: data.session.access_token }
  }

  /**
   * @param {string} wid
   * @param {string} prev
   * @param {string} next
   */
  async function onAssetClassChange(wid, prev, next) {
    if (next === prev) return

    if (!window.confirm('Update asset class and re-run Claude analysis now? This takes about 60–120 seconds.')) return

    if (!supabase) return

    setReRunBusy(wid)

    try {
      const { error } = await supabase.from('watchlist_items').update({ asset_class: next || null, awaiting_analysis: true }).eq('id', wid)

      if (error) throw error

      const sess = await sessionAccess()

      if (!sess) throw new Error('Not signed in')

      await runWatchlistFullReanalysis(sess, wid)

      reload()
    } catch (e) {
      window.alert(e instanceof Error ? e.message : String(e))
    } finally {
      setReRunBusy(null)
    }
  }

  /**
   * @param {string} wid
   * @param {boolean} next
   */
  async function onAutoMonitor(wid, next) {
    if (!supabase) return

    const { error } = await supabase.from('watchlist_items').update({ auto_monitor: next }).eq('id', wid)

    if (error) window.alert(error.message)
    else reload()
  }

  /**
   * @param {string} wid
   */
  async function onFlash(wid) {
    setFlashBusy(wid)

    try {
      const sess = await sessionAccess()

      if (!sess) throw new Error('Not signed in')

      await postWatchlistFlash({ watchlistItemId: wid }, sess)

      reload()
    } catch (e) {
      window.alert(e instanceof Error ? e.message : String(e))
    } finally {
      setFlashBusy(null)
    }
  }

  return (
    <div className={`mx-auto w-full max-w-[1600px] space-y-6 px-4 py-8 pb-28 lg:px-8 lg:pb-12 ${theme.fg}`}>
      <div className="flex flex-col gap-2">
        <h1 className="text-[22px] font-semibold">Watchlist</h1>

        <p className={`max-w-[78ch] text-sm ${theme.muted}`}>
          Search FMP to lock symbol and exchange, then add candidates. When you buy and the holding appears in Sharesight, rows promote
          automatically after sync.
        </p>
      </div>

      <WatchlistAddTicker onCreated={reload} />

      <div className="flex flex-wrap gap-3 rounded-xl border border-[rgba(255,255,255,0.06)] bg-[#111118] px-4 py-3 font-mono text-[11px] text-[#C8C8D8]">
        <span>
          <span className="text-[#505068]">Total </span>
          {stats.total}
        </span>

        <span>
          <span className="text-[#505068]">Qualify (≥65%) </span>
          {stats.qualify}
        </span>

        <span>
          <span className="text-[#505068]">High conviction (≥78%) </span>
          {stats.high}
        </span>

        <span>
          <span className="text-[#505068]">Marginal </span>
          {stats.marginal}
        </span>

        <span>
          <span className="text-[#505068]">Unanalysed </span>
          {stats.unanalysed}
        </span>
      </div>

      <div className="flex flex-wrap gap-3 rounded-xl border border-[rgba(255,255,255,0.06)] bg-[#111118] px-4 py-3">
        <label className="flex flex-col gap-1 font-mono text-[10px] text-[#505068]">
          Asset class
          <select
            className="rounded border border-[rgba(255,255,255,0.12)] bg-[#1A1A24] px-2 py-1 text-[11px] text-[#F0F0F8]"
            value={fAsset}
            onChange={(e) => setFAsset(e.target.value)}
          >
            <option value="">All</option>
            {ASSET_CLASS_OPTIONS.filter((o) => o.value).map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </label>

        <label className="flex flex-col gap-1 font-mono text-[10px] text-[#505068]">
          Tier
          <select
            className="rounded border border-[rgba(255,255,255,0.12)] bg-[#1A1A24] px-2 py-1 text-[11px] text-[#F0F0F8]"
            value={fTier}
            onChange={(e) => setFTier(e.target.value)}
          >
            <option value="">All</option>
            <option value="High conviction">High conviction</option>
            <option value="Qualified">Qualified</option>
            <option value="Marginal">Marginal</option>
          </select>
        </label>

        <label className="flex flex-col gap-1 font-mono text-[10px] text-[#505068]">
          Exchange
          <select
            className="rounded border border-[rgba(255,255,255,0.12)] bg-[#1A1A24] px-2 py-1 text-[11px] text-[#F0F0F8]"
            value={fExchange}
            onChange={(e) => setFExchange(e.target.value)}
          >
            <option value="">All</option>
            {exchanges.map((ex) => (
              <option key={ex} value={ex}>
                {ex}
              </option>
            ))}
          </select>
        </label>

        <label className="flex flex-col gap-1 font-mono text-[10px] text-[#505068]">
          Score min
          <input
            className="w-24 rounded border border-[rgba(255,255,255,0.12)] bg-[#1A1A24] px-2 py-1 text-[11px]"
            value={fScoreMin}
            onChange={(e) => setFScoreMin(e.target.value)}
          />
        </label>

        <label className="flex flex-col gap-1 font-mono text-[10px] text-[#505068]">
          Score max
          <input
            className="w-24 rounded border border-[rgba(255,255,255,0.12)] bg-[#1A1A24] px-2 py-1 text-[11px]"
            value={fScoreMax}
            onChange={(e) => setFScoreMax(e.target.value)}
          />
        </label>

        <label className="flex flex-col gap-1 font-mono text-[10px] text-[#505068]">
          Analysis
          <select
            className="rounded border border-[rgba(255,255,255,0.12)] bg-[#1A1A24] px-2 py-1 text-[11px] text-[#F0F0F8]"
            value={fAnalysed}
            onChange={(e) => setFAnalysed(/** @type {''|'yes'|'no'} */ (e.target.value))}
          >
            <option value="">Any</option>
            <option value="yes">Analysed</option>
            <option value="no">Unanalysed</option>
          </select>
        </label>
      </div>

      {loadError ? (
        <DataStaleBanner
          message={loadError}
          context={
            sorted.length > 0
              ? 'Table shows the last synced watchlist + score payloads.'
              : 'Watchlist refresh failed — try reloading or check Supabase connectivity.'
          }
        />
      ) : null}

      <div className="overflow-x-auto rounded-xl border border-[rgba(255,255,255,0.06)] bg-[#111118]">
        <table className="min-w-[1200px] w-full border-collapse text-left text-[11px]">
          <thead className="border-b border-[rgba(255,255,255,0.06)] bg-[#0d0d14]">
            <tr>
              {th('Ticker', 'ticker')}
              {th('Company', 'company')}
              {th('Exch.', 'exchange')}
              <th className="whitespace-nowrap px-2 py-2 font-mono text-[10px] uppercase tracking-wide text-[#505068]">Asset class</th>
              {th('Framework', 'fw')}
              {th('Score', 'score')}
              {th('Tier', 'tier')}
              {th('Last', 'last')}
              {th('Δ%', 'chg')}
              {th('Mkt cap', 'mcap')}
              {th('P/E', 'peTtm')}
              {th('P/E f', 'peFwd')}
              {th('Rev g', 'revG')}
              {th('52w H', '52h')}
              {th('52w L', '52l')}
              {th('% above L', 'distL')}
              {th('Last scored', 'gen')}
              <th className="px-2 py-2 font-mono text-[10px] uppercase tracking-wide text-[#505068]">Auto</th>
              <th className="min-w-[200px] px-2 py-2 font-mono text-[10px] uppercase tracking-wide text-[#505068]">Synopsis</th>
              <th className="px-2 py-2 font-mono text-[10px] uppercase tracking-wide text-[#505068]">News</th>
            </tr>
          </thead>

          <tbody className="divide-y divide-[rgba(255,255,255,0.03)] font-mono text-[11px] tabular-nums">
            {!watchlistHydrated ? (
              Array.from({ length: 7 }, (_, i) => (
                <tr key={`sk-${i}`}>
                  <td className="px-3 py-3" colSpan={20}>
                    <Skeleton className="h-8 w-full" />
                  </td>
                </tr>
              ))
            ) : sorted.length === 0 ? (
              <tr>
                <td className="px-3 py-6 text-[#505068]" colSpan={20}>
                  Empty watchlist — add a ticker above.
                </td>
              </tr>
            ) : (
              sorted.map((e) => {
                const w = e.row

                const ac = `${w.asset_class ?? ''}`

                return (
                  <tr key={e.id} className="hover:bg-[rgba(255,255,255,0.03)]">
                    <td className="px-2 py-2">
                      <Link className="text-[#79CBFF] hover:underline" to={`/watchlist/${e.id}`}>
                        {`${w.display_ticker ?? w.fmp_symbol ?? '—'}`}
                      </Link>
                    </td>

                    <td className="max-w-[220px] truncate px-2 py-2 text-[#C8C8D8]">{`${w.name ?? ''}`}</td>

                    <td className="px-2 py-2 text-[#9090A8]">{`${w.exchange_short_name ?? ''}`}</td>

                    <td className="px-2 py-2">
                      <select
                        className="max-w-[160px] rounded border border-[rgba(255,255,255,0.12)] bg-[#1A1A24] px-2 py-1 text-[10px]"
                        disabled={reRunBusy === e.id}
                        value={ac}
                        onChange={(ev) => void onAssetClassChange(e.id, ac, ev.target.value)}
                      >
                        {ASSET_CLASS_OPTIONS.map((o) => (
                          <option key={`${e.id}-${o.value}`} value={o.value}>
                            {o.label}
                          </option>
                        ))}
                      </select>
                    </td>

                    <td className="max-w-[120px] truncate px-2 py-2 text-[#9090A8]" title={`${e.sc?.framework ?? ''}`}>
                      {e.sc ? `${e.sc.framework ?? ''}` : '—'}
                    </td>

                    <td className="px-2 py-2 text-[#4DB8FF]">{e.overall != null ? `${e.overall.toFixed(1)}%` : '—'}</td>

                    <td className="px-2 py-2">{e.displayTier ?? '—'}</td>

                    <td className="px-2 py-2">{e.last != null ? e.last.toFixed(3) : '—'}</td>

                    <td className={`px-2 py-2 ${e.chg != null && e.chg >= 0 ? 'text-[#22C55E]' : 'text-[#EF4444]'}`}>
                      {e.chg != null ? `${e.chg >= 0 ? '+' : ''}${e.chg.toFixed(2)}%` : '—'}
                    </td>

                    <td className="px-2 py-2">
                      {e.mcap != null ? (Math.abs(e.mcap) >= 1e12 ? `${(e.mcap / 1e12).toFixed(2)}T` : `${(e.mcap / 1e9).toFixed(2)}B`) : '—'}
                    </td>

                    <td className="px-2 py-2">{e.peTtm != null ? e.peTtm.toFixed(1) : '—'}</td>

                    <td className="px-2 py-2">{e.peForward != null ? e.peForward.toFixed(1) : '—'}</td>

                    <td className="px-2 py-2">
                      {e.revGrowth != null
                        ? `${(Math.abs(e.revGrowth) <= 1 ? e.revGrowth * 100 : e.revGrowth).toFixed(1)}%`
                        : '—'}
                    </td>

                    <td className="px-2 py-2">{e.yh52 != null ? e.yh52.toFixed(2) : '—'}</td>

                    <td className="px-2 py-2">{e.yl52 != null ? e.yl52.toFixed(2) : '—'}</td>

                    <td className="px-2 py-2">{e.distLow != null ? `${e.distLow.toFixed(1)}%` : '—'}</td>

                    <td className="whitespace-nowrap px-2 py-2 text-[#505068]">
                      {e.sc?.generated_at ? `${`${e.sc.generated_at}`.slice(0, 10)}` : '—'}
                    </td>

                    <td className="px-2 py-2">
                      <input
                        type="checkbox"
                        checked={w.auto_monitor === true}
                        onChange={(ev) => void onAutoMonitor(e.id, ev.target.checked)}
                      />
                    </td>

                    <td className="max-w-[280px] px-2 py-2 whitespace-normal text-[10px] leading-snug text-[#B8B8C8]">{e.synopsis}</td>

                    <td className="px-2 py-2">
                      <button
                        type="button"
                        disabled={flashBusy === e.id}
                        className="rounded border border-[rgba(121,203,255,0.35)] px-2 py-1 font-mono text-[10px] text-[#79CBFF] disabled:opacity-40"
                        onClick={() => void onFlash(e.id)}
                      >
                        Gemini Flash
                      </button>
                    </td>
                  </tr>
                )
              })
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}

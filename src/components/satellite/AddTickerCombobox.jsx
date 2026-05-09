import { useEffect, useState } from 'react'

import { postTickerSearch, postEquityFacts } from '../../lib/market/marketApi.js'

import { deriveYahooSymbolFromFmp } from '../../lib/market/tickerMap.js'

import { useSharesightIntegration } from '../../context/SharesightIntegrationContext.jsx'

/** @param {{
 *   onCreated?: () => void,
 *   prefilledSymbol?: string,
 *   sharesightHoldingExternalId?: string|null,
 *   target?: 'satellite' | 'watchlist',
 * }} props */

export function AddTickerCombobox({
  onCreated,
  prefilledSymbol = '',
  sharesightHoldingExternalId = null,
  target = 'satellite',
}) {
  const { supabase, userPresent } = useSharesightIntegration()

  const [q, setQ] = useState(prefilledSymbol)

  const [debounced, setDebounced] = useState(prefilledSymbol)

  const [hits, setHits] = useState([])

  const [busy, setBusy] = useState(false)

  const [creating, setCreating] = useState(false)

  const [surface, setSurface] = useState(null)

  const [open, setOpen] = useState(false)

  useEffect(() => {
    const id = window.setTimeout(() => setDebounced(q), 320)
    return () => window.clearTimeout(id)
  }, [q])

  useEffect(() => {
    if (!debounced.trim()) {
      queueMicrotask(() => setHits([]))

      return undefined
    }

    let cancelled = false

    void (async () => {
      setBusy(true)

      setSurface(null)

      try {
        const res = await postTickerSearch(debounced.trim(), 15)

        if (cancelled) return

        if (res.ok === false) {
          setHits([])

          setSurface(`${res.error ?? 'search_failed'}`)

          return
        }

        setHits(Array.isArray(res.results) ? res.results : [])
      } catch (e) {
        if (!cancelled) setSurface(e instanceof Error ? e.message : String(e))
      } finally {
        if (!cancelled) setBusy(false)
      }
    })()

    return () => {
      cancelled = true
    }
  }, [debounced])

  /**
   * @param {{
   *   symbol: string
   *   name: string
   *   exchangeShortName: string
   *   currency: string | null
   * }} hit
   */
  async function createInstrument(hit) {
    if (!supabase || !userPresent) return

    const exRaw = `${hit.exchangeShortName ?? ''}`.trim()

    if (!exRaw || /^unknown$/i.test(exRaw)) {
      setSurface('Pick a row with a valid exchange (CLAUDE section 8).')

      return
    }

    setCreating(true)

    setSurface(null)

    try {
      const { data: ud } = await supabase.auth.getUser()

      const uid = ud.user?.id

      if (!uid) throw new Error('Not signed in')

      const yahoo = deriveYahooSymbolFromFmp({ fmpSymbol: hit.symbol, exchangeShortName: hit.exchangeShortName })

      const cur = `${hit.currency ?? 'USD'}`.trim().toUpperCase()

      if (target === 'satellite') {
        const row = {
          user_id: uid,
          kind: 'satellite',
          fmp_symbol: hit.symbol,
          exchange_short_name: hit.exchangeShortName,
          yahoo_symbol: yahoo,
          currency: cur || 'USD',
          name: hit.name,
          display_ticker: hit.symbol,
          awaiting_analysis: true,
          archived: false,
          closed: false,
          buy_zones: [],
          exit_triggers: [],
          sharesight_holding_key: sharesightHoldingExternalId,
          extra: { source: 'fmp_ticker_search' },
        }

        const { error } = await supabase.from('positions').insert(row)

        if (error) throw error
      } else {
        const row = {
          user_id: uid,
          fmp_symbol: hit.symbol,
          exchange_short_name: hit.exchangeShortName,
          yahoo_symbol: yahoo,
          currency: cur || null,
          name: hit.name,
          display_ticker: hit.symbol,
          awaiting_analysis: true,
          archived: false,
          buy_zones: [],
          exit_triggers: [],
          auto_monitor: false,
          extra: { source: 'fmp_ticker_search' },
        }

        const { data: wl, error } = await supabase.from('watchlist_items').insert(row).select('id').single()

        if (error) throw error

        const wid = wl?.id

        if (typeof wid === 'string') {
          try {
            const facts = /** @type {Record<string, unknown>} */ (await postEquityFacts(hit.symbol))

            if (facts && facts.ok === true && facts.profile != null && typeof facts.profile === 'object') {
              const p = /** @type {Record<string, unknown>} */ (facts.profile)

              const descRaw = Reflect.get(p, 'description')

              await supabase
                .from('watchlist_items')
                .update({
                  fmp_company_description: typeof descRaw === 'string' ? descRaw : null,
                  fmp_metrics: {
                    profile: facts.profile ?? null,
                    quote: facts.quote ?? null,
                    key_metrics: facts.key_metrics ?? null,
                  },
                  fmp_metrics_fetched_at: new Date().toISOString(),
                })
                .eq('id', wid)
            }
          } catch {
            /* best-effort */
          }
        }
      }

      setOpen(false)

      setQ('')

      onCreated?.()
    } catch (e) {
      setSurface(e instanceof Error ? e.message : String(e))
    } finally {
      setCreating(false)
    }
  }

  if (!supabase || !userPresent) return null

  const title =
    target === 'satellite'
      ? 'Add satellite position (FMP)'
      : 'Add watchlist candidate'

  const copy =
    target === 'satellite'
      ? 'Search locks fmp_symbol and exchangeShortName; Yahoo symbol is derived and persisted.'
      : 'Same FMP lookup as Satellite — picks symbol, exchange, Yahoo mapping, then enriches with company facts.'

  return (
    <div className="relative rounded-xl border border-[rgba(255,255,255,0.06)] bg-[#111118] px-4 py-4">
      <p className="text-[10px] font-medium uppercase tracking-wide text-[#505068]">{title}</p>

      <p className="mt-2 text-xs text-[#9090A8]">{copy}</p>

      <input
        type="text"
        value={q}
        onChange={(e) => setQ(e.target.value)}
        onFocus={() => setOpen(true)}
        placeholder="Type symbol or company"
        className="mt-4 w-full rounded-lg border border-[rgba(255,255,255,0.12)] bg-[#1A1A24] px-3 py-2 font-mono text-sm text-[#F0F0F8] outline-none focus:border-[rgba(77,184,255,0.55)]"
        autoComplete="off"
      />

      {surface ? <p className="mt-2 font-mono text-[11px] text-[#EF4444]">{surface}</p> : null}

      {busy ? (
        <p className="mt-2 font-mono text-[10px] uppercase tracking-wide text-[#505068]">Searching FMP</p>
      ) : null}

      {open && hits.length > 0 ? (
        <div className="absolute left-4 right-4 top-full z-20 mt-1 max-h-[280px] overflow-auto rounded-lg border border-[rgba(255,255,255,0.08)] bg-[#0A0A0F] shadow-[0_18px_44px_rgba(0,0,0,0.55)]">
          {hits.map((h) => (
            <button
              key={`${h.symbol}:${h.exchangeShortName}`}
              type="button"
              disabled={creating}
              className="flex w-full flex-col gap-0.5 border-b border-[rgba(255,255,255,0.05)] px-3 py-2 text-left hover:bg-[rgba(255,255,255,0.04)] disabled:opacity-50"
              onClick={() => void createInstrument(h)}
            >
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="font-mono text-sm text-[#4DB8FF]">{h.symbol}</span>

                <span className="font-mono text-[10px] uppercase tracking-wide text-[#505068]">{h.exchangeShortName}</span>
              </div>

              <span className="text-xs text-[#C4C4D8]">{h.name}</span>
            </button>
          ))}
        </div>
      ) : null}

      {creating ? (
        <p className="mt-3 font-mono text-[10px] uppercase tracking-wide text-[#F59E0B]">Saving row</p>
      ) : null}
    </div>
  )
}

import { useState } from 'react'
import { TickerSearchCombobox } from '../TickerSearchCombobox.jsx'
import { postEquityFacts } from '../../lib/market/marketApi.js'
import { deriveYahooSymbolFromFmp } from '../../lib/market/tickerMap.js'
import { useSharesightIntegration } from '../../context/SharesightIntegrationContext.jsx'

/**
 * @param {{ onCreated?: () => void }} props
 */
export function WatchlistAddTicker({ onCreated }) {
  const { supabase, userPresent } = useSharesightIntegration()
  /** @type {[{ symbol: string, name: string, exchangeShortName: string, currency: string|null } | null, Function]} */
  const [selected, setSelected] = useState(null)
  const [searchKey, setSearchKey] = useState(0)
  const [saving, setSaving] = useState(false)
  const [surface, setSurface] = useState(/** @type {string|null} */ (null))

  async function addToWatchlist() {
    if (!supabase || !userPresent || !selected) return

    const exRaw = `${selected.exchangeShortName ?? ''}`.trim()
    if (!exRaw || /^unknown$/i.test(exRaw)) {
      setSurface('Pick a row with a valid exchange.')
      return
    }

    setSaving(true)
    setSurface(null)

    try {
      const { data: ud } = await supabase.auth.getUser()
      const uid = ud.user?.id
      if (!uid) throw new Error('Not signed in')

      const yahoo = deriveYahooSymbolFromFmp({
        fmpSymbol: selected.symbol,
        exchangeShortName: selected.exchangeShortName,
      })
      const cur = `${selected.currency ?? 'USD'}`.trim().toUpperCase()

      const row = {
        user_id: uid,
        fmp_symbol: selected.symbol,
        exchange_short_name: selected.exchangeShortName,
        yahoo_symbol: yahoo,
        currency: cur || null,
        name: selected.name,
        display_ticker: selected.symbol,
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
          const facts = /** @type {Record<string, unknown>} */ (await postEquityFacts(selected.symbol))
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

      setSelected(null)
      setSearchKey((k) => k + 1)
      onCreated?.()
    } catch (e) {
      setSurface(e instanceof Error ? e.message : String(e))
    } finally {
      setSaving(false)
    }
  }

  if (!supabase || !userPresent) return null

  return (
    <div className="rounded-xl border border-[rgba(255,255,255,0.06)] bg-[#111118] px-4 py-4">
      <p className="text-[10px] font-medium uppercase tracking-wide text-[#505068]">Add watchlist candidate</p>
      <p className="mt-2 text-xs text-[#9090A8]">
        Search FMP, select a ticker to lock symbol and exchange, then add to your watchlist.
      </p>

      <div className="mt-4">
        <TickerSearchCombobox key={searchKey} selectedHit={selected} onSelect={setSelected} />
      </div>

      {selected ? (
        <p className="mt-2 font-mono text-[11px] text-[#9090A8]">
          Selected: <span className="text-[#F0F0F8]">{selected.symbol}</span> · {selected.name} · {selected.exchangeShortName}
          {selected.currency ? ` · ${selected.currency}` : ''}
        </p>
      ) : null}

      {surface ? <p className="mt-2 font-mono text-[11px] text-[#EF4444]">{surface}</p> : null}

      <button
        type="button"
        disabled={!selected || saving}
        onClick={() => void addToWatchlist()}
        className="mt-4 rounded-lg border border-[#4DB8FF] bg-[rgba(77,184,255,0.12)] px-4 py-2 font-mono text-xs text-[#79CBFF] hover:bg-[rgba(77,184,255,0.18)] disabled:border-[rgba(255,255,255,0.08)] disabled:bg-[#1A1A24] disabled:text-[#505068]"
      >
        {saving ? 'Adding…' : 'Add to watchlist'}
      </button>
    </div>
  )
}

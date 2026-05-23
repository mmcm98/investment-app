import { useState } from 'react'

import { deriveYahooSymbolFromFmp } from '../../lib/market/tickerMap.js'

import { useSharesightIntegration } from '../../context/SharesightIntegrationContext.jsx'

import { TickerSearchCombobox } from '../TickerSearchCombobox.jsx'

/** @param {{
 *   onCreated?: () => void,
 *   prefilledSymbol?: string,
 *   sharesightHoldingExternalId?: string|null,
 * }} props */

export function AddTickerCombobox({
  onCreated,
  prefilledSymbol = '',
  sharesightHoldingExternalId = null,
}) {
  const { supabase, userPresent } = useSharesightIntegration()

  const [creating, setCreating] = useState(false)

  const [surface, setSurface] = useState(null)

  const [searchKey, setSearchKey] = useState(0)

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

      setSearchKey((k) => k + 1)
      onCreated?.()
    } catch (e) {
      setSurface(e instanceof Error ? e.message : String(e))
    } finally {
      setCreating(false)
    }
  }

  if (!supabase || !userPresent) return null

  return (
    <div className="rounded-xl border border-[rgba(255,255,255,0.06)] bg-[#111118] px-4 py-4">
      <p className="text-[10px] font-medium uppercase tracking-wide text-[#505068]">Add satellite position (FMP)</p>

      <p className="mt-2 text-xs text-[#9090A8]">
        Search locks fmp_symbol and exchangeShortName; Yahoo symbol is derived and persisted.
      </p>

      <div className="mt-4">
        <TickerSearchCombobox
          key={`${searchKey}-${prefilledSymbol}`}
          placeholder={prefilledSymbol || 'Type symbol or company'}
          onSelect={(hit) => {
            if (hit && !creating) void createInstrument(hit)
          }}
        />
      </div>

      {surface ? <p className="mt-2 font-mono text-[11px] text-[#EF4444]">{surface}</p> : null}

      {creating ? (
        <p className="mt-3 font-mono text-[10px] uppercase tracking-wide text-[#F59E0B]">Saving row</p>
      ) : null}
    </div>
  )
}

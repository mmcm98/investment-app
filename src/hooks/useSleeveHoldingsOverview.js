import { useCallback, useEffect, useMemo, useState } from 'react'
import { useSharesightIntegration } from '../context/SharesightIntegrationContext.jsx'
import { useLivePrices } from '../context/LivePricesContext.jsx'
import { isCashLikeHolding, numOrNull } from '../lib/satellite/satelliteMerge.js'

/** @param {string|null|undefined} c */
function currencyIso(c) {
  const v = `${c ?? ''}`.trim().toUpperCase()

  return v || 'AUD'
}

/** @param {unknown} v */
function numOrFinite(v) {
  if (typeof v === 'number' && Number.isFinite(v)) return v

  const n = Number.parseFloat(`${v ?? ''}`)

  return Number.isFinite(n) ? n : null
}

/**
 * @param {'core'|'satellite'} portfolioRole
 */
export function useSleeveHoldingsOverview(portfolioRole) {
  const { supabase, userPresent, holdingsCount } = useSharesightIntegration()
  const { mergedRows, pricesUpdating } = useLivePrices()

  const [holdings, setHoldings] = useState(/** @type {any[]} */ ([]))

  const [loadError, setLoadError] = useState(/** @type {string|null} */ (null))
  const [hydrated, setHydrated] = useState(false)

  const reload = useCallback(async () => {
    if (!supabase || !userPresent) {
      setHoldings([])
      setHydrated(false)

      return
    }

    setLoadError(null)

    try {
      const { data: ud } = await supabase.auth.getUser()
      const uid = ud.user?.id

      if (!uid) {
        setHoldings([])
        setHydrated(true)

        return
      }

      const { data, error } = await supabase
        .from('sharesight_holdings')
        .select('*')
        .eq('user_id', uid)
        .eq('portfolio_role', portfolioRole)
        .order('instrument_symbol', { ascending: true })

      if (error) throw error

      setHoldings(data ?? [])
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : String(e))
      setHoldings([])
    } finally {
      setHydrated(true)
    }
  }, [supabase, userPresent, portfolioRole])

  useEffect(() => {
    const t = window.setTimeout(() => {
      void reload()
    }, 0)

    return () => window.clearTimeout(t)
  }, [reload, holdingsCount])

  const rows = useMemo(() => {
    return (holdings ?? []).map((h) => {
      const hk = `${h.portfolio_role ?? ''}:${h.holding_external_id ?? ''}`

      const q =
        mergedRows.find(
          (m) =>
            `${m.portfolio_role ?? ''}`.toLowerCase() === `${portfolioRole}`.toLowerCase() &&
            `${m.holding_external_id ?? ''}` === `${h.holding_external_id ?? ''}`,
        ) ?? null

      const cashLike = isCashLikeHolding({
        instrument_symbol: h.instrument_symbol,
        instrument_name: h.instrument_name,
      })

      const qty = numOrNull(h.quantity)
      const mv = numOrFinite(h.market_value)
      const cost = numOrFinite(
        Reflect.get(/** @type {Record<string, unknown>} */ (h), 'cost_basis') ??
          Reflect.get(/** @type {Record<string, unknown>} */ (h.raw ?? {}), 'cost_basis'),
      )

      const uglAud =
        q?.unrealised_gain_aud != null && Number.isFinite(Number(q.unrealised_gain_aud))
          ? Number(q.unrealised_gain_aud)
          : currencyIso(h.currency) === 'AUD'
            ? numOrFinite(Reflect.get(/** @type {Record<string, unknown>} */ (h), 'unrealized_gain_loss'))
            : null

      const valueAud =
        q?.holding_value_aud != null && Number.isFinite(Number(q.holding_value_aud))
          ? Number(q.holding_value_aud)
          : mv != null && currencyIso(h.currency) === 'AUD'
            ? mv
            : null

      const displayNative = q?.display_native ?? q?.last_price ?? null
      const displayAud = q?.display_aud ?? null

      const pctUgl =
        cost != null && cost !== 0 && uglAud != null && Number.isFinite(uglAud) ? (uglAud / Math.abs(cost)) * 100 : null

      return {
        rowKey: hk,
        holding: h,
        mergedQuote: q,
        cashLike,
        ticker: `${h.instrument_symbol ?? '—'}`.trim() || '—',
        name: `${h.instrument_name ?? '—'}`.trim() || '—',
        quantity: qty,
        costBasis: cost,
        unrealisedAud: uglAud,
        unrealisedPct: pctUgl,
        valueAud,
        displayNative,
        displayAud,
        quoteCurrency: q?.quote_currency ?? currencyIso(h.currency),
      }
    })
  }, [holdings, mergedRows, portfolioRole])

  const totals = useMemo(() => {
    let sleeveValue = 0
    let sleeveCost = 0
    let sleeveUgl = 0

    for (const r of rows) {
      if (r.cashLike) continue

      if (r.valueAud != null && Number.isFinite(r.valueAud)) sleeveValue += r.valueAud

      if (r.costBasis != null && Number.isFinite(r.costBasis)) sleeveCost += r.costBasis

      if (r.unrealisedAud != null && Number.isFinite(r.unrealisedAud)) sleeveUgl += r.unrealisedAud
    }

    return { sleeveValue, sleeveCost, sleeveUgl }
  }, [rows])

  const donutSlices = useMemo(() => {
    const denom = totals.sleeveValue > 0 ? totals.sleeveValue : 0

    if (denom <= 0) return []

    return rows
      .filter((r) => !r.cashLike && r.valueAud != null && r.valueAud > 0)
      .map((r) => ({
        name: r.ticker !== '—' ? r.ticker : r.name.slice(0, 18),
        value: r.valueAud,
        pct: (r.valueAud / denom) * 100,
      }))
  }, [rows, totals.sleeveValue])

  return {
    hydrated,
    loadError,
    reload,
    rows,
    totals,
    donutSlices,
    pricesUpdating,
  }
}

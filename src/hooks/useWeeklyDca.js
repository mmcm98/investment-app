import { useEffect, useMemo, useState } from 'react'
import { useSharesightIntegration } from '../context/SharesightIntegrationContext.jsx'
import { useLivePrices } from '../context/LivePricesContext.jsx'
import {
  computeWeeklyDcaRows,
  DEFAULT_BASE_WEEKLY_AUD,
  numOr,
} from '../lib/dca/computeWeeklyDca.js'

/**
 * Loads `user_settings`, `core_etfs`, and combines with live quote rows for DCA math.
 */
export function useWeeklyDca() {
  const { supabase, userPresent, supabaseConfigured } = useSharesightIntegration()
  const { mergedRows } = useLivePrices()

  const [reloadKey, setReloadKey] = useState(0)

  const [settingsRow, setSettingsRow] = useState(/** @type {Record<string, unknown> | null} */ (null))
  const [coreRows, setCoreRows] = useState(/** @type {Record<string, unknown>[]} */ ([]))
  const [loadError, setLoadError] = useState(/** @type {string | null} */ (null))

  useEffect(() => {
    if (!supabase || !userPresent) {
      queueMicrotask(() => {
        setSettingsRow(null)
        setCoreRows([])
        setLoadError(null)
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

        const [setRes, coreRes] = await Promise.all([
          supabase.from('user_settings').select('*').eq('user_id', uid).maybeSingle(),
          supabase
            .from('core_etfs')
            .select(
              'ticker,name,provider_page_url,target_weight_pct,tier_schedule_kind,custom_tier_schedule,gearing_multiple,sort_order,archived',
            )
            .eq('user_id', uid)
            .eq('archived', false)
            .order('sort_order', { ascending: true })
            .order('ticker', { ascending: true }),
        ])

        if (setRes.error) throw setRes.error
        if (coreRes.error) throw coreRes.error

        if (cancelled) return

        setSettingsRow(setRes.data ? /** @type {Record<string, unknown>} */ (setRes.data) : null)
        setCoreRows((coreRes.data ?? []) /** @type {Record<string, unknown>[]} */)
      } catch (e) {
        if (!cancelled) setLoadError(e instanceof Error ? e.message : String(e))
      }
    })()

    return () => {
      cancelled = true
    }
  }, [supabase, userPresent, reloadKey])

  const computed = useMemo(() => {
    const base = settingsRow ? numOr(settingsRow.weekly_dca_base_aud, DEFAULT_BASE_WEEKLY_AUD) : DEFAULT_BASE_WEEKLY_AUD
    const tierSchedulesJson = settingsRow ? settingsRow.tier_schedules : null

    const coreEtfs = coreRows.map((r) => ({
      ticker: `${r.ticker ?? ''}`,
      name: typeof r.name === 'string' ? r.name : null,
      provider_page_url: typeof r.provider_page_url === 'string' ? r.provider_page_url : null,
      target_weight_pct: numOr(r.target_weight_pct, 0),
      tier_schedule_kind: `${r.tier_schedule_kind ?? 'standard'}`,
      custom_tier_schedule: r.custom_tier_schedule,
      gearing_multiple: r.gearing_multiple == null ? null : numOr(r.gearing_multiple, NaN),
      sort_order: r.sort_order == null ? 0 : numOr(r.sort_order, 0),
    }))

    return computeWeeklyDcaRows({
      weeklyDcaBaseAud: base,
      tierSchedulesJson,
      coreEtfs,
      mergedRows,
    })
  }, [settingsRow, coreRows, mergedRows])

  return {
    supabaseConfigured,
    userPresent,
    loadError,
    hasSettingsRow: Boolean(settingsRow),
    reloadWeeklyDca: () => setReloadKey((n) => n + 1),
    ...computed,
  }
}

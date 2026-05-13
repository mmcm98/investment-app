import { useCallback, useEffect, useMemo, useState } from 'react'

import { useSharesightIntegration } from '../context/SharesightIntegrationContext.jsx'

import { DEFAULT_EXCHANGE_ROWS } from '../lib/settings/defaultExchangeSeed.js'

import { DEFAULT_GHHF_TIERS, DEFAULT_STANDARD_TIERS } from '../lib/dca/defaultTierSchedules.js'

import { mergeUserPreferences } from '../lib/settings/mergeUserPreferences.js'

import { notifyUserSettingsUpdated } from '../lib/settings/settingsEvents.js'

import { resolveSchedulesFromSettings } from '../lib/dca/computeWeeklyDca.js'

import { closedDbIsNotTrueOr } from '../lib/satellite/satelliteMerge.js'

/**
 * @returns {{
 * loading: boolean
 * saving: boolean
 * error: string | null
 * userId: string | null
 * settingsRow: Record<string, unknown> | null
 * mergedPrefs: Record<string, unknown>
 * coreEtfs: Record<string, unknown>[]
 * exchanges: Record<string, unknown>[]
 * positions: Record<string, unknown>[]
 * positionsArchived: Record<string, unknown>[]
 * watchlistItems: Record<string, unknown>[]
 * watchlistArchived: Record<string, unknown>[]
 * reload: () => Promise<void>
 * saveUserSettingsPatch: (patch: Record<string, unknown>) => Promise<void>
 * savePreferencesMerged: (nextPrefs: Record<string, unknown>) => Promise<void>
 * saveCoreEtfsRows: (rows: Record<string, unknown>[]) => Promise<void>
 * seedExchangesIfEmpty: () => Promise<void>
 * saveExchangeRows: (rows: Record<string, unknown>[]) => Promise<void>
 * }}
 */

export function useSettingsController() {
  const {
    supabase,
    userPresent,
    connectSharesight,
    refreshSharesightNow,
    oauthRow,
    reloadLocalSnapshot,
    isSyncing,
    syncPhaseLabel,
  } = useSharesightIntegration()

  const [loading, setLoading] = useState(true)

  const [saving, setSaving] = useState(false)

  const [error, setError] = useState(/** @type {string|null} */ (null))

  const [userId, setUserId] = useState(/** @type {string|null} */ (null))

  const [settingsRow, setSettingsRow] = useState(/** @type {Record<string, unknown>|null} */ (null))

  const [coreEtfs, setCoreEtfs] = useState(/** @type {Record<string, unknown>[]} */ ([]))

  const [exchanges, setExchanges] = useState(/** @type {Record<string, unknown>[]} */ ([]))

  const [positions, setPositions] = useState(/** @type {Record<string, unknown>[]} */ ([]))

  const [positionsArchived, setPositionsArchived] = useState(/** @type {Record<string, unknown>[]} */ ([]))

  const [watchlistItems, setWatchlistItems] = useState(/** @type {Record<string, unknown>[]} */ ([]))

  const [watchlistArchived, setWatchlistArchived] = useState(/** @type {Record<string, unknown>[]} */ ([]))

  const mergedPrefs = useMemo(() => mergeUserPreferences(settingsRow?.preferences), [settingsRow?.preferences])

  const reload = useCallback(async () => {
    if (!supabase || !userPresent) {
      setSettingsRow(null)

      setCoreEtfs([])

      setExchanges([])

      setPositions([])

      setPositionsArchived([])

      setWatchlistItems([])

      setWatchlistArchived([])

      setUserId(null)

      setLoading(false)

      return
    }

    setLoading(true)

    setError(null)

    try {
      const { data: ud, error: uErr } = await supabase.auth.getUser()

      if (uErr) throw uErr

      const uid = ud.user?.id ?? ''

      if (!uid) throw new Error('Not signed in')

      setUserId(uid)

      const [st, ce, ex, pos, pa, wl, wa] = await Promise.all([
        supabase.from('user_settings').select('*').eq('user_id', uid).maybeSingle(),
        supabase.from('core_etfs').select('*').eq('user_id', uid).order('sort_order', { ascending: true }),
        supabase.from('exchange_registry').select('*').eq('user_id', uid).order('sort_order', { ascending: true }),
        supabase
          .from('positions')
          .select('*')
          .eq('user_id', uid)
          .eq('kind', 'satellite')
          .eq('archived', false)
          .or(closedDbIsNotTrueOr)
          .order('display_ticker'),
        supabase.from('positions').select('*').eq('user_id', uid).eq('kind', 'satellite').eq('archived', true).order('display_ticker'),
        supabase.from('watchlist_items').select('*').eq('user_id', uid).eq('archived', false).order('display_ticker'),
        supabase.from('watchlist_items').select('*').eq('user_id', uid).eq('archived', true).order('display_ticker'),
      ])

      if (st.error) throw st.error

      if (ce.error) throw ce.error

      if (ex.error) throw ex.error

      if (pos.error) throw pos.error

      if (pa.error) throw pa.error

      if (wl.error) throw wl.error

      if (wa.error) throw wa.error

      setSettingsRow(st.data ? /** @type {Record<string, unknown>} */ (st.data) : null)

      setCoreEtfs(/** @type {Record<string, unknown>[]} */ (ce.data ?? []))

      setExchanges(/** @type {Record<string, unknown>[]} */ (ex.data ?? []))

      setPositions(/** @type {Record<string, unknown>[]} */ (pos.data ?? []))

      setPositionsArchived(/** @type {Record<string, unknown>[]} */ (pa.data ?? []))

      setWatchlistItems(/** @type {Record<string, unknown>[]} */ (wl.data ?? []))

      setWatchlistArchived(/** @type {Record<string, unknown>[]} */ (wa.data ?? []))
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setLoading(false)
    }
  }, [supabase, userPresent])

  /* eslint-disable react-hooks/set-state-in-effect -- bootstrap settings */

  useEffect(() => {

    void reload()

  }, [reload])

  /* eslint-enable react-hooks/set-state-in-effect */

  const saveUserSettingsPatch = useCallback(
    async (patch) => {
      if (!supabase || !userId) throw new Error('Not ready')

      setSaving(true)

      try {
        const { error: err } = await supabase.from('user_settings').upsert({ user_id: userId, ...patch, updated_at: new Date().toISOString() }, { onConflict: 'user_id' })

        if (err) throw err

        notifyUserSettingsUpdated()

        await reload()
      } finally {
        setSaving(false)
      }
    },
    [supabase, userId, reload],
  )

  const savePreferencesMerged = useCallback(
    async (nextPrefs) => {
      await saveUserSettingsPatch({ preferences: nextPrefs })
    },
    [saveUserSettingsPatch],
  )

  const saveCoreEtfsRows = useCallback(
    async (rows) => {
      if (!supabase || !userId) throw new Error('Not ready')

      setSaving(true)

      try {
        for (const r of rows) {
          const idRaw = Reflect.get(r, 'id')

          const kind = `${Reflect.get(r, 'tier_schedule_kind') ?? 'standard'}`.toLowerCase()

          const kindNorm = kind === 'ghhf' || kind === 'custom' ? kind : 'standard'

          /** @type {Record<string, unknown>} */

          const base = {
            user_id: userId,
            ticker: `${Reflect.get(r, 'ticker') ?? ''}`.trim().toUpperCase(),
            name: Reflect.get(r, 'name'),
            target_weight_pct: Number(Reflect.get(r, 'target_weight_pct')),
            tier_schedule_kind: kindNorm,
            custom_tier_schedule: Reflect.get(r, 'custom_tier_schedule'),
            gearing_multiple: Reflect.get(r, 'gearing_multiple'),
            provider_page_url: Reflect.get(r, 'provider_page_url'),
            archived: Boolean(Reflect.get(r, 'archived')),
            sort_order: Number(Reflect.get(r, 'sort_order')) || 0,
            updated_at: new Date().toISOString(),
          }

          if (typeof idRaw === 'string' && idRaw) {
            const { error: err } = await supabase.from('core_etfs').update(base).eq('id', idRaw).eq('user_id', userId)

            if (err) throw err
          } else {
            const { error: err } = await supabase
              .from('core_etfs')
              .insert({ ...base, created_at: new Date().toISOString() })

            if (err) throw err
          }
        }

        notifyUserSettingsUpdated()

        await reload()
      } finally {
        setSaving(false)
      }
    },
    [supabase, userId, reload],
  )

  const seedExchangesIfEmpty = useCallback(async () => {
    if (!supabase || !userId) return

    if (exchanges.length > 0) return

    setSaving(true)

    try {
      const rows = DEFAULT_EXCHANGE_ROWS.map((r, i) => ({
        ...r,
        user_id: userId,
        sort_order: r.sort_order ?? i * 10,
      }))

      const { error: err } = await supabase.from('exchange_registry').insert(rows)

      if (err) throw err

      await reload()
    } finally {
      setSaving(false)
    }
  }, [supabase, userId, exchanges.length, reload])

  const saveExchangeRows = useCallback(
    async (rows) => {
      if (!supabase || !userId) throw new Error('Not ready')

      setSaving(true)

      try {
        for (const r of rows) {
          const idRaw = Reflect.get(r, 'id')

          /** @type {Record<string, unknown>} */

          const patch = {
            user_id: userId,
            exchange_short_name: `${Reflect.get(r, 'exchange_short_name') ?? ''}`.trim(),
            timezone_label: `${Reflect.get(r, 'timezone_label') ?? 'UTC'}`.trim(),
            market_open_local: Reflect.get(r, 'market_open_local'),
            market_close_local: Reflect.get(r, 'market_close_local'),
            announcement_source: Reflect.get(r, 'announcement_source'),
            manual_monitoring: Boolean(Reflect.get(r, 'manual_monitoring')),
            fmp_symbol_format: Reflect.get(r, 'fmp_symbol_format'),
            yahoo_symbol_format: Reflect.get(r, 'yahoo_symbol_format'),
            mapping_example: Reflect.get(r, 'mapping_example'),
            sort_order: Number(Reflect.get(r, 'sort_order')) || 0,
            updated_at: new Date().toISOString(),
          }

          if (typeof idRaw === 'string' && idRaw) {
            Reflect.set(patch, 'id', idRaw)

            const { error: err } = await supabase.from('exchange_registry').update(patch).eq('id', idRaw).eq('user_id', userId)

            if (err) throw err
          } else {
            const ins = { ...patch }

            Reflect.delete(ins, 'id')

            const { error: err } = await supabase.from('exchange_registry').insert(ins)

            if (err) throw err
          }
        }

        notifyUserSettingsUpdated()

        await reload()
      } finally {
        setSaving(false)
      }
    },
    [supabase, userId, reload],
  )

  const resolvedSchedules = useMemo(() => resolveSchedulesFromSettings(settingsRow?.tier_schedules), [settingsRow?.tier_schedules])

  return {
    loading,
    saving,
    error,
    userId,
    settingsRow,
    mergedPrefs,
    coreEtfs,
    exchanges,
    positions,
    positionsArchived,
    watchlistItems,
    watchlistArchived,
    oauthRow,
    reload,
    saveUserSettingsPatch,
    savePreferencesMerged,
    saveCoreEtfsRows,
    seedExchangesIfEmpty,
    saveExchangeRows,
    connectSharesight,
    refreshSharesightNow,
    reloadLocalSnapshot,
    isSyncing,
    syncPhaseLabel,
    supabase,
    defaultStandardBands: DEFAULT_STANDARD_TIERS.map((b) => ({ ...b })),
    defaultGhhfBands: DEFAULT_GHHF_TIERS.map((b) => ({ ...b })),
    resolvedSchedules,
    rawTierSchedules: settingsRow?.tier_schedules,
  }
}

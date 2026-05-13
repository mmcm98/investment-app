import { useCallback, useEffect, useMemo, useState } from 'react'
import { useSharesightIntegration } from '../context/SharesightIntegrationContext.jsx'
import { useLivePrices } from '../context/LivePricesContext.jsx'
import { extractSharesightValueSeries, mergeSeriesSum } from '../lib/dashboard/parseSharesightPerformance.js'
import { readDashboardPrefs } from '../lib/dashboard/dashboardPrefs.js'
import {
  brokerCashAudBreakdown,
  bookValueTotalsFromHoldingsAud,
  dayMoveTotalsAud,
  holdingsExCashByRoleAudFromSharesight,
  unrealisedGainSumAud,
} from '../lib/dashboard/dashboardTotals.js'
import { closedDbIsNotTrueOr } from '../lib/satellite/satelliteMerge.js'

export function useDashboardData() {
  const { supabase, userPresent, lastSuccessfulSyncAt } = useSharesightIntegration()
  const { mergedRows, fxByCurrency } = useLivePrices()

  /** @type {[Record<string, unknown>|null, import('react').Dispatch<React.SetStateAction<Record<string, unknown>|null>>]} */
  const [settingsRow, setSettingsRow] = useState(null)

  const [cashRows, setCashRows] = useState(/** @type {Record<string, unknown>[]} */ ([]))
  const [holdingsAll, setHoldingsAll] = useState(/** @type {Record<string, unknown>[]} */ ([]))
  const [corePerfPayload, setCorePerfPayload] = useState(/** @type {unknown} */ (null))
  const [satPerfPayload, setSatPerfPayload] = useState(/** @type {unknown} */ (null))
  const [positions, setPositions] = useState(/** @type {Record<string, unknown>[]} */ ([]))
  const [scoreRowsAll, setScoreRowsAll] = useState(/** @type {Record<string, unknown>[]} */ ([]))
  const [watchlistItems, setWatchlistItems] = useState(/** @type {Record<string, unknown>[]} */ ([]))
  const [loadError, setLoadError] = useState(/** @type {string|null} */ (null))
  const [dashboardFetching, setDashboardFetching] = useState(false)
  const [dashboardHydrated, setDashboardHydrated] = useState(false)

  const reload = useCallback(async () => {
    if (!supabase || !userPresent) return

    setLoadError(null)
    setDashboardFetching(true)

    try {
      const { data: ud } = await supabase.auth.getUser()

      const uid = ud.user?.id

      if (!uid) return

      const [setRes, cashRes, hRes, pCore, pSat, posRes, wlRes] = await Promise.all([
        supabase.from('user_settings').select('*').eq('user_id', uid).maybeSingle(),
        supabase.from('sharesight_cash_balances').select('*').eq('user_id', uid),
        supabase.from('sharesight_holdings').select('*').eq('user_id', uid),
        supabase
          .from('sharesight_performance_snapshots')
          .select('payload,created_at')
          .eq('user_id', uid)
          .eq('portfolio_role', 'core')
          .order('created_at', { ascending: false })
          .limit(1)
          .maybeSingle(),
        supabase
          .from('sharesight_performance_snapshots')
          .select('payload,created_at')
          .eq('user_id', uid)
          .eq('portfolio_role', 'satellite')
          .order('created_at', { ascending: false })
          .limit(1)
          .maybeSingle(),
        supabase
          .from('positions')
          .select('*')
          .eq('user_id', uid)
          .eq('kind', 'satellite')
          .eq('archived', false)
          .or(closedDbIsNotTrueOr),
        supabase.from('watchlist_items').select('*').eq('user_id', uid).eq('archived', false).order('display_ticker'),
      ])

      if (setRes.error) throw setRes.error
      if (cashRes.error) throw cashRes.error
      if (hRes.error) throw hRes.error
      if (pCore.error) throw pCore.error
      if (pSat.error) throw pSat.error
      if (posRes.error) throw posRes.error
      if (wlRes.error) throw wlRes.error

      const pidList = (posRes.data ?? []).map((r) => `${Reflect.get(/** @type {Record<string, unknown>} */ (r), 'id')}`).filter(Boolean)

      const wlIds = (wlRes.data ?? []).map((r) => `${Reflect.get(/** @type {Record<string, unknown>} */ (r), 'id')}`).filter(Boolean)

      const scPid =
        pidList.length > 0
          ? await supabase
              .from('scorecard_versions')
              .select('id, position_id, watchlist_item_id, version_number, framework, overall_score, generated_at')
              .in('position_id', pidList)
          : ({ data: [], error: /** @type {null} */ (null) })

      const scWl =
        wlIds.length > 0
          ? await supabase
              .from('scorecard_versions')
              .select('id, watchlist_item_id, version_number, overall_score, generated_at')
              .in('watchlist_item_id', wlIds)
          : ({ data: [], error: /** @type {null} */ (null) })

      if (scPid.error) throw scPid.error

      if (scWl.error) throw scWl.error

      const scores = [...(scPid.data ?? []), ...(scWl.data ?? [])]

      setSettingsRow(setRes.data ? /** @type {Record<string, unknown>} */ (setRes.data) : null)
      setCashRows(/** @type {Record<string, unknown>[]} */ (cashRes.data ?? []))
      setHoldingsAll(/** @type {Record<string, unknown>[]} */ (hRes.data ?? []))
      setCorePerfPayload(pCore.data && typeof Reflect.get(pCore.data, 'payload') !== 'undefined' ? Reflect.get(pCore.data, 'payload') : null)
      setSatPerfPayload(pSat.data && typeof Reflect.get(pSat.data, 'payload') !== 'undefined' ? Reflect.get(pSat.data, 'payload') : null)
      setPositions(/** @type {Record<string, unknown>[]} */ (posRes.data ?? []))
      setWatchlistItems(/** @type {Record<string, unknown>[]} */ (wlRes.data ?? []))
      setScoreRowsAll(/** @type {Record<string, unknown>[]} */ (scores ?? []))
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : String(e))
    } finally {
      setDashboardFetching(false)
      setDashboardHydrated(true)
    }
  }, [supabase, userPresent])

  useEffect(() => {
    if (!supabase || !userPresent) {
      queueMicrotask(() => {
        setSettingsRow(null)
        setCashRows([])
        setHoldingsAll([])
        setCorePerfPayload(null)
        setSatPerfPayload(null)
        setPositions([])
        setWatchlistItems([])
        setScoreRowsAll([])
        setLoadError(null)
        setDashboardHydrated(false)
      })

      return undefined
    }

    const t = window.setTimeout(() => void reload(), 0)

    return () => window.clearTimeout(t)
  }, [supabase, userPresent, reload])

  const dashboardPrefs = useMemo(() => readDashboardPrefs(settingsRow?.preferences), [settingsRow])

  const holdingsSplit = useMemo(() => holdingsExCashByRoleAudFromSharesight(holdingsAll), [holdingsAll])

  const broker = useMemo(
    () => brokerCashAudBreakdown(cashRows, /** @type {Record<string, { aud_per_unit: number }>} */ (fxByCurrency ?? {})),
    [cashRows, fxByCurrency],
  )

  const externalCashAud =
    typeof settingsRow?.external_cash_aud === 'number' && Number.isFinite(Number(settingsRow.external_cash_aud))
      ? Number(settingsRow.external_cash_aud)
      : Number.parseFloat(`${settingsRow?.external_cash_aud ?? 0}`) || 0

  const totalCashAud = broker.totalBrokerCashAud + externalCashAud

  const coreTarget = typeof settingsRow?.core_target_pct === 'number' ? Number(settingsRow.core_target_pct) : 72
  const satelliteTarget = typeof settingsRow?.satellite_target_pct === 'number' ? Number(settingsRow.satellite_target_pct) : 28

  const investedExCashAud = holdingsSplit.coreHoldingsExcCashAud + holdingsSplit.satelliteHoldingsExcCashAud
  const totalPortfolioAud = investedExCashAud + totalCashAud

  const dayAud = dayMoveTotalsAud(mergedRows)
  const unrealisedAud = unrealisedGainSumAud(mergedRows)

  const actualCorePctInvested =
    investedExCashAud > 0 ? (holdingsSplit.coreHoldingsExcCashAud / investedExCashAud) * 100 : null

  const actualSatPctInvested =
    investedExCashAud > 0 ? (holdingsSplit.satelliteHoldingsExcCashAud / investedExCashAud) * 100 : null

  const dayPctOnInvested =
    investedExCashAud > 0 && dayAud !== 0 ? (dayAud / (investedExCashAud || 1)) * 100 : investedExCashAud > 0 ? 0 : null

  const perfCoreSeries = extractSharesightValueSeries(corePerfPayload)
  const perfSatSeries = extractSharesightValueSeries(satPerfPayload)

  const perfTotalMerged = mergeSeriesSum(perfCoreSeries ?? null, perfSatSeries ?? null)

  const persistPrefs = useCallback(
    async (nextDashboardPrefs) => {
      if (!supabase) return

      const { data: ud } = await supabase.auth.getUser()

      const uid = ud.user?.id

      if (!uid) return

      const base = settingsRow?.preferences && typeof settingsRow.preferences === 'object' ? { .../** @type {Record<string, unknown>} */ (settingsRow.preferences) } : {}

      const next = {
        ...base,
        dashboard: {
          ...(base.dashboard && typeof base.dashboard === 'object' ? /** @type {Record<string, unknown>} */ (base.dashboard) : {}),
          ...nextDashboardPrefs,
        },
      }

      const { error } = await supabase
        .from('user_settings')
        .upsert(
          {
            user_id: uid,
            preferences: next,
            updated_at: new Date().toISOString(),
          },
          { onConflict: 'user_id' },
        )

      if (error) throw error

      setSettingsRow((prev) => ({ ...(typeof prev === 'object' && prev ? prev : {}), preferences: next, user_id: uid }))
    },
    [supabase, settingsRow],
  )

  /** Collapse scores for positions + watch items */
  const latestScoreByPid = useMemo(() => collapseScores(scoreRowsAll, 'position_id'), [scoreRowsAll])
  const latestScoreByWid = useMemo(() => collapseScores(scoreRowsAll, 'watchlist_item_id'), [scoreRowsAll])

  /** Book value totals (AUD cost basis rows only — multi-ccy omissions possible). */
  const bookCore = useMemo(() => bookValueTotalsFromHoldingsAud(holdingsAll, 'core'), [holdingsAll])
  const bookSat = useMemo(() => bookValueTotalsFromHoldingsAud(holdingsAll, 'satellite'), [holdingsAll])

  const hasRecoverableDashboardData =
    Boolean(settingsRow) ||
    positions.length > 0 ||
    holdingsAll.length > 0 ||
    watchlistItems.length > 0 ||
    cashRows.length > 0

  return {
    settingsRow,
    dashboardPrefs,
    persistPrefs,
    reload,
    loadError,

    dashboardFetching,
    dashboardHydrated,
    hasRecoverableDashboardData,

    holdingsSplit,
    broker,
    externalCashAud,
    totalCashAud,
    totalPortfolioAud,

    investedExCashAud,

    investedCoreAud: holdingsSplit.coreHoldingsExcCashAud,
    investedSatelliteAud: holdingsSplit.satelliteHoldingsExcCashAud,

    dayMoveAud: dayAud,
    dayPctOnInvested,
    unrealisedAud,

    coreTargetPct: coreTarget,
    satelliteTargetPct: satelliteTarget,
    actualCorePctInvested,
    actualSatPctInvested,

    lastSuccessfulSyncAt,

    perfCoreSeries,
    perfSatSeries,
    perfTotalMerged,

    holdingsAll,

    positions,
    watchlistItems,
    mergedRows,
    latestScoreByPid,
    latestScoreByWid,

    bookCoreAud: bookCore,
    bookSatelliteAud: bookSat,
  }
}

/**
 * @param {Record<string, unknown>[]} scores
 * @param {'position_id'|'watchlist_item_id'} keyField
 */
function collapseScores(scores, keyField) {
  /** @type {Record<string, Record<string, unknown>>} */
  const m = {}

  for (const r of scores) {
    const pid = Reflect.get(r, keyField)

    if (typeof pid !== 'string') continue

    const vnRaw = Reflect.get(r, 'version_number')
    const vn = typeof vnRaw === 'number' && Number.isFinite(vnRaw) ? vnRaw : Number.NaN

    const prev = m[pid]

    if (!prev) {
      m[pid] = /** @type {Record<string, unknown>} */ (r)

      continue
    }

    const pv = Reflect.get(prev, 'version_number')
    const pn = typeof pv === 'number' && Number.isFinite(pv) ? pv : Number.NaN

    if (Number.isFinite(vn) && (!Number.isFinite(pn) || vn > pn)) {
      m[pid] = /** @type {Record<string, unknown>} */ (r)
    }
  }

  return m
}

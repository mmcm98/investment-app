import { useCallback, useEffect, useMemo, useState } from 'react'
import { useSharesightIntegration } from '../context/SharesightIntegrationContext.jsx'
import { useLivePrices } from '../context/LivePricesContext.jsx'
import { computeSatelliteTargetAllocations } from '../lib/satellite/allocationEngine.js'
import { isCashLikeHolding, numOrNull } from '../lib/satellite/satelliteMerge.js'
import { universalTierFromScore } from '../lib/satellite/tierFromScore.js'
import { tickersLooselyEqual } from '../lib/dca/tickerMatch.js'

/** @param {unknown} prefs */
export function satelliteShowAudParenthetical(prefs) {
  if (!prefs || typeof prefs !== 'object') return false
  return Reflect.get(/** @type {Record<string, unknown>} */ (prefs), 'satellite_show_aud_parenthetical') === true
}

/** @param {unknown[]} holdings */
export function satelliteHoldingsMvTotal(holdings) {
  let t = 0
  for (const h of holdings) {
    const row = /** @type {Record<string, unknown>} */ (h)
    if (isCashLikeHolding(row)) continue
    const mv = numOrNull(Reflect.get(row, 'market_value'))
    if (mv != null) t += mv
  }
  return t
}

/** @param {unknown[]} scores */
export function collapseLatestScorecardsByPosition(scores) {
  /** @type {Record<string, Record<string, unknown>>} */
  const byPos = {}
  for (const r of scores) {
    const row = /** @type {Record<string, unknown>} */ (r)
    const pid = Reflect.get(row, 'position_id')
    if (typeof pid !== 'string') continue
    const vnRaw = Reflect.get(row, 'version_number')
    const vn = typeof vnRaw === 'number' && Number.isFinite(vnRaw) ? vnRaw : Number.NaN
    const prev = byPos[pid]
    if (!prev) {
      byPos[pid] = row
      continue
    }
    const prevV = Reflect.get(prev, 'version_number')
    const prevN = typeof prevV === 'number' && Number.isFinite(prevV) ? prevV : Number.NaN
    if (!Number.isFinite(vn)) continue
    if (!Number.isFinite(prevN) || vn > prevN) byPos[pid] = row
  }
  return byPos
}

/**
 * @param {string | null | undefined} ticker
 * @param {string | null | undefined} yahoo
 * @param {{ portfolio_role?: string, instrument_symbol?: string|null, yahoo_symbol?: string|null, display_native?: number|null, display_aud?: number|null }[]} mergedRows
 */
function findSatelliteQuote(ticker, yahoo, mergedRows) {
  const sat = mergedRows.filter((m) => `${m.portfolio_role ?? ''}`.toLowerCase() === 'satellite')
  /** @type {{ score: number, row: (typeof sat)[number] } | null} */
  let best = null
  for (const row of sat) {
    const tick = ticker
      ? tickersLooselyEqual(row.instrument_symbol, ticker) || tickersLooselyEqual(row.yahoo_symbol, ticker)
      : false
    const ys = yahoo ? tickersLooselyEqual(row.yahoo_symbol, yahoo) : false
    if (!tick && !ys) continue
    const score = (typeof row.display_native === 'number' ? 1 : 0) + (typeof row.display_aud === 'number' ? 1 : 0)
    if (!best || score > best.score) best = { score, row }
  }
  return best ? best.row : null
}

/** @param {Record<string, unknown>|null} position @param {string} key */
function extraField(position, key) {
  if (!position) return null
  const ex = Reflect.get(position, 'extra')
  if (!ex || typeof ex !== 'object') return null
  const v = Reflect.get(/** @type {Record<string, unknown>} */ (ex), key)
  return typeof v === 'string' ? v : null
}

export function useSatellitePortfolio() {
  const { supabase, userPresent, holdingsCount } = useSharesightIntegration()
  const { mergedRows } = useLivePrices()

  const [holdings, setHoldings] = useState(/** @type {Record<string, unknown>[]} */ ([]))
  const [positions, setPositions] = useState(/** @type {Record<string, unknown>[]} */ ([]))
  const [overrides, setOverrides] = useState(/** @type {Record<string, unknown>[]} */ ([]))
  const [settingsRow, setSettingsRow] = useState(/** @type {Record<string, unknown>|null} */ (null))
  const [scoreRows, setScoreRows] = useState(/** @type {Record<string, unknown>[]} */ ([]))
  const [loadError, setLoadError] = useState(/** @type {string|null} */ (null))

  const reload = useCallback(async () => {
    if (!supabase) return

    const { data: ud } = await supabase.auth.getUser()
    const uid = ud.user?.id
    if (!uid) return

    const [hRes, pRes, oRes, sRes] = await Promise.all([
      supabase.from('sharesight_holdings').select('*').eq('user_id', uid).eq('portfolio_role', 'satellite').order('instrument_symbol', { ascending: true }),
      supabase.from('positions').select('*').eq('user_id', uid).eq('kind', 'satellite').eq('archived', false).order('display_ticker', { ascending: true }),
      supabase.from('allocation_overrides').select('*').eq('user_id', uid).eq('active', true),
      supabase.from('user_settings').select('*').eq('user_id', uid).maybeSingle(),
    ])

    if (hRes.error) throw hRes.error
    if (pRes.error) throw pRes.error
    if (oRes.error) throw oRes.error
    if (sRes.error) throw sRes.error

    const pidList = (pRes.data ?? []).map((r) => `${Reflect.get(/** @type {Record<string, unknown>} */ (r), 'id')}`).filter(Boolean)

    const scRes =
      pidList.length > 0
        ? await supabase
            .from('scorecard_versions')
            .select('id, position_id, version_number, framework, overall_score, payload, generated_at')
            .in('position_id', pidList)
        : ({ data: [], error: /** @type {null} */ (null) })

    if (scRes.error) throw scRes.error

    setHoldings(/** @type {Record<string, unknown>[]} */ (hRes.data ?? []))
    setPositions(/** @type {Record<string, unknown>[]} */ (pRes.data ?? []))
    setOverrides(/** @type {Record<string, unknown>[]} */ (oRes.data ?? []))
    setSettingsRow(sRes.data ? /** @type {Record<string, unknown>} */ (sRes.data) : null)
    setScoreRows(/** @type {Record<string, unknown>[]} */ (scRes.data ?? []))
  }, [supabase])

  useEffect(() => {
    if (!supabase || !userPresent) {
      queueMicrotask(() => {
        setHoldings([])
        setPositions([])
        setOverrides([])
        setSettingsRow(null)
        setScoreRows([])
        setLoadError(null)
      })
      return undefined
    }

    let cancelled = false
    void (async () => {
      setLoadError(null)
      try {
        await reload()
      } catch (e) {
        if (!cancelled) setLoadError(e instanceof Error ? e.message : String(e))
      }
    })()

    return () => {
      cancelled = true
    }
  }, [supabase, userPresent, holdingsCount, reload])

  const showAudPar = useMemo(() => satelliteShowAudParenthetical(settingsRow?.preferences), [settingsRow])
  const latestScores = useMemo(() => collapseLatestScorecardsByPosition(scoreRows), [scoreRows])

  const overrideByPid = useMemo(() => {
    /** @type {Record<string, Record<string, unknown>>} */
    const m = {}
    for (const o of overrides) {
      const pid = Reflect.get(o, 'position_id')
      if (typeof pid === 'string') m[pid] = /** @type {Record<string, unknown>} */ (o)
    }
    return m
  }, [overrides])

  const totalMv = useMemo(() => satelliteHoldingsMvTotal(holdings), [holdings])

  const portfolio = useMemo(() => {
    /** @type {Record<string, Record<string, unknown>>} */
    const posByHolding = {}
    for (const p of positions) {
      const hk = Reflect.get(p, 'sharesight_holding_key')
      if (typeof hk === 'string' && hk) posByHolding[hk] = /** @type {Record<string, unknown>} */ (p)
    }

    const satHoldings = holdings.filter((h) => !isCashLikeHolding(/** @type {Record<string, unknown>} */ (h)))

    /** @type {{ rowKey: string, holding: Record<string, unknown>|null, position: Record<string, unknown>|null }[]} */
    const rows = []

    for (const h of satHoldings) {
      const ho = /** @type {Record<string, unknown>} */ (h)
      const hid = `${Reflect.get(ho, 'holding_external_id')}`
      rows.push({ rowKey: `h:${hid}`, holding: ho, position: posByHolding[hid] ?? null })
    }

    for (const p of positions) {
      const hk = Reflect.get(p, 'sharesight_holding_key')
      if (hk == null || hk === '') {
        rows.push({ rowKey: `p:${Reflect.get(p, 'id')}`, holding: null, position: /** @type {Record<string, unknown>} */ (p) })
      }
    }

    const allocEntries = positions.map((p) => {
      const id = `${Reflect.get(p, 'id')}`
      const sc = latestScores[id]
      const os = sc ? numOrNull(Reflect.get(sc, 'overall_score')) : null
      const ov = overrideByPid[id]
      const manualActive = Boolean(ov && Reflect.get(ov, 'active'))
      const manualPct = ov ? numOrNull(Reflect.get(ov, 'target_pct')) : null

      return {
        positionId: id,
        rawScore: os,
        manualTargetPct: manualActive && manualPct != null ? manualPct : null,
        manualActive: manualActive && manualPct != null && Number.isFinite(manualPct),
      }
    })

    const { targetsByPositionId, sumOverrides, remainderValid } = computeSatelliteTargetAllocations(allocEntries)

    /** @typedef {typeof rows[number] & {
     * ticker: string, displayName: string, synopsis: string, assetClass: string|null, overallScore: number|null,
     * tier: string|null, awaitingAnalysis: boolean, targetGuidancePct: number|null, actualWeightPct: number|null, driftPct: number|null,
     * mergedQuote: Record<string, unknown>|null, showAudPar: boolean, allocationOverridePct: number|null, allocationOverrideNote: string|null, positionId: string|null }} EnrichedCard */

    /** @type {EnrichedCard[]} */
    const cards = rows.map((r) => {
      const pos = r.position
      const h = r.holding

      const pid = pos ? `${Reflect.get(pos, 'id')}` : null

      const ticker =
        (pos && `${Reflect.get(pos, 'display_ticker') ?? Reflect.get(pos, 'fmp_symbol') ?? ''}`.trim()) ||
        `${Reflect.get(h ?? {}, 'instrument_symbol') ?? ''}`.trim() ||
        '—'

      const displayName =
        (pos && `${Reflect.get(pos, 'name') ?? ''}`.trim()) || `${Reflect.get(h ?? {}, 'instrument_name') ?? ''}`.trim() || ticker

      const yahoo = pos ? `${Reflect.get(pos, 'yahoo_symbol') ?? ''}`.trim() : ''
      const mergedQuote = findSatelliteQuote(ticker, yahoo, mergedRows)

      const sc = pid ? latestScores[pid] : null
      const overallScore = sc ? numOrNull(Reflect.get(sc, 'overall_score')) : null
      const awaiting = pos ? Boolean(Reflect.get(pos, 'awaiting_analysis')) : true
      const hasScorecard = Boolean(sc)
      const awaitingAnalysis = !pos || awaiting || !hasScorecard

      const tier = universalTierFromScore(overallScore)

      const payloadRaw = sc ? Reflect.get(sc, 'payload') : null
      const synopsis =
        extraField(pos, 'synopsis') ||
        (payloadRaw && typeof payloadRaw === 'object'
          ? `${Reflect.get(/** @type {Record<string, unknown>} */ (payloadRaw), 'thesis_summary') ?? ''}`.trim().slice(0, 240)
          : '') ||
        '—'

      const assetClass =
        extraField(pos, 'asset_class') ||
        (payloadRaw && typeof payloadRaw === 'object'
          ? `${Reflect.get(/** @type {Record<string, unknown>} */ (payloadRaw), 'instrument_type_guess') ?? ''}`.replace(/_/g, ' ')
          : '') ||
        null

      const mv = h ? numOrNull(Reflect.get(h, 'market_value')) : null
      const actualWeightPct = totalMv > 0 && mv != null ? (mv / totalMv) * 100 : null

      const targetGuidancePct = pid ? numOrNull(targetsByPositionId[pid]) : null

      const driftPct = actualWeightPct != null && targetGuidancePct != null ? actualWeightPct - targetGuidancePct : null

      const ov = pid ? overrideByPid[pid] : null
      const allocationOverridePct = ov && Reflect.get(ov, 'active') ? numOrNull(Reflect.get(ov, 'target_pct')) : null
      const allocationOverrideNote = ov && typeof Reflect.get(ov, 'note') === 'string' ? `${Reflect.get(ov, 'note')}` : null

      return {
        ...r,
        ticker,
        displayName,
        synopsis,
        assetClass,
        overallScore,
        tier,
        awaitingAnalysis,
        targetGuidancePct,
        actualWeightPct,
        driftPct,
        mergedQuote,
        showAudPar,
        allocationOverridePct,
        allocationOverrideNote,
        positionId: pid,
      }
    })

    return { cards, targetsByPositionId, sumOverrides, remainderValid, totalMv }
  }, [holdings, positions, latestScores, mergedRows, totalMv, overrideByPid, showAudPar])

  const setPrefShowAud = useCallback(
    async (v) => {
      if (!supabase) return
      const { data: ud } = await supabase.auth.getUser()
      const uid = ud.user?.id
      if (!uid) return

      const prev = settingsRow?.preferences && typeof settingsRow.preferences === 'object' ? { .../** @type {Record<string, unknown>} */ (settingsRow.preferences) } : {}
      const next = { ...prev, satellite_show_aud_parenthetical: Boolean(v) }

      const { error } = await supabase.from('user_settings').upsert(
        { user_id: uid, preferences: next, updated_at: new Date().toISOString() },
        { onConflict: 'user_id' },
      )

      if (error) throw error

      setSettingsRow((row) => ({ ...(row ?? {}), user_id: uid, preferences: next }))
    },
    [supabase, settingsRow],
  )

  const saveAllocationOverride = useCallback(
    async (positionId, targetPct, note) => {
      if (!supabase) return

      const { data: ud } = await supabase.auth.getUser()
      const uid = ud.user?.id
      if (!uid) return

      if (targetPct == null || !Number.isFinite(Number(targetPct))) {
        const { error } = await supabase
          .from('allocation_overrides')
          .update({ active: false, target_pct: null, updated_at: new Date().toISOString() })
          .eq('position_id', positionId)
          .eq('user_id', uid)

        if (error) throw error
      } else {
        await supabase
          .from('allocation_overrides')
          .update({ active: false, updated_at: new Date().toISOString() })
          .eq('position_id', positionId)
          .eq('user_id', uid)

        const row = {
          user_id: uid,
          position_id: positionId,
          target_pct: Number(targetPct),
          note: note ?? null,
          active: true,
          updated_at: new Date().toISOString(),
        }

        const { error } = await supabase.from('allocation_overrides').insert(row)

        if (error) throw error
      }

      await reload()
    },
    [supabase, reload],
  )

  return {
    loadError,
    settingsRow,
    showAudParenthetical: showAudPar,
    setPrefShowAud,
    cards: portfolio.cards,
    targetsByPositionId: portfolio.targetsByPositionId,
    sumOverrides: portfolio.sumOverrides,
    remainderValid: portfolio.remainderValid,
    totalMv: portfolio.totalMv,
    refresh: reload,
    saveAllocationOverride,
  }
}

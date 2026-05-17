import { useCallback, useEffect, useMemo, useState } from 'react'
import { useSharesightIntegration } from '../context/SharesightIntegrationContext.jsx'
import { useLivePrices } from '../context/LivePricesContext.jsx'
import { mergeUserPreferences } from '../lib/settings/mergeUserPreferences.js'
import { computeSatelliteTargetAllocations } from '../lib/satellite/allocationEngine.js'
import {
  closedDbIsNotTrueOr,
  isCashLikeHolding,
  isSharesightHoldingClosed,
  numOrNull,
} from '../lib/satellite/satelliteMerge.js'
import { universalTierFromScore } from '../lib/satellite/tierFromScore.js'
import { tickersLooselyEqual } from '../lib/dca/tickerMatch.js'
import { resolveSharesightHoldingQuantity, resolveSharesightHoldingValueAud } from '../lib/sharesight/normalizePayloads.js'
import { fmpInstrumentSymbol } from '../lib/market/fmpInstrumentSymbol.js'

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
    if (isSharesightHoldingClosed(row)) continue
    const mv = numOrNull(Reflect.get(row, 'market_value'))
    if (mv != null) t += mv
  }
  return t
}

/** @param {unknown} value @param {unknown} currency @param {Record<string, { aud_per_unit?: number }>} fxByCurrency */
function nativeValueToAud(value, currency, fxByCurrency) {
  const native = numOrNull(value)
  if (native == null) return null

  const cur = `${currency ?? ''}`.trim().toUpperCase()
  if (!cur) return null
  if (cur === 'AUD') return native

  const rate = fxByCurrency[cur]?.aud_per_unit

  return typeof rate === 'number' && Number.isFinite(rate) ? native * rate : null
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

/**
 * @param {Record<string, unknown>|null} pos
 * @param {Record<string, unknown>|null|undefined} h
 */
function exchangeGroupForRow(pos, h) {
  const ho = /** @type {Record<string, unknown>|null} */ (h)

  if (ho && isCashLikeHolding(ho)) return 'Cash Accounts'

  const inst = ho ? `${Reflect.get(ho, 'instrument_symbol') ?? ''}`.trim() : ''

  if (/^ASX:/i.test(inst)) return 'ASX'

  const ex = pos ? `${Reflect.get(pos, 'exchange_short_name') ?? ''}`.trim().toUpperCase() : ''

  if (ex === 'ASX' || ex === 'AU' || ex === 'AX') return 'ASX'

  if (ex === 'LSE' || ex === 'LON' || ex === 'L') return 'LSE'

  if (ex) return ex

  const yahoo = pos ? `${Reflect.get(pos, 'yahoo_symbol') ?? ''}`.trim() : ''

  if (/\.AX$/i.test(yahoo)) return 'ASX'

  if (/\.L$/i.test(yahoo)) return 'LSE'

  return 'Other'
}

/** @param {Record<string, unknown>|null|undefined} h */
function valuationSnapshot(h) {
  const raw = h && Reflect.get(h, 'raw')

  if (!raw || typeof raw !== 'object') return null

  const valuation = Reflect.get(/** @type {Record<string, unknown>} */ (raw), 'sharesight_valuation_holding')

  return valuation && typeof valuation === 'object' ? /** @type {Record<string, unknown>} */ (valuation) : null
}

/** @param {Record<string, unknown>|null|undefined} h */
function sharesightExchangeDisplay(h) {
  const direct = h ? `${Reflect.get(h, 'exchange_display') ?? ''}`.trim() : ''
  if (direct) return direct

  const valuation = valuationSnapshot(h)

  return valuation ? `${Reflect.get(valuation, 'exchange_display') ?? ''}`.trim() : ''
}

/**
 * @param {Record<string, unknown>|null} pos
 * @param {Record<string, unknown>|null|undefined} h
 */
function fmpDisplayAndExchange(pos, h) {
  const ho = /** @type {Record<string, unknown>|null} */ (h)
  const inst = ho ? `${Reflect.get(ho, 'instrument_symbol') ?? ''}`.trim() : ''
  const inferredExchange = /^ASX:/i.test(inst) ? 'ASX' : /^LSE:/i.test(inst) ? 'LSE' : ''
  const exchangeDisplay = sharesightExchangeDisplay(ho)

  if (pos) {
    return {
      fmp: `${Reflect.get(pos, 'fmp_symbol') ?? ''}`.trim(),
      exchangeShort: `${Reflect.get(pos, 'exchange_short_name') ?? ''}`.trim() || exchangeDisplay || '—',
    }
  }

  const m = inst.match(/^ASX:\s*(.+)$/i)

  if (m) return { fmp: `${m[1] ?? ''}`.trim(), exchangeShort: exchangeDisplay || 'ASX' }

  const m2 = inst.match(/^LSE:\s*(.+)$/i)

  if (m2) return { fmp: `${m2[1] ?? ''}`.trim(), exchangeShort: exchangeDisplay || 'LSE' }

  return { fmp: inst.replace(/^=/, ''), exchangeShort: exchangeDisplay || inferredExchange || '—' }
}

export function useSatellitePortfolio() {
  const { supabase, userPresent, holdingsCount } = useSharesightIntegration()
  const { mergedRows, fxByCurrency } = useLivePrices()

  const [holdings, setHoldings] = useState(/** @type {Record<string, unknown>[]} */ ([]))
  const [positions, setPositions] = useState(/** @type {Record<string, unknown>[]} */ ([]))
  const [overrides, setOverrides] = useState(/** @type {Record<string, unknown>[]} */ ([]))
  const [settingsRow, setSettingsRow] = useState(/** @type {Record<string, unknown>|null} */ (null))
  const [scoreRows, setScoreRows] = useState(/** @type {Record<string, unknown>[]} */ ([]))
  const [loadError, setLoadError] = useState(/** @type {string|null} */ (null))
  const [satelliteFetching, setSatelliteFetching] = useState(false)
  const [satelliteHydrated, setSatelliteHydrated] = useState(false)

  const reload = useCallback(async () => {
    if (!supabase) return

    setSatelliteFetching(true)

    try {
      const { data: ud } = await supabase.auth.getUser()
      const uid = ud.user?.id
      if (!uid) return

      const [hRes, pRes, oRes, sRes] = await Promise.all([
      supabase.from('sharesight_holdings').select('*').eq('user_id', uid).eq('portfolio_role', 'satellite').order('instrument_symbol', { ascending: true }),
      supabase
        .from('positions')
        .select('*')
        .eq('user_id', uid)
        .eq('kind', 'satellite')
        .eq('archived', false)
        .or(closedDbIsNotTrueOr)
        .order('display_ticker', { ascending: true }),
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
    } finally {
      setSatelliteFetching(false)
      setSatelliteHydrated(true)
    }
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
        setSatelliteHydrated(false)
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

  const mergedPrefs = useMemo(() => mergeUserPreferences(settingsRow?.preferences), [settingsRow?.preferences])

  const showAudPar = useMemo(
    () => Reflect.get(mergedPrefs, 'satellite_show_aud_parenthetical') === true,
    [mergedPrefs],
  )

  const allocRuleOpts = useMemo(() => {
    const r = Reflect.get(mergedPrefs, 'satellite_allocation_rules')

    if (!r || typeof r !== 'object') return undefined

    const o = /** @type {Record<string, unknown>} */ (r)

    const ht = Number(o.haircut_threshold)

    const hm = Number(o.haircut_multiplier)

    /** @type {{ haircut_threshold?: number, haircut_multiplier?: number }} */

    const out = {}

    if (Number.isFinite(ht)) Reflect.set(out, 'haircut_threshold', ht)

    if (Number.isFinite(hm)) Reflect.set(out, 'haircut_multiplier', hm)

    return Object.keys(out).length ? out : undefined
  }, [mergedPrefs])

  const tierOpts = useMemo(() => {
    const r = Reflect.get(mergedPrefs, 'satellite_allocation_rules')

    const s = Reflect.get(mergedPrefs, 'scoring')

    const buy = r && typeof r === 'object' ? Number(Reflect.get(/** @type {Record<string, unknown>} */ (r), 'buy_zone_unlock_threshold')) : Number.NaN

    const hi = s && typeof s === 'object' ? Number(Reflect.get(/** @type {Record<string, unknown>} */ (s), 'high_conviction_tier_pct')) : Number.NaN

    const rebal = r && typeof r === 'object' ? Number(Reflect.get(/** @type {Record<string, unknown>} */ (r), 'rebalance_trigger_pct')) : Number.NaN

    return {
      buyZoneUnlockThreshold: Number.isFinite(buy) ? buy : 65,
      highConvictionThreshold: Number.isFinite(hi) ? hi : 78,
      rebalanceTriggerPct: Number.isFinite(rebal) ? rebal : 10,
    }
  }, [mergedPrefs])

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

    const nonCashHoldings = holdings.filter(
      (h) => !isCashLikeHolding(/** @type {Record<string, unknown>} */ (h)),
    )

    const cashHoldings = holdings.filter((h) => isCashLikeHolding(/** @type {Record<string, unknown>} */ (h)))

    /** @type {{ rowKey: string, holding: Record<string, unknown>|null, position: Record<string, unknown>|null }[]} */
    const tableRows = []

    for (const h of nonCashHoldings) {
      const ho = /** @type {Record<string, unknown>} */ (h)
      const hid = `${Reflect.get(ho, 'holding_external_id')}`
      tableRows.push({ rowKey: `h:${hid}`, holding: ho, position: posByHolding[hid] ?? null })
    }

    for (const h of cashHoldings) {
      const ho = /** @type {Record<string, unknown>} */ (h)
      const hid = `${Reflect.get(ho, 'holding_external_id')}`
      tableRows.push({ rowKey: `h:${hid}`, holding: ho, position: posByHolding[hid] ?? null })
    }

    for (const p of positions) {
      const hk = Reflect.get(p, 'sharesight_holding_key')
      if (hk == null || hk === '') {
        tableRows.push({ rowKey: `p:${Reflect.get(p, 'id')}`, holding: null, position: /** @type {Record<string, unknown>} */ (p) })
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

    const { targetsByPositionId, sumOverrides, remainderValid } = computeSatelliteTargetAllocations(allocEntries, allocRuleOpts)

    /** @typedef {typeof tableRows[number] & {
     * ticker: string, displayName: string, synopsis: string, assetClass: string|null, overallScore: number|null,
     * tier: string|null, awaitingAnalysis: boolean, hasScorecard: boolean, targetGuidancePct: number|null, actualWeightPct: number|null, driftPct: number|null,
     * mergedQuote: Record<string, unknown>|null, showAudPar: boolean, allocationOverridePct: number|null, allocationOverrideNote: string|null, positionId: string|null }} EnrichedCard */

    /** @type {EnrichedCard[]} */
    const baseCards = tableRows.map((r) => {
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

      const tier = universalTierFromScore(overallScore, {
        buyZoneUnlockThreshold: tierOpts.buyZoneUnlockThreshold,
        highConvictionThreshold: tierOpts.highConvictionThreshold,
      })

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
      const ho = /** @type {Record<string, unknown>|null} */ (h)
      const isClosedRow =
        Boolean(ho && isSharesightHoldingClosed(ho)) || Boolean(pos && Reflect.get(pos, 'closed') === true)
      const isCashRow = Boolean(ho && isCashLikeHolding(ho))
      const actualWeightMvDen = !isClosedRow && !isCashRow && totalMv > 0 && mv != null ? (mv / totalMv) * 100 : null

      const targetGuidancePct = pid ? numOrNull(targetsByPositionId[pid]) : null

      const driftPct = actualWeightMvDen != null && targetGuidancePct != null ? actualWeightMvDen - targetGuidancePct : null

      const rebalanceSuggested =
        driftPct != null && Number.isFinite(driftPct) && Math.abs(driftPct) >= tierOpts.rebalanceTriggerPct

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
        hasScorecard,
        targetGuidancePct,
        actualWeightPct: actualWeightMvDen,
        driftPct,
        rebalanceSuggested,
        mergedQuote,
        showAudPar,
        allocationOverridePct,
        allocationOverrideNote,
        positionId: pid,
      }
    })

    /** @type {(EnrichedCard & Record<string, unknown>)[]} */
    const tableCards = baseCards.map((c) => {
      const pos = c.position
      const h = c.holding
      const ho = /** @type {Record<string, unknown>|null} */ (h)

      const rowClosed =
        Boolean(ho && isSharesightHoldingClosed(ho)) || Boolean(pos && Reflect.get(pos, 'closed') === true)

      const isCashLikeRow = Boolean(ho && isCashLikeHolding(ho))

      const { fmp: fmpSymbol, exchangeShort } = fmpDisplayAndExchange(pos, h)

      const qty = ho ? resolveSharesightHoldingQuantity(ho) : null

      const sharesightValueAud = ho ? resolveSharesightHoldingValueAud(ho) : null
      const nativeHoldingValue = ho ? Reflect.get(ho, 'market_value') : null
      const nativeCurrency = ho ? Reflect.get(ho, 'currency') : null
      const fxCurrency = `${nativeCurrency ?? ''}`.trim().toUpperCase()
      const fxRate = fxByCurrency[fxCurrency]?.aud_per_unit
      const marketValueNative = numOrNull(nativeHoldingValue)
      const fxValueAud = nativeValueToAud(
        nativeHoldingValue,
        nativeCurrency,
        /** @type {Record<string, { aud_per_unit?: number }>} */ (fxByCurrency),
      )
      const valueAud = sharesightValueAud ?? fxValueAud

      if (sharesightValueAud == null && fxValueAud != null && fxCurrency !== 'AUD') {
        console.log('[satellite-value-debug]', {
          ticker: c.ticker,
          currency: fxCurrency,
          sharesight_value_aud: sharesightValueAud,
          market_value_native: marketValueNative,
          fx_rate: fxRate,
          calculated_value_aud:
            marketValueNative != null && typeof fxRate === 'number' && Number.isFinite(fxRate)
              ? marketValueNative * fxRate
              : null,
        })
      }

      const capitalGainHo = ho ? numOrNull(Reflect.get(ho, 'unrealized_gain_loss')) : null
      const cost = valueAud != null && capitalGainHo != null ? valueAud - capitalGainHo : null
      const payoutGainAud = ho ? numOrNull(Reflect.get(ho, 'payout_gain')) : null
      const totalGainAud = ho ? numOrNull(Reflect.get(ho, 'total_gain')) : null
      const capitalGainPercent = ho ? numOrNull(Reflect.get(ho, 'capital_gain_percent')) : null
      const totalGainPercent = ho ? numOrNull(Reflect.get(ho, 'total_gain_percent')) : null
      const incomePct =
        cost != null && cost !== 0 && payoutGainAud != null && Number.isFinite(payoutGainAud)
          ? (payoutGainAud / cost) * 100
          : null

      const capitalGainAud =
        capitalGainHo ??
        (valueAud != null && cost != null && Number.isFinite(valueAud) && Number.isFinite(cost) ? valueAud - cost : null)

      const q = c.mergedQuote

      const quoteCurrency =
        (q && typeof Reflect.get(q, 'quote_currency') === 'string' && `${Reflect.get(q, 'quote_currency')}`.trim()) ||
        (pos && `${Reflect.get(pos, 'currency') ?? ''}`.trim()) ||
        (ho && `${Reflect.get(ho, 'currency') ?? ''}`.trim()) ||
        ''

      const fmpProfileSymbol = fmpInstrumentSymbol(fmpSymbol, exchangeShort)

      const exchangeGroup = exchangeGroupForRow(pos, h)
      const exchange = (pos && `${Reflect.get(pos, 'exchange_short_name') ?? ''}`.trim()) || '—'

      return {
        ...c,
        rowClosed,
        isCashLike: isCashLikeRow,
        exchange,
        exchangeGroup,
        fmpSymbol,
        exchangeShort,
        fmpProfileSymbol,
        quantity: qty,
        costBasis: cost,
        valueAud,
        capitalGainAud,
        payoutGainAud,
        incomePct,
        totalGainAud,
        returnPct: capitalGainPercent,
        totalReturnPct: totalGainPercent,
        quoteCurrency,
      }
    })

    const cards = tableCards.filter((c) => !c.rowClosed && !c.isCashLike)

    return { cards, tableCards, targetsByPositionId, sumOverrides, remainderValid, totalMv }
  }, [holdings, positions, latestScores, mergedRows, fxByCurrency, totalMv, overrideByPid, showAudPar, allocRuleOpts, tierOpts])

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

  const savePositionType = useCallback(
    async (positionId, nextType) => {
      if (!supabase || !positionId) return

      const { data: ud } = await supabase.auth.getUser()
      const uid = ud.user?.id
      if (!uid) return

      const current = positions.find((p) => `${Reflect.get(p, 'id')}` === `${positionId}`)
      const prevExtra =
        current && Reflect.get(current, 'extra') && typeof Reflect.get(current, 'extra') === 'object'
          ? { .../** @type {Record<string, unknown>} */ (Reflect.get(current, 'extra')) }
          : {}
      const next = `${nextType ?? ''}`.trim()

      if (next) prevExtra.asset_class = next
      else delete prevExtra.asset_class

      const { error } = await supabase
        .from('positions')
        .update({ extra: prevExtra, updated_at: new Date().toISOString() })
        .eq('id', positionId)
        .eq('user_id', uid)

      if (error) throw error

      setPositions((rows) =>
        rows.map((row) =>
          `${Reflect.get(row, 'id')}` === `${positionId}`
            ? { ...row, extra: prevExtra }
            : row,
        ),
      )
    },
    [positions, supabase],
  )

  const hasRecoverableSatelliteData = positions.length > 0 || holdings.length > 0

  return {
    loadError,
    satelliteFetching,
    satelliteHydrated,
    hasRecoverableSatelliteData,

    settingsRow,
    showAudParenthetical: showAudPar,
    setPrefShowAud,
    cards: portfolio.cards,
    tableCards: portfolio.tableCards,
    targetsByPositionId: portfolio.targetsByPositionId,
    sumOverrides: portfolio.sumOverrides,
    remainderValid: portfolio.remainderValid,
    totalMv: portfolio.totalMv,
    refresh: reload,
    saveAllocationOverride,
    savePositionType,
  }
}

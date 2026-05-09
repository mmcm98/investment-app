import { useCallback, useEffect, useMemo, useState } from 'react'

import { useSharesightIntegration } from '../context/SharesightIntegrationContext.jsx'

import { satelliteShowAudParenthetical } from './useSatellitePortfolio.js'

/**
 * @param {string|null|undefined} watchlistItemId
 */

export function useWatchlistDetail(watchlistItemId) {
  const { supabase, userPresent } = useSharesightIntegration()

  const [reloadToken, setReloadToken] = useState(0)

  const refreshDetail = useCallback(() => {
    setReloadToken((n) => n + 1)
  }, [])

  const [watchlistRow, setWatchlistRow] = useState(/** @type {Record<string, unknown>|null} */ (null))
  const [versionManifest, setVersionManifest] = useState(/** @type {Record<string, unknown>[]} */ ([]))
  /** @type {[string|null, import('react').Dispatch<import('react').SetStateAction<string|null>>]} */

  const [selectedVersionId, setSelectedVersionId] = useState(null)
  const [scorecardFull, setScorecardFull] = useState(/** @type {Record<string, unknown>|null} */ (null))
  const [researchFull, setResearchFull] = useState(/** @type {Record<string, unknown>|null} */ (null))
  const [settingsRow, setSettingsRow] = useState(/** @type {Record<string, unknown>|null} */ (null))
  const [loadError, setLoadError] = useState(/** @type {string|null} */ (null))
  const [versionLoadError, setVersionLoadError] = useState(/** @type {string|null} */ (null))

  useEffect(() => {
    queueMicrotask(() => {
      setSelectedVersionId(null)
      setScorecardFull(null)
      setResearchFull(null)
      setVersionManifest([])
      setLoadError(null)
      setWatchlistRow(null)
    })

    if (!supabase || !userPresent || !watchlistItemId) return undefined

    let cancelled = false

    void (async () => {
      try {
        const { data: ud } = await supabase.auth.getUser()
        const uid = ud.user?.id
        if (!uid) return

        const [{ data: wl, error: wlErr }, { data: mans, error: mErr }, { data: sett, error: sErr }] = await Promise.all([
          supabase.from('watchlist_items').select('*').eq('id', watchlistItemId).eq('user_id', uid).maybeSingle(),
          supabase
            .from('scorecard_versions')
            .select('id, version_number, overall_score, framework, generated_at')
            .eq('watchlist_item_id', watchlistItemId)
            .eq('user_id', uid)
            .order('version_number', { ascending: false }),
          supabase.from('user_settings').select('preferences').eq('user_id', uid).maybeSingle(),
        ])

        if (wlErr) throw wlErr
        if (mErr) throw mErr
        if (sErr) throw sErr

        if (cancelled) return

        setWatchlistRow(wl ? /** @type {Record<string, unknown>} */ (wl) : null)

        const activeRows = /** @type {Record<string, unknown>[]} */ (mans ?? [])

        setVersionManifest(activeRows)
        setSettingsRow(sett ? /** @type {Record<string, unknown>} */ (sett) : null)

        const head = activeRows[0]
        const headId = head && typeof Reflect.get(head, 'id') === 'string' ? `${Reflect.get(head, 'id')}` : null

        if (headId) {
          setSelectedVersionId(headId)
          const { data: sc, error: scErr } = await supabase.from('scorecard_versions').select('*').eq('id', headId).maybeSingle()
          if (scErr) throw scErr

          setScorecardFull(sc ? /** @type {Record<string, unknown>} */ (sc) : null)

          const { data: rp, error: rpErr } = await supabase.from('research_paper_versions').select('*').eq('scorecard_version_id', headId).maybeSingle()
          if (rpErr) throw rpErr
          setResearchFull(rp ? /** @type {Record<string, unknown>} */ (rp) : null)
        }
      } catch (e) {
        if (!cancelled) setLoadError(e instanceof Error ? e.message : String(e))
      }
    })()

    return () => {
      cancelled = true
    }
  }, [supabase, userPresent, watchlistItemId, reloadToken])

  const loadVersion = useCallback(
    async (versionUuid) => {
      if (!supabase || !versionUuid) return

      setVersionLoadError(null)

      try {
        const { data: sc, error: scErr } = await supabase.from('scorecard_versions').select('*').eq('id', versionUuid).maybeSingle()

        if (scErr) throw scErr

        setScorecardFull(sc ? /** @type {Record<string, unknown>} */ (sc) : null)

        const { data: rp, error: rpErr } = await supabase.from('research_paper_versions').select('*').eq('scorecard_version_id', versionUuid).maybeSingle()

        if (rpErr) throw rpErr

        setResearchFull(rp ? /** @type {Record<string, unknown>} */ (rp) : null)
        setSelectedVersionId(versionUuid)
      } catch (e) {
        setVersionLoadError(e instanceof Error ? e.message : String(e))
      }
    },
    [supabase],
  )

  const showAudParen = useMemo(() => satelliteShowAudParenthetical(settingsRow?.preferences), [settingsRow])

  return {
    watchlistRow,
    versionManifest,
    selectedVersionId,
    selectScorecardVersion: loadVersion,
    scorecardFull,
    researchFull,
    showAudParenthetical: showAudParen,
    loadError,
    versionLoadError,
    refreshDetail,
  }
}

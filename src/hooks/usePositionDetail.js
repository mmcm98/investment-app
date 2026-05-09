import { useCallback, useEffect, useMemo, useState } from 'react'
import { useSharesightIntegration } from '../context/SharesightIntegrationContext.jsx'
import { satelliteShowAudParenthetical } from './useSatellitePortfolio.js'

/**
 * Fetch current scorecard-only on mount; heavier rows when user selects a version.
 *
 * @param {string|null|undefined} positionId
 */

export function usePositionDetail(positionId) {
  const { supabase, userPresent } = useSharesightIntegration()

  const [reloadToken, setReloadToken] = useState(0)

  const refreshDetail = useCallback(() => {
    setReloadToken((n) => n + 1)
  }, [])

  const [position, setPosition] = useState(/** @type {Record<string, unknown>|null} */ (null))
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
      setPosition(null)
    })

    if (!supabase || !userPresent || !positionId) return undefined

    let cancelled = false

    void (async () => {
      try {
        const { data: ud } = await supabase.auth.getUser()
        const uid = ud.user?.id
        if (!uid) return

        const [{ data: pos, error: pErr }, { data: mans, error: mErr }, { data: sett, error: sErr }] = await Promise.all([
          supabase.from('positions').select('*').eq('id', positionId).eq('user_id', uid).maybeSingle(),
          supabase
            .from('scorecard_versions')
            .select('id, version_number, overall_score, framework, generated_at')
            .eq('position_id', positionId)
            .order('version_number', { ascending: false }),
          supabase.from('user_settings').select('preferences').eq('user_id', uid).maybeSingle(),
        ])

        if (pErr) throw pErr
        if (mErr) throw mErr
        if (sErr) throw sErr

        if (cancelled) return

        setPosition(pos ? /** @type {Record<string, unknown>} */ (pos) : null)
        setVersionManifest(/** @type {Record<string, unknown>[]} */ (mans ?? []))
        setSettingsRow(sett ? /** @type {Record<string, unknown>} */ (sett) : null)

        const head = (mans ?? [])[0]
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
  }, [supabase, userPresent, positionId, reloadToken])

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
    position,
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

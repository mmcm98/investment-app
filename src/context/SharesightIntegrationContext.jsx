/* eslint-disable react-refresh/only-export-components -- Provider + colocated hook export */
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import { createSupabaseBrowserClient } from '../lib/supabaseClient.js'
import { fetchSharesightOAuthRow } from '../lib/sharesight/oauthCredentialsRepository.js'
import { beginSharesightAuthorizationCodeFlow } from '../lib/sharesight/oauth.js'
import { syncSharesightPortfolios } from '../lib/sharesight/syncSharesightPortfolios.js'

/** @typedef {import('../lib/sharesight/oauthCredentialsRepository.js').SharesightOAuthRow | null} SharesightOAuthRow */

/** @type {React.Context<SharesightIntegrationValue | null>} */
const SharesightIntegrationContext = createContext(null)

/** @typedef {{ children: import('react').ReactNode }} Props */

/** @typedef {{
 *   supabaseConfigured: boolean
 *   userPresent: boolean
 *   oauthRow: SharesightOAuthRow
 *   reconnectRequired: boolean
 *   lastSuccessfulSyncAt: string | null
 *   lastSyncAttemptAt: string | null
 *   lastSyncError: string | null
 *   holdingsCount: number | null
 *   isSyncing: boolean
 *   surfaceError: string | null
 *   isStale: boolean
 *   connectSharesight: () => void
 *   refreshSharesightNow: () => Promise<void>
 *   reloadLocalSnapshot: () => Promise<void>
 * }} SharesightIntegrationValue */

function formatUnknownError(error) {
  if (error instanceof Error) return error.message

  if (typeof error === 'string') return error

  try {
    return JSON.stringify(error)
  } catch {
    return 'Unknown error'
  }
}

/** @param {Props} props */
export function SharesightIntegrationProvider({ children }) {
  const supabase = useMemo(() => createSupabaseBrowserClient(), [])

  /** @type {import('@supabase/supabase-js').Session | null} */
  const [session, setSession] = useState(null)

  /** @type {SharesightOAuthRow} */
  const [oauthRow, setOauthRow] = useState(null)

  const [holdingsCount, setHoldingsCount] = useState(null)
  const [isSyncing, setIsSyncing] = useState(false)
  const [surfaceError, setSurfaceError] = useState(null)

  /** Used purely to re-evaluate staleness banners without relying on impure clocks during render */
  const [freshnessClock, setFreshnessClock] = useState(() => Date.now())

  const syncInFlightRef = useRef(false)
  const didInitialSyncRef = useRef(false)

  useEffect(() => {
    if (!oauthRow) {
      didInitialSyncRef.current = false
    }
  }, [oauthRow])

  const supabaseConfigured = Boolean(supabase)
  const userPresent = Boolean(session?.user?.id)

  const reconnectRequired = Boolean(oauthRow?.reconnect_required)

  const reloadLocalSnapshot = useCallback(async () => {
    if (!supabase) return

    const { data: row, error: rowErr } = await fetchSharesightOAuthRow(supabase)
    if (rowErr) {
      setSurfaceError(formatUnknownError(rowErr))

      return
    }

    setOauthRow(row)

    if (!row) {
      setHoldingsCount(null)

      return
    }

    const { count, error: countErr } = await supabase
      .from('sharesight_holdings')
      .select('*', { count: 'exact', head: true })

    if (countErr) {
      // Keep last known count; surface a non-fatal warning
      setSurfaceError((prev) => prev ?? formatUnknownError(countErr))

      return
    }

    setHoldingsCount(typeof count === 'number' ? count : 0)
  }, [supabase])

  useEffect(() => {
    if (!supabase) return undefined

    let mounted = true

    void supabase.auth.getSession().then(({ data }) => {
      if (!mounted) return

      const nextSession = data.session ?? null

      setSession(nextSession)

      if (!nextSession?.user?.id) {
        setOauthRow(null)
        setHoldingsCount(null)
        didInitialSyncRef.current = false

        return
      }

      void reloadLocalSnapshot()
    })

    const { data: sub } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      const normalized = nextSession ?? null

      setSession(normalized)

      if (!normalized?.user?.id) {
        setOauthRow(null)
        setHoldingsCount(null)
        didInitialSyncRef.current = false

        return
      }

      void reloadLocalSnapshot()
    })

    return () => {
      mounted = false
      sub.subscription.unsubscribe()
    }
  }, [supabase, reloadLocalSnapshot])

  useEffect(() => {
    const id = window.setInterval(() => setFreshnessClock(Date.now()), 30_000)

    return () => window.clearInterval(id)
  }, [])

  const runSync = useCallback(
    async (/** @type {'app_load'|'interval'|'manual'} */ trigger) => {
      if (!supabase || !userPresent) return

      if (reconnectRequired) {
        setSurfaceError('Sharesight sync is suspended until you reconnect OAuth.')

        return
      }

      if (syncInFlightRef.current) return

      syncInFlightRef.current = true
      setIsSyncing(true)
      setSurfaceError(null)

      try {
        await syncSharesightPortfolios(supabase, { trigger })
        await reloadLocalSnapshot()
      } catch (error) {
        setSurfaceError(formatUnknownError(error))
        await reloadLocalSnapshot()
      } finally {
        syncInFlightRef.current = false
        setIsSyncing(false)
        setFreshnessClock(Date.now())
      }
    },
    [supabase, userPresent, reconnectRequired, reloadLocalSnapshot],
  )

  useEffect(() => {
    if (!supabase || !userPresent) return undefined
    if (!oauthRow) return undefined
    if (reconnectRequired) return undefined

    if (didInitialSyncRef.current) return undefined

    didInitialSyncRef.current = true

    void runSync('app_load')

    return undefined
  }, [supabase, userPresent, oauthRow, reconnectRequired, runSync])

  useEffect(() => {
    if (!supabase || !userPresent) return undefined
    if (!oauthRow) return undefined
    if (reconnectRequired) return undefined

    const id = window.setInterval(() => {
      void runSync('interval')
    }, 30 * 60 * 1000)

    return () => window.clearInterval(id)
  }, [supabase, userPresent, oauthRow, reconnectRequired, runSync])

  const connectSharesight = useCallback(() => {
    setSurfaceError(null)

    try {
      const { authorizeUrl } = beginSharesightAuthorizationCodeFlow()

      window.location.assign(authorizeUrl)
    } catch (error) {
      setSurfaceError(formatUnknownError(error))
    }
  }, [])

  const refreshSharesightNow = useCallback(async () => {
    await runSync('manual')
  }, [runSync])

  /** @type {SharesightIntegrationValue} */
  const value = useMemo(() => {
    const lastSuccessMs = oauthRow?.last_successful_sync_at ? Date.parse(oauthRow.last_successful_sync_at) : NaN
    const isStale =
      Number.isFinite(lastSuccessMs) && freshnessClock - lastSuccessMs > 31 * 60 * 1000

    return {
      supabaseConfigured,
      userPresent,
      oauthRow,
      reconnectRequired,
      lastSuccessfulSyncAt: oauthRow?.last_successful_sync_at ?? null,
      lastSyncAttemptAt: oauthRow?.last_sync_attempt_at ?? null,
      lastSyncError: oauthRow?.last_sync_error ?? null,
      holdingsCount,
      isSyncing,
      surfaceError,
      isStale,
      connectSharesight,
      refreshSharesightNow,
      reloadLocalSnapshot,
    }
  }, [
    connectSharesight,
    freshnessClock,
    holdingsCount,
    isSyncing,
    oauthRow,
    reconnectRequired,
    refreshSharesightNow,
    reloadLocalSnapshot,
    surfaceError,
    supabaseConfigured,
    userPresent,
  ])

  return <SharesightIntegrationContext.Provider value={value}>{children}</SharesightIntegrationContext.Provider>
}

/** @returns {SharesightIntegrationValue} */
export function useSharesightIntegration() {
  const ctx = useContext(SharesightIntegrationContext)

  if (!ctx) {
    throw new Error('useSharesightIntegration must be used within SharesightIntegrationProvider')
  }

  return ctx
}

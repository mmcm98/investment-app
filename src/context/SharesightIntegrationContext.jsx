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
import { ensureSharesightAccessToken } from '../lib/sharesight/tokenSession.js'

/** @typedef {import('../lib/sharesight/oauthCredentialsRepository.js').SharesightOAuthRow | null} SharesightOAuthRow */

/** @type {React.Context<SharesightIntegrationValue | null>} */
const SharesightIntegrationContext = createContext(null)

/** @typedef {{ children: import('react').ReactNode }} Props */

/** @typedef {import('@supabase/supabase-js').SupabaseClient | null} SupabaseClientMaybe */

/** @typedef {{
 *   supabase: SupabaseClientMaybe
 *   supabaseConfigured: boolean
 *   authReady: boolean
 *   userPresent: boolean
 *   oauthRow: SharesightOAuthRow
 *   reconnectRequired: boolean
 *   lastSuccessfulSyncAt: string | null
 *   lastSyncAttemptAt: string | null
 *   lastSyncError: string | null
 *   holdingsCount: number | null
 *   isSyncing: boolean
 *   syncPhaseLabel: string | null
 *   surfaceError: string | null
 *   isStale: boolean
 *   connectSharesight: () => void
 *   refreshSharesightNow: () => Promise<void>
 *   reloadLocalSnapshot: () => Promise<void>
 *   signOut: () => Promise<void>
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

  const [authReady, setAuthReady] = useState(false)

  /** @type {import('@supabase/supabase-js').Session | null} */
  const [session, setSession] = useState(null)

  /** @type {SharesightOAuthRow} */
  const [oauthRow, setOauthRow] = useState(null)

  const [holdingsCount, setHoldingsCount] = useState(null)
  const [isSyncing, setIsSyncing] = useState(false)
  const [syncPhaseLabel, setSyncPhaseLabel] = useState(/** @type {string | null} */ (null))
  const [surfaceError, setSurfaceError] = useState(null)

  /** Used purely to re-evaluate staleness banners without relying on impure clocks during render */
  const [freshnessClock, setFreshnessClock] = useState(() => Date.now())

  const syncInFlightRef = useRef(false)
  const didInitialSyncRef = useRef(false)

  /** @type {React.MutableRefObject<boolean | null>} */
  const prevReconnectRequiredRef = useRef(null)

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

    void supabase.auth
      .getSession()
      .then(({ data }) => {
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
      .finally(() => {
        if (!mounted) return

        setAuthReady(true)
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
      setSyncPhaseLabel(null)
      setSurfaceError(null)

      try {
        await syncSharesightPortfolios(supabase, {
          trigger,

          onProgress: (label) => setSyncPhaseLabel(label),
        })

        setSyncPhaseLabel('Refreshing local data…')

        await reloadLocalSnapshot()
      } catch (error) {
        setSurfaceError(formatUnknownError(error))

        await reloadLocalSnapshot()
      } finally {
        syncInFlightRef.current = false
        setIsSyncing(false)
        setSyncPhaseLabel(null)
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

  /** Proactively rotate credentials before expiry (not only on sync / 401). */
  useEffect(() => {
    if (!supabase || !userPresent) return undefined
    if (!oauthRow) return undefined
    if (reconnectRequired) return undefined

    const id = window.setInterval(() => {
      void (async () => {
        try {
          await ensureSharesightAccessToken(supabase)
        } catch {
          // Token row / refresh errors update `reconnect_required` server-side; always resync local snapshot.
        } finally {
          await reloadLocalSnapshot()
        }
      })()
    }, 4 * 60 * 1000)

    return () => window.clearInterval(id)
  }, [supabase, userPresent, oauthRow, reconnectRequired, reloadLocalSnapshot])

  /** After a successful OAuth reconnect, run a fresh sync so the banner clears and holdings update. */
  useEffect(() => {
    const prev = prevReconnectRequiredRef.current

    if (prev === null) {
      prevReconnectRequiredRef.current = reconnectRequired

      return undefined
    }

    if (prev === true && reconnectRequired === false && supabase && userPresent && oauthRow) {
      void runSync('app_load')
    }

    prevReconnectRequiredRef.current = reconnectRequired

    return undefined
  }, [reconnectRequired, oauthRow, runSync, supabase, userPresent])

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

  const signOut = useCallback(async () => {
    if (!supabase) return

    setSurfaceError(null)

    await supabase.auth.signOut()
  }, [supabase])

  /** @type {SharesightIntegrationValue} */
  const value = useMemo(() => {
    const lastSuccessMs = oauthRow?.last_successful_sync_at ? Date.parse(oauthRow.last_successful_sync_at) : NaN
    const isStale =
      Number.isFinite(lastSuccessMs) && freshnessClock - lastSuccessMs > 31 * 60 * 1000

    return {
      supabase,
      supabaseConfigured,
      authReady,
      userPresent,
      oauthRow,
      reconnectRequired,
      lastSuccessfulSyncAt: oauthRow?.last_successful_sync_at ?? null,
      lastSyncAttemptAt: oauthRow?.last_sync_attempt_at ?? null,
      lastSyncError: oauthRow?.last_sync_error ?? null,
      holdingsCount,
      isSyncing,
      syncPhaseLabel,
      surfaceError,
      isStale,
      connectSharesight,
      refreshSharesightNow,
      reloadLocalSnapshot,
      signOut,
    }
  }, [
    authReady,
    connectSharesight,
    freshnessClock,
    holdingsCount,
    isSyncing,
    oauthRow,
    syncPhaseLabel,
    reconnectRequired,
    refreshSharesightNow,
    reloadLocalSnapshot,
    signOut,
    supabase,
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

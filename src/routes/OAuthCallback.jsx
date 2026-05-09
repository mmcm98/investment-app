import { useEffect, useMemo, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useSharesightIntegration } from '../context/SharesightIntegrationContext.jsx'
import { exchangeAuthorizationCode } from '../lib/sharesight/oauth.js'
import { persistFreshSharesightOAuthTokens } from '../lib/sharesight/syncSharesightPortfolios.js'

function formatUnknownError(error) {
  if (error instanceof Error) return error.message

  if (typeof error === 'string') return error

  try {
    return JSON.stringify(error)
  } catch {
    return 'Unknown error'
  }
}

export function OAuthCallback() {
  const navigate = useNavigate()

  const { authReady, userPresent, supabase, reloadLocalSnapshot } = useSharesightIntegration()

  const [errorMessage, setErrorMessage] = useState(
    /** @type {string | null} */
    (null),
  )

  const params = useMemo(() => new URLSearchParams(window.location.search), [])
  const code = params.get('code')
  const state = params.get('state')

  useEffect(() => {
    /** @type {boolean} */
    let cancelled = false

    async function run() {
      if (!authReady || !userPresent) return

      if (!supabase) {
        setErrorMessage('Missing Supabase configuration (env vars).')

        return
      }

      if (!code) {
        setErrorMessage('Missing OAuth authorization code.')

        return
      }

      const expectedState = sessionStorage.getItem('sharesight_oauth_state')

      if (!expectedState || !state || expectedState !== state) {
        setErrorMessage(
          `OAuth state mismatch (possible CSRF). Expected ${expectedState ? 'state' : 'missing state'}, got ${state ? 'state' : 'missing state'}.`,
        )

        return
      }

      try {
        const tokenPayload = await exchangeAuthorizationCode(code)
        sessionStorage.removeItem('sharesight_oauth_state')

        await persistFreshSharesightOAuthTokens(supabase, tokenPayload)
        await reloadLocalSnapshot()

        if (cancelled) return

        navigate('/', { replace: true })
      } catch (error) {
        if (cancelled) return

        setErrorMessage(formatUnknownError(error))
      }
    }

    void run()

    return () => {
      cancelled = true
    }
  }, [authReady, code, navigate, reloadLocalSnapshot, state, supabase, userPresent])

  if (!authReady) {
    return (
      <div className="min-h-[60vh] p-10 text-[#F0F0F8]">
        <p className="text-sm text-[#9090A8]">Preparing Sharesight OAuth…</p>
      </div>
    )
  }

  if (!userPresent) {
    return (
      <div className="min-h-[60vh] p-10 text-[#F0F0F8]">
        <h1 className="text-xl font-semibold">Sign in required</h1>

        <p className="mt-3 max-w-[70ch] text-sm text-[#9090A8]">
          Sign in first, then reconnect Sharesight. You will need to restart the Sharesight authorize flow because this
          callback contains a fresh OAuth code.
        </p>

        <Link className="mt-6 inline-flex text-[#79CBFF] underline" to="/login">
          Go to sign in
        </Link>
      </div>
    )
  }

  return (
    <div className="min-h-[60vh] p-10 text-[#F0F0F8]">
      <h1 className="text-xl font-semibold">Connecting Sharesight…</h1>

      {!errorMessage ? (
        <p className="mt-3 text-sm text-[#9090A8]">Completing OAuth. You will be redirected automatically.</p>
      ) : (
        <div className="mt-5 rounded-xl border border-[rgba(239,68,68,0.35)] bg-[rgba(239,68,68,0.08)] px-5 py-4">
          <p className="text-sm font-semibold text-[#EF4444]">Sharesight OAuth failed</p>

          <p className="mt-2 whitespace-pre-wrap text-sm text-[#F0F0F8]">{errorMessage}</p>

          <div className="mt-4 flex gap-4">
            <Link className="text-sm text-[#4DB8FF] underline" to="/">
              Back to dashboard
            </Link>
          </div>
        </div>
      )}
    </div>
  )
}

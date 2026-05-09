import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useSharesightIntegration } from '../context/SharesightIntegrationContext.jsx'

function formatUnknownError(error) {
  if (error instanceof Error) return error.message

  if (typeof error === 'string') return error

  try {
    return JSON.stringify(error)
  } catch {
    return 'Unknown error'
  }
}

/** @typedef {'sign_in'|'sign_up'} Mode */

const MIN_PASSWORD_LEN = 8

export function AuthPage() {
  const navigate = useNavigate()

  /** @type {Mode} */
  const [mode, setMode] = useState('sign_in')

  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [banner, setBanner] = useState(/** @type {string | null} */ (null))

  const { supabaseConfigured, userPresent, authReady, supabase } = useSharesightIntegration()

  const passwordOk = password.length >= MIN_PASSWORD_LEN
  const emailOk = email.trim().includes('@')

  const canSubmit = Boolean(
    authReady && supabaseConfigured && supabase && emailOk && passwordOk && busy === false,
  )

  useEffect(() => {
    if (!authReady || !userPresent) return

    navigate('/', { replace: true })
  }, [authReady, navigate, userPresent])

  const title = mode === 'sign_in' ? 'Sign in' : 'Create account'

  async function onSubmit(e) {
    e.preventDefault()
    setBanner(null)

    if (!supabase) {
      setBanner('Supabase is not configured.')

      return
    }

    setBusy(true)

    try {
      if (mode === 'sign_in') {
        const { error } = await supabase.auth.signInWithPassword({
          email: email.trim(),
          password,
        })

        if (error) throw error

        navigate('/', { replace: true })

        return
      }

      const { data, error } = await supabase.auth.signUp({
        email: email.trim(),
        password,
        options: {
          emailRedirectTo: `${window.location.origin}/`,
        },
      })

      if (error) throw error

      if (!data.session) {
        setBanner(
          'Account created — if confirmations are enabled in Supabase you may need to verify email before signing in.',
        )

        setMode('sign_in')

        return
      }

      navigate('/', { replace: true })
    } catch (error) {
      setBanner(formatUnknownError(error))
    } finally {
      setBusy(false)
    }
  }

  if (!supabaseConfigured) {
    return (
      <div className="min-h-screen bg-[#0A0A0F] px-6 py-12 text-[#F0F0F8]">
        <div className="mx-auto w-full max-w-md rounded-xl border border-[rgba(255,255,255,0.06)] bg-[#111118] px-8 py-7">
          <h1 className="text-xl font-semibold">Supabase missing</h1>

          <p className="mt-3 text-sm text-[#9090A8]">
            Configure <span className="font-mono">VITE_SUPABASE_URL</span> and{' '}
            <span className="font-mono">VITE_SUPABASE_ANON_KEY</span> in `.env.local`, then reload.
          </p>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-[#0A0A0F] px-6 py-14 text-[#F0F0F8]">
      <div className="mx-auto w-full max-w-md rounded-xl border border-[rgba(255,255,255,0.06)] bg-[#111118] px-8 py-8 shadow-[inset_0_1px_0_rgba(255,255,255,0.04)]">
        <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-[#505068]">
          Investment app
        </p>

        <h1 className="mt-4 text-[22px] font-semibold">{title}</h1>

        <p className="mt-3 text-sm text-[#9090A8]">Email / password authentication via Supabase Auth.</p>

        <form className="mt-7 space-y-4" onSubmit={(e) => void onSubmit(e)}>
          <div>
            <label className="text-[10px] font-semibold uppercase tracking-[0.12em] text-[#9090A8]" htmlFor="email">
              Email
            </label>

            <input
              id="email"
              className="mt-2 w-full rounded-md border border-[rgba(255,255,255,0.12)] bg-[#1A1A24] px-3 py-2 font-mono text-sm text-[#F0F0F8] outline-none ring-[#4DB8FF] focus-visible:ring-2"
              autoComplete="email"
              inputMode="email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@domain.com"
              required
            />
          </div>

          <div>
            <label
              className="text-[10px] font-semibold uppercase tracking-[0.12em] text-[#9090A8]"
              htmlFor="password"
            >
              Password
            </label>

            <input
              id="password"
              type="password"
              className="mt-2 w-full rounded-md border border-[rgba(255,255,255,0.12)] bg-[#1A1A24] px-3 py-2 font-mono text-sm text-[#F0F0F8] outline-none ring-[#4DB8FF] focus-visible:ring-2"
              autoComplete={mode === 'sign_in' ? 'current-password' : 'new-password'}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="••••••••"
              minLength={MIN_PASSWORD_LEN}
              required
            />

            <p className="mt-2 text-xs text-[#505068]">Use at least {MIN_PASSWORD_LEN} characters.</p>
          </div>

          <button
            type="submit"
            disabled={!canSubmit}
            className="w-full rounded-md bg-[#4DB8FF] px-4 py-2 font-mono text-sm font-semibold text-[#0A0A0F] disabled:cursor-not-allowed disabled:opacity-50"
          >
            {busy ? 'Working…' : mode === 'sign_in' ? 'Sign in' : 'Create account'}
          </button>
        </form>

        {!authReady ? <p className="mt-4 text-xs text-[#9090A8]">Initializing session…</p> : null}

        <div className="mt-6 flex flex-col gap-4 border-t border-[rgba(255,255,255,0.06)] pt-6">
          <button
            type="button"
            className="text-left text-sm text-[#79CBFF] underline decoration-[rgba(77,184,255,0.35)] underline-offset-4"
            onClick={() => {
              setBanner(null)

              setMode((m) => (m === 'sign_in' ? 'sign_up' : 'sign_in'))
            }}
          >
            {mode === 'sign_in' ? 'Need an account? Create one' : 'Already have an account? Sign in'}
          </button>
        </div>

        {banner ? (
          <div className="mt-6 rounded-md border border-[rgba(245,158,11,0.35)] bg-[rgba(245,158,11,0.08)] px-4 py-3 text-sm text-[#F0F0F8]">
            {banner}
          </div>
        ) : null}
      </div>
    </div>
  )
}

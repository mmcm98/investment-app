/** @typedef {'development'|'production'} AppEnvKind */

/** Same-origin baseline for deployed build when `VITE_PUBLIC_APP_URL` is omitted (Vercel / prod). */
const DEFAULT_PUBLIC_APP_ORIGIN = 'https://investment-app-rouge.vercel.app'

const DEFAULT_SHARESIGHT_OAUTH_REDIRECT_URI_DEV = 'http://localhost:5173/callback'

/** @returns {AppEnvKind} */
export function getAppEnv() {
  const raw = `${import.meta.env.VITE_APP_ENV ?? import.meta.env.MODE ?? 'development'}`
  const v = raw.trim().toLowerCase()
  if (v === 'production') return 'production'

  return 'development'
}

export function isProductionEnv() {
  return getAppEnv() === 'production'
}

export function getSharesightClientId() {
  const dev = import.meta.env.VITE_SHARESIGHT_CLIENT_ID_DEV?.trim?.()
  const prod = import.meta.env.VITE_SHARESIGHT_CLIENT_ID_PROD?.trim?.()

  if (isProductionEnv()) {
    if (!prod) throw new Error('Missing VITE_SHARESIGHT_CLIENT_ID_PROD')

    return prod
  }

  if (!dev) throw new Error('Missing VITE_SHARESIGHT_CLIENT_ID_DEV')

  return dev
}

export function getSharesightClientSecret() {
  const dev = import.meta.env.VITE_SHARESIGHT_CLIENT_SECRET_DEV?.trim?.()
  const prod = import.meta.env.VITE_SHARESIGHT_CLIENT_SECRET_PROD?.trim?.()

  if (isProductionEnv()) {
    if (!prod) throw new Error('Missing VITE_SHARESIGHT_CLIENT_SECRET_PROD')

    return prod
  }

  if (!dev) throw new Error('Missing VITE_SHARESIGHT_CLIENT_SECRET_DEV')

  return dev
}

function trimTrailingSlash(value) {
  return value.replace(/\/+$/, '')
}

/**
 * Canonical site URL for redirects / links when `VITE_PUBLIC_APP_URL` is absent.
 * Override via `VITE_PUBLIC_APP_URL` when the deployment hostname changes.
 */
export function getPublicAppUrl() {
  const fromEnv = import.meta.env.VITE_PUBLIC_APP_URL?.trim?.()

  return fromEnv && fromEnv.length > 0 ? fromEnv : DEFAULT_PUBLIC_APP_ORIGIN
}

/**
 * OAuth redirect_uri must exactly match Sharesight OAuth app registration.
 *
 * Resolution order:
 * - `VITE_SHARESIGHT_OAUTH_REDIRECT_URI` when set (highest precedence)
 * - **`http://localhost:5173/callback`** when {@link getAppEnv} resolves to **`development`** (typically `VITE_APP_ENV=development`)
 * - otherwise **`${getPublicAppUrl()}/callback`**, which becomes **`https://investment-app-rouge.vercel.app/callback`**
 *   when `VITE_PUBLIC_APP_URL` is also unset
 */
export function getSharesightOAuthRedirectUri() {
  const explicitRedirect = import.meta.env.VITE_SHARESIGHT_OAUTH_REDIRECT_URI?.trim?.()
  if (explicitRedirect && explicitRedirect.length > 0) return explicitRedirect

  if (!isProductionEnv()) {
    return DEFAULT_SHARESIGHT_OAUTH_REDIRECT_URI_DEV
  }

  return `${trimTrailingSlash(getPublicAppUrl())}/callback`
}

export function getSharesightPortfolioUuids() {
  const core = import.meta.env.VITE_SHARESIGHT_PORTFOLIO_UUID_CORE?.trim?.()
  const satellite = import.meta.env.VITE_SHARESIGHT_PORTFOLIO_UUID_SATELLITE?.trim?.()

  if (!core || !satellite) {
    throw new Error(
      'Missing VITE_SHARESIGHT_PORTFOLIO_UUID_CORE or VITE_SHARESIGHT_PORTFOLIO_UUID_SATELLITE',
    )
  }

  return { core, satellite }
}

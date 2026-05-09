/** @typedef {'development'|'production'} AppEnvKind */

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
 * OAuth redirect_uri must exactly match Sharesight OAuth app registration.
 * Production resolves from VITE_PUBLIC_APP_URL (+ /callback) unless overridden explicitly.
 */
export function getSharesightOAuthRedirectUri() {
  const explicit = import.meta.env.VITE_SHARESIGHT_OAUTH_REDIRECT_URI?.trim?.()
  if (explicit) return explicit

  if (isProductionEnv()) {
    const site = import.meta.env.VITE_PUBLIC_APP_URL?.trim?.()
    if (!site) throw new Error('Missing VITE_PUBLIC_APP_URL or VITE_SHARESIGHT_OAUTH_REDIRECT_URI for production OAuth')

    return `${trimTrailingSlash(site)}/callback`
  }

  return 'http://localhost:5173/callback'
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

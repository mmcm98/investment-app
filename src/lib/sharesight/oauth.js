import { proxiedSharesightUrl } from './proxyFetch.js'
import { getSharesightClientId, getSharesightClientSecret, getSharesightOAuthRedirectUri } from './runtimeEnv.js'
import { withRetries } from './retry.js'

const OAUTH_AUTHORIZE_PATH = '/oauth2/authorize'
const TOKEN_PATH = '/oauth2/token'

function sharesightIssuerOrigin() {
  const explicit = import.meta.env.VITE_SHARESIGHT_ISSUER_ORIGIN?.trim?.()
  if (explicit) return explicit.replace(/\/+$/, '')

  // Sharesight-hosted OAuth issuer (public URL; not application-specific secrets).
  return 'https://api.sharesight.com'
}

/** @typedef {{ access_token: string, refresh_token?: string, expires_in: number, token_type?: string, created_at?: number }} SharesightTokenResponse */

function buildAuthorizeUrlParts() {
  const clientId = getSharesightClientId()
  const redirectUri = getSharesightOAuthRedirectUri()

  const url = new URL(`${sharesightIssuerOrigin()}${OAUTH_AUTHORIZE_PATH}`)
  url.searchParams.set('response_type', 'code')
  url.searchParams.set('client_id', clientId)
  url.searchParams.set('redirect_uri', redirectUri)

  return { authorizeUrl: url.toString(), redirectUri }
}

/** @returns {{ authorizeUrl: string, oauthState: string, redirectUri: string }} */
export function beginSharesightAuthorizationCodeFlow() {
  const oauthState =
    typeof globalThis.crypto?.randomUUID === 'function'
      ? globalThis.crypto.randomUUID()
      : `${Date.now()}-${Math.random().toString(16).slice(2)}`

  sessionStorage.setItem('sharesight_oauth_state', oauthState)

  const { authorizeUrl: baseAuthorizeUrl, redirectUri } = buildAuthorizeUrlParts()
  const authorizeUrl = new URL(baseAuthorizeUrl)

  authorizeUrl.searchParams.set('state', oauthState)

  return { authorizeUrl: authorizeUrl.toString(), oauthState, redirectUri }
}

/** @type {(code: string) => Promise<SharesightTokenResponse>} */
export async function exchangeAuthorizationCode(code) {
  const redirectUri = getSharesightOAuthRedirectUri()

  const body = new URLSearchParams()
  body.set('grant_type', 'authorization_code')
  body.set('code', code)
  body.set('redirect_uri', redirectUri)
  body.set('client_id', getSharesightClientId())
  body.set('client_secret', getSharesightClientSecret())

  return await fetchToken(body)
}

/** @type {(refreshToken: string) => Promise<SharesightTokenResponse>} */
export async function refreshAccessToken(refreshToken) {
  const body = new URLSearchParams()
  body.set('grant_type', 'refresh_token')
  body.set('refresh_token', refreshToken)
  body.set('client_id', getSharesightClientId())
  body.set('client_secret', getSharesightClientSecret())

  return await fetchToken(body)
}

/** @param {URLSearchParams} body */
async function fetchToken(body) {
  return await withRetries(
    async () => {
      const response = await fetch(proxiedSharesightUrl(TOKEN_PATH), {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body,
      })

      const text = await response.text()

      /** @type {unknown | undefined} */
      const parsedJson = (() => {
        try {
          return JSON.parse(text)
        } catch {
          return undefined
        }
      })()

      if (!response.ok) {
        throw new SharesightOAuthHttpError(response.status, text, typeof parsedJson === 'object' ? parsedJson : null)
      }

      if (parsedJson === undefined || parsedJson === null || typeof parsedJson !== 'object') {
        throw new SharesightOAuthHttpError(response.status, 'Invalid JSON token response', null)
      }

      const access_token = Reflect.get(parsedJson, 'access_token')
      const expires_in = Reflect.get(parsedJson, 'expires_in')

      if (typeof access_token !== 'string' || !access_token.trim()) {
        throw new SharesightOAuthHttpError(response.status, 'Token response missing access_token', parsedJson)
      }

      if (typeof expires_in !== 'number' || !Number.isFinite(expires_in)) {
        throw new SharesightOAuthHttpError(response.status, 'Token response missing expires_in', parsedJson)
      }

      return /** @type {SharesightTokenResponse} */ (parsedJson)
    },
    { attempts: 3 },
  )
}

export class SharesightOAuthHttpError extends Error {
  /** @param {number} status */
  constructor(status, message, payload) {
    super(message)
    this.name = 'SharesightOAuthHttpError'
    this.status = status
    this.payload = payload
  }
}

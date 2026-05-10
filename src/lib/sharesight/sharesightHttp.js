/** @typedef {import('@supabase/supabase-js').SupabaseClient} SupabaseClient */

import { proxiedSharesightUrl } from './proxyFetch.js'
import { withRetries } from './retry.js'
import {
  forceRefreshSharesightAccessToken,
  getSharesightAccessMemoryToken,
  SharesightSuspendedError,
} from './tokenSession.js'
import { flagSharesightReconnectRequired } from './oauthCredentialsRepository.js'

export class SharesightHttpError extends Error {
  /**
   * @param {number} status
   * @param {string} method
   * @param {string} url
   * @param {string} bodyText
   */
  constructor(status, method, url, bodyText) {
    super(`Sharesight API error ${status} ${method} ${url}: ${truncate(bodyText, 800)}`)
    this.name = 'SharesightHttpError'
    this.status = status
    this.method = method
    this.url = url
    this.bodyText = bodyText
  }
}

/** @param {string} text @param {number} max */
function truncate(text, max) {
  if (text.length <= max) return text

  return `${text.slice(0, max)}…`
}

/**
 * @param {string} initialAccessToken
 * @param {SupabaseClient | undefined} supabase
 */
function bearerForRequest(initialAccessToken, supabase) {
  if (!supabase) return initialAccessToken

  return getSharesightAccessMemoryToken() ?? initialAccessToken
}

/**
 * @param {string} accessToken
 * @param {string} apiPathSuffix Example: `api/v3/portfolios/123/holdings`
 * @param {{
 *   method?: string
 *   searchParams?: Record<string, string | number | undefined | null>
 *   supabase?: SupabaseClient
 * }} [opts]
 */
export async function sharesightAuthorizedFetch(accessToken, apiPathSuffix, opts) {
  const method = opts?.method ?? 'GET'
  const supabaseForRefresh = opts?.supabase

  const networkRetryOpts = {
    attempts: 3,
    shouldRetry: (err) =>
      !(err instanceof SharesightHttpError && (err.status === 401 || err.status === 403)),
  }

  const fetchOnce = async () => {
    const bearer = bearerForRequest(accessToken, supabaseForRefresh)

    const url = new URL(proxiedSharesightUrl(apiPathSuffix), window.location.origin)

    const params = opts?.searchParams ?? {}
    for (const [k, v] of Object.entries(params)) {
      if (v === undefined || v === null) continue
      url.searchParams.set(k, String(v))
    }

    const response = await fetch(url.toString(), {
      method,
      headers: {
        Accept: 'application/json',
        Authorization: `Bearer ${bearer}`,
      },
    })

    const text = await response.text()

    if (!response.ok) {
      throw new SharesightHttpError(response.status, method, url.toString(), text)
    }

    if (!text) {
      return null
    }

    try {
      return JSON.parse(text)
    } catch {
      throw new SharesightHttpError(response.status, method, url.toString(), 'Non-JSON response body')
    }
  }

  let refreshedOnce = false
  /** Count 401/403 responses after the first silent refresh for this logical request. */
  let unauthorizedAfterRefresh = 0

  for (;;) {
    try {
      return await withRetries(async () => fetchOnce(), networkRetryOpts)
    } catch (e) {
      const unauthorized = e instanceof SharesightHttpError && (e.status === 401 || e.status === 403)

      if (!unauthorized || !supabaseForRefresh) throw e

      if (!refreshedOnce) {
        refreshedOnce = true

        console.warn('[sharesight/http] unauthorized; mutex token refresh then retry', { status: e.status })

        try {
          await forceRefreshSharesightAccessToken(supabaseForRefresh)

          console.info('[sharesight/http] silent token refresh completed; retrying with in-memory bearer')
        } catch (refreshErr) {
          const msg = refreshErr instanceof Error ? refreshErr.message : String(refreshErr)
          console.warn('[sharesight/http] silent token refresh failed', msg)
          if (refreshErr instanceof SharesightSuspendedError) throw refreshErr
          throw e
        }

        continue
      }

      unauthorizedAfterRefresh += 1

      if (unauthorizedAfterRefresh >= 3) {
        const reason = `Sharesight returned ${e.status} repeatedly after token refresh (${unauthorizedAfterRefresh} times).`

        console.warn('[sharesight/http] auth_exhausted', { status: e.status, unauthorizedAfterRefresh })

        await flagSharesightReconnectRequired(supabaseForRefresh, reason)

        throw new SharesightSuspendedError(reason)
      }

      try {
        await forceRefreshSharesightAccessToken(supabaseForRefresh)
      } catch (refreshErr) {
        if (refreshErr instanceof SharesightSuspendedError) throw refreshErr
        throw e
      }

      continue
    }
  }
}

/** @typedef {import('@supabase/supabase-js').SupabaseClient} SupabaseClient */

import { proxiedSharesightUrl } from './proxyFetch.js'
import { withRetries } from './retry.js'
import { forceRefreshSharesightAccessToken, SharesightSuspendedError } from './tokenSession.js'

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
  /** @type {string} */
  let bearer = accessToken

  const fetchOnce = async () => {
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

  const networkRetryOpts = {
    attempts: 3,
    shouldRetry: (err) =>
      !(err instanceof SharesightHttpError && (err.status === 401 || err.status === 403)),
  }

  for (let authRound = 0; authRound < 2; authRound += 1) {
    try {
      return await withRetries(async () => fetchOnce(), networkRetryOpts)
    } catch (e) {
      const unauthorized = e instanceof SharesightHttpError && (e.status === 401 || e.status === 403)
      if (!supabaseForRefresh || !unauthorized || authRound >= 1) throw e

      console.warn('[sharesight/http] unauthorized; attempting silent token refresh before retry', {
        status: e.status,
      })

      try {
        const next = await forceRefreshSharesightAccessToken(supabaseForRefresh)

        bearer = next.accessToken
        console.info('[sharesight/http] silent token refresh succeeded; retrying request once')
      } catch (refreshErr) {
        const msg = refreshErr instanceof Error ? refreshErr.message : String(refreshErr)
        console.warn('[sharesight/http] silent token refresh failed', msg)
        if (refreshErr instanceof SharesightSuspendedError) throw refreshErr
        throw e
      }
    }
  }
}

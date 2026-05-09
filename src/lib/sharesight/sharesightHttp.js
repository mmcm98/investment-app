import { proxiedSharesightUrl } from './proxyFetch.js'
import { withRetries } from './retry.js'

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
 * @param {{ method?: string, searchParams?: Record<string, string | number | undefined | null> }} [opts]
 */
export async function sharesightAuthorizedFetch(accessToken, apiPathSuffix, opts) {
  const method = opts?.method ?? 'GET'
  const url = new URL(proxiedSharesightUrl(apiPathSuffix), window.location.origin)

  const params = opts?.searchParams ?? {}
  for (const [k, v] of Object.entries(params)) {
    if (v === undefined || v === null) continue
    url.searchParams.set(k, String(v))
  }

  return await withRetries(
    async () => {
      const response = await fetch(url.toString(), {
        method,
        headers: {
          Accept: 'application/json',
          Authorization: `Bearer ${accessToken}`,
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
    },
    { attempts: 3 },
  )
}

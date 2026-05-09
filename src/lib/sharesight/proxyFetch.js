/**
 * Same-origin proxied Sharesight HTTPS calls via:
 * - Vite dev proxy (`vite.config.js`)
 * - `vercel.json` rewrite (`/__proxy_sharesight/*`)
 */
const PROXY_PREFIX = '/__proxy_sharesight'

function joinUrl(basePrefix, apiPath) {
  const trimmedBase = `${basePrefix}`.replace(/\/+$/, '')
  const trimmedPath = `${apiPath}`.replace(/^\/+/, '')

  return `${trimmedBase}/${trimmedPath}`
}

/** @param {string} apiPath Examples: oauth2/token, api/v3/portfolios/123/holdings */
export function proxiedSharesightUrl(apiPath) {
  const override = import.meta.env.VITE_SHARESIGHT_PROXY_PREFIX?.trim?.()

  const prefix =
    typeof override === 'string' && override.length > 0 ? override.replace(/\/+$/, '') : PROXY_PREFIX

  return joinUrl(prefix, apiPath)
}

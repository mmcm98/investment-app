/** @typedef {import('@supabase/supabase-js').SupabaseClient} SupabaseClient */
/** @typedef {import('./oauthCredentialsRepository.js').SharesightOAuthRow} SharesightOAuthRow */

import {
  fetchSharesightOAuthRow,
  flagSharesightReconnectRequired,
  upsertSharesightOAuthRow,
} from './oauthCredentialsRepository.js'
import { refreshAccessToken } from './oauth.js'
import { withRetries } from './retry.js'

const REFRESH_BUFFER_MS = 120_000 // align with Sharesight guidance (avoid race at expiry edges)

/** @param {string | undefined | null} iso */
function parseIsoMaybe(iso) {
  if (!iso) return null
  const ms = Date.parse(iso)

  return Number.isFinite(ms) ? ms : null
}

/** @type {(row?: SharesightOAuthRow | null) => boolean} */
export function oauthRowNeedsReconnect(row) {
  if (!row) return true

  return Boolean(row.reconnect_required)
}

/** @type {(row: SharesightOAuthRow) => boolean} */
export function accessTokenExpiresWithinBuffer(row) {
  const expiresMs = parseIsoMaybe(row.access_expires_at)

  // If we can't parse expiry, assume refresh ASAP (but refresh requires refresh_token)
  if (expiresMs === null) return true

  return Date.now() >= expiresMs - REFRESH_BUFFER_MS
}

/**
 * Returns a usable bearer access_token, refreshing early when needed.
 *
 * @param {SupabaseClient} supabase
 * @returns {Promise<{ accessToken: string, row: SharesightOAuthRow }>}
 */
export async function ensureSharesightAccessToken(supabase) {
  const { data: row, error: loadErr } = await fetchSharesightOAuthRow(supabase)

  if (loadErr) throw loadErr

  if (!row) throw new Error('Sharesight is not connected yet')

  if (oauthRowNeedsReconnect(row)) {
    throw new SharesightSuspendedError(row.last_auth_error ?? 'Sharesight reconnect is required.')
  }

  if (!accessTokenExpiresWithinBuffer(row)) {
    return { accessToken: row.access_token, row }
  }

  const refreshToken = typeof row.refresh_token === 'string' ? row.refresh_token : ''
  if (!refreshToken) {
    await flagSharesightReconnectRequired(
      supabase,
      'Missing refresh token — please reconnect Sharesight OAuth.',
    )

    throw new SharesightSuspendedError('Missing refresh token — please reconnect Sharesight.')
  }

  try {
    const refreshed = await withRetries(async () => await refreshAccessToken(refreshToken), { attempts: 3 })

    await upsertSharesightOAuthRow(supabase, {
      access_token: refreshed.access_token,
      refresh_token: refreshed.refresh_token ?? refreshToken,
      token_type: refreshed.token_type ?? 'bearer',
      expires_in: refreshed.expires_in,
      reconnect_required: false,
      clear_auth_error: true,
    })

    const { data: nextRow, error: reloadErr } = await fetchSharesightOAuthRow(supabase)
    if (reloadErr) throw reloadErr
    if (!nextRow) throw new Error('Failed to reload Sharesight credentials after refresh')

    return { accessToken: nextRow.access_token, row: nextRow }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)

    await flagSharesightReconnectRequired(supabase, message)

    throw new SharesightSuspendedError(message)
  }
}

export class SharesightSuspendedError extends Error {
  constructor(message) {
    super(message)
    this.name = 'SharesightSuspendedError'
  }
}

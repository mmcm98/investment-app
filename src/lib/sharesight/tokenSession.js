/** @typedef {import('@supabase/supabase-js').SupabaseClient} SupabaseClient */
/** @typedef {import('./oauthCredentialsRepository.js').SharesightOAuthRow} SharesightOAuthRow */

import {
  fetchSharesightOAuthRow,
  flagSharesightReconnectRequired,
  upsertSharesightOAuthRow,
} from './oauthCredentialsRepository.js'
import { refreshAccessToken } from './oauth.js'
import { withRetries } from './retry.js'

/** Align with Sharesight expiry windows — rotate before the access token lapses (~5 minutes). */
const REFRESH_BEFORE_EXPIRY_MS = 5 * 60 * 1000

/** Dedup simultaneous 401-triggered rotations (parallel portfolio fetches). */
let forceRefreshInFlight =
  /** @type {Promise<{ accessToken: string, row: SharesightOAuthRow }> | null} */ (null)

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

  return Date.now() >= expiresMs - REFRESH_BEFORE_EXPIRY_MS
}

/**
 * Rotate access token using refresh_token only (no expiry buffer heuristic).
 *
 * @param {SupabaseClient} supabase
 * @returns {Promise<{ accessToken: string, row: SharesightOAuthRow }>}
 */
async function rotateSharesightTokens(supabase, refreshToken, /** @type {'proactive' | 'forced'} */ kind) {
  console.info('[sharesight/oauth] token_refresh_attempt', { kind })

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

    console.info('[sharesight/oauth] token_refresh_ok', { kind })

    return { accessToken: nextRow.access_token, row: nextRow }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    console.warn('[sharesight/oauth] token_refresh_failed', { kind, message })

    await flagSharesightReconnectRequired(supabase, message)

    throw new SharesightSuspendedError(message)
  }
}

/**
 * Immediately refresh using the refresh token stored in Supabase (e.g. after HTTP 401).
 * Concurrent callers await the same in-flight rotation.
 *
 * @param {SupabaseClient} supabase
 * @returns {Promise<{ accessToken: string, row: SharesightOAuthRow }>}
 */
export async function forceRefreshSharesightAccessToken(supabase) {
  if (forceRefreshInFlight) return forceRefreshInFlight

  const run = /** @returns {Promise<{ accessToken: string, row: SharesightOAuthRow }>} */ async () => {
    const { data: row, error: loadErr } = await fetchSharesightOAuthRow(supabase)

    if (loadErr) throw loadErr

    if (!row) throw new Error('Sharesight is not connected yet')

    if (oauthRowNeedsReconnect(row)) {
      throw new SharesightSuspendedError(row.last_auth_error ?? 'Sharesight reconnect is required.')
    }

    const rt = typeof row.refresh_token === 'string' ? row.refresh_token : ''
    if (!rt.trim()) {
      await flagSharesightReconnectRequired(supabase, 'Missing refresh token — please reconnect Sharesight OAuth.')

      throw new SharesightSuspendedError('Missing refresh token — please reconnect Sharesight.')
    }

    return rotateSharesightTokens(supabase, rt, 'forced')
  }

  forceRefreshInFlight = run().finally(() => {
    forceRefreshInFlight = null
  })

  return forceRefreshInFlight
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
  if (!refreshToken.trim()) {
    await flagSharesightReconnectRequired(
      supabase,
      'Missing refresh token — please reconnect Sharesight OAuth.',
    )

    throw new SharesightSuspendedError('Missing refresh token — please reconnect Sharesight.')
  }

  return rotateSharesightTokens(supabase, refreshToken, 'proactive')
}

export class SharesightSuspendedError extends Error {
  constructor(message) {
    super(message)
    this.name = 'SharesightSuspendedError'
  }
}

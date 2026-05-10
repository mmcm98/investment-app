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

/** One in-flight token rotation for proactive + forced refresh (avoids parallel refresh races). */
let refreshExclusivePromise =
  /** @type {Promise<{ accessToken: string, row: SharesightOAuthRow }> | null} */ (null)

/**
 * Latest bearer after a successful refresh — used immediately by HTTP layer so parallel callers
 * do not keep sending the pre-refresh access token string from sync start.
 *
 * @type {{ token: string, expiresAtMs: number } | null}
 */
let memoryAccess = null

/** @param {string | undefined | null} iso */
function parseIsoMaybe(iso) {
  if (!iso) return null
  const ms = Date.parse(iso)

  return Number.isFinite(ms) ? ms : null
}

/**
 * Prefer this bearer for Sharesight API calls when present and not near expiry.
 *
 * @returns {string | null}
 */
export function getSharesightAccessMemoryToken() {
  if (!memoryAccess?.token) return null

  if (Date.now() >= memoryAccess.expiresAtMs - REFRESH_BEFORE_EXPIRY_MS) {
    return null
  }

  return memoryAccess.token
}

/**
 * @param {string} accessToken
 * @param {number} expiresInSeconds
 */
export function setSharesightAccessMemoryToken(accessToken, expiresInSeconds) {
  const sec = Number.isFinite(expiresInSeconds) && expiresInSeconds > 0 ? expiresInSeconds : 3600

  memoryAccess = {
    token: accessToken,
    expiresAtMs: Date.now() + sec * 1000,
  }
}

/** @param {SharesightOAuthRow} row */
export function seedSharesightAccessMemoryFromRow(row) {
  const expiresMs = parseIsoMaybe(row.access_expires_at)

  if (!row.access_token) return

  memoryAccess = {
    token: row.access_token,
    expiresAtMs: expiresMs ?? Date.now() + 3600_000,
  }
}

export function clearSharesightAccessMemory() {
  memoryAccess = null
}

/** @type {(row?: SharesightOAuthRow | null) => boolean} */
export function oauthRowNeedsReconnect(row) {
  if (!row) return true

  return Boolean(row.reconnect_required)
}

/** @type {(row: SharesightOAuthRow) => boolean} */
export function accessTokenExpiresWithinBuffer(row) {
  const expiresMs = parseIsoMaybe(row.access_expires_at)

  if (expiresMs === null) return true

  return Date.now() >= expiresMs - REFRESH_BEFORE_EXPIRY_MS
}

/**
 * @param {SupabaseClient} supabase
 * @param {'proactive'|'forced'} kind
 */
async function rotateSharesightTokens(supabase, refreshToken, kind) {
  console.info('[sharesight/oauth] token_refresh_attempt', { kind })

  try {
    const refreshed = await withRetries(async () => await refreshAccessToken(refreshToken), { attempts: 3 })

    setSharesightAccessMemoryToken(refreshed.access_token, refreshed.expires_in)

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

    seedSharesightAccessMemoryFromRow(nextRow)

    console.info('[sharesight/oauth] token_refresh_ok', { kind })

    return { accessToken: nextRow.access_token, row: nextRow }
  } catch (error) {
    clearSharesightAccessMemory()
    const message = error instanceof Error ? error.message : String(error)
    console.warn('[sharesight/oauth] token_refresh_failed', { kind, message })

    await flagSharesightReconnectRequired(supabase, message)

    throw new SharesightSuspendedError(message)
  }
}

/**
 * Single mutex: proactive and forced refresh share one in-flight promise.
 *
 * @param {SupabaseClient} supabase
 * @param {'proactive'|'forced'} kind
 */
async function refreshSharesightTokensExclusive(supabase, kind) {
  if (refreshExclusivePromise) return refreshExclusivePromise

  refreshExclusivePromise = (async () => {
    try {
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

      return rotateSharesightTokens(supabase, rt, kind)
    } finally {
      refreshExclusivePromise = null
    }
  })()

  return refreshExclusivePromise
}

/**
 * Immediately refresh using the refresh token stored in Supabase (e.g. after HTTP 401).
 *
 * @param {SupabaseClient} supabase
 * @returns {Promise<{ accessToken: string, row: SharesightOAuthRow }>}
 */
export async function forceRefreshSharesightAccessToken(supabase) {
  return refreshSharesightTokensExclusive(supabase, 'forced')
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
    seedSharesightAccessMemoryFromRow(row)

    return { accessToken: row.access_token, row }
  }

  return refreshSharesightTokensExclusive(supabase, 'proactive')
}

export class SharesightSuspendedError extends Error {
  constructor(message) {
    super(message)
    this.name = 'SharesightSuspendedError'
  }
}

/** @typedef {import('@supabase/supabase-js').SupabaseClient} SupabaseClient */

/** @typedef {{ data: SharesightOAuthRow | null, error?: unknown }} RepoResult */

/**
 * @typedef {Object} SharesightOAuthRow
 * @property {string} user_id
 * @property {string} access_token
 * @property {string | null | undefined} refresh_token
 * @property {string} token_type
 * @property {string} access_expires_at ISO string timestamptz
 * @property {boolean} reconnect_required
 * @property {string | null | undefined} last_auth_error
 * @property {string | null | undefined} last_successful_sync_at
 * @property {string | null | undefined} last_sync_attempt_at
 * @property {string | null | undefined} last_sync_error
 * @property {string | null | undefined} trades_cursor_core
 * @property {string | null | undefined} trades_cursor_satellite
 */

/**
 * Sharesight OAuth tokens intentionally live in Postgres (never localStorage).
 *
 * @param {SupabaseClient} supabase
 * @returns {Promise<RepoResult>}
 */
export async function fetchSharesightOAuthRow(supabase) {
  const { data: userData, error: userErr } = await supabase.auth.getUser()
  if (userErr) return { data: null, error: userErr }

  const userId = userData?.user?.id ?? ''
  if (!userId) return { data: null, error: new Error('Not authenticated') }

  const { data, error } = await supabase
    .from('sharesight_oauth_credentials')
    .select(
      `
        user_id,
        access_token,
        refresh_token,
        token_type,
        access_expires_at,
        reconnect_required,
        last_auth_error,
        last_successful_sync_at,
        last_sync_attempt_at,
        last_sync_error,
        trades_cursor_core,
        trades_cursor_satellite
      `,
    )
    .eq('user_id', userId)
    .maybeSingle()

  if (error) return { data: null, error }

  return { data: data ? /** @type {SharesightOAuthRow} */ (data) : null, error: undefined }
}

/**
 * @param {SupabaseClient} supabase
 * @param {{
 *   access_token: string
 *   refresh_token?: string | null
 *   token_type?: string | null
 *   expires_in: number
 *   reconnect_required?: boolean
 *   clear_auth_error?: boolean
 * }} tokens
 */
export async function upsertSharesightOAuthRow(supabase, tokens) {
  const { data: userData, error: userErr } = await supabase.auth.getUser()
  if (userErr) throw userErr

  const userId = userData?.user?.id
  if (!userId) throw new Error('Not authenticated')

  const expiresAtMs = Date.now() + tokens.expires_in * 1000
  const access_expires_at = new Date(expiresAtMs).toISOString()

  /** @type {Record<string, unknown>} */
  const payload = {
    user_id: userId,
    access_token: tokens.access_token,
    refresh_token: tokens.refresh_token ?? null,
    token_type: tokens.token_type ?? 'bearer',
    access_expires_at,
    reconnect_required: tokens.reconnect_required ?? false,
  }

  if (tokens.clear_auth_error) {
    payload.last_auth_error = null
  }

  const { error } = await supabase.from('sharesight_oauth_credentials').upsert(payload, { onConflict: 'user_id' })

  if (error) throw error
}

/**
 * @param {SupabaseClient} supabase
 * @param {'core'|'satellite'} portfolioRole
 * @param {string | null} cursorIso ISO-8601 timestamptz string (newest trade synced at this watermark)
 */
export async function patchSharesightTradeCursor(supabase, portfolioRole, cursorIso) {
  const { data: userData, error: userErr } = await supabase.auth.getUser()
  if (userErr) throw userErr

  const userId = userData?.user?.id
  if (!userId) throw new Error('Not authenticated')

  const patch =
    portfolioRole === 'core'
      ? { trades_cursor_core: cursorIso }
      : { trades_cursor_satellite: cursorIso }

  const { error } = await supabase.from('sharesight_oauth_credentials').update(patch).eq('user_id', userId)

  if (error) throw error
}

/**
 * Marks the connection unhealthy (suspend sync until user reconnects OAuth).
 *
 * @param {SupabaseClient} supabase
 * @param {string} reason
 */
export async function flagSharesightReconnectRequired(supabase, reason) {
  const { data: userData, error: userErr } = await supabase.auth.getUser()
  if (userErr) throw userErr

  const userId = userData?.user?.id
  if (!userId) throw new Error('Not authenticated')

  const { error } = await supabase
    .from('sharesight_oauth_credentials')
    .update({
      reconnect_required: true,
      last_auth_error: reason,
    })
    .eq('user_id', userId)

  if (error) throw error
}

/**
 * @param {SupabaseClient} supabase
 * @param {{
 *   last_successful_sync_at?: string | null
 *   last_sync_attempt_at?: string | null
 *   last_sync_error?: string | null
 * }} patch
 */
export async function patchSharesightSyncMeta(supabase, patch) {
  const { data: userData, error: userErr } = await supabase.auth.getUser()
  if (userErr) throw userErr

  const userId = userData?.user?.id
  if (!userId) throw new Error('Not authenticated')

  const { error } = await supabase.from('sharesight_oauth_credentials').update(patch).eq('user_id', userId)

  if (error) throw error
}

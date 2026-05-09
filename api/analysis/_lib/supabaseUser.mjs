import { createClient } from '@supabase/supabase-js'

/**
 * Authenticated-as-user Supabase client (inherits RLS) from Browser Authorization header.
 *
 * @param {string} supabaseUrl
 * @param {string} supabaseAnonKey
 * @param {string | undefined} bearerHeader e.g. "Bearer eyJ..."
 */
export function createUserSupabase(supabaseUrl, supabaseAnonKey, bearerHeader) {
  const tokenRaw = `${bearerHeader ?? ''}`.trim().replace(/^Bearer\s+/i, '')

  if (!tokenRaw) return { error: /** @type {const} */ ('missing_bearer') }

  /** @typedef {import('@supabase/supabase-js').SupabaseClient} SB */
  const supabase = createClient(supabaseUrl, supabaseAnonKey, {
    global: { headers: { Authorization: `Bearer ${tokenRaw}` } },
    auth: { persistSession: false, autoRefreshToken: false },
  })

  return { supabase, accessToken: tokenRaw }
}

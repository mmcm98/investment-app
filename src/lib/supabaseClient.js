import { createClient } from '@supabase/supabase-js'

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY

if (!supabaseUrl?.trim?.() || !supabaseAnonKey?.trim?.()) {
  console.warn(
    '[investment-app] Missing VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY — Supabase client disabled until configured.',
  )
}

/** @type {import('@supabase/supabase-js').SupabaseClient | null} */
let singleton = null

export function createSupabaseBrowserClient() {
  if (!supabaseUrl?.trim?.() || !supabaseAnonKey?.trim?.()) return null

  singleton ??= createClient(supabaseUrl.trim(), supabaseAnonKey.trim(), {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: true,
    },
  })

  return singleton
}

export function requireSupabase() {
  const c = createSupabaseBrowserClient()
  if (!c) {
    throw new Error('Supabase client is not configured (missing env vars)')
  }

  return c
}

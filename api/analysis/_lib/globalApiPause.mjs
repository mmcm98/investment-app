/**
 * @param {import('@supabase/supabase-js').SupabaseClient} supabase
 * @param {string} userId
 */
export async function assertGlobalApiNotPaused(supabase, userId) {
  const { data } = await supabase.from('user_settings').select('global_api_pause').eq('user_id', userId).maybeSingle()

  if (data?.global_api_pause === true) {
    const e = new Error('global_api_pause')

    e.code = 'api_paused'

    throw e
  }
}

import { useCallback, useEffect, useState } from 'react'

import { mergeUserPreferences } from '../lib/settings/mergeUserPreferences.js'
import { SETTINGS_UPDATED_EVENT } from '../lib/settings/settingsEvents.js'

import { useSharesightIntegration } from '../context/SharesightIntegrationContext.jsx'

/** @returns {{ globalApiPaused: boolean, themeClass: 'light'|'dark', reloadShellFlags: () => Promise<void>, flagsLoading: boolean }} */

export function useShellUserFlags() {
  const { supabase, userPresent } = useSharesightIntegration()

  const [globalApiPaused, setGlobalApiPaused] = useState(false)

  /** @type {['light'|'dark', React.Dispatch<React.SetStateAction<'light'|'dark'>>]} */

  const [themeClass, setThemeClass] = useState(/** @type {'light'|'dark'} */ ('dark'))

  const [flagsLoading, setFlagsLoading] = useState(true)

  const reloadShellFlags = useCallback(async () => {
    if (!supabase || !userPresent) {
      setGlobalApiPaused(false)

      setThemeClass('dark')

      setFlagsLoading(false)

      return
    }

    setFlagsLoading(true)

    try {
      const { data: ud } = await supabase.auth.getUser()

      const uid = ud.user?.id

      if (!uid) {
        setGlobalApiPaused(false)

        setThemeClass('dark')

        return
      }

      const { data, error } = await supabase.from('user_settings').select('global_api_pause, preferences').eq('user_id', uid).maybeSingle()

      if (error) throw error

      const row = /** @type {Record<string, unknown>|null} */ (data)

      setGlobalApiPaused(row?.global_api_pause === true)

      const merged = mergeUserPreferences(row?.preferences)

      const ap =
        merged.appearance &&
        typeof merged.appearance === 'object' &&
        merged.appearance !== null &&
        typeof Reflect.get(merged.appearance, 'theme') === 'string'
          ? `${Reflect.get(merged.appearance, 'theme')}`.toLowerCase()
          : 'dark'

      setThemeClass(ap === 'light' ? 'light' : 'dark')
    } catch {
      setGlobalApiPaused(false)
    } finally {
      setFlagsLoading(false)
    }
  }, [supabase, userPresent])

  /* eslint-disable react-hooks/set-state-in-effect -- snapshot auth flags */

  useEffect(() => {

    void reloadShellFlags()

  }, [reloadShellFlags])

  /* eslint-enable react-hooks/set-state-in-effect */

  useEffect(() => {
    function onInvalidate() {
      void reloadShellFlags()
    }

    window.addEventListener(SETTINGS_UPDATED_EVENT, onInvalidate)

    return () => window.removeEventListener(SETTINGS_UPDATED_EVENT, onInvalidate)
  }, [reloadShellFlags])

  return { globalApiPaused, themeClass, reloadShellFlags, flagsLoading }
}

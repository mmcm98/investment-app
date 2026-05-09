/* eslint-disable react-refresh/only-export-components -- Provider + hook */
import { createContext, useContext, useMemo } from 'react'

import { useShellUserFlags } from '../hooks/useShellUserFlags.js'

/** @typedef {{ light: boolean, fg: string, muted: string, tertiary: string, borderSubtle: string }} InvTheme */

/** @type {React.Context<InvTheme | null>} */
const InvThemeContext = createContext(null)

export function InvThemeProvider({ children }) {
  const { themeClass } = useShellUserFlags()

  const light = themeClass === 'light'

  const value = useMemo(
    () => ({
      light,
      fg: light ? 'text-[#0A0A1A]' : 'text-[#F0F0F8]',
      muted: light ? 'text-[#50507A]' : 'text-[#9090A8]',
      tertiary: light ? 'text-[#7A7A92]' : 'text-[#505068]',
      borderSubtle: light ? 'border-[rgba(0,0,0,0.08)]' : 'border-[rgba(255,255,255,0.06)]',
    }),
    [light],
  )

  return <InvThemeContext.Provider value={value}>{children}</InvThemeContext.Provider>
}

/** @returns {InvTheme} */
export function useInvTheme() {
  const v = useContext(InvThemeContext)

  if (!v) {
    return {
      light: false,
      fg: 'text-[#F0F0F8]',
      muted: 'text-[#9090A8]',
      tertiary: 'text-[#505068]',
      borderSubtle: 'border-[rgba(255,255,255,0.06)]',
    }
  }

  return v
}

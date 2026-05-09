import { NavLink, Outlet } from 'react-router-dom'
import { Layers, Radar, Satellite, Settings, LayoutDashboard } from 'lucide-react'

import { useShellUserFlags } from '../hooks/useShellUserFlags.js'
import { useLivePrices } from '../context/LivePricesContext.jsx'
import { InvThemeProvider } from '../context/InvThemeContext.jsx'

const desktopLink = (light) => ({ isActive }) =>
  [
    'flex items-center gap-2 rounded-md px-3 py-2 font-mono text-xs transition-colors duration-150',
    isActive
      ? light
        ? 'border border-[rgba(37,99,235,0.45)] bg-[rgba(37,99,235,0.1)] text-[#1D4ED8]'
        : 'border border-[rgba(77,184,255,0.55)] bg-[rgba(77,184,255,0.12)] text-[#79CBFF]'
      : light
        ? 'border border-transparent text-[#4b4b5c] hover:border-[rgba(0,0,0,0.08)] hover:text-[#12121a]'
        : 'border border-transparent text-[#9090A8] hover:border-[rgba(255,255,255,0.08)] hover:text-[#F0F0F8]',
  ].join(' ')

/** @type {{ to: string, label: string, end?: boolean, icon: typeof LayoutDashboard }[]} */
const NAV = [
  { to: '/', label: 'Dashboard', end: true, icon: LayoutDashboard },
  { to: '/core', label: 'Core', icon: Layers },
  { to: '/satellite', label: 'Satellite', icon: Satellite },
  { to: '/watchlist', label: 'Watchlist', icon: Radar },
  { to: '/settings', label: 'Settings', icon: Settings },
]

export function AppShell() {
  const { globalApiPaused, themeClass } = useShellUserFlags()

  const { quoteError, pricesUpdating } = useLivePrices()

  const light = themeClass === 'light'

  const showPauseBanner = globalApiPaused

  const showQuoteBanner = Boolean(quoteError)

  const bannerStack = showPauseBanner && showQuoteBanner ? 2 : showPauseBanner || showQuoteBanner ? 1 : 0

  const fixedTopUnderBanners =
    bannerStack === 2 ? 'top-[5.25rem] lg:top-[5.25rem]' : bannerStack === 1 ? 'top-12 lg:top-12' : 'top-0'

  const mainTopPad =
    bannerStack === 2 ? 'pt-[5.25rem] lg:pt-[5.25rem]' : bannerStack === 1 ? 'pt-12 lg:pt-12' : 'pt-6 lg:pt-10'

  return (
    <div
      className={`inv-shell min-h-screen ${light ? 'inv-shell-light bg-[#F4F4F8] text-[#0a0a1a]' : 'bg-[#0A0A0F] text-[#F0F0F8]'}`}
    >
      {bannerStack > 0 ? (
        <div className="sticky top-0 z-50">
          {showPauseBanner ? (
            <div className="border-b border-[rgba(239,68,68,0.55)] bg-[rgba(127,29,29,0.92)] px-4 py-2 text-center font-mono text-[11px] text-[#FEE2E2]">
              API pause is active — Gemini and Claude traffic is suspended. Clear <span className="font-semibold">global_api_pause</span> in
              Settings §10.16 to resume.
            </div>
          ) : null}

          {showQuoteBanner ? (
            <div
              role="status"

              className={`border-b px-4 py-2 text-center font-mono text-[11px] ${
                light
                  ? 'border-[rgba(180,83,9,0.35)] bg-[rgba(254,243,199,0.85)] text-[#78350f]'
                  : 'border-[rgba(245,158,11,0.45)] bg-[rgba(245,158,11,0.12)] text-[#FEF3C7]'
              }`}
            >
              Market quote refresh issue — showing last cached prices. {pricesUpdating ? 'Retrying…' : ''}

              <span className="mt-1 block opacity-90">{quoteError}</span>
            </div>
          ) : null}
        </div>
      ) : null}

      <aside
        className={`fixed left-0 z-30 hidden h-full w-[210px] shrink-0 border-r px-4 pb-10 pt-8 lg:flex lg:flex-col ${fixedTopUnderBanners} ${
          light ? 'border-[rgba(0,0,0,0.08)] bg-white' : 'border-[rgba(255,255,255,0.06)] bg-[#111118]'
        }`}
      >
        <div className="px-3">

          <p className={`font-sans text-xs font-semibold uppercase tracking-wide ${light ? 'text-[#7a7a8c]' : 'text-[#505068]'}`}>Invest</p>

          <nav className="mt-8 space-y-1">
            {NAV.map(({ to, label, end, icon: Icon }) => (
              <NavLink key={to} to={to} end={Boolean(end)} className={desktopLink(light)}>
                <Icon className="h-4 w-4 shrink-0 opacity-80" aria-hidden />

                {label}

              </NavLink>
            ))}

          </nav>
        </div>
      </aside>

      <main className={`min-h-screen flex-1 pb-24 lg:ml-[210px] lg:pb-10 ${mainTopPad}`}>
        <InvThemeProvider>
          <Outlet />
        </InvThemeProvider>
      </main>

      <nav

        aria-label="Primary"


        className={`fixed inset-x-0 bottom-0 z-40 grid min-h-[56px] grid-cols-5 gap-px border-t lg:hidden ${
          light ? 'border-[rgba(0,0,0,0.08)] bg-white' : 'border-[rgba(255,255,255,0.08)] bg-[#111118]'
        }`}

      >
        {NAV.map(({ to, label, end, icon: Icon }) => (
          <NavLink
            key={to}
            to={to}

            end={Boolean(end)}
            className={({ isActive }) =>
              `flex min-h-[44px] min-w-0 touch-manipulation flex-col items-center justify-center gap-1 px-2 py-2 font-mono text-[10px] transition-colors duration-150 ${
                isActive ? (light ? 'text-[#1D4ED8]' : 'text-[#79CBFF]') : light ? 'text-[#5c5c6e]' : 'text-[#9090A8]'
              }`
            }


          >
            <Icon className="h-[22px] w-[22px] shrink-0" aria-hidden />

            <span className="truncate px-1">{label}</span>
          </NavLink>
        ))}

      </nav>
    </div>
  )
}

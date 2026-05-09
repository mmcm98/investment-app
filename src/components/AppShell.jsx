import { NavLink, Outlet } from 'react-router-dom'
import { Layers, Radar, Satellite, Settings, LayoutDashboard } from 'lucide-react'

const desktopLink = ({ isActive }) =>
  [
    'flex items-center gap-2 rounded-md px-3 py-2 font-mono text-xs transition-colors duration-150',
    isActive
      ? 'border border-[rgba(77,184,255,0.55)] bg-[rgba(77,184,255,0.12)] text-[#79CBFF]'
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
  return (
    <div className="min-h-screen bg-[#0A0A0F] text-[#F0F0F8]">
      <aside className="fixed left-0 top-0 z-30 hidden h-full w-[210px] shrink-0 border-r border-[rgba(255,255,255,0.06)] bg-[#111118] px-4 pb-10 pt-8 lg:flex lg:flex-col">
        <div className="px-3">

          <p className="font-sans text-xs font-semibold uppercase tracking-wide text-[#505068]">Invest</p>

          <nav className="mt-8 space-y-1">
            {NAV.map(({ to, label, end, icon: Icon }) => (
              <NavLink key={to} to={to} end={Boolean(end)} className={desktopLink}>
                <Icon className="h-4 w-4 shrink-0 opacity-80" aria-hidden />

                {label}

              </NavLink>
            ))}

          </nav>
        </div>
      </aside>

      <main className="min-h-screen flex-1 pb-24 pt-6 lg:ml-[210px] lg:pb-10 lg:pt-10">
        <Outlet />
      </main>

      <nav

        aria-label="Primary"


        className="fixed inset-x-0 bottom-0 z-40 grid h-14 grid-cols-5 gap-px border-t border-[rgba(255,255,255,0.08)] bg-[#111118] lg:hidden"

      >
        {NAV.map(({ to, label, end, icon: Icon }) => (
          <NavLink
            key={to}
            to={to}

            end={Boolean(end)}
            className={({ isActive }) =>
              `flex flex-col items-center justify-center gap-1 font-mono text-[10px] transition-colors duration-150 ${
                isActive ? 'text-[#79CBFF]' : 'text-[#9090A8]'
              }`
            }


          >
            <Icon className="h-[18px] w-[18px]" aria-hidden />

            <span className="truncate px-1">{label}</span>
          </NavLink>
        ))}

      </nav>
    </div>
  )
}

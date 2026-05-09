import { NavLink, Outlet } from 'react-router-dom'

const linkCls = ({ isActive }) =>
  [
    'block rounded-md px-3 py-2 font-mono text-xs transition-colors',
    isActive
      ? 'border border-[rgba(77,184,255,0.55)] bg-[rgba(77,184,255,0.12)] text-[#79CBFF]'
      : 'border border-transparent text-[#9090A8] hover:border-[rgba(255,255,255,0.08)] hover:text-[#F0F0F8]',
  ].join(' ')

export function AppShell() {
  return (
    <div className="flex min-h-screen bg-[#0A0A0F] text-[#F0F0F8]">
      <aside className="w-[210px] shrink-0 border-r border-[rgba(255,255,255,0.06)] bg-[#111118] px-4 py-8">
        <p className="px-3 font-sans text-xs font-semibold uppercase tracking-wide text-[#505068]">Invest</p>

        <nav className="mt-6 space-y-2">
          <NavLink to="/" className={linkCls} end>
            Dashboard
          </NavLink>

          <NavLink to="/satellite" className={linkCls}>
            Satellite
          </NavLink>
        </nav>
      </aside>

      <main className="flex-1 overflow-auto">
        <Outlet />
      </main>
    </div>
  )
}

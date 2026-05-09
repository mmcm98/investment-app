import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom'
import { SharesightIntegrationProvider, useSharesightIntegration } from './context/SharesightIntegrationContext.jsx'
import { LivePricesProvider } from './context/LivePricesContext.jsx'
import { AppShell } from './components/AppShell.jsx'
import { DashboardHome } from './routes/DashboardHome.jsx'
import { OAuthCallback } from './routes/OAuthCallback.jsx'
import { AuthPage } from './routes/AuthPage.jsx'
import { SatellitePortfolio } from './routes/SatellitePortfolio.jsx'
import { PositionDetail } from './routes/PositionDetail.jsx'

function AuthLoading() {
  return (
    <div className="min-h-screen bg-[#0A0A0F] px-6 py-14 text-[#F0F0F8]">
      <div className="mx-auto w-full max-w-md rounded-xl border border-[rgba(255,255,255,0.06)] bg-[#111118] px-8 py-8">
        <p className="text-sm text-[#9090A8]">Checking authentication…</p>
      </div>
    </div>
  )
}

function MissingSupabaseConfig() {
  return (
    <div className="min-h-screen bg-[#0A0A0F] px-6 py-14 text-[#F0F0F8]">
      <div className="mx-auto w-full max-w-xl rounded-xl border border-[rgba(255,255,255,0.06)] bg-[#111118] px-8 py-8">
        <h1 className="text-xl font-semibold">Supabase not configured</h1>

        <p className="mt-4 text-sm text-[#9090A8]">
          Add{' '}
          <span className="font-mono text-[#79CBFF]">VITE_SUPABASE_URL</span> and{' '}
          <span className="font-mono text-[#79CBFF]">VITE_SUPABASE_ANON_KEY</span> to your environment files, reload the
          dev server, then try again.
        </p>
      </div>
    </div>
  )
}

function AppRoutes() {
  const ss = useSharesightIntegration()

  if (!ss.supabaseConfigured) {
    return <MissingSupabaseConfig />
  }

  /** OAuth redirect must resolve even while Supabase session is still hydrating (SPA + Sharesight callback). */
  if (!ss.authReady) {
    return (
      <Routes>
        <Route path="/callback" element={<OAuthCallback />} />

        <Route path="*" element={<AuthLoading />} />
      </Routes>
    )
  }

  return (
    <Routes>
      <Route path="/login" element={<AuthPage />} />

      <Route path="/callback" element={<OAuthCallback />} />

      <Route path="/" element={ss.userPresent ? <AppShell /> : <Navigate to="/login" replace />}>
        <Route index element={<DashboardHome />} />

        <Route path="satellite" element={<SatellitePortfolio />} />

        <Route path="satellite/position/:id" element={<PositionDetail />} />
      </Route>

      <Route path="*" element={<Navigate to={ss.userPresent ? '/' : '/login'} replace />} />
    </Routes>
  )
}

export default function App() {
  return (
    <SharesightIntegrationProvider>
      <BrowserRouter>
        <LivePricesProvider>
          <AppRoutes />
        </LivePricesProvider>
      </BrowserRouter>
    </SharesightIntegrationProvider>
  )
}

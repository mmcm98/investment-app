import { BrowserRouter, Route, Routes } from 'react-router-dom'
import { SharesightIntegrationProvider } from './context/SharesightIntegrationContext.jsx'
import { DashboardHome } from './routes/DashboardHome.jsx'
import { OAuthCallback } from './routes/OAuthCallback.jsx'

export default function App() {
  return (
    <SharesightIntegrationProvider>
      <BrowserRouter>
        <Routes>
          <Route path="/" element={<DashboardHome />} />
          <Route path="/callback" element={<OAuthCallback />} />
        </Routes>
      </BrowserRouter>
    </SharesightIntegrationProvider>
  )
}

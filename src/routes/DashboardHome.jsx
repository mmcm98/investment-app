import { useSharesightIntegration } from '../context/SharesightIntegrationContext.jsx'

export function DashboardHome() {
  const ss = useSharesightIntegration()

  const lastSyncLabel =
    ss.lastSuccessfulSyncAt && Number.isFinite(Date.parse(ss.lastSuccessfulSyncAt))
      ? new Date(ss.lastSuccessfulSyncAt).toLocaleString()
      : 'Never'

  const isConnected = Boolean(ss.oauthRow) && !ss.reconnectRequired

  const blockingMessage = !ss.supabaseConfigured
    ? 'Supabase env vars missing: `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`. Without them, Sharesight OAuth tokens cannot be stored in Postgres.'
    : !ss.userPresent
      ? 'No Supabase authenticated session detected. Sharesight OAuth + sync writes are keyed to `auth.uid()` — implement your sign-in flow, then reconnect Sharesight.'
      : null

  return (
    <div className="mx-auto flex w-full max-w-[1200px] flex-col gap-6 p-10 text-[#F0F0F8]">
      <header>
        <h1 className="text-[22px] font-semibold">Investment dashboard</h1>

        <p className="mt-2 max-w-[80ch] text-sm text-[#9090A8]">
          Sharesight is the upstream source of truth. This scaffold syncs holdings, trades, cash balances (valuation
          payload parsing), portfolio performance payloads, and per-holding income events into Supabase.
        </p>
      </header>

      <section className="rounded-xl border border-[rgba(255,255,255,0.06)] bg-[#111118] px-6 py-5 shadow-[inset_0_1px_0_rgba(255,255,255,0.04)]">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="min-w-[260px]">
            <p className="text-[10px] font-medium uppercase tracking-wide text-[#505068]">Last successful sync</p>

            <p className="mt-2 font-mono text-sm">{lastSyncLabel}</p>
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <button
              type="button"
              className="rounded-md bg-[#4DB8FF] px-4 py-2 font-mono text-sm font-semibold text-[#0A0A0F] disabled:cursor-not-allowed disabled:opacity-50"
              onClick={() => void ss.refreshSharesightNow()}
              disabled={!ss.supabaseConfigured || !ss.userPresent || ss.reconnectRequired || ss.isSyncing}
              title={
                ss.reconnectRequired ? 'Reconnect OAuth first.' : ss.isSyncing ? 'Sync in progress…' : 'Sync Sharesight'
              }
            >
              {ss.isSyncing ? 'Syncing…' : 'Refresh sharesight'}
            </button>

            <button
              type="button"
              className="rounded-md border border-[rgba(255,255,255,0.12)] px-4 py-2 font-mono text-sm text-[#F0F0F8] hover:border-[rgba(77,184,255,0.65)] hover:text-[#79CBFF] disabled:cursor-not-allowed disabled:opacity-50"
              onClick={() => ss.connectSharesight()}
              disabled={!ss.supabaseConfigured || !ss.userPresent}
            >
              {isConnected ? 'Reconnect sharesight OAuth' : 'Connect sharesight'}
            </button>
          </div>
        </div>

        {!blockingMessage ? (
          <>
            {(ss.surfaceError ?? ss.lastSyncError) ? (
              <div className="mt-5 rounded-xl border border-[rgba(245,158,11,0.35)] bg-[rgba(245,158,11,0.08)] px-5 py-4">
                <p className="text-xs font-semibold uppercase tracking-wide text-[#F59E0B]">Sync diagnostic</p>

                <pre className="mt-3 max-h-[220px] overflow-auto whitespace-pre-wrap font-mono text-xs text-[#F0F0F8]">
                  {(ss.surfaceError ?? ss.lastSyncError) ?? ''}
                </pre>
              </div>
            ) : null}

            {ss.reconnectRequired ? (
              <div className="mt-5 rounded-xl border border-[rgba(239,68,68,0.45)] bg-[rgba(239,68,68,0.10)] px-5 py-4">
                <p className="text-sm font-semibold text-[#EF4444]">Sharesight needs reconnection</p>

                <p className="mt-3 text-sm text-[#F0F0F8]">
                  Automatic sync is suspended until Sharesight OAuth is restored. Typical causes: revoked refresh token,
                  changed password/policy, stale credentials, or a failed refresh handshake.
                  {ss.oauthRow?.last_auth_error ? (
                    <>
                      {' '}
                      <span className="font-mono text-xs opacity-95">Reason: {ss.oauthRow.last_auth_error}</span>
                    </>
                  ) : null}
                </p>
              </div>
            ) : null}

            {ss.isStale && holdingsPresent(ss.holdingsCount) ? (
              <div className="mt-5 rounded-xl border border-[rgba(245,158,11,0.35)] px-5 py-4">
                <p className="text-sm font-semibold text-[#F59E0B]">Data may be stale</p>

                <p className="mt-2 text-sm text-[#9090A8]">
                  Automated sync hasn’t refreshed within the freshness window (~31 minutes since last successful sync).
                  Showing the last persisted snapshot from Supabase.
                </p>
              </div>
            ) : null}

            <div className="mt-6 grid grid-cols-1 gap-5 md:grid-cols-2">
              <div className="rounded-xl border border-[rgba(255,255,255,0.06)] bg-[#0A0A0F] px-5 py-4">
                <p className="text-[10px] font-medium uppercase tracking-wide text-[#505068]">Holdings rows (combined)</p>

                <p className="mt-3 font-mono text-[32px] font-bold leading-none text-[#4DB8FF]">
                  {typeof ss.holdingsCount === 'number' ? ss.holdingsCount : '—'}
                </p>

                {!holdingsPresent(ss.holdingsCount) && isConnected ? (
                  <p className="mt-4 text-xs text-[#9090A8]">
                    No holdings persisted yet — run sync if you haven’t, or verify Core/Satellite UUIDs match your real
                    Sharesight portfolio IDs (they may be integers on some tenants).
                  </p>
                ) : null}
              </div>

              <div className="rounded-xl border border-[rgba(255,255,255,0.06)] bg-[#0A0A0F] px-5 py-4">
                <p className="text-[10px] font-medium uppercase tracking-wide text-[#505068]">Connection summary</p>

                <dl className="mt-4 space-y-3 text-xs text-[#9090A8]">
                  <div className="flex items-center justify-between gap-4 border-b border-[rgba(255,255,255,0.06)] pb-3">
                    <dt>Connected</dt>
                    <dd className={`font-mono ${isConnected ? 'text-[#22C55E]' : 'text-[#9090A8]'}`}>{`${isConnected}`}</dd>
                  </div>

                  <div className="flex items-center justify-between gap-4 border-b border-[rgba(255,255,255,0.06)] pb-3">
                    <dt>Syncing</dt>
                    <dd className="font-mono text-[#F0F0F8]">{`${ss.isSyncing}`}</dd>
                  </div>

                  <div className="flex items-start justify-between gap-4 pt-2">
                    <dt>Reconnect required</dt>
                    <dd className="max-w-[60%] text-right font-mono text-[#F0F0F8]">{`${ss.reconnectRequired}`}</dd>
                  </div>
                </dl>
              </div>
            </div>
          </>
        ) : (
          <div className="mt-5 rounded-xl border border-[rgba(77,184,255,0.35)] bg-[rgba(77,184,255,0.08)] px-5 py-4">
            <p className="text-sm font-semibold text-[#4DB8FF]">Setup needed</p>

            <p className="mt-3 text-sm text-[#F0F0F8]">{blockingMessage}</p>
          </div>
        )}
      </section>
    </div>
  )
}

/** @param {number | null} count */
function holdingsPresent(count) {
  return typeof count === 'number' && Number.isFinite(count) && count > 0
}

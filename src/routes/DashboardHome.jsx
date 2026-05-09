import { useNavigate } from 'react-router-dom'
import { DcaWidget } from '../components/DcaWidget.jsx'
import { useSharesightIntegration } from '../context/SharesightIntegrationContext.jsx'
import { useLivePrices } from '../context/LivePricesContext.jsx'

/** @param {number | null | undefined} n */
function fmtAud(n) {
  if (n == null || !Number.isFinite(n)) return '—'

  return n.toLocaleString('en-AU', {
    style: 'currency',
    currency: 'AUD',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })
}

/** @param {number | null | undefined} n */
function fmtNum(n) {
  if (n == null || !Number.isFinite(n)) return '—'

  return n.toLocaleString('en-AU', { minimumFractionDigits: 2, maximumFractionDigits: 4 })
}

export function DashboardHome() {
  const navigate = useNavigate()
  const ss = useSharesightIntegration()
  const lp = useLivePrices()

  const lastSyncLabel =
    ss.lastSuccessfulSyncAt && Number.isFinite(Date.parse(ss.lastSuccessfulSyncAt))
      ? new Date(ss.lastSuccessfulSyncAt).toLocaleString()
      : 'Never'

  const isConnected = Boolean(ss.oauthRow) && !ss.reconnectRequired

  const blockingMessage = !ss.supabaseConfigured
    ? 'Supabase env vars missing: `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`. Without them, Sharesight OAuth tokens cannot be stored in Postgres.'
    : null

  return (
    <div className="mx-auto flex w-full max-w-[1200px] flex-col gap-6 p-10 text-[#F0F0F8]">
      <header>
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h1 className="text-[22px] font-semibold">Investment dashboard</h1>

            <p className="mt-2 max-w-[80ch] text-sm text-[#9090A8]">
              Sharesight is the upstream source of truth. This scaffold syncs holdings, trades, cash balances (valuation
              payload parsing), portfolio performance payloads, and per-holding income events into Supabase.
            </p>
          </div>

          <button
            type="button"
            className="rounded-md border border-[rgba(255,255,255,0.12)] px-3 py-2 font-mono text-xs text-[#F0F0F8] hover:border-[rgba(77,184,255,0.65)] hover:text-[#79CBFF] disabled:cursor-not-allowed disabled:opacity-50"
            disabled={!ss.supabaseConfigured}
            onClick={async () => {
              await ss.signOut()

              navigate('/login', { replace: true })
            }}
          >
            Sign out
          </button>
        </div>
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
              disabled={!ss.supabaseConfigured || ss.reconnectRequired || ss.isSyncing}
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
              disabled={!ss.supabaseConfigured}
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

            {holdingsPresent(ss.holdingsCount) ? (
              <div className="mt-8 rounded-xl border border-[rgba(255,255,255,0.06)] bg-[#0A0A0F] px-5 py-4">
                <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[rgba(255,255,255,0.06)] pb-4">
                  <div>
                    <p className="text-[10px] font-medium uppercase tracking-wide text-[#505068]">Live prices cache</p>

                    <p className="mt-2 text-xs text-[#9090A8]">
                      Yahoo Finance via{' '}
                      <span className="font-mono text-[#79CBFF]">yahoo-finance2</span> (server-side) · FMP{' '}
                      <span className="font-mono text-[#79CBFF]">/quote</span> fallback · FX majors every{' '}
                      <span className="font-mono text-[#F0F0F8]">5</span>m · quotes tick only when exchange session is open
                      (§10.15).
                      {lp.pricesUpdating ? (
                        <span aria-live="polite" className="ml-2 inline-flex items-center rounded border border-[rgba(245,158,11,0.45)] bg-[rgba(245,158,11,0.12)] px-2 py-0.5 font-mono text-[10px] uppercase tracking-wide text-[#FCD34D]">
                          updating…
                        </span>
                      ) : null}
                    </p>
                  </div>

                  <button
                    type="button"
                    className="rounded-md border border-[rgba(255,255,255,0.12)] px-3 py-2 font-mono text-xs text-[#F0F0F8] hover:border-[rgba(77,184,255,0.65)] hover:text-[#79CBFF] disabled:cursor-not-allowed disabled:opacity-50"
                    disabled={lp.pricesUpdating}
                    onClick={() => void lp.refreshMarketData()}
                  >
                    {lp.pricesUpdating ? 'Refreshing…' : 'Refresh prices now'}
                  </button>
                </div>

                {lp.quoteError ? (
                  <p className="mt-4 font-mono text-xs text-[#EF4444]">{lp.quoteError}</p>
                ) : (
                  <p className="mt-4 hidden text-[10px] text-[#505068] xl:block">
                    Local dev: run <span className="font-mono text-[#79CBFF]">npm run dev:market-api</span> alongside Vite so
                    <span className="font-mono"> /api/market/batch </span>
                    resolves. Deployed on Vercel uses <span className="font-mono">api/market/batch.js</span>.
                  </p>
                )}

                <div className="mt-5 overflow-x-auto">
                  <table className="w-full min-w-[880px] border-collapse text-left text-sm">
                    <thead>
                      <tr className="border-b border-[rgba(255,255,255,0.06)] text-[10px] font-semibold uppercase tracking-wide text-[#505068]">
                        <th className="py-3 pr-3">Portfolio</th>
                        <th className="py-3 pr-3 font-mono">Symbol</th>
                        <th className="py-3 pr-3 font-mono">Yahoo</th>

                        <th className="py-3 pr-3">Instrument</th>
                        <th className="py-3 pr-3 text-right font-mono">Last (AUD)</th>
                        <th className="py-3 pr-3 text-right font-mono">ATH (AUD)</th>
                        <th className="py-3 pr-3 text-right font-mono">Native</th>
                        <th className="py-3 pr-3 font-mono">Src</th>
                      </tr>
                    </thead>

                    <tbody>
                      {lp.mergedRows.length === 0 ? (
                        <tr>
                          <td colSpan={8} className="py-6 text-xs text-[#9090A8]">
                            No holdings rows matched with quote cache yet. Run Sharesight sync, then quote refresh completes on a
                            short timer.
                          </td>
                        </tr>
                      ) : (
                        lp.mergedRows.map((row, idx) => (
                          <tr
                            key={`${row.portfolio_role}-${row.holding_external_id}-${idx}`}
                            className="border-b border-[rgba(255,255,255,0.04)] hover:bg-[rgba(255,255,255,0.02)]"
                          >
                            <td className="py-3 pr-3 font-mono text-xs capitalize text-[#9090A8]">{row.portfolio_role}</td>
                            <td className="py-3 pr-3 font-mono text-[#F0F0F8]">{row.instrument_symbol ?? '—'}</td>
                            <td className="py-3 pr-3 font-mono text-xs text-[#79CBFF]">{row.yahoo_symbol}</td>

                            <td className="py-3 pr-3 text-xs text-[#F0F0F8]">
                              <div className="max-w-[220px] truncate" title={`${row.instrument_name ?? ''}`}>
                                {row.instrument_name ?? '—'}
                              </div>
                            </td>
                            <td className="py-3 pr-3 text-right font-mono text-[#F0F0F8]">
                              <span>{fmtAud(row.display_aud)}</span>
                              {lp.pricesUpdating && row.display_aud != null ? (
                                <span aria-hidden className="ml-1 text-[10px] text-[#F59E0B]">
                                  · refreshing
                                </span>
                              ) : null}
                              {row.display_aud == null &&
                              row.display_native == null &&
                              row.sharesight_market_value != null ? (
                                <span className="mt-1 block text-[10px] text-[#505068]" title="Broker snapshot from Sharesight sync">
                                  snapshot {fmtAud(row.sharesight_market_value)}
                                </span>
                              ) : null}
                            </td>
                            <td className="py-3 pr-3 text-right font-mono text-xs text-[#9090A8]">
                              {fmtAud(row.ath)}
                              {row.ath_as_of ? (
                                <span className="mt-1 block text-[10px] text-[#505068]">{row.ath_as_of}</span>
                              ) : null}
                            </td>
                            <td className="py-3 pr-3 text-right font-mono text-xs text-[#9090A8]">{fmtNum(row.display_native)}</td>
                            <td className="py-3 pr-3 font-mono text-[10px] uppercase text-[#505068]">
                              {row.quote_source ?? '—'}
                            </td>
                          </tr>
                        ))
                      )}
                    </tbody>
                  </table>
                </div>
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

            <DcaWidget />
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

import { useCallback, useEffect, useMemo, useState } from 'react'

import { Link } from 'react-router-dom'

import { DangerConfirmTypingModal } from './DangerConfirmModal.jsx'

import { useSettingsController } from '../../hooks/useSettingsController.js'

import { parseTierBands } from '../../lib/dca/tierMultiplier.js'

import { mergeUserPreferences } from '../../lib/settings/mergeUserPreferences.js'

import { notifyUserSettingsUpdated } from '../../lib/settings/settingsEvents.js'

import {
  clearBriefingHistory,
  clearScoreHistory,
  clearUnattachedAnnouncements,
  deleteAllPortfolioProjectData,
} from '../../lib/settings/dangerDeletes.js'

/** @param {{ title: string, children?: import('react').ReactNode }} p */

function SectionCard({ title, children }) {
  return (
    <section className="rounded-xl border border-[rgba(255,255,255,0.08)] bg-[#111118] p-5">
      <h2 className="font-sans text-base font-semibold text-[#F0F0F8]">{title}</h2>

      <div className="mt-4 space-y-4 text-sm text-[#D6D6E8]">{children}</div>
    </section>
  )
}

/** @param {{ label: string, children?: import('react').ReactNode }} p */

function Field({ label, children }) {
  return (
    <label className="block space-y-1.5">
      <span className="text-[11px] uppercase tracking-wide text-[#707088]">{label}</span>

      {children}
    </label>
  )
}

/** @typedef {{ cls: string }} InputCls */

/** @returns {InputCls['cls']} */

function inputCls() {
  return 'w-full rounded-md border border-[rgba(255,255,255,0.12)] bg-[#0A0A0F] px-3 py-2 font-mono text-xs text-[#F0F0F8] outline-none focus:border-[rgba(77,184,255,0.55)] disabled:opacity-45'
}

function btnPri() {
  return 'rounded-md border border-[rgba(77,184,255,0.55)] bg-[rgba(77,184,255,0.12)] px-4 py-2 font-mono text-xs text-[#79CBFF] disabled:cursor-not-allowed disabled:opacity-35'
}

function btnGhost() {
  return 'rounded-md border border-[rgba(255,255,255,0.12)] px-3 py-2 font-mono text-xs hover:border-[rgba(77,184,255,0.35)] disabled:opacity-35'
}

/**
 * @param {{ checked: boolean, onChange: (v: boolean) => void, label: string }} p
 */

function Toggle({ checked, onChange, label }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      onClick={() => onChange(!checked)}
      className={`flex w-full items-center justify-between gap-4 rounded-lg border px-3 py-2 font-mono text-[11px] ${
        checked ? 'border-[rgba(77,184,255,0.45)] bg-[rgba(77,184,255,0.08)] text-[#79CBFF]' : 'border-[rgba(255,255,255,0.06)] bg-[#0A0A0F] text-[#9090A8]'
      }`}
    >
      <span className="text-left">{label}</span>

      <span className="shrink-0 font-semibold">{checked ? 'On' : 'Off'}</span>
    </button>
  )
}

/**
 * @param {{ bands: Array<{maxPct: number|null, multiplier: number}>, setBands: (b: typeof bands) => void, label: string }} p
 */

function TierBandsEditor({ bands, setBands, label }) {
  return (
    <div className="space-y-2 rounded-lg border border-[rgba(255,255,255,0.06)] bg-[#0A0A0F] p-3">
      <div className="font-mono text-[11px] text-[#79CBFF]">{label}</div>

      {bands.map((b, idx) => (
        <div

          key={`${label}-${idx}-${b.multiplier}-${b.maxPct === null ? 'tail' : b.maxPct}`}

          className="grid grid-cols-[1fr_1fr_auto] gap-2"

        >
          <Field label="≤ % from ATH">
            <input
              type="number"
              className={inputCls()}
              placeholder="null tail"
              value={b.maxPct == null ? '' : `${b.maxPct}`}
              onChange={(e) => {
                const raw = e.target.value.trim()

                const next = bands.map((row, i) => (i !== idx ? row : { ...row, maxPct: raw === '' ? null : Number.parseFloat(raw) }))

                setBands(next)
              }}
            />
          </Field>

          <Field label="× mult">
            <input
              type="number"
              step="0.05"
              className={inputCls()}
              value={`${b.multiplier}`}
              onChange={(e) => {
                const v = Number.parseFloat(e.target.value)

                const next = bands.map((row, i) => (i !== idx ? row : { ...row, multiplier: Number.isFinite(v) ? v : row.multiplier }))

                setBands(next)
              }}
            />
          </Field>

          <div className="flex items-end">
            <button
              type="button"
              className={btnGhost()}
              disabled={bands.length <= 2}
              onClick={() => setBands(bands.filter((_, i) => i !== idx))}
            >
              ×
            </button>
          </div>
        </div>
      ))}

      <button
        type="button"
        className={`${btnGhost()} mt-2 w-full`}
        onClick={() => {
          const next = [...bands]

          const tail = next[next.length - 1]

          if (!tail || tail.maxPct !== null) return

          next.splice(next.length - 1, 0, { maxPct: 25, multiplier: 1 })

          setBands(next)
        }}
      >
        + Insert tier row before tail
      </button>
    </div>
  )
}

function cloneBands(bands) {
  return bands.map((b) => ({ maxPct: b.maxPct, multiplier: b.multiplier }))
}

function downloadBlob(filename, mime, contents) {
  const blob = new Blob([contents], { type: mime })

  const url = URL.createObjectURL(blob)

  const a = document.createElement('a')

  a.href = url

  a.download = filename

  document.body.appendChild(a)

  a.click()

  a.remove()

  URL.revokeObjectURL(url)
}

const NAV = /** @type {const} */ ([
  ['s101', '10.1 Portfolio'],
  ['s102', '10.2 DCA'],
  ['s103', '10.3 Satellite rules'],
  ['s104', '10.4 API keys'],
  ['s105', '10.5 Refresh'],
  ['s106', '10.6 Notifications'],
  ['s107', '10.7 Scoring'],
  ['s108', '10.8 Core ETFs'],
  ['s109', '10.9 Satellite positions'],
  ['s110', '10.10 Watchlist'],
  ['s111', '10.11 Benchmark'],
  ['s112', '10.12 Appearance'],
  ['s113', '10.13 Export'],
  ['s114', '10.14 Danger zone'],
  ['s115', '10.15 Exchanges'],
  ['s116', '10.16 API Pause'],
])

export function SettingsModule() {
  const s = useSettingsController()

  const [tierStd, setTierStd] = useState(cloneBands(s.resolvedSchedules.standard))

  const [tierGh, setTierGh] = useState(cloneBands(s.resolvedSchedules.ghhf))

  const [exchangeDraft, setExchangeDraft] = useState(() => [...s.exchanges])

  /** @typedef {Partial<typeof s.coreEtfs[number]> & Record<string, unknown>} CoreDraft */

  /** @type {[Record<string, unknown>[], React.Dispatch<React.SetStateAction<Record<string, unknown>[]>>]} */

  const [coreDraft, setCoreDraft] = useState([])

  const [danger, setDanger] = useState(/** @type {string|null} */ (null))

  const [dangerBusy, setDangerBusy] = useState(false)

  const [msg, setMsg] = useState(/** @type {string|null} */ (null))

  const [tierErr, setTierErr] = useState(/** @type {string|null} */ (null))

  /* Sync server rows into editors after load navigations */

  /* eslint-disable react-hooks/set-state-in-effect */

  useEffect(() => {

    if (!s.loading) {

      setTierStd(cloneBands(s.resolvedSchedules.standard))

      setTierGh(cloneBands(s.resolvedSchedules.ghhf))

      setExchangeDraft([...s.exchanges])

      setCoreDraft(JSON.parse(JSON.stringify(s.coreEtfs)))
    }

  }, [s.loading, s.rawTierSchedules, s.coreEtfs, s.exchanges, s.resolvedSchedules])

  /* eslint-enable react-hooks/set-state-in-effect */

  const prefs = mergeUserPreferences(s.mergedPrefs)

  const fmpKey = `${import.meta.env.VITE_FMP_API_KEY ?? ''}`.trim()

  const anthKey = `${import.meta.env.VITE_ANTHROPIC_API_KEY ?? ''}`.trim()

  const gemKey = `${import.meta.env.VITE_GEMINI_API_KEY ?? ''}`.trim()

  const weightsSum = useMemo(() => coreDraft.reduce((acc, r) => (Reflect.get(r, 'archived') ? acc : acc + Number(Reflect.get(r, 'target_weight_pct'))), 0), [coreDraft])

  const weightsExact = Math.round(weightsSum * 1000) === 100 * 1000

  const persistMergedPrefs = useCallback(
    async (nextMerged) => {
      await s.savePreferencesMerged(nextMerged)

      setMsg('Saved')

      notifyUserSettingsUpdated()
    },

    [s],
  )

  if (s.loading) {
    return <p className="text-sm text-[#9090A8]">Loading settings…</p>
  }

  if (s.error) {
    return <div className="rounded-lg border border-[rgba(239,68,68,0.4)] px-4 py-3 font-mono text-xs text-[#FECACA]">{s.error}</div>
  }

  return (
    <div className="flex gap-10">
      <nav className="sticky top-6 hidden h-[calc(100vh-4rem)] w-[200px] shrink-0 overflow-y-auto font-mono text-[10px] text-[#707088] lg:block">
        {NAV.map(([id, name]) => (
          <a key={id} href={`#${id}`} className="mb-1 block truncate rounded px-2 py-1 hover:bg-[rgba(255,255,255,0.04)] hover:text-[#79CBFF]">
            {name}

          </a>
        ))}
      </nav>

      <div className="min-w-0 flex-1 space-y-10">
        {msg ? (
          <div className="rounded-md border border-[rgba(74,222,128,0.35)] bg-[rgba(74,222,128,0.08)] px-3 py-2 font-mono text-[11px] text-[#86EFAC]">
            {msg}

            <button type="button" className="ml-3 underline" onClick={() => setMsg(null)}>
              dismiss
            </button>
          </div>
        ) : null}

        <SectionCard title="10.1 Portfolio configuration">
          <div id="s101" className="-mt-24 block h-24" aria-hidden />

          <Field label="Core target %">
            <input
              key={`core-${Reflect.get(s.settingsRow ?? {}, 'updated_at')}`}
              type="number"
              className={inputCls()}
              defaultValue={`${Reflect.get(s.settingsRow ?? {}, 'core_target_pct') ?? 72}`}
              disabled={s.saving}
              onBlur={async (e) => {
                const v = Number.parseFloat(e.target.value)

                if (!Number.isFinite(v)) return

                await s.saveUserSettingsPatch({ core_target_pct: v })
              }}
            />
          </Field>

          <Field label="Satellite target %">
            <input
              key={`sat-${Reflect.get(s.settingsRow ?? {}, 'updated_at')}`}
              type="number"
              className={inputCls()}
              defaultValue={`${Reflect.get(s.settingsRow ?? {}, 'satellite_target_pct') ?? 28}`}
              disabled={s.saving}
              onBlur={async (e) => {
                const v = Number.parseFloat(e.target.value)

                if (!Number.isFinite(v)) return

                await s.saveUserSettingsPatch({ satellite_target_pct: v })
              }}
            />

            <span className="mt-1 block font-mono text-[10px] text-[#505068]">
              Guidance sleeve split — must reconcile with Sharesight overlays manually if misaligned.

            </span>
          </Field>

          <Field label="External cash (AUD)">
            <input
              type="number"
              className={inputCls()}
              value={`${Reflect.get(s.settingsRow ?? {}, 'external_cash_aud') ?? 0}`}
              disabled={s.saving}
              onBlur={async (e) => {
                const v = Number.parseFloat(e.target.value)

                if (!Number.isFinite(v)) return

                await s.saveUserSettingsPatch({ external_cash_aud: v })
              }}
            />
          </Field>

          <Field label="Manual total portfolio AUD override — optional informational">
            <input
              type="number"
              className={inputCls()}
              value={`${prefs.appearance?.manual_portfolio_value_aud ?? ''}`}
              placeholder="Leave blank to use synced brokerage totals"
              onBlur={async (e) => {
                const raw = e.target.value.trim()

                const v = raw === '' ? null : Number.parseFloat(raw)

                const merged = mergeUserPreferences(prefs)

                merged.appearance = { ...(typeof merged.appearance === 'object' && merged.appearance !== null ? merged.appearance : {}), manual_portfolio_value_aud: Number.isFinite(/** @type {number} */ (v)) ? v : null }

                await persistMergedPrefs(/** @type {Record<string, unknown>} */ (merged))
              }}
            />
          </Field>
        </SectionCard>

        <SectionCard title="10.2 DCA settings">
          <div id="s102" className="-mt-24 block h-24" aria-hidden />

          <Field label="Base weekly amount (AUD)">
            <input
              type="number"
              className={inputCls()}
              disabled={s.saving}
              defaultValue={`${Reflect.get(s.settingsRow ?? {}, 'weekly_dca_base_aud') ?? 350}`}
              onBlur={async (e) => {
                const v = Number.parseFloat(e.target.value)

                if (!Number.isFinite(v)) return

                await s.saveUserSettingsPatch({ weekly_dca_base_aud: v })
              }}
            />
          </Field>

          <Field label="Target guidance day">
            <input
              key={`day-${Reflect.get(s.settingsRow ?? {}, 'updated_at')}`}
              type="text"
              className={inputCls()}
              disabled={s.saving}
              defaultValue={`${prefs.dca_target_day ?? 'Tuesday'}`}
              onBlur={(e) => void persistMergedPrefs({ ...prefs, dca_target_day: e.target.value })}
            />

            <span className="font-mono text-[10px] text-[#505068]">Not enforced — discretionary execution.</span>
          </Field>

          <Field label="Core ETF allocations (active list) running sum">
            <p className="font-mono text-xs text-[#79CBFF]">
              Σ target weights:&nbsp ;

              <span className={weightsExact ? '' : 'text-[#FCA5A5]'}>{weightsSum.toFixed(3)}</span>%

              {!weightsExact ? <span className="text-[#FCA5A5]"> — must equal 100.000% before saving weights</span> : null}

            </p>

            <p className="text-xs text-[#707088]">Full editor in §10.8 — mirrored here while you iterate.</p>
          </Field>

          {tierErr ? <div className="rounded border border-[#F8717144] px-3 py-2 font-mono text-[11px] text-[#FCA5A5]">{tierErr}</div> : null}

          <TierBandsEditor bands={tierStd} setBands={setTierStd} label="Standard ladder (DHHF / EXUS / BEMG)" />

          <TierBandsEditor bands={tierGh} setBands={setTierGh} label="GHHF ladder" />

          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              className={`${btnPri()} whitespace-nowrap`}
              disabled={s.saving}
              onClick={async () => {
                setTierErr(null)

                const parsedS = parseTierBands(tierStd)

                const parsedG = parseTierBands(tierGh)

                if (!parsedS || !parsedG) {
                  setTierErr('Tier ladders invalid: strictly ascending finite caps ending with tail maxPct:null.')

                  return
                }

                await s.saveUserSettingsPatch({ tier_schedules: { standard: parsedS, ghhf: parsedG } })

                setMsg('Tier schedules saved')
              }}
            >
              Save tier schedules
            </button>
          </div>
        </SectionCard>

        <SectionCard title="10.3 Satellite allocation rules">
          <div id="s103" className="-mt-24 block h-24" aria-hidden />

          {(() => {
            const sar =
              typeof prefs.satellite_allocation_rules === 'object' && prefs.satellite_allocation_rules !== null
                ? /** @type {Record<string, unknown>} */ (prefs.satellite_allocation_rules)
                : {}

            return [
              ['max_position_pct_cap', 'Max satellite position cap % (leave empty = off)'],
              ['haircut_threshold', 'Haircut score threshold'],
              ['haircut_multiplier', 'Haircut multiplier (e.g. 0.5)'],
              ['buy_zone_unlock_threshold', 'Buy-zone unlock gate %'],
              ['rebalance_trigger_pct', 'Rebalance drift flag % vs guidance'],
            ].map(([k, lbl]) => (
              <Field key={`${k}`} label={`${lbl}`}>
                <input
                  type="number"
                  className={inputCls()}
                  value={
                    k === 'max_position_pct_cap'
                      ? `${sar[k] == null ? '' : sar[k]}`
                      : `${typeof sar[k] === 'number' || typeof sar[k] === 'string' ? sar[k] : ''}`
                  }
                  onBlur={async (e) => {
                    const merged = mergeUserPreferences(prefs)

                    const sr = {

                      ...(typeof merged.satellite_allocation_rules === 'object' && merged.satellite_allocation_rules !== null
                        ? /** @type {Record<string, unknown>} */ (merged.satellite_allocation_rules)
                        : {}),
                    }

                    const raw = e.target.value.trim()

                    if (k === 'max_position_pct_cap') {
                      sr[k] = raw === '' ? null : Number.parseFloat(raw)
                    } else {
                      sr[k] = Number.parseFloat(raw)
                    }

                    merged.satellite_allocation_rules = sr

                    await persistMergedPrefs(/** @type {Record<string, unknown>} */ (merged))
                  }}
                />
              </Field>
            ))
          })()}
        </SectionCard>

        <SectionCard title="10.4 API keys and connections">
          <div id="s104" className="-mt-24 block h-24" aria-hidden />

          <dl className="grid gap-4 font-mono text-[11px]">
            <div>
              <dt className="text-[#79CBFF]">Sharesight</dt>

              <dd className="mt-1 text-[#9090A8]">
                Status:{' '}

                <span className="text-[#F0F0F8]">{s.oauthRow?.access_token ? 'Connected (+ tokens stored in Postgres)' : 'Disconnected / needs OAuth'}</span>

                <button type="button" className={`${btnPri()} mt-3`} onClick={() => s.connectSharesight()}>
                  Connect / reconnect Sharesight

                </button>

                <button
                  type="button"
                  disabled={s.isSyncing}
                  className={`${btnGhost()} ml-2 mt-3 disabled:opacity-45`}
                  onClick={() => void s.refreshSharesightNow()}
                >
                  {s.isSyncing ? 'Syncing…' : 'Test sync now'}

                </button>

                {s.isSyncing && s.syncPhaseLabel ? (
                  <span className="mt-2 block font-mono text-[10px] text-[#79CBFF]" aria-live="polite">
                    {s.syncPhaseLabel}

                  </span>
                ) : null}
              </dd>
            </div>

            <div>
              <dt className="text-[#79CBFF]">Supabase session</dt>

              <dd className="mt-1 text-[#9090A8]">Active when you can read this row — bearer auth via console.</dd>
            </div>

            <div>
              <dt className="text-[#79CBFF]">FMP / Anthropic / Gemini (bundle)</dt>

              <dd className="mt-1 text-[#9090A8]">
                Configure via <span className="font-mono text-[#FCD34D]">VITE_*</span> env keys (browser-exposed bundle). Presence:
                {' '}

                {[['FMP', fmpKey.length > 8], ['Claude', anthKey.length > 8], ['Gemini', gemKey.length > 8]]

                  .map(([n, ok]) => `${n}:${ok ? 'set' : 'missing'}`)
                  .join(' · ')}

              </dd>
            </div>

            <div>
              <dt className="text-[#79CBFF]">Yahoo Finance</dt>

              <dd className="mt-1 text-[#9090A8]">Live prices via bundled client — API keyless.</dd>
            </div>
          </dl>
        </SectionCard>

        <SectionCard title="10.5 Data refresh preferences">
          <div id="s105" className="-mt-24 block h-24" aria-hidden />

          {([
            ['live_price_refresh_minutes', 'Live price refresh cadence notes (minutes)'],
            ['sharesight_sync_minutes', 'Sharesight autosync spacing (planned)'],
            ['ath_refresh', 'ATH refresh preset label'],
          ]).map(([k, lbl]) => (
            <Field key={`${k}`} label={`${lbl}`}>
              <input
                className={inputCls()}
                value={`${prefs.data_refresh[k] ?? ''}`}
                onBlur={async (e) => {
                  const merged = mergeUserPreferences(prefs)

                  merged.data_refresh = {

                    ...merged.data_refresh,

                    [k]: k.endsWith('_minutes') ? Number.parseFloat(e.target.value) || 0 : e.target.value,

                  }

                  await persistMergedPrefs(/** @type {Record<string, unknown>} */ (merged))
                }}
              />
            </Field>
          ))}

          <Toggle checked={prefs.data_refresh.fmp_refresh_mode_auto} onChange={async (v) => persistMergedPrefs({ ...prefs, data_refresh: { ...prefs.data_refresh, fmp_refresh_mode_auto: v } })} label="FMP fundamentals: automatic cadence vs on-demand" />

          <Toggle
            checked={prefs.data_refresh.watchlist_auto_monitor}
            onChange={async (v) => persistMergedPrefs({ ...prefs, data_refresh: { ...prefs.data_refresh, watchlist_auto_monitor: v } })}
            label="Watchlist twice-daily auto-monitoring toggle"
          />

          <Field label="Threshold when monitoring on">
            <input
              type="number"
              className={inputCls()}
              value={`${prefs.data_refresh.watchlist_auto_monitor_threshold}`}
              onBlur={async (e) => persistMergedPrefs({ ...prefs, data_refresh: { ...prefs.data_refresh, watchlist_auto_monitor_threshold: Number(e.target.value) } })}
            />
          </Field>
        </SectionCard>

        <SectionCard title="10.6 Notification settings">
          <div id="s106" className="-mt-24 block h-24" aria-hidden />

          <p className="text-xs text-[#707088]">API Pause uses a global banner (always on while pause is active) — see §10.16.</p>

          {(
            /** @type {[keyof typeof prefs.notifications, string][]} */
            [
              ['buy_zone_satellite', 'Buy zone — satellite'],
              ['buy_zone_watchlist', 'Buy zone — watchlist'],
              ['exit_trigger', 'Exit trigger identified'],
              ['price_sensitive_announcement', 'Price-sensitive announcement'],
              ['weekly_dca_reminder', 'Weekly DCA reminder (browser)'],
              ['reanalysis_recommended', 'Re-analysis recommended (90+ days)'],
              ['sharesight_sync_failure', 'Sharesight sync failure'],
              ['fmp_incomplete_data', 'FMP incomplete dataset'],
              ['monthly_api_spend_alert', 'Monthly API spend alert'],
            ]
          ).map(([k, label]) => (
            <Toggle
              key={k}
              label={label}
              checked={prefs.notifications[k] === true}
              onChange={(v) =>
                void persistMergedPrefs({ ...prefs, notifications: { ...prefs.notifications, [k]: v } })
              }
            />
          ))}
        </SectionCard>

        <SectionCard title="10.7 Scoring and analysis settings">
          <div id="s107" className="-mt-24 block h-24" aria-hidden />

          {(
            [
              ['reanalysis_days', 'Re-analysis threshold (days)', 'col'],
              ['refire_days_after_dismiss', 'Re-fire interval after dismiss', 'col'],
              ['announcement_retention_days', 'Unattached announcement retention (days)', 'col'],
              ['score_version_cap', 'Score versions kept per position', 'col'],
              ['briefing_retention', 'Briefing retention preset (1y | 2y | 5y | all)', 'select'],
            ]
          ).map(([col, label]) => {
            if (col === 'briefing_retention') {
              return (
                <Field key={`${col}`} label={`${label}`}>
                  <select
                    className={inputCls()}
                    value={`${Reflect.get(s.settingsRow ?? {}, col) ?? 'all'}`}
                    onChange={async (e) => {
                      await s.saveUserSettingsPatch({ [col]: e.target.value })
                    }}
                  >
                    {['1y', '2y', '5y', 'all'].map((o) => (
                      <option key={o} value={o}>
                        {o}

                      </option>
                    ))}
                  </select>
                </Field>
              )
            }

            return (
              <Field key={`${col}`} label={`${label}`}>
                <input
                  type="number"
                  className={inputCls()}
                  defaultValue={`${Reflect.get(s.settingsRow ?? {}, col) ?? ''}`}
                  onBlur={async (e) => {
                    const v = Number.parseInt(e.target.value, 10)

                    if (!Number.isFinite(v)) return

                    await s.saveUserSettingsPatch({ [col]: v })
                  }}
                />
              </Field>
            )
          })}

          <Toggle
            checked={prefs.scoring.auto_analyse_price_sensitive === true}
            onChange={(v) => void persistMergedPrefs({ ...prefs, scoring: { ...prefs.scoring, auto_analyse_price_sensitive: v } })}
            label="Auto-analyse price-sensitive announcements"
          />

          <Toggle
            checked={prefs.scoring.framework_auto_suggest !== false}
            onChange={(v) => void persistMergedPrefs({ ...prefs, scoring: { ...prefs.scoring, framework_auto_suggest: v } })}
            label="Framework auto-suggest"
          />

          <Field label="Monthly API spend threshold (AUD, rough)">
            <input
              key={`spend-${Reflect.get(s.settingsRow ?? {}, 'updated_at')}`}
              type="number"
              className={inputCls()}
              defaultValue={`${prefs.scoring.monthly_api_spend_threshold_aud ?? 50}`}
              onBlur={(e) =>
                void persistMergedPrefs({
                  ...prefs,
                  scoring: { ...prefs.scoring, monthly_api_spend_threshold_aud: Number.parseFloat(e.target.value) || 0 },
                })
              }
            />

            <span className="mt-1 block font-mono text-[10px] text-[#606078]">Alerts only when §10.6 spend toggle is on.</span>
          </Field>

          <Field label="Claude / Gemini model aliases (for operator reference)">
            <div className="grid gap-2 lg:grid-cols-2">
              <input
                key={`cm-${Reflect.get(s.settingsRow ?? {}, 'updated_at')}`}
                className={inputCls()}
                defaultValue={`${prefs.scoring.claude_model ?? ''}`}
                onBlur={(e) =>
                  void persistMergedPrefs({ ...prefs, scoring: { ...prefs.scoring, claude_model: e.target.value } })
                }
              />

              <input
                key={`gm-${Reflect.get(s.settingsRow ?? {}, 'updated_at')}`}
                className={inputCls()}
                defaultValue={`${prefs.scoring.gemini_model ?? ''}`}
                onBlur={(e) =>
                  void persistMergedPrefs({ ...prefs, scoring: { ...prefs.scoring, gemini_model: e.target.value } })
                }
              />
            </div>
          </Field>
        </SectionCard>

        <SectionCard title="10.8 Core ETF management">
          <div id="s108" className="-mt-24 block h-24" aria-hidden />

          <p className="font-mono text-xs">
            Active weight sum:{' '}

            <span className={weightsExact ? 'text-[#86EFAC]' : 'text-[#FCA5A5]'}>{weightsSum.toFixed(3)}</span>%

          </p>

          <div className="space-y-4">
            {coreDraft.map((row, idx) => (
              <div key={`${Reflect.get(row, 'id') ?? `new-${idx}`}`} className="rounded-lg border border-[rgba(255,255,255,0.06)] bg-[#0A0A0F] p-3">
                <div className="grid gap-2 lg:grid-cols-6">
                  <Field label="Ticker">
                    <input
                      className={inputCls()}
                      value={`${Reflect.get(row, 'ticker') ?? ''}`}
                      disabled={Boolean(Reflect.get(row, 'id'))}
                      onChange={(e) => {
                        const next = [...coreDraft]

                        Reflect.set(next[idx], 'ticker', e.target.value.toUpperCase())

                        setCoreDraft(next)
                      }}
                    />

                    <span className="mt-1 block font-mono text-[9px] text-[#505068]">Ticker immutable after first save (archive instead).</span>
                  </Field>

                  <Field label="Name">
                    <input
                      className={inputCls()}
                      value={`${Reflect.get(row, 'name') ?? ''}`}
                      onChange={(e) => {
                        const next = [...coreDraft]

                        Reflect.set(next[idx], 'name', e.target.value)

                        setCoreDraft(next)
                      }}
                    />
                  </Field>

                  <Field label="Target %">
                    <input
                      type="number"
                      className={inputCls()}
                      value={`${Reflect.get(row, 'target_weight_pct') ?? ''}`}
                      onChange={(e) => {
                        const next = [...coreDraft]

                        Reflect.set(next[idx], 'target_weight_pct', Number.parseFloat(e.target.value))

                        setCoreDraft(next)
                      }}
                    />
                  </Field>

                  <Field label="Tier kind">
                    <select
                      className={inputCls()}
                      value={`${Reflect.get(row, 'tier_schedule_kind') ?? 'standard'}`}
                      onChange={(e) => {
                        const next = [...coreDraft]

                        Reflect.set(next[idx], 'tier_schedule_kind', e.target.value)

                        setCoreDraft(next)
                      }}
                    >
                      <option value="standard">Standard</option>

                      <option value="ghhf">GHHF</option>

                      <option value="custom">Custom</option>
                    </select>
                  </Field>

                  <Field label="Gearing ×">
                    <input
                      type="number"
                      step="0.05"
                      className={inputCls()}
                      value={`${Reflect.get(row, 'gearing_multiple') ?? ''}`}
                      onChange={(e) => {
                        const next = [...coreDraft]

                        Reflect.set(next[idx], 'gearing_multiple', Number.parseFloat(e.target.value))

                        setCoreDraft(next)
                      }}
                    />
                  </Field>

                  <Field label="Archived">
                    <Toggle
                      checked={Boolean(Reflect.get(row, 'archived'))}
                      onChange={(v) => {
                        const next = [...coreDraft]

                        Reflect.set(next[idx], 'archived', v)

                        setCoreDraft(next)
                      }}
                      label={Reflect.get(row, 'archived') ? 'Archived' : 'Active'}

                    />
                  </Field>

                  <div className="lg:col-span-6">
                    <Field label="Custom tier JSON (when kind = custom)">
                      <textarea
                        rows={3}
                        className={`${inputCls()} resize-y font-mono`}
                        defaultValue={JSON.stringify(Reflect.get(row, 'custom_tier_schedule') ?? [], null, 2)}
                        onBlur={(e) => {
                          try {
                            const parsed = JSON.parse(e.target.value)

                            const next = [...coreDraft]

                            Reflect.set(next[idx], 'custom_tier_schedule', parsed)

                            setCoreDraft(next)
                          } catch {
                            /* keep */
                          }
                        }}
                      />
                    </Field>
                  </div>

                  <div className="lg:col-span-6">
                    <Field label="Provider URL">
                      <input
                        className={inputCls()}
                        value={`${Reflect.get(row, 'provider_page_url') ?? ''}`}
                        onChange={(e) => {
                          const next = [...coreDraft]

                          Reflect.set(next[idx], 'provider_page_url', e.target.value)

                          setCoreDraft(next)
                        }}
                      />
                    </Field>
                  </div>
                </div>
              </div>
            ))}
          </div>

          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              className={btnGhost()}
              onClick={() =>
                setCoreDraft([
                  ...coreDraft,
                  {
                    ticker: 'NEW',

                    target_weight_pct: 0,

                    tier_schedule_kind: 'standard',

                    archived: false,

                    sort_order: coreDraft.length * 10,

                    custom_tier_schedule: [],

                  },
                ])

              }

            >
              + Add ETF row

            </button>

            <button type="button" className={`${btnPri()} ${!weightsExact ? 'opacity-40' : ''}`} disabled={!weightsExact || s.saving} onClick={() => void s.saveCoreEtfsRows(coreDraft)}>
              Save core ETFs

              {!weightsExact ? ' (Σ≠100)' : ''}

            </button>
          </div>
        </SectionCard>

        <SectionCard title="10.9 Satellite position management">
          <div id="s109" className="-mt-24 block h-24" aria-hidden />

          <p className="text-xs text-[#707088]">Deep edits (overrides, buy zones, archives) live on each position screen.</p>

          <ul className="space-y-2 font-mono text-[11px]">
            {s.positions.map((p) => (
              <li key={`${Reflect.get(p, 'id')}`}>
                <Link className="text-[#79CBFF] underline" to={`/satellite/position/${Reflect.get(p, 'id')}`}>
                  {`${Reflect.get(p, 'display_ticker') ?? Reflect.get(p, 'fmp_symbol')}`.trim()}
                </Link>

                {' — '}

                {Reflect.get(p, 'archived') ? 'archived' : 'active'}

              </li>
            ))}

          </ul>
        </SectionCard>

        <SectionCard title="10.10 Watchlist management">
          <div id="s110" className="-mt-24 block h-24" aria-hidden />

          <div className="flex flex-wrap gap-2">
            <Link className={`${btnPri()} inline-flex items-center justify-center no-underline`} to="/watchlist">
              Open Watchlist workspace

            </Link>

            <button
              type="button"
              className={btnGhost()}
              onClick={() => {
                const rows = [...s.watchlistItems, ...s.watchlistArchived]

                const lines = [['ticker', 'exchange', 'yahoo', 'archived'].join(','), ...rows.map((r) => [Reflect.get(r, 'display_ticker'), Reflect.get(r, 'exchange_short_name'), Reflect.get(r, 'yahoo_symbol'), Reflect.get(r, 'archived')].map((x) => `"${`${x ?? ''}`.replaceAll('"', '""')}"`).join(','))]

                downloadBlob(`watchlist-${new Date().toISOString().slice(0, 10)}.csv`, 'text/csv;charset=utf-8', lines.join('\n'))
              }}
            >
              Export watchlist CSV

            </button>
          </div>
        </SectionCard>

        <SectionCard title="10.11 Benchmark settings">
          <div id="s111" className="-mt-24 block h-24" aria-hidden />

          <Field label="Default Yahoo symbol">
            <input
              key={`bench-sym-${Reflect.get(s.settingsRow ?? {}, 'updated_at')}`}
              className={inputCls()}
              defaultValue={`${prefs.benchmarks.default_symbol ?? 'VGS.AX'}`}
              onBlur={(e) => void persistMergedPrefs({ ...prefs, benchmarks: { ...prefs.benchmarks, default_symbol: e.target.value } })}
            />

            <span className="mt-1 block font-mono text-[10px] text-[#505068]">Feeds the dashboard overlay when configured.</span>
          </Field>

          <Field label="Display title">
            <input
              key={`bench-name-${Reflect.get(s.settingsRow ?? {}, 'updated_at')}`}
              className={inputCls()}
              defaultValue={`${prefs.benchmarks.default_display_name ?? ''}`}
              onBlur={(e) =>
                void persistMergedPrefs({ ...prefs, benchmarks: { ...prefs.benchmarks, default_display_name: e.target.value } })
              }
            />

          </Field>

          <Field label="Secondary benchmark (saved; chart wiring optional)">
            <input
              key={`bench2-${Reflect.get(s.settingsRow ?? {}, 'updated_at')}`}
              className={inputCls()}
              defaultValue={`${prefs.benchmarks.secondary_symbol ?? ''}`}
              placeholder="Optional second ticker"
              onBlur={(e) =>
                void persistMergedPrefs({ ...prefs, benchmarks: { ...prefs.benchmarks, secondary_symbol: e.target.value } })
              }
            />

          </Field>
        </SectionCard>

        <SectionCard title="10.12 Display and appearance">
          <div id="s112" className="-mt-24 block h-24" aria-hidden />

          <Toggle checked={prefs.appearance.theme === 'light'} onChange={(v) => persistMergedPrefs({ ...prefs, appearance: { ...prefs.appearance, theme: v ? 'light' : 'dark' } })} label="Light shell theme (toolbar + surrounds)" />

          <Toggle checked={prefs.satellite_show_aud_parenthetical === true} onChange={(v) => void persistMergedPrefs({ ...prefs, satellite_show_aud_parenthetical: v })} label="Show AUD parenthetical on satellite valuations" />

          <Field label="Chart default horizon">
            <select
              className={inputCls()}
              value={`${prefs.appearance.preferred_chart_period ?? '1Y'}`}
              onChange={(e) => void persistMergedPrefs({ ...prefs, appearance: { ...prefs.appearance, preferred_chart_period: e.target.value } })}
            >
              {['1M', '3M', '6M', '1Y', '2Y', 'ALL'].map((p) => (
                <option key={p} value={p}>
                  {p}

                </option>
              ))}

            </select>
          </Field>
        </SectionCard>

        <SectionCard title="10.13 Data export & backup">
          <div id="s113" className="-mt-24 block h-24" aria-hidden />

          <button

            type="button"

            className={btnGhost()}

            onClick={() => {

              const payload = {

                exported_at: new Date().toISOString(),

                user_settings: s.settingsRow,

                core_etfs: s.coreEtfs,

                satellites: { active: s.positions, archived: s.positionsArchived },

                watchlist: { active: s.watchlistItems, archived: s.watchlistArchived },

                exchanges: s.exchanges,

                preferences_preview: prefs,

              }

              downloadBlob(`portfolio-export-${new Date().toISOString().slice(0, 10)}.json`, 'application/json', JSON.stringify(payload, null, 2))

            }}

          >
            Download JSON snapshot

          </button>

          <p className="text-xs text-[#707088]">Supabase remains source of truth; run this monthly per framework guidance.</p>
        </SectionCard>

        <SectionCard title="10.14 Reset & danger zone">
          <div id="s114" className="-mt-24 block h-24" aria-hidden />

          <div className="grid gap-2 font-mono text-[11px]">
            <button type="button" className={`${btnGhost()} text-[#FECACA]`} onClick={() => setDanger('reset-tier')}>
              Reset DCA tier schedules (needs CONFIRM below)

            </button>

            <button type="button" className={`${btnGhost()} text-[#FECACA]`} onClick={() => setDanger('reset-settings')}>

              Reset all preferences + numerical settings to defaults (CONFIRM)

            </button>

            <button type="button" className={`${btnGhost()} text-[#FECACA]`} onClick={() => setDanger('announcements')}>

              Clear unattached announcements (CONFIRM)

            </button>

            <button type="button" className={`${btnGhost()} text-[#FECACA]`} onClick={() => setDanger('briefings')}>

              Clear briefing history (CONFIRM)

            </button>

            <button type="button" className={`${btnGhost()} text-[#FECACA]`} onClick={() => setDanger('scores')}>

              Clear score history — scorecards/research artefacts (CONFIRM)

            </button>

            <button type="button" className={`${btnGhost()} text-[#FECACA]`} onClick={() => setDanger('disconnect')}>

              Disconnect Sharesight OAuth row (CONFIRM)

            </button>

            <button type="button" className={`${btnPri()} mt-4 border-[rgba(239,68,68,0.45)] bg-[rgba(239,68,68,0.09)] text-[#FECACA]`} onClick={() => setDanger('nuclear')}>

              Delete all portfolio-linked Supabase rows (CONFIRM typed)

            </button>

          </div>
        </SectionCard>

        <SectionCard title="10.15 Exchange management (+ ticker suffix reference)">

          <div id="s115" className="-mt-24 block h-24" aria-hidden />

          <button type="button" className={`${btnGhost()} mb-4`} onClick={() => void s.seedExchangesIfEmpty()}>

            Seed default exchange + mapping catalogue

          </button>

          {exchangeDraft.map((row, i) => (

            <div key={`${Reflect.get(row, 'id') ?? i}`} className="mb-4 rounded-lg border border-[rgba(255,255,255,0.05)] bg-[#0B0B12] p-3">

              <div className="grid gap-2 lg:grid-cols-3">

                {(['exchange_short_name', 'timezone_label', 'market_open_local', 'market_close_local', 'announcement_source', 'fmp_symbol_format', 'yahoo_symbol_format', 'mapping_example'] ).map((key) => (

                  <Field key={key} label={key}>

                    <input className={inputCls()} value={`${Reflect.get(row, key) ?? ''}`} onChange={(e) => {

                      const next = [...exchangeDraft]

                      Reflect.set(next[i], key, e.target.value)

                      setExchangeDraft(next)

                    }} />

                  </Field>

                ))}

              </div>

              <Toggle

                checked={Boolean(Reflect.get(row, 'manual_monitoring'))}

                onChange={(v) => {

                  const next = [...exchangeDraft]

                  Reflect.set(next[i], 'manual_monitoring', v)

                  setExchangeDraft(next)

                }}

                label="Manual monitoring-only venue"

              />

            </div>

          ))}

          <div className="flex gap-2">

            <button type="button" className={btnGhost()} onClick={() => setExchangeDraft([...exchangeDraft, { exchange_short_name: 'NEW', timezone_label: 'UTC', manual_monitoring: false }])}>

              + Row

            </button>

            <button type="button" className={btnPri()} onClick={() => void s.saveExchangeRows(exchangeDraft)} disabled={s.saving}>

              Save exchanges

            </button>

          </div>

        </SectionCard>

        <SectionCard title="10.16 Global API Pause (kill-switch)">

          <div id="s116" className="-mt-24 block h-24" aria-hidden />

          <Toggle

            checked={Reflect.get(s.settingsRow ?? {}, 'global_api_pause') === true}

            onChange={async (on) => {

              await s.saveUserSettingsPatch({ global_api_pause: on })

              setMsg(on ? 'API pause enabled — Gemini/Claude calls blocked server-side.' : 'API pause cleared.')

            }}

            label="Suspend all Gemini + Claude callers (leave market data unaffected)"

          />

          <p className="rounded-md border border-[rgba(239,68,68,0.35)] px-3 py-2 font-mono text-[11px] text-[#FCA5A5]">

            When enabled, keep this visible — the navigation shell shows a banner on every route.

          </p>

        </SectionCard>

        {danger ? (

          <DangerConfirmTypingModal

            busy={dangerBusy}

            title="Confirm destructive mutation"

            body={

              danger === 'nuclear'

                ? 'Deletes portfolio-domain rows mirrored in Supabase (research artefacts, satellites, core ETFs, Sharesight-sync cache). OAuth persists unless you disconnect separately. Typed confirmation required.'

                : 'This mutation is irreversible in-app. Typed confirmation required.'

            }

            onCancel={() => setDanger(null)}

            onValidated={async () => {

              if (!s.supabase || !s.userId) return

              setDangerBusy(true)

              try {

                try {

                  if (danger === 'reset-tier') {

                    await s.saveUserSettingsPatch({ tier_schedules: null })

                  } else if (danger === 'reset-settings') {

                    const { error: rsErr } = await s.supabase.from('user_settings').upsert(

                      {

                        user_id: s.userId,

                        preferences: {},

                        core_target_pct: 72,

                        satellite_target_pct: 28,

                        weekly_dca_base_aud: 350,

                        external_cash_aud: 0,

                        global_api_pause: false,

                        tier_schedules: null,

                        reanalysis_days: 90,

                        refire_days_after_dismiss: 30,

                        announcement_retention_days: 30,

                        score_version_cap: 10,

                        briefing_retention: 'all',

                        updated_at: new Date().toISOString(),
                      },

                      { onConflict: 'user_id' },

                    )

                    if (rsErr) throw rsErr

                  } else if (danger === 'announcements') await clearUnattachedAnnouncements(s.supabase, s.userId)

                  else if (danger === 'briefings') await clearBriefingHistory(s.supabase, s.userId)

                  else if (danger === 'scores') await clearScoreHistory(s.supabase, s.userId)

                  else if (danger === 'disconnect') await s.supabase.from('sharesight_oauth_credentials').delete().eq('user_id', s.userId)

                  else if (danger === 'nuclear') await deleteAllPortfolioProjectData(s.supabase, s.userId, { includeOAuth: false })

                  await s.reloadLocalSnapshot?.()

                  await s.reload()

                  notifyUserSettingsUpdated()

                  setMsg('Danger action executed')

                } catch (err) {

                  setMsg(`Action failed — ${err instanceof Error ? err.message : String(err)}`)

                }

              } finally {

                setDangerBusy(false)

                setDanger(null)

              }

            }}

          />

        ) : null}

      </div>

    </div>

  )

}

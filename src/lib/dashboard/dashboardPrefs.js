/**
 * Persist lightweight dashboard dismissal state inside `user_settings.preferences.dashboard`.
 *
 * @typedef {{
 * dismissed_exit_positions?: Record<string, string>,
 * dismissed_buy_zone_keys?: Record<string, string>,
 * dca_week_dismissed_iso?: string|null,
 * announcements_snoozed_until?: string|null,
 * dismissed_reanalysis?: Record<string, string>,
 * }} DashboardPrefsBucket
 */

/** @param {unknown} prefs */
export function readDashboardPrefs(prefs) {
  if (!prefs || typeof prefs !== 'object') return /** @type {DashboardPrefsBucket} */ ({})

  const root = /** @type {Record<string, unknown>} */ (prefs)
  const d = Reflect.get(root, 'dashboard')

  return d && typeof d === 'object' ? /** @type {DashboardPrefsBucket} */ (d) : {}
}

/** @param {unknown} settingsRowPrefs */
export function mergeDashboardPrefs(settingsRowPrefs, patch) {
  const base = settingsRowPrefs && typeof settingsRowPrefs === 'object' ? { .../** @type {Record<string, unknown>} */ (settingsRowPrefs) } : {}

  const prevDashboard = readDashboardPrefs(base)

  const nextDashboard = {
    ...prevDashboard,
    ...patch,
  }

  return { ...base, dashboard: nextDashboard }
}

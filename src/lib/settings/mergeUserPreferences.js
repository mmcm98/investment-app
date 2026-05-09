import {
  DEFAULT_DATA_REFRESH,
  DEFAULT_NOTIFICATION_PREFS,
  DEFAULT_PREFERENCES,
  DEFAULT_SATELLITE_ALLOCATION_RULES,
} from './preferenceDefaults.js'

/**
 * Shallow-merge known nested blobs from defaults.
 *
 * @param {unknown} raw
 */

export function mergeUserPreferences(raw) {
  /** @type {Record<string, unknown>} */

  const p = typeof raw === 'object' && raw !== null ? { .../** @type {Record<string, unknown>} */ (raw) } : {}

  /** @type {Record<string, unknown>} */

  const satRules = {
    ...DEFAULT_SATELLITE_ALLOCATION_RULES,
    ...(typeof p.satellite_allocation_rules === 'object' && p.satellite_allocation_rules !== null
      ? /** @type {Record<string, unknown>} */ (p.satellite_allocation_rules)
      : {}),
  }

  /** @type {Record<string, unknown>} */

  const dataRefresh = {
    ...DEFAULT_DATA_REFRESH,
    ...(typeof p.data_refresh === 'object' && p.data_refresh !== null ? /** @type {Record<string, unknown>} */ (p.data_refresh) : {}),
  }

  /** @type {Record<string, unknown>} */

  const notifications = {
    ...DEFAULT_NOTIFICATION_PREFS,
    ...(typeof p.notifications === 'object' && p.notifications !== null
      ? /** @type {Record<string, unknown>} */ (p.notifications)
      : {}),
  }

  /** @type {Record<string, unknown>} */

  const scoring = {
    ...(typeof DEFAULT_PREFERENCES.scoring === 'object' && DEFAULT_PREFERENCES.scoring !== null
      ? /** @type {Record<string, unknown>} */ (DEFAULT_PREFERENCES.scoring)
      : {}),
    ...(typeof p.scoring === 'object' && p.scoring !== null ? /** @type {Record<string, unknown>} */ (p.scoring) : {}),
  }

  /** @type {Record<string, unknown>} */

  const benchmarks = {
    ...(typeof DEFAULT_PREFERENCES.benchmarks === 'object' && DEFAULT_PREFERENCES.benchmarks !== null
      ? /** @type {Record<string, unknown>} */ (DEFAULT_PREFERENCES.benchmarks)
      : {}),
    ...(typeof p.benchmarks === 'object' && p.benchmarks !== null ? /** @type {Record<string, unknown>} */ (p.benchmarks) : {}),
  }

  /** @type {Record<string, unknown>} */

  const appearance = {
    ...(typeof DEFAULT_PREFERENCES.appearance === 'object' && DEFAULT_PREFERENCES.appearance !== null
      ? /** @type {Record<string, unknown>} */ (DEFAULT_PREFERENCES.appearance)
      : {}),
    ...(typeof p.appearance === 'object' && p.appearance !== null ? /** @type {Record<string, unknown>} */ (p.appearance) : {}),
  }

  /** @type {Record<string, unknown>} */

  const base = /** @type {Record<string, unknown>} */ ({ ...DEFAULT_PREFERENCES, ...p })

  return {
    ...base,
    satellite_allocation_rules: satRules,
    data_refresh: dataRefresh,
    notifications,
    scoring,
    benchmarks,
    appearance,
  }
}

/** @typedef {'1y' | '2y' | '5y' | 'all'} BriefingRetention */

/** @typedef {{
 * max_position_pct_cap: number | null
 * haircut_threshold: number
 * haircut_multiplier: number
 * buy_zone_unlock_threshold: number
 * rebalance_trigger_pct: number
 * }} SatelliteAllocRulesPrefs */

/** @typedef {{
 * live_price_refresh_minutes: number
 * sharesight_sync_minutes: number
 * ath_refresh: string
 * fmp_fundamentals_refresh: string
 * fmp_refresh_mode_auto: boolean
 * provider_weekly_note: string
 * announcement_twice_daily: boolean
 * watchlist_auto_monitor: boolean
 * watchlist_auto_monitor_threshold: number
 * }} DataRefreshPrefs */

/** @typedef {{
 * buy_zone_satellite: boolean
 * buy_zone_watchlist: boolean
 * exit_trigger: boolean
 * price_sensitive_announcement: boolean
 * weekly_dca_reminder: boolean
 * reanalysis_recommended: boolean
 * sharesight_sync_failure: boolean
 * fmp_incomplete_data: boolean
 * monthly_api_spend_alert: boolean
 * }} NotificationPrefs */

/** Deep defaults merged into `user_settings.preferences`. */

/** @type {SatelliteAllocRulesPrefs} */

export const DEFAULT_SATELLITE_ALLOCATION_RULES = {
  max_position_pct_cap: null,
  haircut_threshold: 65,
  haircut_multiplier: 0.5,
  buy_zone_unlock_threshold: 65,
  rebalance_trigger_pct: 10,
}

/** @type {DataRefreshPrefs} */

export const DEFAULT_DATA_REFRESH = {
  live_price_refresh_minutes: 5,
  sharesight_sync_minutes: 30,
  ath_refresh: 'daily_after_close',
  fmp_fundamentals_refresh: 'daily_after_close',
  fmp_refresh_mode_auto: true,
  provider_weekly_note: 'wednesday_weekly',
  announcement_twice_daily: true,
  watchlist_auto_monitor: false,
  watchlist_auto_monitor_threshold: 78,
}

/** @type {NotificationPrefs} */

export const DEFAULT_NOTIFICATION_PREFS = {
  buy_zone_satellite: true,
  buy_zone_watchlist: true,
  exit_trigger: true,
  price_sensitive_announcement: true,
  weekly_dca_reminder: true,
  reanalysis_recommended: true,
  sharesight_sync_failure: true,
  fmp_incomplete_data: true,
  monthly_api_spend_alert: false,
}

/**
 * Typed defaults keyed for Settings sections 10.5–10.12.
 *
 * @type {Record<string, unknown>}
 */
export const DEFAULT_PREFERENCES = {
  satellite_allocation_rules: { ...DEFAULT_SATELLITE_ALLOCATION_RULES },

  satellite_show_aud_parenthetical: false,

  dca_target_day: 'Tuesday',

  data_refresh: { ...DEFAULT_DATA_REFRESH },

  notifications: { ...DEFAULT_NOTIFICATION_PREFS },

  scoring: {
    auto_analyse_price_sensitive: true,
    framework_auto_suggest: true,
    catalyst_attachment_mode: 'auto_manual',
    claude_model: 'claude-opus-4-7',
    gemini_model: 'gemini-2.0-pro',
    monthly_api_spend_threshold_aud: 50,
    watchlist_monitor_threshold_pct: 78,
    high_conviction_tier_pct: 78,
  },

  benchmarks: {
    default_symbol: 'VGS.AX',
    default_display_name: 'Vanguard MSCI Index Intl Shares ETF',
    secondary_symbol: '',
  },

  appearance: {
    theme: 'dark',
    preferred_chart_period: '1Y',
    dashboard_sort: 'score_desc',
    manual_portfolio_value_aud: null,
    price_decimal_places: 2,
    date_format_ddmmyyyy: true,
    timezone_pref: 'AEST_auto',
    currency_display_aud_parenthetical_satellite: true,
  },
}

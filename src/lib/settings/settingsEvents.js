export const SETTINGS_UPDATED_EVENT = 'investment:user-settings-updated'

export function notifyUserSettingsUpdated() {
  if (typeof window === 'undefined') return

  window.dispatchEvent(new CustomEvent(SETTINGS_UPDATED_EVENT))
}

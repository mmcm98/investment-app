import { SettingsModule } from '../components/settings/SettingsModule.jsx'

export function SettingsPage() {
  return (
    <div className="mx-auto w-full max-w-[1200px] space-y-6 px-4 py-6 pb-24 text-[#F0F0F8] lg:px-10 lg:pb-10">
      <header>
        <h1 className="text-[22px] font-semibold">Settings</h1>

        <p className="mt-2 max-w-[78ch] text-sm text-[#9090A8]">
          All configuration surfaces from the investment framework (sections 10.1–10.16). Changes persist to Supabase tables such as{' '}

          <span className="font-mono text-[#79CBFF]">user_settings</span>, <span className="font-mono text-[#79CBFF]">core_etfs</span>, and{' '}

          <span className="font-mono text-[#79CBFF]">exchange_registry</span>.

        </p>
      </header>

      <SettingsModule />
    </div>
  )
}

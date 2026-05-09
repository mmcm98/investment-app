/** Application settings shell — advanced controls stay in Supabase for now. */

export function SettingsPage() {
  return (
    <div className="mx-auto w-full max-w-[1200px] space-y-4 p-6 pb-24 text-[#F0F0F8] lg:pb-10">
      <h1 className="text-[22px] font-semibold">Settings</h1>

      <p className="max-w-[70ch] text-sm text-[#9090A8]">
        Core/satellite portfolio UUID mapping, Sharesight reconnect, FX cadence, and API pause continue to hydrate from{' '}
        <span className="font-mono text-[#79CBFF]">user_settings</span>. Dedicated forms will consolidate here shortly.
      </p>
    </div>
  )
}

/** @param {{ message: string, context?: string }} props */

export function DataStaleBanner({ message, context = 'Showing last loaded data.' }) {
  return (
    <div
      role="status"

      className="rounded-lg border-l-4 border-[#F59E0B] border border-[rgba(245,158,11,0.35)] bg-[rgba(245,158,11,0.09)] px-4 py-3"

    >
      <p className="text-[10px] font-semibold uppercase tracking-wide text-[#FBBF24]">Data refresh warning</p>

      <p className="mt-1 font-mono text-xs text-[#FEF3C7]">{message}</p>

      <p className="mt-2 text-xs text-[#D6D3D1]">{context}</p>

    </div>

  )

}

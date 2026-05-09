/**
 * Minimal pill tabs for Overview / Live / Scorecard / Research / Buy zones layouts.
 *
 * @param {{
 *   value: string,
 *   onChange: (next: string) => void,
 *   tabs: { id: string, label: string }[],
 * }} props
 */
export function DetailTabStrip({ value, onChange, tabs }) {
  return (
    <div className="flex flex-wrap gap-2 border-b border-[rgba(255,255,255,0.08)] pb-3">
      {tabs.map((t) => {
        const active = value === t.id

        return (
          <button
            key={t.id}
            type="button"
            onClick={() => onChange(t.id)}
            className={[
              'rounded-lg px-3 py-1.5 font-mono text-[11px] transition-colors duration-150',
              active ? 'border border-[rgba(77,184,255,0.45)] bg-[rgba(77,184,255,0.08)] text-[#79CBFF]' : 'text-[#9090A8] hover:bg-[rgba(255,255,255,0.04)]',
            ].join(' ')}
          >
            {t.label}
          </button>
        )
      })}
    </div>
  )
}

export const POSITION_DETAIL_TAB_DEFS = [
  { id: 'overview', label: 'Overview' },
  { id: 'live', label: 'Live data' },
  { id: 'scorecard', label: 'Scorecard' },
  { id: 'research', label: 'Research paper' },
  { id: 'monitor', label: 'Buy zones & exits' },
]

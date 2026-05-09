import { motion } from 'framer-motion'

/**
 * @param {{ pct: number|null|undefined, size?: number, stroke?: number, label?: string }} props
 */
export function ScoreRing({ pct, size = 120, stroke = 10, label = 'Overall' }) {
  const r = (size - stroke) / 2
  const c = 2 * Math.PI * r
  const p = pct == null || Number.isNaN(Number(pct)) ? 0 : Math.max(0, Math.min(100, Number(pct)))
  const offset = c * (1 - p / 100)
  const tone = p >= 65 ? '#22C55E' : p >= 50 ? '#F59E0B' : '#EF4444'

  return (
    <div className="flex flex-col items-center gap-2">
      <svg width={size} height={size} className="block" aria-hidden>
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="rgba(255,255,255,0.08)" strokeWidth={stroke} />

        <motion.circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke={tone}
          strokeWidth={stroke}
          strokeLinecap="round"
          strokeDasharray={c}
          initial={{ strokeDashoffset: c }}
          animate={{ strokeDashoffset: offset }}
          transition={{ duration: 0.4, ease: [0.4, 0, 0.2, 1] }}
          transform={`rotate(-90 ${size / 2} ${size / 2})`}
        />
      </svg>

      <div className="text-center">
        <p className="font-mono text-[10px] uppercase tracking-wide text-[#505068]">{label}</p>

        <p className="font-mono text-lg text-[#F0F0F8]">{pct == null ? '—' : `${p.toFixed(1)}%`}</p>
      </div>
    </div>
  )
}

import { useEffect, useState } from 'react'

/** Monotonic client clock for expiry comparisons (minute resolution). */
export function useDashboardClock() {
  const [now, setNow] = useState(() => Date.now())

  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 60_000)

    return () => window.clearInterval(id)
  }, [])

  return now
}

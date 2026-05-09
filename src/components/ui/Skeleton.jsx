/**
 * Skeleton block — shimmer on dark/light shells (parent sets bg).
 *
 * @param {{ className?: string, rounded?: string }} props
 */

export function Skeleton({ className = '', rounded = '' }) {
  return (
    <div
      aria-hidden

      className={`inv-skel ${rounded} ${className}`}
    />

  )

}

/** @param {{ lines?: number, className?: string }} props */

export function SkeletonText({ lines = 3, className = '' }) {
  return (
    <div className={`space-y-2 ${className}`} aria-busy aria-label="Loading">

      {Array.from({ length: lines }, (_, i) => (

        <Skeleton key={i} className={`h-3 ${i === lines - 1 ? 'w-4/5' : 'w-full'}`} />

      ))}

    </div>

  )

}

import { Skeleton } from '../ui/Skeleton.jsx'

/** Full dashboard layout skeleton — avoids blank shells while dashboard hydrates */

export function DashboardPageSkeleton() {
  return (
    <div className="mx-auto flex w-full max-w-screen-2xl flex-col gap-8 px-6 pb-8">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0 flex-1 space-y-3">
          <Skeleton className="h-7 w-[200px]" />

          <Skeleton className="h-4 max-w-xl" />

          <Skeleton className="h-4 max-w-lg" />

        </div>

        <div className="flex gap-2">
          <Skeleton className="h-9 w-[88px] rounded-lg" />

          <Skeleton className="h-9 w-[92px] rounded-lg" />

        </div>

      </div>

      <div className="space-y-4 rounded-xl border border-[rgba(255,255,255,0.06)] bg-[#111118] p-5">
        <Skeleton className="h-5 w-[72%]" />

        <Skeleton className="h-[120px] w-full rounded-xl" />

        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <Skeleton className="h-16 w-full" />

          <Skeleton className="h-16 w-full" />

          <Skeleton className="h-16 w-full" />

          <Skeleton className="h-16 w-full" />

        </div>

      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <div className="space-y-4 rounded-xl border border-[rgba(255,255,255,0.06)] bg-[#111118] p-5">
          <Skeleton className="h-5 w-2/5" />

          <Skeleton className="h-[180px] w-full rounded-lg" />

        </div>

        <div className="space-y-4 rounded-xl border border-[rgba(255,255,255,0.06)] bg-[#111118] p-5">
          <Skeleton className="h-5 w-1/3" />

          <Skeleton className="h-[180px] w-full rounded-lg" />

        </div>

      </div>

      <Skeleton className="h-[260px] w-full rounded-xl" />

      <Skeleton className="h-32 w-full rounded-xl" />

    </div>

  )

}

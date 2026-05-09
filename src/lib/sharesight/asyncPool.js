/**
 * @template T
 * @template R
 * @param {number} concurrency
 * @param {T[]} items
 * @param {(item: T, index: number) => Promise<R>} mapper
 */
export async function mapWithConcurrency(concurrency, items, mapper) {
  const safe = Math.max(1, Math.floor(concurrency))
  /** @type {R[]} */
  const results = /** @type {any} */ ([])

  if (items.length === 0) return results

  let nextIndex = 0

  async function worker() {
    while (true) {
      const idx = nextIndex
      nextIndex += 1

      if (idx >= items.length) return

      results[idx] = await mapper(items[idx], idx)
    }
  }

  const workerCount = Math.min(safe, items.length)

  await Promise.all(Array.from({ length: workerCount }, () => worker()))

  return /** @type {R[]} */ (results)
}

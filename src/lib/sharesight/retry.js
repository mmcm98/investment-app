async function sleep(ms) {
  await new Promise((resolve) => {
    window.setTimeout(resolve, ms)
  })
}

/** @typedef {{ attempt: number, error: unknown }} RetryContext */

/** @typedef {(ctx: RetryContext) => Promise<T>} Retryable<T> */

/**
 * @template T
 * @param {Retryable<T>} fn
 * @param {{ attempts?: number }} [opts]
 */
export async function withRetries(fn, opts) {
  const attempts = opts?.attempts ?? 3
  /** @type {unknown} */
  let lastError = undefined

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      return await fn({ attempt, error: lastError })
    } catch (error) {
      lastError = error
      const isFinal = attempt >= attempts

      if (isFinal) break

      const backoffMs = 250 * 2 ** (attempt - 1)
      await sleep(backoffMs)
    }
  }

  throw lastError
}

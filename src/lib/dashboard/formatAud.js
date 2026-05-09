/** @param {number|null|undefined} n */
export function fmtAud(n) {
  if (n == null || !Number.isFinite(Number(n))) return '—'

  return Number(n).toLocaleString('en-AU', {
    style: 'currency',
    currency: 'AUD',
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  })
}

/** @param {number|null|undefined} n */
export function fmtAudFull(n) {
  if (n == null || !Number.isFinite(Number(n))) return '—'

  return Number(n).toLocaleString('en-AU', {
    style: 'currency',
    currency: 'AUD',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })
}

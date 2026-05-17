import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { fmpInstrumentSymbol } from '../../lib/market/fmpInstrumentSymbol.js'

/** @param {unknown} v */
function numFin(v) {
  if (typeof v === 'number' && Number.isFinite(v)) return v
  const n = Number.parseFloat(`${v ?? ''}`)
  return Number.isFinite(n) ? n : null
}

/** @param {number|null|undefined} n */
function fmtAud(n) {
  if (n == null || !Number.isFinite(Number(n))) return '—'
  return Number(n).toLocaleString('en-AU', { style: 'currency', currency: 'AUD', minimumFractionDigits: 2 })
}

/** @param {number|null|undefined} n @param {string} cur */
function fmtNative(n, cur) {
  if (n == null || !Number.isFinite(Number(n))) return '—'
  const c = `${cur ?? ''}`.trim()
  return `${Number(n).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 4 })}${c ? ` ${c}` : ''}`
}

/** @param {number|null|undefined} n */
function fmtPct(n) {
  if (n == null || !Number.isFinite(Number(n))) return '—'
  return `${Number(n).toFixed(2)}%`
}

/** @param {number|null|undefined} n */
function fmtNum(n) {
  if (n == null || !Number.isFinite(Number(n))) return '—'
  return Number(n).toLocaleString(undefined, { maximumFractionDigits: 4 })
}

/** @param {number|null|undefined} n */
function fmtScore(n) {
  if (n == null || !Number.isFinite(Number(n))) return '—'
  return Number(n).toFixed(0)
}

/** @param {string} group */
function groupSortRank(group) {
  if (group === 'ASX') return 0
  if (group === 'LSE') return 1
  if (group === 'Cash Accounts') return 400
  return 100
}

/** @param {Record<string, unknown>[]} rows */
function subtotalMetrics(rows) {
  let value = 0
  let gain = 0
  let cost = 0
  for (const r of rows) {
    const va = numFin(r.valueAud)
    const cg = numFin(r.capitalGainAud)
    const co = numFin(r.costBasis)
    if (va != null) value += va
    if (cg != null) gain += cg
    if (co != null) cost += co
  }
  const ret = cost > 0 && Number.isFinite(gain) ? (gain / cost) * 100 : null
  return { value, gain, ret }
}

const STORAGE_COLUMNS = 'satellitePositionsTable.columnOrder.v1'
const STORAGE_HIDDEN = 'satellitePositionsTable.hiddenColumns.v1'

const TYPE_OPTIONS = ['Compounder', 'Cyclical', 'Turnaround', 'Yield']

const DEFAULT_COLUMNS = /** @type {const} */ ([
  { id: 'logo', label: 'Logo', removable: true },
  { id: 'ticker', label: 'Ticker', removable: false },
  { id: 'exch', label: 'Exch', removable: true },
  { id: 'company', label: 'Company', removable: true },
  { id: 'type', label: 'Type', removable: true },
  { id: 'tier', label: 'Tier', removable: true },
  { id: 'score', label: 'Score', removable: true },
  { id: 'cur', label: 'Cur', removable: true },
  { id: 'price', label: 'Price', removable: true, align: 'right' },
  { id: 'avgBuy', label: 'Avg buy', removable: true, align: 'right' },
  { id: 'qty', label: 'Qty', removable: true, align: 'right' },
  { id: 'valueAud', label: 'Value (AUD)', removable: true, align: 'right' },
  { id: 'costBasis', label: 'Cost basis', removable: true, align: 'right' },
  { id: 'capGain', label: 'Cap gain', removable: true, align: 'right' },
  { id: 'income', label: 'Income', removable: true, align: 'right' },
  { id: 'return', label: 'Return', removable: true, align: 'right' },
  { id: 'totalReturn', label: 'Total return', removable: true, align: 'right' },
  { id: 'actions', label: 'Actions', removable: false, align: 'right' },
])

const DEFAULT_COLUMN_IDS = DEFAULT_COLUMNS.map((c) => c.id)

/** @param {string} key @param {string[]} fallback */
function loadStringArray(key, fallback) {
  if (typeof window === 'undefined') return fallback
  try {
    const raw = window.localStorage.getItem(key)
    const parsed = raw ? JSON.parse(raw) : null
    return Array.isArray(parsed) ? parsed.filter((x) => typeof x === 'string') : fallback
  } catch {
    return fallback
  }
}

/** @param {unknown} raw */
function tierLabel(raw) {
  const label = `${raw ?? ''}`.toLowerCase()
  if (label.includes('high')) return 'Tier 1'
  if (label.includes('qualified')) return 'Tier 2'
  if (label.includes('haircut')) return 'Tier 3'
  return '—'
}

/** @param {unknown} audValue @param {unknown} pctValue @param {'aud'|'pct'} mode */
function metricCell(audValue, pctValue, mode) {
  return mode === 'aud' ? fmtAud(numFin(audValue)) : fmtPct(numFin(pctValue))
}

/**
 * @param {{ tableCards: Record<string, unknown>[], onTypeChange?: (positionId: string, nextType: string) => Promise<void>|void }} props
 */
export function SatellitePositionsTable({ tableCards, onTypeChange }) {
  const [includeClosed, setIncludeClosed] = useState(false)
  const [valueMode, setValueMode] = useState(/** @type {'aud'|'pct'} */ ('aud'))
  const [editTable, setEditTable] = useState(false)
  const [rowOrder, setRowOrder] = useState(/** @type {string[]} */ ([]))
  const [dragRowKey, setDragRowKey] = useState(/** @type {string|null} */ (null))
  const [dragColumnId, setDragColumnId] = useState(/** @type {string|null} */ (null))
  const [columnOrder, setColumnOrder] = useState(() => loadStringArray(STORAGE_COLUMNS, DEFAULT_COLUMN_IDS))
  const [hiddenColumns, setHiddenColumns] = useState(() => new Set(loadStringArray(STORAGE_HIDDEN, [])))

  useEffect(() => {
    window.localStorage.setItem(STORAGE_COLUMNS, JSON.stringify(columnOrder))
  }, [columnOrder])

  useEffect(() => {
    window.localStorage.setItem(STORAGE_HIDDEN, JSON.stringify([...hiddenColumns]))
  }, [hiddenColumns])

  const columnsById = useMemo(() => {
    const map = new Map()
    for (const col of DEFAULT_COLUMNS) map.set(col.id, col)
    return map
  }, [])

  const visibleColumns = useMemo(() => {
    const normalizedOrder = [
      ...columnOrder.filter((id) => columnsById.has(id)),
      ...DEFAULT_COLUMN_IDS.filter((id) => !columnOrder.includes(id)),
    ]

    return normalizedOrder
      .filter((id) => !hiddenColumns.has(id) || id === 'ticker' || id === 'actions')
      .map((id) => columnsById.get(id))
      .filter(Boolean)
  }, [columnOrder, columnsById, hiddenColumns])

  const openRows = useMemo(
    () => tableCards.filter((row) => !row.rowClosed && !row.isCashLike),
    [tableCards],
  )

  const visibleRows = useMemo(() => {
    const source = (includeClosed ? tableCards : openRows).filter((row) => !row.isCashLike)
    const order = rowOrder.length ? rowOrder : source.map((row) => `${row.rowKey}`)
    const rank = new Map(order.map((key, index) => [key, index]))

    return [...source].sort((a, b) => {
      const ak = `${a.rowKey}`
      const bk = `${b.rowKey}`
      const ar = rank.has(ak) ? rank.get(ak) ?? 0 : Number.MAX_SAFE_INTEGER
      const br = rank.has(bk) ? rank.get(bk) ?? 0 : Number.MAX_SAFE_INTEGER
      if (ar !== br) return ar - br

      const ag = `${a.exchangeGroup ?? 'Other'}`
      const bg = `${b.exchangeGroup ?? 'Other'}`
      return groupSortRank(ag) - groupSortRank(bg) || `${a.ticker ?? ''}`.localeCompare(`${b.ticker ?? ''}`)
    })
  }, [includeClosed, openRows, rowOrder, tableCards])

  useEffect(() => {
    queueMicrotask(() => {
      setRowOrder((prev) => {
        const keys = tableCards.map((row) => `${row.rowKey}`)
        return [...prev.filter((key) => keys.includes(key)), ...keys.filter((key) => !prev.includes(key))]
      })
    })
  }, [tableCards])

  const summary = useMemo(() => {
    const t = subtotalMetrics(openRows)
    return {
      portfolioValue: t.value,
      capitalGain: t.gain,
      totalReturnPct: t.ret,
    }
  }, [openRows])

  const moveColumn = useCallback((fromId, toId) => {
    if (!fromId || !toId || fromId === toId) return
    setColumnOrder((prev) => {
      const next = [...prev.filter((id) => DEFAULT_COLUMN_IDS.includes(id))]
      const from = next.indexOf(fromId)
      const to = next.indexOf(toId)
      if (from < 0 || to < 0) return prev
      const [item] = next.splice(from, 1)
      next.splice(to, 0, item)
      return next
    })
  }, [])

  const moveRow = useCallback(
    (fromKey, toKey) => {
      if (!fromKey || !toKey || fromKey === toKey) return
      setRowOrder((prev) => {
        const keys = visibleRows.map((row) => `${row.rowKey}`)
        const next = prev.length ? [...prev] : keys
        const from = next.indexOf(fromKey)
        const to = next.indexOf(toKey)
        if (from < 0 || to < 0) return prev
        const [item] = next.splice(from, 1)
        next.splice(to, 0, item)
        return next
      })
    },
    [visibleRows],
  )

  const imgSrcForRow = useCallback((row) => {
    const base = `${row.fmpSymbol ?? ''}`.trim()
    if (!base) return ''
    const full = `${row.fmpProfileSymbol ?? ''}`.trim() || fmpInstrumentSymbol(base, `${row.exchangeShort ?? ''}`)
    return `https://financialmodelingprep.com/image-stock/${encodeURIComponent(full)}.png`
  }, [])

  const renderCell = useCallback(
    (row, columnId) => {
      const q = row.mergedQuote && typeof row.mergedQuote === 'object' ? /** @type {Record<string, unknown>} */ (row.mergedQuote) : null
      const native =
        q && typeof q.display_native === 'number'
          ? q.display_native
          : q && typeof q.last_price === 'number'
            ? q.last_price
            : null
      const cur = `${row.quoteCurrency ?? ''}`.trim()
      const pid = row.positionId ? `${row.positionId}` : ''
      const currentType = `${row.assetClass ?? ''}`.trim()

      switch (columnId) {
        case 'logo': {
          const img = imgSrcForRow(row)
          const letter = `${row.ticker ?? '?'}`.trim().charAt(0).toUpperCase() || '?'

          return (
            <div className="relative flex h-5 w-5 items-center justify-center overflow-hidden rounded-full bg-[#1A1A24] ring-1 ring-[rgba(255,255,255,0.08)]">
              <span className="absolute inset-0 flex items-center justify-center font-mono text-[9px] font-semibold text-[#4DB8FF]">
                {letter}
              </span>
              {img ? (
                <img
                  src={img}
                  alt=""
                  className="relative z-10 h-5 w-5 object-cover"
                  onError={(e) => {
                    e.currentTarget.style.visibility = 'hidden'
                  }}
                />
              ) : null}
            </div>
          )
        }
        case 'ticker':
          return (
            <div className="flex flex-wrap items-center gap-2 font-mono text-[13px] text-[#4DB8FF]">
              {`${row.ticker ?? '—'}`.trim() || '—'}
              {row.rowClosed ? (
                <span className="rounded border border-[rgba(255,255,255,0.12)] bg-[#22222F] px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-wide text-[#9090A8]">
                  Closed
                </span>
              ) : null}
            </div>
          )
        case 'exch':
          return `${row.exchangeShort ?? row.exchangeGroup ?? '—'}`.trim() || '—'
        case 'company':
          return <span className="line-clamp-2 min-w-[180px]">{`${row.displayName ?? '—'}`}</span>
        case 'type':
          return (
            <select
              value={TYPE_OPTIONS.includes(currentType) ? currentType : ''}
              disabled={!pid}
              onChange={(e) => {
                if (pid) void onTypeChange?.(pid, e.target.value)
              }}
              className="min-w-[130px] rounded border border-[rgba(255,255,255,0.12)] bg-[#1A1A24] px-2 py-1 text-xs text-[#F0F0F8] disabled:opacity-50"
            >
              <option value="">—</option>
              {TYPE_OPTIONS.map((opt) => (
                <option key={opt} value={opt}>
                  {opt}
                </option>
              ))}
            </select>
          )
        case 'tier':
          return tierLabel(row.tier)
        case 'score':
          return fmtScore(numFin(row.overallScore))
        case 'cur':
          return cur || '—'
        case 'price':
          return fmtNative(native, cur)
        case 'avgBuy':
          return fmtNative(numFin(row.avgBuyNative), 'AUD')
        case 'qty':
          return fmtNum(numFin(row.quantity))
        case 'valueAud':
          return fmtAud(numFin(row.valueAud))
        case 'costBasis':
          return fmtAud(numFin(row.costBasis))
        case 'capGain':
          return metricCell(row.capitalGainAud, row.returnPct, valueMode)
        case 'income':
          return metricCell(row.payoutGainAud, row.incomePct, valueMode)
        case 'return':
          return metricCell(row.capitalGainAud, row.returnPct, valueMode)
        case 'totalReturn':
          return metricCell(row.totalGainAud, row.totalReturnPct, valueMode)
        case 'actions':
          return pid ? (
            <Link className="whitespace-nowrap font-mono text-[11px] text-[#4DB8FF] hover:text-[#79CBFF]" to={`/satellite/position/${pid}`}>
              See analysis →
            </Link>
          ) : (
            <span className="text-[#505068]">—</span>
          )
        default:
          return '—'
      }
    },
    [imgSrcForRow, onTypeChange, valueMode],
  )

  return (
    <section className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-[rgba(255,255,255,0.06)] bg-[#111118] px-4 py-3">
        <div className="flex flex-wrap gap-6 font-mono text-xs text-[#F0F0F8]">
          <div>
            <span className="text-[10px] uppercase tracking-wide text-[#505068]">Portfolio value</span>
            <div className="mt-0.5 text-sm">{fmtAud(summary.portfolioValue)}</div>
          </div>
          <div>
            <span className="text-[10px] uppercase tracking-wide text-[#505068]">Live capital gain</span>
            <div
              className={`mt-0.5 text-sm ${
                summary.capitalGain != null && summary.capitalGain >= 0 ? 'text-[#22C55E]' : 'text-[#EF4444]'
              }`}
            >
              {fmtAud(summary.capitalGain)}
            </div>
          </div>
          <div>
            <span className="text-[10px] uppercase tracking-wide text-[#505068]">Total return</span>
            <div className="mt-0.5 text-sm">{fmtPct(summary.totalReturnPct)}</div>
          </div>
        </div>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-4 text-xs">
        <div className="flex flex-wrap items-center gap-4">
          <label className="flex cursor-pointer items-center gap-2 text-[#9090A8]">
            <input type="checkbox" checked={includeClosed} onChange={(e) => setIncludeClosed(e.target.checked)} />
            Include closed positions
          </label>
          <div className="flex items-center gap-2">
            <span className="text-[10px] font-semibold uppercase tracking-wide text-[#505068]">Gain display</span>
            <div className="flex rounded border border-[rgba(255,255,255,0.12)] p-0.5">
              <button
                type="button"
                onClick={() => setValueMode('aud')}
                className={`rounded px-2 py-1 font-mono text-[10px] ${valueMode === 'aud' ? 'bg-[#22222F] text-[#4DB8FF]' : 'text-[#9090A8]'}`}
              >
                AU$
              </button>
              <button
                type="button"
                onClick={() => setValueMode('pct')}
                className={`rounded px-2 py-1 font-mono text-[10px] ${valueMode === 'pct' ? 'bg-[#22222F] text-[#4DB8FF]' : 'text-[#9090A8]'}`}
              >
                %
              </button>
            </div>
          </div>
          <div className="text-[10px] uppercase tracking-wide text-[#505068]">
            Group by:{' '}
            <select className="rounded border border-[rgba(255,255,255,0.12)] bg-[#1A1A24] px-2 py-1 text-[#F0F0F8]" value="market" disabled>
              <option value="market">Market</option>
            </select>
          </div>
        </div>
        <button
          type="button"
          onClick={() => setEditTable((v) => !v)}
          className={`rounded border px-3 py-1.5 font-mono text-[11px] ${
            editTable
              ? 'border-[#4DB8FF] bg-[rgba(77,184,255,0.12)] text-[#79CBFF]'
              : 'border-[rgba(255,255,255,0.12)] text-[#9090A8] hover:text-[#F0F0F8]'
          }`}
        >
          Edit table
        </button>
      </div>

      <div className="overflow-x-auto rounded-xl border border-[rgba(255,255,255,0.06)] bg-[#111118]">
        <table className="w-full min-w-[1720px] border-collapse text-left text-sm">
          <thead>
            <tr className="border-b border-[rgba(255,255,255,0.08)] text-[10px] font-semibold uppercase tracking-wide text-[#505068]">
              {visibleColumns.map((col) => (
                <th
                  key={col.id}
                  draggable
                  onDragStart={() => setDragColumnId(col.id)}
                  onDragOver={(e) => e.preventDefault()}
                  onDrop={() => {
                    moveColumn(dragColumnId, col.id)
                    setDragColumnId(null)
                  }}
                  className={`px-3 py-2 ${col.align === 'right' ? 'text-right' : ''}`}
                >
                  <span className="inline-flex items-center gap-1">
                    {col.label}
                    {editTable && col.removable ? (
                      <button
                        type="button"
                        className="rounded px-1 text-[#9090A8] hover:bg-[#22222F] hover:text-[#EF4444]"
                        onClick={() => setHiddenColumns((prev) => new Set([...prev, col.id]))}
                        aria-label={`Hide ${col.label}`}
                      >
                        ×
                      </button>
                    ) : null}
                  </span>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {visibleRows.length === 0 ? (
              <tr>
                <td colSpan={visibleColumns.length} className="px-4 py-8 text-center text-[#505068]">
                  No rows to display.
                </td>
              </tr>
            ) : null}
            {visibleRows.map((row) => {
              const rk = `${row.rowKey}`
              const closed = Boolean(row.rowClosed)

              return (
                <tr
                  key={rk}
                  draggable
                  onDragStart={() => setDragRowKey(rk)}
                  onDragOver={(e) => e.preventDefault()}
                  onDrop={() => {
                    moveRow(dragRowKey, rk)
                    setDragRowKey(null)
                  }}
                  className={`border-b border-[rgba(255,255,255,0.04)] transition-colors hover:bg-[#22222F] ${
                    closed ? 'opacity-60' : ''
                  }`}
                >
                  {visibleColumns.map((col) => {
                    const isNumber = col.align === 'right'
                    const gainish = ['capGain', 'income', 'return', 'totalReturn'].includes(col.id)
                    const valueForColour =
                      col.id === 'income'
                        ? numFin(row.payoutGainAud)
                        : col.id === 'totalReturn'
                          ? numFin(row.totalGainAud)
                          : numFin(row.capitalGainAud)

                    return (
                      <td
                        key={`${rk}:${col.id}`}
                        className={`px-3 py-2 align-middle text-xs ${
                          isNumber ? 'text-right font-mono' : ''
                        } ${
                          gainish && valueForColour != null
                            ? valueForColour >= 0
                              ? 'text-[#22C55E]'
                              : 'text-[#EF4444]'
                            : isNumber
                              ? 'text-[#C8C8D8]'
                              : 'text-[#F0F0F8]'
                        }`}
                      >
                        {renderCell(row, col.id)}
                      </td>
                    )
                  })}
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </section>
  )
}

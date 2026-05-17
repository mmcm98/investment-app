import { Fragment, useCallback, useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { useSharesightIntegration } from '../../context/SharesightIntegrationContext.jsx'

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

/** @param {number|null|undefined} n */
function fmtNum(n) {
  if (n == null || !Number.isFinite(Number(n))) return '—'
  return Number(n).toLocaleString(undefined, { maximumFractionDigits: 4 })
}

/** @param {number|null|undefined} n @param {string} cur */
function fmtNative(n, cur) {
  if (n == null || !Number.isFinite(Number(n))) return '—'
  const c = `${cur ?? ''}`.trim()
  return `${Number(n).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 4 })}${c ? ` ${c}` : ''}`
}

/** @param {number|null|undefined} n */
function fmtScore(n) {
  if (n == null || !Number.isFinite(Number(n))) return '—'
  return Number(n).toFixed(0)
}

/** @param {unknown} raw */
function tierLabel(raw) {
  const label = `${raw ?? ''}`.toLowerCase()
  if (label.includes('high')) return 'Tier 1'
  if (label.includes('qualified')) return 'Tier 2'
  if (label.includes('haircut')) return 'Tier 3'
  return '—'
}

/** @param {unknown} row */
function persistedOrderForRow(row) {
  const pos = row && typeof row === 'object' ? Reflect.get(/** @type {Record<string, unknown>} */ (row), 'position') : null
  const extra = pos && typeof pos === 'object' ? Reflect.get(/** @type {Record<string, unknown>} */ (pos), 'extra') : null
  const raw = extra && typeof extra === 'object' ? Reflect.get(/** @type {Record<string, unknown>} */ (extra), 'satellite_table_order') : null
  const n = typeof raw === 'number' ? raw : Number.parseFloat(`${raw ?? ''}`)

  return Number.isFinite(n) ? n : null
}

/** @param {unknown} row */
function rowExtra(row) {
  const pos = row && typeof row === 'object' ? Reflect.get(/** @type {Record<string, unknown>} */ (row), 'position') : null
  const extra = pos && typeof pos === 'object' ? Reflect.get(/** @type {Record<string, unknown>} */ (pos), 'extra') : null

  return extra && typeof extra === 'object' ? { .../** @type {Record<string, unknown>} */ (extra) } : {}
}

/** @param {{ target: EventTarget | null }} event */
function isNoDragEvent(event) {
  return event.target instanceof Element && Boolean(event.target.closest('[data-no-drag="true"]'))
}

/** @param {Record<string, unknown>} row */
function exchangeLabelForRow(row) {
  return `${row.exchange ?? '—'}`.trim() || '—'
}

/** @param {Record<string, unknown>} row */
function exchangeGroupForRow(row) {
  const exchange = exchangeLabelForRow(row)

  return exchange === '—' ? 'Other' : exchange
}

/** @param {Record<string, unknown>[]} rows */
function groupRowsByExchange(rows) {
  /** @type {Array<{ exchange: string, rows: Record<string, unknown>[], valueAud: number }>} */
  const groups = []
  /** @type {Map<string, { exchange: string, rows: Record<string, unknown>[], valueAud: number }>} */
  const byExchange = new Map()

  for (const row of rows) {
    const exchange = exchangeGroupForRow(row)
    let group = byExchange.get(exchange)

    if (!group) {
      group = { exchange, rows: [], valueAud: 0 }
      byExchange.set(exchange, group)
      groups.push(group)
    }

    group.rows.push(row)
    group.valueAud += numFin(row.valueAud) ?? 0
  }

  return groups
}

const STORAGE_COLUMNS = 'satellitePositionsTable.columnOrder.v2'
const STORAGE_HIDDEN = 'satellitePositionsTable.hiddenColumns.v2'
const TYPE_OPTIONS = ['Regular Stock', 'Thematic ETF', 'Fund Manager / LIC', 'Speculative Stock', 'Alternative / PE']

const DEFAULT_COLUMNS = /** @type {const} */ ([
  { id: 'ticker', label: 'Ticker', removable: false },
  { id: 'exchange', label: 'Exchange', removable: true },
  { id: 'company', label: 'Company', removable: true },
  { id: 'type', label: 'Type', removable: true },
  { id: 'tier', label: 'Tier', removable: true },
  { id: 'score', label: 'Score', removable: true, align: 'right' },
  { id: 'price', label: 'Price', removable: true, align: 'right' },
  { id: 'qty', label: 'Qty', removable: true, align: 'right' },
  { id: 'valueAud', label: 'Value (AUD)', removable: true, align: 'right' },
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

/**
 * @param {{
 *   tableCards: Record<string, unknown>[],
 *   onTypeChange?: (positionId: string, nextType: string) => Promise<void>|void
 * }} props
 */
export function SatellitePositionsTable({ tableCards, onTypeChange }) {
  const { supabase } = useSharesightIntegration()
  const [includeClosed, setIncludeClosed] = useState(false)
  const [editTable, setEditTable] = useState(false)
  const [rowOrder, setRowOrder] = useState(/** @type {string[]} */ ([]))
  const [dragRowKey, setDragRowKey] = useState(/** @type {string|null} */ (null))
  const [dragColumnId, setDragColumnId] = useState(/** @type {string|null} */ (null))
  const [openTypeRow, setOpenTypeRow] = useState(/** @type {string|null} */ (null))
  const [columnOrder, setColumnOrder] = useState(() => loadStringArray(STORAGE_COLUMNS, DEFAULT_COLUMN_IDS))
  const [hiddenColumns, setHiddenColumns] = useState(() => new Set(loadStringArray(STORAGE_HIDDEN, [])))

  useEffect(() => {
    const closeMenu = () => setOpenTypeRow(null)

    document.addEventListener('click', closeMenu)

    return () => document.removeEventListener('click', closeMenu)
  }, [])

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

  const sourceRows = useMemo(
    () =>
      tableCards
        .filter((row) => includeClosed || row.rowClosed === false)
        .filter((row) => !row.isCashLike),
    [includeClosed, tableCards],
  )

  useEffect(() => {
    queueMicrotask(() => {
      setRowOrder((prev) => {
        const sortedByPersisted = [...sourceRows]
          .map((row, index) => ({ key: `${row.rowKey}`, order: persistedOrderForRow(row), index }))
          .sort((a, b) => {
            if (a.order != null && b.order != null && a.order !== b.order) return a.order - b.order
            if (a.order != null && b.order == null) return -1
            if (a.order == null && b.order != null) return 1
            return a.index - b.index
          })
          .map((row) => row.key)

        return [...prev.filter((key) => sortedByPersisted.includes(key)), ...sortedByPersisted.filter((key) => !prev.includes(key))]
      })
    })
  }, [sourceRows])

  const visibleRows = useMemo(() => {
    const rank = new Map((rowOrder.length ? rowOrder : sourceRows.map((row) => `${row.rowKey}`)).map((key, index) => [key, index]))

    return [...sourceRows].sort((a, b) => {
      const ak = `${a.rowKey}`
      const bk = `${b.rowKey}`
      const ar = rank.has(ak) ? rank.get(ak) ?? 0 : Number.MAX_SAFE_INTEGER
      const br = rank.has(bk) ? rank.get(bk) ?? 0 : Number.MAX_SAFE_INTEGER

      return ar - br || `${a.ticker ?? ''}`.localeCompare(`${b.ticker ?? ''}`)
    })
  }, [rowOrder, sourceRows])

  const exchangeGroups = useMemo(() => groupRowsByExchange(visibleRows), [visibleRows])

  const persistRowOrder = useCallback(
    async (nextOrder) => {
      if (!supabase) return

      const { data: ud } = await supabase.auth.getUser()
      const uid = ud.user?.id
      if (!uid) return

      const byKey = new Map(tableCards.map((row) => [`${row.rowKey}`, row]))
      const updates = nextOrder
        .map((key, index) => {
          const row = byKey.get(key)
          const positionId = row?.positionId ? `${row.positionId}` : ''

          if (!positionId) return null

          return {
            positionId,
            extra: { ...rowExtra(row), satellite_table_order: index },
          }
        })
        .filter(Boolean)

      await Promise.all(
        updates.map((u) =>
          supabase
            .from('positions')
            .update({ extra: u.extra, updated_at: new Date().toISOString() })
            .eq('id', u.positionId)
            .eq('user_id', uid),
        ),
      )
    },
    [supabase, tableCards],
  )

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
        const next = prev.length ? [...prev.filter((key) => keys.includes(key))] : keys
        const from = next.indexOf(fromKey)
        const to = next.indexOf(toKey)
        if (from < 0 || to < 0) return prev
        const [item] = next.splice(from, 1)
        next.splice(to, 0, item)
        void persistRowOrder(next)
        return next
      })
    },
    [persistRowOrder, visibleRows],
  )

  const renderCell = useCallback(
    (row, columnId) => {
      const q = row.mergedQuote && typeof row.mergedQuote === 'object' ? /** @type {Record<string, unknown>} */ (row.mergedQuote) : null
      const nativePrice =
        q && typeof q.display_native === 'number'
          ? q.display_native
          : q && typeof q.last_price === 'number'
            ? q.last_price
            : null
      const cur = `${row.quoteCurrency ?? ''}`.trim()
      const pid = row.positionId ? `${row.positionId}` : ''
      const holdingId = `${row.holdingId || row.id || row.sharesight_id || ''}`.trim()
      const currentType = `${row.assetClass ?? ''}`.trim()
      const rowKey = `${row.rowKey ?? ''}`

      switch (columnId) {
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
        case 'exchange':
          return exchangeLabelForRow(row)
        case 'company':
          return <span className="line-clamp-2 min-w-[180px]">{`${row.displayName ?? '—'}`}</span>
        case 'type':
          return (
            <div
              data-no-drag="true"
              className="relative min-w-[150px] pointer-events-auto"
              onMouseDown={(e) => e.stopPropagation()}
              onPointerDown={(e) => e.stopPropagation()}
              onClick={(e) => e.stopPropagation()}
            >
              <button
                type="button"
                disabled={!pid}
                onClick={(e) => {
                  e.stopPropagation()
                  e.preventDefault()
                  if (pid) setOpenTypeRow((current) => (current === rowKey ? null : rowKey))
                }}
                className="flex w-full items-center justify-between gap-2 rounded border border-[rgba(255,255,255,0.12)] bg-[#1A1A24] px-2 py-1 text-left text-xs text-[#F0F0F8] disabled:opacity-50"
              >
                <span className="truncate">{TYPE_OPTIONS.includes(currentType) ? currentType : '—'}</span>
                <span className="text-[#505068]">▾</span>
              </button>
              {openTypeRow === rowKey ? (
                <div
                  className="absolute left-0 top-[calc(100%+4px)] z-50 w-48 overflow-hidden rounded-lg border border-[rgba(255,255,255,0.12)] bg-[#1A1A24] shadow-xl"
                  onClick={(e) => e.stopPropagation()}
                >
                  {['', ...TYPE_OPTIONS].map((opt) => (
                    <button
                      key={opt || '__blank'}
                      type="button"
                      className={`block w-full px-3 py-2 text-left text-xs hover:bg-[#22222F] ${
                        opt === currentType || (!opt && !TYPE_OPTIONS.includes(currentType))
                          ? 'text-[#4DB8FF]'
                          : 'text-[#F0F0F8]'
                      }`}
                      onClick={(e) => {
                        e.stopPropagation()
                        if (pid) void onTypeChange?.(pid, opt)
                        setOpenTypeRow(null)
                      }}
                    >
                      {opt || '—'}
                    </button>
                  ))}
                </div>
              ) : null}
            </div>
          )
        case 'tier':
          return tierLabel(row.tier)
        case 'score':
          return fmtScore(numFin(row.overallScore))
        case 'price':
          return fmtNative(nativePrice, cur)
        case 'qty':
          return fmtNum(numFin(row.quantity))
        case 'valueAud':
          return fmtAud(numFin(row.valueAud))
        case 'totalReturn':
          return fmtAud(numFin(row.totalGainAud))
        case 'actions':
          return holdingId ? (
            <Link className="whitespace-nowrap font-mono text-[11px] text-[#4DB8FF] hover:text-[#79CBFF]" to={`/satellite/position/${holdingId}`}>
              See analysis →
            </Link>
          ) : (
            <span className="text-[#505068]">—</span>
          )
        default:
          return '—'
      }
    },
    [onTypeChange, openTypeRow],
  )

  return (
    <section className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-4 text-xs">
        <label className="flex cursor-pointer items-center gap-2 text-[#9090A8]">
          <input type="checkbox" checked={includeClosed} onChange={(e) => setIncludeClosed(e.target.checked)} />
          Include closed positions
        </label>
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
        <table className="w-full min-w-[1180px] border-collapse text-left text-sm">
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
            {exchangeGroups.map((group) => (
              <Fragment key={group.exchange}>
                <tr className="border-b border-[rgba(255,255,255,0.08)] bg-[#0A0A0F]">
                  <td colSpan={visibleColumns.length} className="px-3 py-2">
                    <div className="flex items-center gap-2 font-mono text-[11px] font-semibold uppercase tracking-wide text-[#9090A8]">
                      <span>{group.exchange}</span>
                      <span className="text-[#505068]">↑↓</span>
                    </div>
                  </td>
                </tr>

                {group.rows.map((row) => {
                  const rowKey = `${row.rowKey}`
                  const closed = Boolean(row.rowClosed)

                  return (
                    <tr
                      key={rowKey}
                      draggable
                      onDragStart={(e) => {
                        if (isNoDragEvent(e)) {
                          e.preventDefault()
                          setDragRowKey(null)
                          return
                        }

                        setDragRowKey(rowKey)
                      }}
                      onDragOver={(e) => e.preventDefault()}
                      onDrop={() => {
                        moveRow(dragRowKey, rowKey)
                        setDragRowKey(null)
                      }}
                      className={`border-b border-[rgba(255,255,255,0.04)] transition-colors hover:bg-[#22222F] ${
                        closed ? 'opacity-60' : ''
                      }`}
                    >
                      {visibleColumns.map((col) => {
                        const isNumber = col.align === 'right'
                        const isReturn = col.id === 'totalReturn'
                        const totalReturn = numFin(row.totalGainAud)
                        const isTypeCell = col.id === 'type'

                        return (
                          <td
                            key={`${rowKey}:${col.id}`}
                            data-no-drag={isTypeCell ? 'true' : undefined}
                            className={`px-3 py-2 align-middle text-xs ${
                              isNumber ? 'text-right font-mono' : ''
                            } ${isTypeCell ? 'relative pointer-events-auto' : ''} ${
                              isReturn && totalReturn != null
                                ? totalReturn >= 0
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

                <tr className="border-b border-[rgba(255,255,255,0.08)] bg-[rgba(255,255,255,0.03)]">
                  {visibleColumns.map((col, index) => {
                    const isValueColumn = col.id === 'valueAud'
                    const isFirstColumn = index === 0

                    return (
                      <td
                        key={`${group.exchange}:subtotal:${col.id}`}
                        className={`px-3 py-2 align-middle font-mono text-[11px] ${
                          col.align === 'right' ? 'text-right' : ''
                        } ${isValueColumn ? 'text-[#F0F0F8]' : 'text-[#505068]'}`}
                      >
                        {isValueColumn ? fmtAud(group.valueAud) : isFirstColumn ? `${group.exchange} subtotal` : ''}
                      </td>
                    )
                  })}
                </tr>
              </Fragment>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  )
}

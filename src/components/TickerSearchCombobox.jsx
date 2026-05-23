import { useEffect, useId, useRef, useState } from 'react'
import { Building2 } from 'lucide-react'
import { fetchFmpTickerSearch } from '../lib/market/marketApi.js'

/**
 * @typedef {{
 *   symbol: string,
 *   name: string,
 *   exchangeShortName: string,
 *   currency: string | null,
 * }} TickerHit
 */

/**
 * @param {{
 *   placeholder?: string,
 *   limit?: number,
 *   debounceMs?: number,
 *   onSelect?: (hit: TickerHit | null) => void,
 *   selectedHit?: TickerHit | null,
 * }} props
 */
export function TickerSearchCombobox({
  placeholder = 'Type symbol or company',
  limit = 10,
  debounceMs = 250,
  onSelect,
  selectedHit = null,
}) {
  const listId = useId()
  const rootRef = useRef(/** @type {HTMLDivElement|null} */ (null))
  const [q, setQ] = useState(selectedHit?.symbol ?? '')
  const [debounced, setDebounced] = useState('')
  const [hits, setHits] = useState(/** @type {TickerHit[]} */ ([]))
  const [busy, setBusy] = useState(false)
  const [open, setOpen] = useState(false)
  const [activeIndex, setActiveIndex] = useState(-1)
  const [error, setError] = useState(/** @type {string|null} */ (null))

  useEffect(() => {
    const id = window.setTimeout(() => setDebounced(q), debounceMs)
    return () => window.clearTimeout(id)
  }, [q, debounceMs])

  useEffect(() => {
    if (!debounced.trim()) {
      queueMicrotask(() => {
        setHits([])
        setBusy(false)
        setActiveIndex(-1)
      })
      return undefined
    }

    let cancelled = false
    void (async () => {
      setBusy(true)
      setError(null)
      try {
        const results = await fetchFmpTickerSearch(debounced.trim(), limit)
        if (cancelled) return
        setHits(results)
        setActiveIndex(results.length ? 0 : -1)
      } catch (e) {
        if (!cancelled) {
          setHits([])
          setError(e instanceof Error ? e.message : String(e))
        }
      } finally {
        if (!cancelled) setBusy(false)
      }
    })()

    return () => {
      cancelled = true
    }
  }, [debounced, limit])

  useEffect(() => {
    function onDocDown(ev) {
      if (!rootRef.current?.contains(/** @type {Node} */ (ev.target))) setOpen(false)
    }
    document.addEventListener('mousedown', onDocDown)
    return () => document.removeEventListener('mousedown', onDocDown)
  }, [])

  /** @param {TickerHit} hit */
  function pick(hit) {
    setQ(hit.symbol)
    setOpen(false)
    setActiveIndex(-1)
    onSelect?.(hit)
  }

  /** @param {import('react').KeyboardEvent<HTMLInputElement>} ev */
  function onKeyDown(ev) {
    if (!open && (ev.key === 'ArrowDown' || ev.key === 'ArrowUp')) {
      setOpen(true)
      return
    }

    if (ev.key === 'Escape') {
      setOpen(false)
      setActiveIndex(-1)
      return
    }

    if (!hits.length) return

    if (ev.key === 'ArrowDown') {
      ev.preventDefault()
      setActiveIndex((i) => (i + 1) % hits.length)
    } else if (ev.key === 'ArrowUp') {
      ev.preventDefault()
      setActiveIndex((i) => (i <= 0 ? hits.length - 1 : i - 1))
    } else if (ev.key === 'Enter' && activeIndex >= 0 && activeIndex < hits.length) {
      ev.preventDefault()
      pick(hits[activeIndex])
    }
  }

  const showDropdown = open && debounced.trim().length > 0

  return (
    <div ref={rootRef} className="relative">
      <input
        type="text"
        value={q}
        role="combobox"
        aria-expanded={showDropdown}
        aria-controls={listId}
        aria-autocomplete="list"
        onChange={(e) => {
          const next = e.target.value
          setQ(next)
          setOpen(true)
          if (selectedHit && next.trim().toUpperCase() !== selectedHit.symbol) {
            onSelect?.(null)
          }
        }}
        onFocus={() => setOpen(true)}
        onKeyDown={onKeyDown}
        placeholder={placeholder}
        className="w-full rounded-lg border border-[rgba(255,255,255,0.12)] bg-[#1A1A24] px-3 py-2 font-mono text-sm text-[#F0F0F8] outline-none focus:border-[rgba(77,184,255,0.55)]"
        autoComplete="off"
      />

      {error ? <p className="mt-2 font-mono text-[11px] text-[#EF4444]">{error}</p> : null}

      {showDropdown ? (
        <div
          id={listId}
          role="listbox"
          className="absolute left-0 right-0 top-[calc(100%+4px)] z-50 max-h-[240px] overflow-y-auto rounded-lg border border-[rgba(255,255,255,0.12)] bg-[#1A1A24] shadow-xl"
        >
          {busy ? (
            <p className="px-3 py-3 font-mono text-[11px] text-[#9090A8]">Searching…</p>
          ) : hits.length === 0 ? (
            <p className="px-3 py-3 font-mono text-[11px] text-[#9090A8]">No matches found</p>
          ) : (
            hits.map((hit, index) => {
              const active = index === activeIndex
              return (
                <button
                  key={`${hit.symbol}:${hit.exchangeShortName}`}
                  type="button"
                  role="option"
                  aria-selected={active}
                  className={`flex w-full items-center gap-3 border-b border-[rgba(255,255,255,0.06)] px-3 py-2.5 text-left last:border-b-0 ${
                    active ? 'bg-[rgba(77,184,255,0.12)]' : 'hover:bg-[rgba(255,255,255,0.04)]'
                  }`}
                  onMouseEnter={() => setActiveIndex(index)}
                  onClick={() => pick(hit)}
                >
                  <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-[rgba(255,255,255,0.06)] text-[#505068]">
                    <Building2 className="h-3.5 w-3.5" aria-hidden />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="flex items-baseline gap-2">
                      <span className="font-mono text-sm font-semibold text-[#F0F0F8]">{hit.symbol}</span>
                      <span className="truncate text-sm text-[#C8C8D8]">{hit.name}</span>
                    </span>
                    <span className="font-mono text-[10px] uppercase tracking-wide text-[#9090A8]">
                      {hit.exchangeShortName}
                    </span>
                  </span>
                </button>
              )
            })
          )}
        </div>
      ) : null}
    </div>
  )
}

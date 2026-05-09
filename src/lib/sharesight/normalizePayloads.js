/** @param {unknown} v */
function coerceString(v) {
  if (typeof v === 'string') return v.trim() ? v : ''
  if (typeof v === 'number' && Number.isFinite(v)) return String(v)

  return ''
}

/** @param {unknown} v */
function coerceNumber(v) {
  if (typeof v === 'number' && Number.isFinite(v)) return v

  if (typeof v === 'string' && v.trim()) {
    const n = Number.parseFloat(v)

    return Number.isFinite(n) ? n : null
  }

  return null
}

/** @param {unknown} raw */
export function normalizeHolding(raw) {
  if (!raw || typeof raw !== 'object') return null

  /** @type {any} */
  const h = raw

  const instrument = h.instrument && typeof h.instrument === 'object' ? h.instrument : null

  const holding_external_id = coerceString(h.id ?? h.holding_id ?? h.holding?.id)
  if (!holding_external_id) return null

  return {
    holding_external_id,
    instrument_symbol: coerceString(instrument?.code ?? instrument?.symbol ?? instrument?.ticker ?? h.code),
    instrument_name: coerceString(instrument?.name ?? h.name ?? h.description),
    quantity: coerceNumber(h.quantity ?? h.quantity_on_hand ?? h.units_on_hand ?? h.units ?? h.balance),
    market_value: coerceNumber(
      h.market_value ??
        h.value?.amount ??
        h.latest_close_value ??
        h.close_value ??
        h.portfolio_value,
    ),
    cost_basis: coerceNumber(
      h.cost_basis ??
        h.opening_cost ??
        h.opening_cost_base ??
        h.opening_cost_amount ??
        h.book_cost,
    ),
    unrealized_gain_loss: coerceNumber(
      h.unrealised_gain_loss ??
        h.unrealized_gain_loss ??
        h.capital_gain ??
        h.unrealised_capital_gain,
    ),
    currency: coerceString(
      h.currency_code ??
        h.value?.currency_code ??
        instrument?.currency_code ??
        h.portfolio_currency ??
        '',
    ),
    raw: /** @type {Record<string, unknown>} */ ({ ...h }),
  }
}

/** @param {unknown} raw */
export function normalizeTrade(raw) {
  if (!raw || typeof raw !== 'object') return null

  /** @type {any} */
  const t = raw

  const trade_external_id = coerceString(t.id ?? t.trade_id)
  if (!trade_external_id) return null

  return {
    trade_external_id,
    raw: /** @type {Record<string, unknown>} */ ({ ...t }),
  }
}

/** @param {unknown} raw */
export function normalizePayout(raw) {
  if (!raw || typeof raw !== 'object') return null

  /** @type {any} */
  const p = raw

  const income_external_id = coerceString(p.id ?? p.payout_id)
  if (!income_external_id) return null

  const paidRaw = coerceString(p.transaction_date ?? p.payment_date ?? p.date ?? '')
  const paid_on = paidRaw ? paidRaw.slice(0, 10) : null

  return {
    income_external_id,
    paid_on,
    amount: coerceNumber(p.amount ?? p.payment ?? p.amount_paid ?? p.amount_base),
    currency: coerceString(p.currency_code ?? p.currency ?? ''),
    kind: coerceString(p.transaction_type ?? p.type ?? 'payout'),
    raw: /** @type {Record<string, unknown>} */ ({ ...p }),
  }
}

/** @param {unknown} valuation */
export function extractCashBalancesFromValuationPayload(valuation) {
  /** @type {Array<{ account_key: string, label?: string, currency?: string, balance?: number|null, raw: Record<string, unknown> }>} */
  const rows = []

  const pushRow = (
    /** @type {{ account_key: string, label?: string, currency?: string, balance?: unknown, raw?: Record<string, unknown> }} */ r,
  ) => {
    rows.push({
      account_key: r.account_key,
      label: r.label,
      currency: r.currency === undefined || r.currency === null ? '' : coerceString(r.currency),
      balance: coerceNumber(r.balance),
      raw: r.raw ?? {},
    })
  }

  /** @type {any} */
  const vAny = valuation

  const tryConsumeArray = (arr, namespace) => {
    if (!Array.isArray(arr)) return

    arr.forEach((item, idx) => {
      if (!item || typeof item !== 'object') return

      /** @type {any} */
      const it = item

      const key = coerceString(
        it.account_id ?? it.account_key ?? it.id ?? it.portfolio_cash_account_id ?? `${namespace}:${idx}`,
      )

      pushRow({
        account_key: key || `${namespace}:${idx}`,
        label: coerceString(it.name ?? it.description ?? it.broker ?? it.bank_name ?? it.account_name),
        currency: coerceString(it.currency_code ?? it.currency ?? it.portfolio_currency ?? ''),
        balance: it.balance ?? it.value?.amount ?? it.cash_balance ?? it.total,
        raw: /** @type {Record<string, unknown>} */ ({ ...it }),
      })
    })
  }

  tryConsumeArray(vAny?.cash_accounts ?? vAny?.cashBalances ?? vAny?.portfolio_cash_accounts, 'cash_account')
  tryConsumeArray(vAny?.linked_accounts ?? vAny?.bank_accounts ?? vAny?.brokers, 'linked_account')

  if (rows.length === 0) {
    pushRow({
      account_key: 'portfolio_valuation:unparsed',
      label: 'Unparsed valuation payload (inspect raw JSON)',
      raw: vAny && typeof vAny === 'object' ? { valuation: JSON.parse(JSON.stringify(vAny)) } : { valuation },
    })
  }

  return rows
}

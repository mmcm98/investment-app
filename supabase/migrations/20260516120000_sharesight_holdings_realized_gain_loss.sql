-- Realised P&L from Sharesight performance payload (BUG-02).

alter table public.sharesight_holdings
  add column if not exists realized_gain_loss numeric;

comment on column public.sharesight_holdings.realized_gain_loss is
  'Realised gain/loss in portfolio reporting currency (AUD when reported), from performance API when available.';

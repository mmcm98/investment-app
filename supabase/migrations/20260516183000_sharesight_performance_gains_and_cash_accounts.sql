alter table public.sharesight_holdings
  add column if not exists payout_gain numeric,
  add column if not exists currency_gain numeric,
  add column if not exists total_gain numeric,
  add column if not exists capital_gain_percent numeric,
  add column if not exists total_gain_percent numeric;

alter table public.sharesight_cash_balances
  add column if not exists cash_account_id text,
  add column if not exists name text,
  add column if not exists balance_in_portfolio_currency numeric,
  add column if not exists portfolio_id text;

comment on column public.sharesight_holdings.unrealized_gain_loss is
  'Sharesight performance capital_gain for the holding.';

comment on column public.sharesight_holdings.payout_gain is
  'Sharesight performance payout_gain for the holding.';

comment on column public.sharesight_holdings.currency_gain is
  'Sharesight performance currency_gain for the holding.';

comment on column public.sharesight_holdings.total_gain is
  'Sharesight performance total_gain for the holding.';

comment on column public.sharesight_holdings.capital_gain_percent is
  'Sharesight performance capital_gain_percent for the holding.';

comment on column public.sharesight_holdings.total_gain_percent is
  'Sharesight performance total_gain_percent for the holding.';

comment on column public.sharesight_cash_balances.cash_account_id is
  'Sharesight v2 cash account id.';

comment on column public.sharesight_cash_balances.name is
  'Sharesight v2 cash account name.';

comment on column public.sharesight_cash_balances.balance_in_portfolio_currency is
  'Cash balance converted by Sharesight into the portfolio currency.';

comment on column public.sharesight_cash_balances.portfolio_id is
  'Sharesight portfolio id from the v2 cash accounts sync.';

-- Persist Sharesight-reported market value in AUD (portfolio / reporting currency) for dashboard math.

alter table public.sharesight_holdings
  add column if not exists holding_value_aud numeric;

comment on column public.sharesight_holdings.holding_value_aud is
  'Market value in AUD from Sharesight (reporting or portfolio currency), not derived from Yahoo live prices.';

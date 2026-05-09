-- Replace expression-based unique index so PostgREST upsert(onConflict=...) works on plain columns.

update public.sharesight_cash_balances
set currency = ''
where currency is null;

alter table public.sharesight_cash_balances alter column currency set default '';

alter table public.sharesight_cash_balances alter column currency set not null;

drop index if exists sharesight_cash_balances_natural_key;

create unique index if not exists sharesight_cash_balances_natural_key
  on public.sharesight_cash_balances (user_id, portfolio_role, portfolio_external_id, account_key, currency);

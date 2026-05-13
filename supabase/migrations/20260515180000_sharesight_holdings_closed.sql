-- Closed / zero-qty holdings: hidden from active views; still retained for history.

alter table public.sharesight_holdings
  add column if not exists closed boolean not null default false;

comment on column public.sharesight_holdings.closed is
  'True when Sharesight reports the holding as closed or quantity is zero — excluded from active sleeve views and live-quote cycles.';

create index if not exists sharesight_holdings_user_closed_idx
  on public.sharesight_holdings (user_id, closed)
  where closed = true;

-- Watchlist parity with satellite analysis state + cached FMP enrichment for list UI.

alter table public.watchlist_items
add column if not exists awaiting_analysis boolean not null default true;

alter table public.watchlist_items
add column if not exists buy_zones jsonb not null default '[]'::jsonb;

alter table public.watchlist_items
add column if not exists exit_triggers jsonb not null default '[]'::jsonb;

alter table public.watchlist_items
add column if not exists auto_monitor boolean not null default false;

alter table public.watchlist_items
add column if not exists fmp_company_description text;

alter table public.watchlist_items
add column if not exists fmp_metrics jsonb default '{}'::jsonb;

alter table public.watchlist_items
add column if not exists fmp_metrics_fetched_at timestamptz;

comment on column public.watchlist_items.fmp_company_description is 'Company description from FMP profile before Claude synopsis exists.';

-- Cached live quotes / FX / ATH — never scrape Yahoo HTML; Yahoo data via server-side yahoo-finance2 only.

-- ---------------------------------------------------------------------------
-- Per-user job cursor (daily ATH cadence keyed to Australia/Sydney calendar day)
-- ---------------------------------------------------------------------------

create table if not exists public.user_market_job_state (
  user_id uuid primary key references auth.users (id) on delete cascade,
  updated_at timestamptz not null default now(),
  last_ath_run_sydney_date date
);

alter table public.user_market_job_state enable row level security;

create policy "user_market_job_state_own_select"
on public.user_market_job_state
for select
to authenticated
using (user_id = auth.uid());

create policy "user_market_job_state_own_upsert"
on public.user_market_job_state
for insert
to authenticated
with check (user_id = auth.uid());

create policy "user_market_job_state_own_update"
on public.user_market_job_state
for update
to authenticated
using (user_id = auth.uid())
with check (user_id = auth.uid());

-- ---------------------------------------------------------------------------
-- FX to AUD — cache pairs from Yahoo FX symbols (yahoo-finance2 quote)
-- ---------------------------------------------------------------------------

create table if not exists public.fx_rates_cache (
  id uuid primary key default gen_random_uuid (),
  user_id uuid not null references auth.users (id) on delete cascade,
  currency text not null,
  aud_per_unit numeric not null,
  yahoo_symbol text not null,
  updated_at timestamptz not null default now(),
  constraint fx_rates_currency_upper check (char_length(trim(currency)) > 0),
  constraint fx_rates_aud_positive check (aud_per_unit > 0)
);

create unique index if not exists fx_rates_cache_natural_key
  on public.fx_rates_cache (user_id, currency);

create index if not exists fx_rates_cache_user_idx on public.fx_rates_cache (user_id);

alter table public.fx_rates_cache enable row level security;

create policy "fx_rates_cache_own_select"
on public.fx_rates_cache
for select
to authenticated
using (user_id = auth.uid());

create policy "fx_rates_cache_own_insert"
on public.fx_rates_cache
for insert
to authenticated
with check (user_id = auth.uid());

create policy "fx_rates_cache_own_update"
on public.fx_rates_cache
for update
to authenticated
using (user_id = auth.uid())
with check (user_id = auth.uid());

create policy "fx_rates_cache_own_delete"
on public.fx_rates_cache
for delete
to authenticated
using (user_id = auth.uid());

-- ---------------------------------------------------------------------------
-- Per-holding quote + ATH snapshot (joins to Sharesight natural key)
-- ---------------------------------------------------------------------------

create table if not exists public.market_quote_snapshots (
  id uuid primary key default gen_random_uuid (),
  user_id uuid not null references auth.users (id) on delete cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  portfolio_role text not null,
  portfolio_external_id text not null,
  holding_external_id text not null,

  instrument_symbol text,
  instrument_name text,
  fmp_symbol text,
  exchange_short_name text not null,
  yahoo_symbol text not null,
  quote_currency text not null default 'AUD',

  last_price numeric,
  previous_close numeric,
  change_percent numeric,
  aud_last_price numeric,

  ath numeric,
  ath_as_of date,
  ath_computed_at timestamptz,

  quote_source text,
  quotes_fetched_at timestamptz,

  constraint market_quote_snapshots_portfolio_role_valid check (portfolio_role in ('core', 'satellite'))
);

create unique index if not exists market_quote_snapshots_natural_key
  on public.market_quote_snapshots (user_id, portfolio_role, holding_external_id);

create index if not exists market_quote_snapshots_user_idx on public.market_quote_snapshots (user_id);
create index if not exists market_quote_snapshots_updated_idx on public.market_quote_snapshots (user_id, updated_at desc);

alter table public.market_quote_snapshots enable row level security;

create policy "market_quote_snapshots_own_select"
on public.market_quote_snapshots
for select
to authenticated
using (user_id = auth.uid());

create policy "market_quote_snapshots_own_insert"
on public.market_quote_snapshots
for insert
to authenticated
with check (user_id = auth.uid());

create policy "market_quote_snapshots_own_update"
on public.market_quote_snapshots
for update
to authenticated
using (user_id = auth.uid())
with check (user_id = auth.uid());

create policy "market_quote_snapshots_own_delete"
on public.market_quote_snapshots
for delete
to authenticated
using (user_id = auth.uid());

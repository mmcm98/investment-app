-- =============================================================================
-- Sharesight integration tables (run after auth is enabled)
-- Paste into Supabase SQL editor or merge with your migration chain.
-- Depends on nothing else if this function exists (otherwise safe to redefine).
-- =============================================================================

create extension if not exists "pgcrypto";

create or replace function public.set_updated_at()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

-- -----------------------------------------------------------------------------
-- OAuth tokens (no localStorage — persisted per authenticated user)
-- -----------------------------------------------------------------------------

create table if not exists public.sharesight_oauth_credentials (
  user_id uuid primary key references auth.users (id) on delete cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  access_token text not null,
  refresh_token text,
  token_type text not null default 'bearer',

  -- When the access token should be treated as expired (refresh before this)
  access_expires_at timestamptz not null,

  reconnect_required boolean not null default false,
  last_auth_error text,

  last_successful_sync_at timestamptz,
  last_sync_attempt_at timestamptz,
  last_sync_error text
);

create index if not exists sharesight_oauth_credentials_updated_at_idx
  on public.sharesight_oauth_credentials (updated_at desc);

drop trigger if exists trg_sharesight_oauth_credentials_updated_at on public.sharesight_oauth_credentials;
create trigger trg_sharesight_oauth_credentials_updated_at
before update on public.sharesight_oauth_credentials
for each row execute procedure public.set_updated_at();

alter table public.sharesight_oauth_credentials enable row level security;

create policy "sharesight_oauth_credentials_select_own"
on public.sharesight_oauth_credentials
for select
to authenticated
using (user_id = auth.uid());

create policy "sharesight_oauth_credentials_insert_own"
on public.sharesight_oauth_credentials
for insert
to authenticated
with check (user_id = auth.uid());

create policy "sharesight_oauth_credentials_update_own"
on public.sharesight_oauth_credentials
for update
to authenticated
using (user_id = auth.uid())
with check (user_id = auth.uid());

create policy "sharesight_oauth_credentials_delete_own"
on public.sharesight_oauth_credentials
for delete
to authenticated
using (user_id = auth.uid());

-- -----------------------------------------------------------------------------
-- Sync runs (correlation id for a single batch)
-- -----------------------------------------------------------------------------

create table if not exists public.sharesight_sync_runs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  created_at timestamptz not null default now(),
  completed_at timestamptz,

  status text not null default 'running',
  error_message text,
  trigger text not null default 'unknown',

  constraint sharesight_sync_runs_status_valid check (
    status in ('running', 'success', 'error', 'partial')
  )
);

create index if not exists sharesight_sync_runs_user_created_idx
  on public.sharesight_sync_runs (user_id, created_at desc);

alter table public.sharesight_sync_runs enable row level security;

create policy "sharesight_sync_runs_select_own"
on public.sharesight_sync_runs
for select
to authenticated
using (user_id = auth.uid());

create policy "sharesight_sync_runs_insert_own"
on public.sharesight_sync_runs
for insert
to authenticated
with check (user_id = auth.uid());

create policy "sharesight_sync_runs_update_own"
on public.sharesight_sync_runs
for update
to authenticated
using (user_id = auth.uid())
with check (user_id = auth.uid());

create policy "sharesight_sync_runs_delete_own"
on public.sharesight_sync_runs
for delete
to authenticated
using (user_id = auth.uid());

-- -----------------------------------------------------------------------------
-- Holdings (normalized + raw)
-- -----------------------------------------------------------------------------

create table if not exists public.sharesight_holdings (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  created_at timestamptz not null default now(),

  portfolio_role text not null,
  portfolio_external_id text not null,
  holding_external_id text not null,

  instrument_symbol text,
  instrument_name text,
  quantity numeric,
  market_value numeric,
  holding_value_aud numeric,
  cost_basis numeric,
  unrealized_gain_loss numeric,
  currency text,

  raw jsonb not null default '{}'::jsonb,
  sync_run_id uuid references public.sharesight_sync_runs (id) on delete set null,

  closed boolean not null default false,

  constraint sharesight_holdings_portfolio_role_valid check (
    portfolio_role in ('core', 'satellite')
  )
);

create unique index if not exists sharesight_holdings_natural_key
  on public.sharesight_holdings (user_id, portfolio_role, holding_external_id);

create index if not exists sharesight_holdings_user_idx on public.sharesight_holdings (user_id);
create index if not exists sharesight_holdings_symbol_idx on public.sharesight_holdings (user_id, instrument_symbol);
create index if not exists sharesight_holdings_created_at_idx on public.sharesight_holdings (created_at desc);

alter table public.sharesight_holdings enable row level security;

create policy "sharesight_holdings_select_own"
on public.sharesight_holdings
for select
to authenticated
using (user_id = auth.uid());

create policy "sharesight_holdings_insert_own"
on public.sharesight_holdings
for insert
to authenticated
with check (user_id = auth.uid());

create policy "sharesight_holdings_update_own"
on public.sharesight_holdings
for update
to authenticated
using (user_id = auth.uid())
with check (user_id = auth.uid());

create policy "sharesight_holdings_delete_own"
on public.sharesight_holdings
for delete
to authenticated
using (user_id = auth.uid());

-- -----------------------------------------------------------------------------
-- Trades
-- -----------------------------------------------------------------------------

create table if not exists public.sharesight_trades (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  created_at timestamptz not null default now(),

  portfolio_role text not null,
  portfolio_external_id text not null,
  trade_external_id text not null,

  raw jsonb not null default '{}'::jsonb,
  sync_run_id uuid references public.sharesight_sync_runs (id) on delete set null,

  constraint sharesight_trades_portfolio_role_valid check (
    portfolio_role in ('core', 'satellite')
  )
);

create unique index if not exists sharesight_trades_natural_key
  on public.sharesight_trades (user_id, portfolio_role, trade_external_id);

create index if not exists sharesight_trades_user_idx on public.sharesight_trades (user_id);
create index if not exists sharesight_trades_created_at_idx on public.sharesight_trades (created_at desc);

alter table public.sharesight_trades enable row level security;

create policy "sharesight_trades_select_own"
on public.sharesight_trades
for select
to authenticated
using (user_id = auth.uid());

create policy "sharesight_trades_insert_own"
on public.sharesight_trades
for insert
to authenticated
with check (user_id = auth.uid());

create policy "sharesight_trades_update_own"
on public.sharesight_trades
for update
to authenticated
using (user_id = auth.uid())
with check (user_id = auth.uid());

create policy "sharesight_trades_delete_own"
on public.sharesight_trades
for delete
to authenticated
using (user_id = auth.uid());

-- -----------------------------------------------------------------------------
-- Cash balances (best-effort extraction from valuation payloads)
-- -----------------------------------------------------------------------------

create table if not exists public.sharesight_cash_balances (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  created_at timestamptz not null default now(),

  portfolio_role text not null,
  portfolio_external_id text not null,
  account_key text not null,
  label text,
  currency text not null default '',
  balance numeric,

  raw jsonb not null default '{}'::jsonb,
  sync_run_id uuid references public.sharesight_sync_runs (id) on delete set null,

  constraint sharesight_cash_portfolio_role_valid check (
    portfolio_role in ('core', 'satellite')
  )
);

create unique index if not exists sharesight_cash_balances_natural_key
  on public.sharesight_cash_balances (user_id, portfolio_role, portfolio_external_id, account_key, currency);

create index if not exists sharesight_cash_balances_user_idx on public.sharesight_cash_balances (user_id);

alter table public.sharesight_cash_balances enable row level security;

create policy "sharesight_cash_balances_select_own"
on public.sharesight_cash_balances
for select
to authenticated
using (user_id = auth.uid());

create policy "sharesight_cash_balances_insert_own"
on public.sharesight_cash_balances
for insert
to authenticated
with check (user_id = auth.uid());

create policy "sharesight_cash_balances_update_own"
on public.sharesight_cash_balances
for update
to authenticated
using (user_id = auth.uid())
with check (user_id = auth.uid());

create policy "sharesight_cash_balances_delete_own"
on public.sharesight_cash_balances
for delete
to authenticated
using (user_id = auth.uid());

-- -----------------------------------------------------------------------------
-- Portfolio performance payloads (full JSON from Sharesight reports)
-- -----------------------------------------------------------------------------

create table if not exists public.sharesight_performance_snapshots (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  created_at timestamptz not null default now(),

  portfolio_role text not null,
  portfolio_external_id text not null,
  start_date date not null,
  end_date date not null,
  payload jsonb not null default '{}'::jsonb,
  sync_run_id uuid references public.sharesight_sync_runs (id) on delete set null,

  constraint sharesight_performance_portfolio_role_valid check (
    portfolio_role in ('core', 'satellite')
  )
);

create unique index if not exists sharesight_performance_snapshots_natural_key
  on public.sharesight_performance_snapshots (
    user_id,
    portfolio_role,
    portfolio_external_id,
    start_date,
    end_date
  );

create index if not exists sharesight_performance_snapshots_user_idx
  on public.sharesight_performance_snapshots (user_id, created_at desc);

alter table public.sharesight_performance_snapshots enable row level security;

create policy "sharesight_performance_snapshots_select_own"
on public.sharesight_performance_snapshots
for select
to authenticated
using (user_id = auth.uid());

create policy "sharesight_performance_snapshots_insert_own"
on public.sharesight_performance_snapshots
for insert
to authenticated
with check (user_id = auth.uid());

create policy "sharesight_performance_snapshots_update_own"
on public.sharesight_performance_snapshots
for update
to authenticated
using (user_id = auth.uid())
with check (user_id = auth.uid());

create policy "sharesight_performance_snapshots_delete_own"
on public.sharesight_performance_snapshots
for delete
to authenticated
using (user_id = auth.uid());

-- -----------------------------------------------------------------------------
-- Income / distributions / payouts (raw payout objects)
-- -----------------------------------------------------------------------------

create table if not exists public.sharesight_income_events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  created_at timestamptz not null default now(),

  portfolio_role text not null,
  portfolio_external_id text not null,
  holding_external_id text not null,
  income_external_id text not null,

  paid_on date,
  amount numeric,
  currency text,
  kind text,
  raw jsonb not null default '{}'::jsonb,
  sync_run_id uuid references public.sharesight_sync_runs (id) on delete set null,

  constraint sharesight_income_portfolio_role_valid check (
    portfolio_role in ('core', 'satellite')
  )
);

create unique index if not exists sharesight_income_events_natural_key
  on public.sharesight_income_events (
    user_id,
    portfolio_role,
    holding_external_id,
    income_external_id
  );

create index if not exists sharesight_income_events_user_holding_idx
  on public.sharesight_income_events (user_id, holding_external_id);

create index if not exists sharesight_income_events_created_at_idx
  on public.sharesight_income_events (created_at desc);

alter table public.sharesight_income_events enable row level security;

create policy "sharesight_income_events_select_own"
on public.sharesight_income_events
for select
to authenticated
using (user_id = auth.uid());

create policy "sharesight_income_events_insert_own"
on public.sharesight_income_events
for insert
to authenticated
with check (user_id = auth.uid());

create policy "sharesight_income_events_update_own"
on public.sharesight_income_events
for update
to authenticated
using (user_id = auth.uid())
with check (user_id = auth.uid());

create policy "sharesight_income_events_delete_own"
on public.sharesight_income_events
for delete
to authenticated
using (user_id = auth.uid());

-- =============================================================================

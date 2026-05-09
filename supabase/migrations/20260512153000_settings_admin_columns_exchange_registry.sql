-- Settings / admin extensions (Sections 10.7 + 10.15): analysis columns + per-user exchange + mapping catalogue.

alter table public.user_settings
  add column if not exists reanalysis_days integer not null default 90
    check (reanalysis_days >= 1 and reanalysis_days <= 730),
  add column if not exists refire_days_after_dismiss integer not null default 30
    check (refire_days_after_dismiss >= 1 and refire_days_after_dismiss <= 365),
  add column if not exists announcement_retention_days integer not null default 30
    check (announcement_retention_days >= 7 and announcement_retention_days <= 366),
  add column if not exists score_version_cap integer not null default 10
    check (score_version_cap >= 1 and score_version_cap <= 100),
  add column if not exists briefing_retention text not null default 'all';

alter table public.user_settings drop constraint if exists user_settings_briefing_retention_check;

alter table public.user_settings
  add constraint user_settings_briefing_retention_check
  check (briefing_retention in ('1y', '2y', '5y', 'all'));

comment on column public.user_settings.reanalysis_days is 'Days since scorecard → recommend full re-analysis (Section 10.7)';
comment on column public.user_settings.briefing_retention is 'Portfolio briefing retention preset';

-- -----------------------------------------------------------------------------
-- Exchange + ticker format catalogue (per user; seeded from app defaults on first Settings visit).
-- -----------------------------------------------------------------------------

create table if not exists public.exchange_registry (
  id uuid primary key default gen_random_uuid (),
  user_id uuid not null references auth.users (id) on delete cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  exchange_short_name text not null,
  timezone_label text not null default 'UTC',
  market_open_local text,
  market_close_local text,
  announcement_source text,
  manual_monitoring boolean not null default false,
  fmp_symbol_format text,
  yahoo_symbol_format text,
  mapping_example text,
  sort_order integer not null default 0,
  constraint exchange_registry_short_name_not_blank check (length(trim(exchange_short_name)) > 0)
);

create index if not exists exchange_registry_user_id_idx on public.exchange_registry (user_id);
create unique index if not exists exchange_registry_user_short_key
on public.exchange_registry (user_id, lower(exchange_short_name));

drop trigger if exists trg_exchange_registry_updated_at on public.exchange_registry;
create trigger trg_exchange_registry_updated_at
before update on public.exchange_registry
for each row execute procedure public.set_updated_at ();

alter table public.exchange_registry enable row level security;

create policy "exchange_registry_select_own"
on public.exchange_registry
for select
to authenticated
using (user_id = auth.uid ());

create policy "exchange_registry_insert_own"
on public.exchange_registry
for insert
to authenticated
with check (user_id = auth.uid ());

create policy "exchange_registry_update_own"
on public.exchange_registry
for update
to authenticated
using (user_id = auth.uid ())
with check (user_id = auth.uid ());

create policy "exchange_registry_delete_own"
on public.exchange_registry
for delete
to authenticated
using (user_id = auth.uid ());

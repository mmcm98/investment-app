-- =============================================================================
-- Investment App — PostgreSQL schema for Supabase
-- Paste into: Supabase Dashboard → SQL Editor → New query
-- Schema only (no application logic beyond updated_at trigger helper).
-- =============================================================================

-- Optional: ensure uuid generation (Supabase usually has this enabled)
create extension if not exists "pgcrypto";

-- -----------------------------------------------------------------------------
-- updated_at maintenance
-- -----------------------------------------------------------------------------

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

-- =============================================================================
-- user_settings
-- =============================================================================

create table public.user_settings (
  user_id uuid primary key references auth.users (id) on delete cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  -- Portfolio / cash / controls
  core_target_pct numeric(5,2) not null default 72.00,
  satellite_target_pct numeric(5,2) not null default 28.00,
  weekly_dca_base_aud numeric(18,2) not null default 350.00,
  external_cash_aud numeric(18,2) not null default 0,
  global_api_pause boolean not null default false,

  tier_schedules jsonb,

  -- JSON blobs for large configurable structures (tier schedules, UI prefs, etc.)
  preferences jsonb not null default '{}'::jsonb
);

create index user_settings_created_at_idx on public.user_settings (created_at);

drop trigger if exists trg_user_settings_updated_at on public.user_settings;
create trigger trg_user_settings_updated_at
before update on public.user_settings
for each row execute procedure public.set_updated_at();

alter table public.user_settings enable row level security;

create policy "user_settings_select_own"
on public.user_settings
for select
to authenticated
using (user_id = auth.uid());

create policy "user_settings_insert_own"
on public.user_settings
for insert
to authenticated
with check (user_id = auth.uid());

create policy "user_settings_update_own"
on public.user_settings
for update
to authenticated
using (user_id = auth.uid())
with check (user_id = auth.uid());

create policy "user_settings_delete_own"
on public.user_settings
for delete
to authenticated
using (user_id = auth.uid());

-- =============================================================================
-- core_etfs
-- =============================================================================

create table public.core_etfs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  ticker text not null,
  name text,
  target_weight_pct numeric(6,3) not null,
  tier_schedule_kind text not null default 'standard',
  custom_tier_schedule jsonb,
  gearing_multiple numeric(10,4),
  gearing_updated_at timestamptz,
  provider_page_url text,
  archived boolean not null default false,
  sort_order integer not null default 0,

  constraint core_etfs_ticker_not_blank check (length(trim(ticker)) > 0),
  constraint core_etfs_target_weight_non_negative check (target_weight_pct >= 0)
);

create index core_etfs_user_id_idx on public.core_etfs (user_id);
create index core_etfs_ticker_idx on public.core_etfs (user_id, ticker);
create index core_etfs_archived_idx on public.core_etfs (user_id, archived);
create index core_etfs_created_at_idx on public.core_etfs (created_at);

create unique index core_etfs_user_ticker_active_key
on public.core_etfs (user_id, lower(ticker))
where (archived = false);

drop trigger if exists trg_core_etfs_updated_at on public.core_etfs;
create trigger trg_core_etfs_updated_at
before update on public.core_etfs
for each row execute procedure public.set_updated_at();

alter table public.core_etfs enable row level security;

create policy "core_etfs_select_own"
on public.core_etfs
for select
to authenticated
using (user_id = auth.uid());

create policy "core_etfs_insert_own"
on public.core_etfs
for insert
to authenticated
with check (user_id = auth.uid());

create policy "core_etfs_update_own"
on public.core_etfs
for update
to authenticated
using (user_id = auth.uid())
with check (user_id = auth.uid());

create policy "core_etfs_delete_own"
on public.core_etfs
for delete
to authenticated
using (user_id = auth.uid());

-- =============================================================================
-- positions (satellite + core-linked representations as needed)
-- =============================================================================

create table public.positions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  kind text not null default 'satellite', -- satellite | core
  core_etf_id uuid references public.core_etfs (id) on delete restrict,

  fmp_symbol text not null,
  exchange_short_name text not null,
  yahoo_symbol text not null,
  display_ticker text,
  currency text not null,
  name text,

  sharesight_holding_key text,
  sharesight_portfolio_key text,
  sharesight_payload jsonb not null default '{}'::jsonb,

  archived boolean not null default false,
  closed boolean not null default false,
  awaiting_analysis boolean not null default false,

  buy_zones jsonb not null default '[]'::jsonb,
  exit_triggers jsonb not null default '[]'::jsonb,
  extra jsonb not null default '{}'::jsonb,

  constraint positions_kind_valid check (kind in ('satellite', 'core')),
  constraint positions_symbol_not_blank check (length(trim(fmp_symbol)) > 0)
);

create index positions_user_id_idx on public.positions (user_id);
create index positions_created_at_idx on public.positions (created_at);
create index positions_ticker_idx on public.positions (user_id, display_ticker);
create index positions_fmp_symbol_idx on public.positions (user_id, fmp_symbol);
create index positions_yahoo_symbol_idx on public.positions (user_id, yahoo_symbol);
create index positions_archived_closed_idx on public.positions (user_id, archived, closed);

create unique index positions_user_sharesight_holding_key
on public.positions (user_id, sharesight_holding_key)
where (sharesight_holding_key is not null);

drop trigger if exists trg_positions_updated_at on public.positions;
create trigger trg_positions_updated_at
before update on public.positions
for each row execute procedure public.set_updated_at();

alter table public.positions enable row level security;

create policy "positions_select_own"
on public.positions
for select
to authenticated
using (user_id = auth.uid());

create policy "positions_insert_own"
on public.positions
for insert
to authenticated
with check (user_id = auth.uid());

create policy "positions_update_own"
on public.positions
for update
to authenticated
using (user_id = auth.uid())
with check (user_id = auth.uid());

create policy "positions_delete_own"
on public.positions
for delete
to authenticated
using (user_id = auth.uid());

-- =============================================================================
-- watchlist_items
-- =============================================================================

create table public.watchlist_items (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  fmp_symbol text not null,
  exchange_short_name text not null,
  yahoo_symbol text not null,
  display_ticker text,
  currency text,
  name text,

  asset_class text,
  archived boolean not null default false,
  moved_to_position_id uuid references public.positions (id) on delete set null,

  extra jsonb not null default '{}'::jsonb,

  constraint watchlist_symbol_not_blank check (length(trim(fmp_symbol)) > 0)
);

create index watchlist_items_user_id_idx on public.watchlist_items (user_id);
create index watchlist_items_created_at_idx on public.watchlist_items (created_at);
create index watchlist_items_ticker_idx on public.watchlist_items (user_id, display_ticker);
create index watchlist_items_fmp_symbol_idx on public.watchlist_items (user_id, fmp_symbol);
create index watchlist_items_archived_idx on public.watchlist_items (user_id, archived);

create unique index watchlist_items_user_symbols_active_key
on public.watchlist_items (user_id, lower(fmp_symbol), lower(exchange_short_name))
where (archived = false);

drop trigger if exists trg_watchlist_items_updated_at on public.watchlist_items;
create trigger trg_watchlist_items_updated_at
before update on public.watchlist_items
for each row execute procedure public.set_updated_at();

alter table public.watchlist_items enable row level security;

create policy "watchlist_items_select_own"
on public.watchlist_items
for select
to authenticated
using (user_id = auth.uid());

create policy "watchlist_items_insert_own"
on public.watchlist_items
for insert
to authenticated
with check (user_id = auth.uid());

create policy "watchlist_items_update_own"
on public.watchlist_items
for update
to authenticated
using (user_id = auth.uid())
with check (user_id = auth.uid());

create policy "watchlist_items_delete_own"
on public.watchlist_items
for delete
to authenticated
using (user_id = auth.uid());

-- =============================================================================
-- scorecard_versions
-- =============================================================================

create table public.scorecard_versions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  position_id uuid references public.positions (id) on delete restrict,
  watchlist_item_id uuid references public.watchlist_items (id) on delete restrict,

  version_number integer not null,
  framework text not null,
  overall_score numeric(6,3),
  payload jsonb not null default '{}'::jsonb,
  generated_at timestamptz not null default now(),

  constraint scorecard_versions_one_parent check (
    (position_id is not null)::int + (watchlist_item_id is not null)::int = 1
  ),
  constraint scorecard_versions_version_positive check (version_number > 0)
);

create index scorecard_versions_user_id_idx on public.scorecard_versions (user_id);
create index scorecard_versions_created_at_idx on public.scorecard_versions (created_at);
create index scorecard_versions_position_idx on public.scorecard_versions (user_id, position_id);
create index scorecard_versions_watchlist_idx on public.scorecard_versions (user_id, watchlist_item_id);
create index scorecard_versions_generated_at_idx on public.scorecard_versions (user_id, generated_at desc);

create unique index scorecard_versions_position_version_uniq
on public.scorecard_versions (user_id, position_id, version_number)
where position_id is not null;

create unique index scorecard_versions_watchlist_version_uniq
on public.scorecard_versions (user_id, watchlist_item_id, version_number)
where watchlist_item_id is not null;

drop trigger if exists trg_scorecard_versions_updated_at on public.scorecard_versions;
create trigger trg_scorecard_versions_updated_at
before update on public.scorecard_versions
for each row execute procedure public.set_updated_at();

alter table public.scorecard_versions enable row level security;

create policy "scorecard_versions_select_own"
on public.scorecard_versions
for select
to authenticated
using (user_id = auth.uid());

create policy "scorecard_versions_insert_own"
on public.scorecard_versions
for insert
to authenticated
with check (user_id = auth.uid());

create policy "scorecard_versions_update_own"
on public.scorecard_versions
for update
to authenticated
using (user_id = auth.uid())
with check (user_id = auth.uid());

create policy "scorecard_versions_delete_own"
on public.scorecard_versions
for delete
to authenticated
using (user_id = auth.uid());

-- =============================================================================
-- research_paper_versions
-- =============================================================================

create table public.research_paper_versions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  scorecard_version_id uuid not null references public.scorecard_versions (id) on delete cascade,
  payload jsonb not null default '{}'::jsonb,
  generated_at timestamptz not null default now(),

  constraint research_paper_one_per_scorecard unique (scorecard_version_id)
);

create index research_paper_versions_user_id_idx on public.research_paper_versions (user_id);
create index research_paper_versions_created_at_idx on public.research_paper_versions (created_at);
create index research_paper_versions_scorecard_idx on public.research_paper_versions (user_id, scorecard_version_id);
create index research_paper_versions_generated_at_idx on public.research_paper_versions (user_id, generated_at desc);

drop trigger if exists trg_research_paper_versions_updated_at on public.research_paper_versions;
create trigger trg_research_paper_versions_updated_at
before update on public.research_paper_versions
for each row execute procedure public.set_updated_at();

alter table public.research_paper_versions enable row level security;

create policy "research_paper_versions_select_own"
on public.research_paper_versions
for select
to authenticated
using (user_id = auth.uid());

create policy "research_paper_versions_insert_own"
on public.research_paper_versions
for insert
to authenticated
with check (user_id = auth.uid());

create policy "research_paper_versions_update_own"
on public.research_paper_versions
for update
to authenticated
using (user_id = auth.uid())
with check (user_id = auth.uid());

create policy "research_paper_versions_delete_own"
on public.research_paper_versions
for delete
to authenticated
using (user_id = auth.uid());

-- =============================================================================
-- score_override_events (per-item manual adjustments; logged)
-- =============================================================================

create table public.score_override_events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  created_at timestamptz not null default now(),
  scorecard_version_id uuid not null references public.scorecard_versions (id) on delete cascade,
  item_key text not null,
  claude_score numeric(6,3),
  user_score numeric(6,3),
  note text
);

create index score_override_events_user_id_idx on public.score_override_events (user_id);
create index score_override_events_created_at_idx on public.score_override_events (created_at);
create index score_override_events_scorecard_idx on public.score_override_events (user_id, scorecard_version_id);

alter table public.score_override_events enable row level security;

create policy "score_override_events_select_own"
on public.score_override_events
for select
to authenticated
using (user_id = auth.uid());

create policy "score_override_events_insert_own"
on public.score_override_events
for insert
to authenticated
with check (user_id = auth.uid());

create policy "score_override_events_update_own"
on public.score_override_events
for update
to authenticated
using (user_id = auth.uid())
with check (user_id = auth.uid());

create policy "score_override_events_delete_own"
on public.score_override_events
for delete
to authenticated
using (user_id = auth.uid());

-- =============================================================================
-- allocation_overrides (target allocation manual guidance)
-- =============================================================================

create table public.allocation_overrides (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  position_id uuid not null references public.positions (id) on delete cascade,
  target_pct numeric(7,4),
  active boolean not null default true,
  note text,

  constraint allocation_overrides_target_pct_valid check (target_pct is null or (target_pct >= 0 and target_pct <= 100))
);

create index allocation_overrides_user_id_idx on public.allocation_overrides (user_id);
create index allocation_overrides_created_at_idx on public.allocation_overrides (created_at);
create index allocation_overrides_position_idx on public.allocation_overrides (user_id, position_id);
create index allocation_overrides_active_idx on public.allocation_overrides (user_id, active);

create unique index allocation_overrides_one_active_per_position
on public.allocation_overrides (user_id, position_id)
where active;

drop trigger if exists trg_allocation_overrides_updated_at on public.allocation_overrides;
create trigger trg_allocation_overrides_updated_at
before update on public.allocation_overrides
for each row execute procedure public.set_updated_at();

alter table public.allocation_overrides enable row level security;

create policy "allocation_overrides_select_own"
on public.allocation_overrides
for select
to authenticated
using (user_id = auth.uid());

create policy "allocation_overrides_insert_own"
on public.allocation_overrides
for insert
to authenticated
with check (user_id = auth.uid());

create policy "allocation_overrides_update_own"
on public.allocation_overrides
for update
to authenticated
using (user_id = auth.uid())
with check (user_id = auth.uid());

create policy "allocation_overrides_delete_own"
on public.allocation_overrides
for delete
to authenticated
using (user_id = auth.uid());

-- =============================================================================
-- announcements
-- =============================================================================

create table public.announcements (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  position_id uuid references public.positions (id) on delete set null,
  watchlist_item_id uuid references public.watchlist_items (id) on delete set null,

  fmp_symbol text,
  exchange_short_name text,
  display_ticker text,

  source text,
  source_url text,
  headline text not null,
  body text,
  published_at timestamptz,
  price_sensitive boolean,
  raw_payload jsonb not null default '{}'::jsonb,

  catalyst_scorecard_version_id uuid references public.scorecard_versions (id) on delete set null,
  purge_after timestamptz,

  constraint announcements_parent_optional check (
    (position_id is null and watchlist_item_id is null)
    or (position_id is not null)::int + (watchlist_item_id is not null)::int <= 1
  )
);

create index announcements_user_id_idx on public.announcements (user_id);
create index announcements_created_at_idx on public.announcements (created_at);
create index announcements_published_at_idx on public.announcements (user_id, published_at desc);
create index announcements_ticker_idx on public.announcements (user_id, display_ticker);
create index announcements_purge_after_idx on public.announcements (user_id, purge_after);
create index announcements_catalyst_idx on public.announcements (user_id, catalyst_scorecard_version_id);

drop trigger if exists trg_announcements_updated_at on public.announcements;
create trigger trg_announcements_updated_at
before update on public.announcements
for each row execute procedure public.set_updated_at();

alter table public.announcements enable row level security;

create policy "announcements_select_own"
on public.announcements
for select
to authenticated
using (user_id = auth.uid());

create policy "announcements_insert_own"
on public.announcements
for insert
to authenticated
with check (user_id = auth.uid());

create policy "announcements_update_own"
on public.announcements
for update
to authenticated
using (user_id = auth.uid())
with check (user_id = auth.uid());

create policy "announcements_delete_own"
on public.announcements
for delete
to authenticated
using (user_id = auth.uid());

-- =============================================================================
-- portfolio_briefings
-- =============================================================================

create table public.portfolio_briefings (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  title text,
  body_md text not null default '',
  metrics_snapshot jsonb not null default '{}'::jsonb,
  generated_at timestamptz not null default now()
);

create index portfolio_briefings_user_id_idx on public.portfolio_briefings (user_id);
create index portfolio_briefings_created_at_idx on public.portfolio_briefings (created_at);
create index portfolio_briefings_generated_at_idx on public.portfolio_briefings (user_id, generated_at desc);

drop trigger if exists trg_portfolio_briefings_updated_at on public.portfolio_briefings;
create trigger trg_portfolio_briefings_updated_at
before update on public.portfolio_briefings
for each row execute procedure public.set_updated_at();

alter table public.portfolio_briefings enable row level security;

create policy "portfolio_briefings_select_own"
on public.portfolio_briefings
for select
to authenticated
using (user_id = auth.uid());

create policy "portfolio_briefings_insert_own"
on public.portfolio_briefings
for insert
to authenticated
with check (user_id = auth.uid());

create policy "portfolio_briefings_update_own"
on public.portfolio_briefings
for update
to authenticated
using (user_id = auth.uid())
with check (user_id = auth.uid());

create policy "portfolio_briefings_delete_own"
on public.portfolio_briefings
for delete
to authenticated
using (user_id = auth.uid());

-- =============================================================================
-- dca_history (weekly calculation snapshots / execution log)
-- =============================================================================

create table public.dca_history (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  created_at timestamptz not null default now(),

  core_etf_id uuid not null references public.core_etfs (id) on delete cascade,

  week_start_date date not null,
  computed_at timestamptz not null default now(),

  base_weekly_aud numeric(18,2) not null,
  ath_price numeric(18,6),
  live_price numeric(18,6),
  distance_from_ath_pct numeric(10,6),
  tier_label text,
  tier_multiplier numeric(10,6) not null,
  contribution_aud numeric(18,2) not null,
  snapshot jsonb not null default '{}'::jsonb
);

create index dca_history_user_id_idx on public.dca_history (user_id);
create index dca_history_created_at_idx on public.dca_history (created_at);
create index dca_history_computed_at_idx on public.dca_history (user_id, computed_at desc);
create index dca_history_week_start_idx on public.dca_history (user_id, week_start_date desc);
create index dca_history_core_etf_idx on public.dca_history (user_id, core_etf_id);

alter table public.dca_history enable row level security;

create policy "dca_history_select_own"
on public.dca_history
for select
to authenticated
using (user_id = auth.uid());

create policy "dca_history_insert_own"
on public.dca_history
for insert
to authenticated
with check (user_id = auth.uid());

create policy "dca_history_update_own"
on public.dca_history
for update
to authenticated
using (user_id = auth.uid())
with check (user_id = auth.uid());

create policy "dca_history_delete_own"
on public.dca_history
for delete
to authenticated
using (user_id = auth.uid());

-- =============================================================================
-- research_logs
-- =============================================================================

create table public.research_logs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,

  "timestamp" timestamptz not null default now(),
  ticker text not null,
  raw_gemini_json jsonb not null,
  claude_synthesis_status text not null default 'pending',

  constraint research_logs_claude_status_valid check (
    claude_synthesis_status in ('pending', 'success', 'failed')
  ),
  constraint research_logs_ticker_not_blank check (length(trim(ticker)) > 0)
);

create index research_logs_user_id_idx on public.research_logs (user_id);
create index research_logs_timestamp_idx on public.research_logs (user_id, "timestamp" desc);
create index research_logs_ticker_idx on public.research_logs (user_id, ticker);
create index research_logs_status_idx on public.research_logs (user_id, claude_synthesis_status);

alter table public.research_logs enable row level security;

create policy "research_logs_select_own"
on public.research_logs
for select
to authenticated
using (user_id = auth.uid());

create policy "research_logs_insert_own"
on public.research_logs
for insert
to authenticated
with check (user_id = auth.uid());

create policy "research_logs_update_own"
on public.research_logs
for update
to authenticated
using (user_id = auth.uid())
with check (user_id = auth.uid());

create policy "research_logs_delete_own"
on public.research_logs
for delete
to authenticated
using (user_id = auth.uid());

-- =============================================================================
-- gemini_research_artefacts (optional cache table; same RLS model)
-- =============================================================================

create table public.gemini_research_artefacts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  canonical_symbol_key text not null,
  task_type text not null,
  model text,
  payload jsonb not null default '{}'::jsonb,
  fetched_at timestamptz not null default now(),

  constraint gemini_artefacts_task_type_valid check (
    task_type in ('stock_research', 'announcement_triage', 'sector_context')
  )
);

create index gemini_artefacts_user_id_idx on public.gemini_research_artefacts (user_id);
create index gemini_artefacts_created_at_idx on public.gemini_research_artefacts (created_at);
create index gemini_artefacts_lookup_idx on public.gemini_research_artefacts (
  user_id,
  canonical_symbol_key,
  task_type,
  fetched_at desc
);

create unique index gemini_artefacts_latest_key_uniq
on public.gemini_research_artefacts (user_id, canonical_symbol_key, task_type);

drop trigger if exists trg_gemini_research_artefacts_updated_at on public.gemini_research_artefacts;
create trigger trg_gemini_research_artefacts_updated_at
before update on public.gemini_research_artefacts
for each row execute procedure public.set_updated_at();

alter table public.gemini_research_artefacts enable row level security;

create policy "gemini_artefacts_select_own"
on public.gemini_research_artefacts
for select
to authenticated
using (user_id = auth.uid());

create policy "gemini_artefacts_insert_own"
on public.gemini_research_artefacts
for insert
to authenticated
with check (user_id = auth.uid());

create policy "gemini_artefacts_update_own"
on public.gemini_research_artefacts
for update
to authenticated
using (user_id = auth.uid())
with check (user_id = auth.uid());

create policy "gemini_artefacts_delete_own"
on public.gemini_research_artefacts
for delete
to authenticated
using (user_id = auth.uid());

-- =============================================================================

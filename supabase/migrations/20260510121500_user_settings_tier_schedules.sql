-- Editable Standard / GHHF / named custom tier ladders for DCA (defaults applied in app when NULL).

alter table public.user_settings
  add column if not exists tier_schedules jsonb;

comment on column public.user_settings.tier_schedules is
  '{ "standard": [...], "ghhf": [...] } — arrays of {"maxPct": number|null,"multiplier": number}; last row maxPct null = open-ended tail.';

alter table public.core_etfs drop constraint if exists core_etfs_tier_schedule_kind_check;

alter table public.core_etfs
  add constraint core_etfs_tier_schedule_kind_check
  check (
    tier_schedule_kind in ('standard', 'ghhf', 'custom')
  );

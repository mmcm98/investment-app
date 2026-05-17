create table if not exists public.analysis_jobs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  holding_id text not null,
  status text not null default 'pending',
  raw_gemini_json jsonb,
  result jsonb,
  error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint analysis_jobs_status_valid check (status in ('pending', 'gemini_complete', 'complete', 'failed')),
  constraint analysis_jobs_holding_not_blank check (length(trim(holding_id)) > 0)
);

create index if not exists analysis_jobs_user_created_idx
  on public.analysis_jobs (user_id, created_at desc);

create index if not exists analysis_jobs_user_status_idx
  on public.analysis_jobs (user_id, status);

alter table public.analysis_jobs enable row level security;

create policy "analysis_jobs_select_own"
on public.analysis_jobs
for select
to authenticated
using (user_id = auth.uid());

create policy "analysis_jobs_insert_own"
on public.analysis_jobs
for insert
to authenticated
with check (user_id = auth.uid());

create policy "analysis_jobs_update_own"
on public.analysis_jobs
for update
to authenticated
using (user_id = auth.uid())
with check (user_id = auth.uid());

create policy "analysis_jobs_delete_own"
on public.analysis_jobs
for delete
to authenticated
using (user_id = auth.uid());

alter table public.sharesight_holdings
  add column if not exists extra jsonb not null default '{}'::jsonb;

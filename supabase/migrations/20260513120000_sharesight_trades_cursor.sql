-- Incremental Sharesight trades sync watermarks (per portfolio role)

alter table public.sharesight_oauth_credentials
  add column if not exists trades_cursor_core timestamptz null;

alter table public.sharesight_oauth_credentials
  add column if not exists trades_cursor_satellite timestamptz null;

comment on column public.sharesight_oauth_credentials.trades_cursor_core is
  'Newest trade execution time seen for core portfolio (ISO timestamptz); incremental sync fetches trades newer than this.';

comment on column public.sharesight_oauth_credentials.trades_cursor_satellite is
  'Newest trade execution time seen for satellite portfolio; incremental sync fetches trades newer than this.';

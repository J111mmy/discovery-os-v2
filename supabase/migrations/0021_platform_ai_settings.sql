-- Migration 0021: Platform AI provider settings
-- Super admin controlled, service-role managed platform settings.

create table if not exists platform_settings (
  key        text primary key,
  value      jsonb not null default '{}'::jsonb,
  updated_by uuid,
  updated_at timestamptz not null default now()
);

alter table platform_settings enable row level security;

-- No RLS policies by design: normal authenticated users cannot read or write
-- platform settings. Super admin route handlers use the service role and check
-- super_admins before any access.

insert into platform_settings (key, value)
values ('ai_provider', '{"provider":"anthropic"}'::jsonb)
on conflict (key) do nothing;

comment on table platform_settings is
  'Service-role managed platform settings. Super admin routes enforce access.';

comment on column platform_settings.value is
  'JSON value for the named setting. ai_provider.value.provider is anthropic or openai.';

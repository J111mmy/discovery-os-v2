-- #14 Markdown -> contract HTML expansion.
--
-- Expand only. Jimmy applies this in Supabase after Opus review.
-- App code is responsible for enforcing docs/ARTIFACT_HTML_CONTRACT.md by
-- sanitising content_html on store and again on render.

alter table public.artifacts
  add column if not exists content_html text;

alter table public.artifact_versions
  add column if not exists content_html text;

comment on column public.artifacts.content_html is
  'Sanitised artifact HTML conforming to docs/ARTIFACT_HTML_CONTRACT.md. Nullable during #14 expand/backfill/contract migration.';

comment on column public.artifact_versions.content_html is
  'Sanitised artifact version HTML conforming to docs/ARTIFACT_HTML_CONTRACT.md. Nullable during #14 expand/backfill/contract migration.';

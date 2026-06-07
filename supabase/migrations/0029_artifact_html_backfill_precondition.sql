-- #14 Markdown -> contract HTML backfill precondition.
--
-- Run this only after the backfill script has completed successfully.
-- It intentionally does not drop content_md; Migration B does the final contract/drop.

do $$
declare
  missing_artifacts bigint;
  missing_artifact_versions bigint;
begin
  select count(*)
    into missing_artifacts
    from public.artifacts
   where content_html is null;

  select count(*)
    into missing_artifact_versions
    from public.artifact_versions
   where content_html is null;

  if missing_artifacts <> 0 or missing_artifact_versions <> 0 then
    raise exception
      'Artifact HTML backfill incomplete. artifacts.content_html null: %, artifact_versions.content_html null: %',
      missing_artifacts,
      missing_artifact_versions;
  end if;
end $$;

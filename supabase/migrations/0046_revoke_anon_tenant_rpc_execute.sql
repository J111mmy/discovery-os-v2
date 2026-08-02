-- Migration 0046: remove unnecessary anonymous execution grants from
-- tenant-scoped helper and retrieval functions found by the #149 isolation
-- harness. Authenticated callers retain the access required by RLS policies
-- and the application.

revoke all on function public.auth_user_org_ids() from public, anon;
grant execute on function public.auth_user_org_ids() to authenticated;

revoke all on function public.auth_user_org_role(uuid) from public, anon;
grant execute on function public.auth_user_org_role(uuid) to authenticated;

revoke all on function public.match_evidence(
  uuid,
  uuid,
  vector,
  text[],
  int
) from public, anon;
grant execute on function public.match_evidence(
  uuid,
  uuid,
  vector,
  text[],
  int
) to authenticated;

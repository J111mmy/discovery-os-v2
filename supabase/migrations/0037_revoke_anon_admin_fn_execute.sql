-- Migration 0037: revoke EXECUTE on admin/security functions from anon.
--
-- Follow-up to the #52 post-apply finding. Supabase default privileges
-- auto-grant EXECUTE on every new public-schema function to anon / authenticated /
-- service_role; the `revoke ... from public` in 0034/0035 removes only the PUBLIC
-- pseudo-role grant, NOT those explicit per-role grants. So anon retained EXECUTE
-- on these two functions.
--
-- No data was exposed: admin_llm_cost_dashboard raises 'not authorized' for any
-- caller without a super-admin auth.uid(), and auth_is_super_admin() returns false
-- for anon (auth.uid() is null). This is least-privilege hardening, not a leak fix.
--
-- IMPORTANT: only `anon` is revoked. `authenticated` MUST keep EXECUTE:
--   - admin_llm_cost_dashboard is called by /admin/costs as the logged-in user.
--   - auth_is_super_admin() is evaluated inside the llm_cost_events RLS SELECT
--     policy for authenticated users.
-- service_role is unaffected.

revoke execute on function public.admin_llm_cost_dashboard(text, text, integer) from anon;
revoke execute on function public.auth_is_super_admin() from anon;

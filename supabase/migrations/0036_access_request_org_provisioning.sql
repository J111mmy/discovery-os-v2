-- Migration 0036: provision a new customer org from an approved access request.
--
-- GitHub #77. This is the single transactional DB path for creating an empty
-- org plus the initial owner invite. The email send stays in the route; if it
-- fails, the route deletes the org and cascades the invite.
--
-- Do not apply until Opus reviews. Jimmy applies in Supabase.

create or replace function public.provision_customer_org(
  p_org_name text,
  p_email text
)
returns table(
  org_id uuid,
  org_name text,
  org_slug text,
  invite_id uuid,
  invite_token text,
  invite_email text,
  invite_role text,
  expires_at timestamptz
)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_org_name text := nullif(trim(p_org_name), '');
  v_email text := lower(nullif(trim(p_email), ''));
  v_base_slug text;
  v_candidate_slug text;
  v_suffix integer := 1;
  v_org public.orgs%rowtype;
  v_invite public.org_invites%rowtype;
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'not authorized' using errcode = '42501';
  end if;

  if v_org_name is null or char_length(v_org_name) > 180 then
    raise exception 'invalid organisation name' using errcode = '22023';
  end if;

  if v_email is null or char_length(v_email) > 320 or position('@' in v_email) < 2 then
    raise exception 'invalid invite email' using errcode = '22023';
  end if;

  v_base_slug := lower(regexp_replace(v_org_name, '[^a-zA-Z0-9]+', '-', 'g'));
  v_base_slug := trim(both '-' from v_base_slug);
  v_base_slug := left(nullif(v_base_slug, ''), 54);
  if v_base_slug is null then
    v_base_slug := 'workspace';
  end if;

  loop
    if v_suffix = 1 then
      v_candidate_slug := v_base_slug;
    else
      v_candidate_slug := left(v_base_slug, 54) || '-' || v_suffix::text;
    end if;

    begin
      insert into public.orgs (name, slug)
      values (v_org_name, v_candidate_slug)
      returning * into v_org;
      exit;
    exception
      when unique_violation then
        v_suffix := v_suffix + 1;
        if v_suffix > 9999 then
          raise exception 'could not generate unique organisation slug' using errcode = '23505';
        end if;
    end;
  end loop;

  insert into public.org_invites (org_id, email, role)
  values (v_org.id, v_email, 'owner')
  returning * into v_invite;

  return query select
    v_org.id,
    v_org.name,
    v_org.slug,
    v_invite.id,
    v_invite.token,
    v_invite.email,
    v_invite.role,
    v_invite.expires_at;
end;
$$;

revoke all on function public.provision_customer_org(text, text) from public, anon, authenticated;
grant execute on function public.provision_customer_org(text, text) to service_role;

comment on function public.provision_customer_org(text, text) is
  'Service-role-only SECURITY DEFINER path that transactionally creates an org and its initial owner invite for approved access requests.';

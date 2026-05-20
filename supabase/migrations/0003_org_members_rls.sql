-- org_members RLS policies
-- org_members had RLS enabled but no read/write policies.
-- Users need to read their own memberships; only owners/admins can manage others.

-- Members can read their own org memberships
create policy "users can read own memberships"
  on org_members for select
  using (user_id = auth.uid());

-- Members can read other members in the same org
create policy "org members can see each other"
  on org_members for select
  using (org_id in (select org_id from org_members where user_id = auth.uid()));

-- Only owners and admins can insert new members
create policy "owners and admins can add members"
  on org_members for insert
  with check (org_id in (
    select org_id from org_members
    where user_id = auth.uid() and role in ('owner', 'admin')
  ));

-- Only owners and admins can update member roles
create policy "owners and admins can update members"
  on org_members for update
  using (org_id in (
    select org_id from org_members
    where user_id = auth.uid() and role in ('owner', 'admin')
  ));

-- Only owners can remove members
create policy "owners can remove members"
  on org_members for delete
  using (org_id in (
    select org_id from org_members
    where user_id = auth.uid() and role = 'owner'
  ));

-- Migration 0020: Super admins table
-- Super admins have cross-org access and can impersonate any org for support.
-- This table is ONLY readable/writable via the service role — never via RLS user queries.
-- To grant super admin: INSERT INTO super_admins (user_id, granted_by) VALUES ('<user_uuid>', '<granter_uuid>');

CREATE TABLE IF NOT EXISTS super_admins (
  user_id     uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  granted_at  timestamptz NOT NULL DEFAULT now(),
  granted_by  uuid REFERENCES auth.users(id) ON DELETE SET NULL
);

-- RLS enabled but NO policies — access only via service role key.
-- This means no authenticated user (including admins) can query this table via the normal client.
ALTER TABLE super_admins ENABLE ROW LEVEL SECURITY;

-- Index for fast lookup by user_id (already PK, but explicit for clarity)
-- (Primary key is already indexed, nothing extra needed)

COMMENT ON TABLE super_admins IS
  'Cross-org super administrators. Only grantable via service role / Supabase dashboard. '
  'Never query this table with the user-facing Supabase client.';

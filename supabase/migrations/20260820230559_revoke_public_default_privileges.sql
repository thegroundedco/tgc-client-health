-- Root cause of the hole patched in 20260820225903_restrict_profiles_grants.sql.
--
-- This project predates Supabase's "new tables are not exposed by default"
-- change (2026-04-28, enforced on all projects 2026-10-30), so schema public
-- still carries default privileges that grant everything to the two
-- browser-reachable roles. Every new table is therefore born readable and
-- writable by anon and authenticated, and any column-level grant written to
-- narrow that surface is a no-op, because Postgres privileges are additive.
--
-- Patching each table after the fact only works if nobody ever forgets. Fixing
-- the default removes the trap instead of documenting it.
--
-- ALTER DEFAULT PRIVILEGES only affects objects created by the role whose
-- defaults are being changed, so a bare `alter default privileges in schema
-- public revoke ...` can silently do nothing. pg_default_acl showed two roles
-- carrying a grant for tables in schema public:
--
--   owning_role     | objtype   | defaclacl
--   ----------------+-----------+------------------------------------------------
--   postgres        | tables    | anon=arwdDxtm/postgres, authenticated=...
--   supabase_admin  | tables    | anon=arwdDxtm/supabase_admin, authenticated=...
--
-- `postgres` is the one that governs this project's schema: migrations connect
-- as postgres and public.profiles is owned by postgres, so postgres is the role
-- that will create public.clients and public.checkins too.
--
-- The supabase_admin entry is deliberately left alone. It applies only to
-- objects created by supabase_admin — Supabase's own managed internals — and is
-- unreachable regardless: as postgres we are not a member of supabase_admin, and
-- attempting it fails with
--   42501: permission denied to change default privileges
--
-- Only anon and authenticated are named. postgres, service_role and every
-- Supabase-internal role keep their defaults untouched: service_role is the
-- trusted server-side key that never reaches the browser, and it is how an admin
-- will activate an account.
alter default privileges for role postgres in schema public
  revoke all on tables from anon, authenticated;

alter default privileges for role postgres in schema public
  revoke all on sequences from anon, authenticated;

-- Function defaults are intentionally NOT revoked. The plan revokes `execute`
-- explicitly on each function it creates, and broadly revoking function defaults
-- in public risks breaking Supabase-managed helpers that expect to be callable.
--
-- Existing tables keep the privileges they were already granted -- default
-- privileges apply at CREATE time only. public.profiles was already corrected in
-- 20260820225903_restrict_profiles_grants.sql, and it is currently the only
-- table in public.

-- The previous migration's `grant update (full_name)` was intended to be the
-- structural reason a user cannot promote or activate themselves. On this
-- project it was not, and the table shipped wide open to the browser roles.
--
-- Projects created before Supabase's "new tables are not exposed by default"
-- change (2026-04-28, enforced everywhere 2026-10-30) still carry
--   alter default privileges in schema public
--     grant all on tables to anon, authenticated, service_role;
-- so public.profiles was created with table-level ALL for anon and
-- authenticated no matter how narrow the explicit grants were.
--
-- Postgres privileges are additive, and a table-level update privilege covers
-- every column, so the column-level grant added nothing. Measured on the
-- remote database immediately after the previous migration:
--   has_column_privilege('authenticated','public.profiles','role','UPDATE')      -> true
--   has_column_privilege('authenticated','public.profiles','is_active','UPDATE') -> true
-- The update policy constrains which row is reachable, never which columns, so
-- a signed-in user could set their own role to 'admin' and is_active to true —
-- turning a deliberately inactive viewer into an active admin.
--
-- Revoke the inherited blanket privileges from the two browser-reachable roles,
-- then re-grant only the intended surface. Revoking a table-level privilege
-- also revokes it on every column, so the revoke must come first.
--
-- service_role is intentionally left alone: it never reaches the browser and is
-- how an admin will later activate an account.
revoke all on public.profiles from anon, authenticated;

-- anon gets nothing: an unauthenticated caller has no business reading profiles.
grant select on public.profiles to authenticated;
grant update (full_name) on public.profiles to authenticated;

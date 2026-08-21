-- Declares service_role's access to the three tables in `public` explicitly.
-- Until now it was INHERITED, never declared, and the repository did not
-- describe it anywhere.
--
-- WHAT WAS MEASURED. No migration in this repository contains the string
-- `to service_role`. Yet on the live project all three tables read:
--   profiles => {postgres=arwdDxtm/postgres,service_role=arwdDxtm/postgres,authenticated=r/postgres}
--   clients  => {postgres=arwdDxtm/postgres,service_role=arwdDxtm/postgres,authenticated=arw/postgres}
--   checkins => {postgres=arwdDxtm/postgres,service_role=arwdDxtm/postgres,authenticated=arw/postgres}
--
-- The service_role entry arrives from a default-privileges row this project
-- inherited from its own age, not from anything written here:
--   pg_default_acl public/postgres/r
--     => {postgres=arwdDxtm/postgres,service_role=arwdDxtm/postgres}
-- That row is what remains after 20260820230559 revoked anon and authenticated
-- from it. Every table these migrations create is therefore born fully
-- accessible to service_role -- by accident of project vintage.
--
-- WHY THAT IS NOT ACCEPTABLE AS-IS. service_role is not incidental here: spec
-- section 7.3 and the README both make it THE admin activation path. `is_active`
-- defaults to false, no UI can change it, and the only way to turn on the first
-- account is a statement run with the secret key or from the dashboard's SQL
-- editor. A project whose inherited default row differs -- a newer Supabase
-- project, a restore into a differently-configured database, or a fresh project
-- created after Supabase's 2026-10-30 default-privileges change -- would produce
-- tables that the documented admin path cannot touch. The failure would land at
-- the worst possible moment: the owner running the activation statement from the
-- README, on a database with no other way in, and getting `42501 permission
-- denied for table profiles`.
--
-- So the grant is written down. The repository now says what service_role holds
-- instead of depending on what the project happened to be born with.
--
-- DO NOT DELETE THIS AS REDUNDANT. On this project it changes nothing: every
-- statement below is already true, which is exactly why it is safe to apply to a
-- live database with real data in it. Its value is on the NEXT database, where
-- the inherited default may not supply it. An apparently redundant grant that
-- makes a repository self-describing is doing its job.
--
-- Ordering follows the standing convention from
-- 20260820232223_revoke_public_function_defaults.sql: revoke from the two
-- browser-reachable roles BEFORE any grant, because revoking a table-level
-- privilege also revokes it at column level, so a revoke written after a column
-- grant would silently undo it. The revokes below are no-ops on this project
-- (20260820225903 and 20260821021840 already did them), and they are repeated
-- because the convention does not depend on remembering that.
revoke all on public.profiles from anon, authenticated;
revoke all on public.clients  from anon, authenticated;
revoke all on public.checkins from anon, authenticated;

-- Re-grant the intended browser surface, unchanged. Required, not decorative:
-- the revokes above are unconditional, so without these three lines this
-- migration would take the app's own access away.
--   profiles: read your own row (RLS-scoped) and rename yourself, nothing else.
grant select on public.profiles to authenticated;
grant update (full_name) on public.profiles to authenticated;
--   clients/checkins: read, create, edit. No delete anywhere -- a client is
--   retired by setting `status` and a check-in is corrected by editing it.
grant select, insert, update on public.clients  to authenticated;
grant select, insert, update on public.checkins to authenticated;

-- The declaration this migration exists for. `all` rather than an enumerated
-- list because it reproduces the inherited grant exactly (arwdDxtm) rather than
-- quietly narrowing it, and because service_role is the trusted server-side
-- identity that never reaches the browser: it needs whatever an admin task
-- needs. RLS stays enabled and stays NOT forced on all three tables
-- (scripts/verify-privileges.sql sections 5 and 7), which is what lets
-- service_role act as an administrator rather than as another policy subject.
--
-- anon is deliberately absent from every line in this file. It holds nothing,
-- anywhere, and that is asserted by scripts/verify-privileges.sql section 4.
grant all on public.profiles to service_role;
grant all on public.clients  to service_role;
grant all on public.checkins to service_role;

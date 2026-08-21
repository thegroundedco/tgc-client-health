-- Asserts the privilege boundary that Slice 0 exists to establish, against the
-- live database. Run with `npm run verify:privileges`. Raises on the first run
-- where reality and intent disagree, listing every violation, and exits non-zero.
--
-- Why this file exists. The vulnerability this project shipped with was an
-- *authenticated* user being able to PATCH `role` and `is_active` on their own
-- row, because a table-level UPDATE grant inherited from Supabase's legacy
-- default privileges made the intended column-level grant a no-op. Every test in
-- src/lib/rls.test.ts uses the anonymous client, so all of them would still pass
-- if that grant came back. The only evidence for the guarantee was a manual
-- has_column_privilege run pasted into a report, which does not survive into CI.
-- This file is that evidence, committed and executable.
--
-- The authenticated-session equivalent (sign in, PATCH your own row, watch
-- full_name succeed and role fail) belongs in Task 4, where a session exists.
-- This asserts the privilege matrix that makes that outcome structural.

do $$
declare
  problems  text[] := '{}';
  r         record;
  n_tables  int;
begin
  ----------------------------------------------------------------------------
  -- 1. public.profiles must exist at all.
  ----------------------------------------------------------------------------
  if to_regclass('public.profiles') is null then
    raise exception 'verify:privileges FAILED -- public.profiles does not exist. Has the migration been applied?';
  end if;

  ----------------------------------------------------------------------------
  -- 2. The regression guard for the original bug: the authenticated write
  --    surface on public.profiles is exactly {full_name} and nothing else.
  --    `role` and `is_active` are the two that turn a deliberately inactive
  --    viewer into an active admin.
  ----------------------------------------------------------------------------
  if has_column_privilege('authenticated', 'public.profiles', 'role', 'UPDATE') then
    problems := problems || 'authenticated can UPDATE public.profiles.role -- a signed-in user could promote themselves to admin'::text;
  end if;

  if has_column_privilege('authenticated', 'public.profiles', 'is_active', 'UPDATE') then
    problems := problems || 'authenticated can UPDATE public.profiles.is_active -- a signed-in user could activate their own account'::text;
  end if;

  if not has_column_privilege('authenticated', 'public.profiles', 'full_name', 'UPDATE') then
    problems := problems || 'authenticated CANNOT UPDATE public.profiles.full_name -- the one intended write has been lost'::text;
  end if;

  -- Neither of these is meant to be user-writable either.
  if has_column_privilege('authenticated', 'public.profiles', 'email', 'UPDATE') then
    problems := problems || 'authenticated can UPDATE public.profiles.email'::text;
  end if;

  if has_column_privilege('authenticated', 'public.profiles', 'id', 'UPDATE') then
    problems := problems || 'authenticated can UPDATE public.profiles.id'::text;
  end if;

  -- A table-level UPDATE would silently re-nullify the column grant above,
  -- because Postgres privileges are additive. This is the exact shape of the
  -- original bug, so it is asserted separately from the column checks.
  if has_table_privilege('authenticated', 'public.profiles', 'UPDATE') then
    problems := problems || 'authenticated holds TABLE-LEVEL UPDATE on public.profiles -- this makes any column-level grant meaningless'::text;
  end if;

  if has_table_privilege('authenticated', 'public.profiles', 'INSERT') then
    problems := problems || 'authenticated holds INSERT on public.profiles -- rows are created by the signup trigger only'::text;
  end if;

  if has_table_privilege('authenticated', 'public.profiles', 'DELETE') then
    problems := problems || 'authenticated holds DELETE on public.profiles'::text;
  end if;

  if not has_table_privilege('authenticated', 'public.profiles', 'SELECT') then
    problems := problems || 'authenticated CANNOT SELECT public.profiles -- the app cannot read its own profile'::text;
  end if;

  ----------------------------------------------------------------------------
  -- 3. anon must hold nothing whatsoever on public.profiles, at table or
  --    column level. An unauthenticated caller has no business here.
  ----------------------------------------------------------------------------
  for r in
    select p as priv
    from unnest(array['SELECT','INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER']) p
  loop
    if has_table_privilege('anon', 'public.profiles', r.priv) then
      problems := problems || format('anon holds %s on public.profiles', r.priv);
    end if;
  end loop;

  for r in
    select a.attname, p as priv
    from pg_attribute a
    cross join unnest(array['SELECT','INSERT','UPDATE','REFERENCES']) p
    where a.attrelid = 'public.profiles'::regclass
      and a.attnum > 0 and not a.attisdropped
  loop
    if has_column_privilege('anon', 'public.profiles', r.attname, r.priv) then
      problems := problems || format('anon holds column %s on public.profiles.%s', r.priv, r.attname);
    end if;
  end loop;

  ----------------------------------------------------------------------------
  -- 4. Generic sweep over EVERY table in `public`, so a re-widening from any
  --    source is caught -- not just on the one table we happen to remember.
  --
  --    The intended matrix is encoded as an explicit allowlist. Anything a
  --    browser-reachable role holds that is not on it is a violation. Widening
  --    the boundary therefore means editing this list on purpose, in a diff a
  --    reviewer can see, rather than inheriting it silently from a default.
  --
  --    Table-level privileges only. Column-scoped grants are the intended
  --    mechanism for a narrow write and are checked per-table above.
  ----------------------------------------------------------------------------
  for r in
    with allowed (table_name, grantee, privilege_type) as (
      values
        -- public.profiles: authenticated may read its own row (RLS-scoped) and
        -- rename itself via a column-level grant that needs no table-level entry.
        ('profiles', 'authenticated', 'SELECT'),

        -- public.clients: the board reads every active client, creates one, and
        -- edits one. No DELETE: a client is retired by setting `status`, never
        -- destroyed from the browser. Which rows are reachable is RLS's job
        -- (clients_*_active_users, gated on private.is_active_user()); these
        -- three entries only say the verbs exist at all.
        ('clients', 'authenticated', 'SELECT'),
        ('clients', 'authenticated', 'INSERT'),
        ('clients', 'authenticated', 'UPDATE'),

        -- public.checkins: INSERT is a conscious entry, not a convenience.
        -- Submitting a check-in IS the app's core write, and the board upserts
        -- (PostgREST resolution=merge-duplicates), which needs INSERT and UPDATE
        -- together on the same statement -- withholding either would break the
        -- one round trip Slice 0 exists to prove. No DELETE: a wrong check-in is
        -- corrected by editing it, so the month's history cannot be erased.
        -- total_score is a generated column, so it is unwritable regardless of
        -- this UPDATE grant -- Postgres rejects any attempt with 428C9.
        ('checkins', 'authenticated', 'SELECT'),
        ('checkins', 'authenticated', 'INSERT'),
        ('checkins', 'authenticated', 'UPDATE')

        -- anon: deliberately absent. It is allowed nothing, anywhere.
    ),
    held as (
      select
        c.relname::text as table_name,
        coalesce(g.rolname, 'PUBLIC') as grantee,
        acl.privilege_type::text as privilege_type
      from pg_class c
      join pg_namespace n on n.oid = c.relnamespace
      cross join lateral aclexplode(coalesce(c.relacl, acldefault('r', c.relowner))) acl
      left join pg_roles g on g.oid = acl.grantee
      where n.nspname = 'public'
        and c.relkind in ('r', 'p')
        and coalesce(g.rolname, 'PUBLIC') in ('anon', 'authenticated', 'PUBLIC')
    )
    select h.table_name, h.grantee, h.privilege_type
    from held h
    where not exists (
      select 1 from allowed a
      where a.table_name = h.table_name
        and a.grantee = h.grantee
        and a.privilege_type = h.privilege_type
    )
    order by h.table_name, h.grantee, h.privilege_type
  loop
    problems := problems || format(
      'unexpected grant: %s holds %s on public.%s (not in the allowlist in scripts/verify-privileges.sql -- if this is intended, add it there deliberately)',
      r.grantee, r.privilege_type, r.table_name);
  end loop;

  ----------------------------------------------------------------------------
  -- 5. Every grant must be paired with RLS. A table in `public` reachable by a
  --    browser role with RLS off is an unconditional data leak.
  ----------------------------------------------------------------------------
  for r in
    select c.relname::text as table_name
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public'
      and c.relkind in ('r', 'p')
      and not c.relrowsecurity
  loop
    problems := problems || format('public.%s does not have row level security enabled', r.table_name);
  end loop;

  ----------------------------------------------------------------------------
  -- 6. No function in `public` may be callable by a browser role.
  --
  --    This is the enforcement that matters, because ALTER DEFAULT PRIVILEGES
  --    provably could not suppress Postgres's own hardcoded EXECUTE-to-PUBLIC on
  --    new functions -- see
  --    20260820232429_revoke_public_function_execute_from_public.sql. So a future
  --    `create function public.x()` IS anon-callable unless its migration
  --    revokes execute explicitly. There are zero functions in `public` today;
  --    this assertion is what makes that stay deliberate.
  ----------------------------------------------------------------------------
  for r in
    select (p.oid::regprocedure)::text as fn, g as grantee
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    cross join unnest(array['anon','authenticated']) g
    where n.nspname = 'public'
      and has_function_privilege(g, p.oid, 'EXECUTE')
  loop
    problems := problems || format('%s can EXECUTE public function %s -- revoke execute from public, anon, authenticated in its migration', r.grantee, r.fn);
  end loop;

  ----------------------------------------------------------------------------
  -- 7. RLS must be enabled but NOT forced on profiles. Forcing it subjects the
  --    table owner to policies, which breaks the security definer trigger that
  --    creates the profile row on signup.
  ----------------------------------------------------------------------------
  if (select relforcerowsecurity from pg_class where oid = 'public.profiles'::regclass) then
    problems := problems || 'public.profiles has FORCE row level security -- this breaks the security definer signup trigger'::text;
  end if;

  ----------------------------------------------------------------------------
  -- 8. No sequence in `public` may be reachable by a browser role.
  --
  --    Sections 4-6 sweep tables and functions and would not have noticed a
  --    sequence. That gap was worth closing rather than reasoning about, because
  --    the legacy default privileges this project carries include sequences, and
  --    the supabase_admin row still grants rwU to both browser roles:
  --      pg_default_acl public/supabase_admin/S
  --        = {postgres=rwU/...,anon=rwU/...,authenticated=rwU/...,service_role=rwU/...}
  --    which this project cannot revoke (42501). Sequences created by postgres
  --    are born closed -- 20260820230559 revoked that row for postgres, and both
  --    identity sequences added with clients/checkins were measured as
  --    {postgres=rwU/postgres,service_role=rwU/postgres}, nothing for anon or
  --    authenticated. One created any other way would not be, and USAGE on a
  --    sequence lets a caller burn ids and read setval state.
  --
  --    Identity columns need no grant of their own: they advance their sequence
  --    internally under the table's INSERT privilege, unlike `serial`. So an
  --    empty browser-role ACL here is the correct steady state, not a limitation.
  ----------------------------------------------------------------------------
  for r in
    select
      c.relname::text as seq_name,
      coalesce(g.rolname, 'PUBLIC') as grantee,
      acl.privilege_type::text as privilege_type
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    cross join lateral aclexplode(coalesce(c.relacl, acldefault('S', c.relowner))) acl
    left join pg_roles g on g.oid = acl.grantee
    where n.nspname = 'public'
      and c.relkind = 'S'
      and coalesce(g.rolname, 'PUBLIC') in ('anon', 'authenticated', 'PUBLIC')
    order by c.relname, 2, 3
  loop
    problems := problems || format(
      'unexpected grant: %s holds %s on sequence public.%s -- identity columns need no sequence grant',
      r.grantee, r.privilege_type, r.seq_name);
  end loop;

  ----------------------------------------------------------------------------
  -- 9. The `private` schema stays unreachable by name, and the one function a
  --    policy depends on is executable by `authenticated` and nobody else.
  --
  --    This asserts a measured, non-obvious fact. Postgres checks EXECUTE on a
  --    function referenced by an RLS policy at QUERY time against the role
  --    running the query, so the blanket
  --      revoke execute on function private.is_active_user()
  --        from public, anon, authenticated
  --    that Supabase's own RLS guidance recommends makes every policy on
  --    clients/checkins fail with 42501 for every signed-in user. Probed on this
  --    database before the migration was written; see
  --    20260821021840_create_clients_and_checkins.sql for the transcript.
  --
  --    The narrow shape is therefore: EXECUTE to authenticated, and NO usage on
  --    schema private. A policy references the function by OID and needs only
  --    EXECUTE at run time; calling it by name needs schema USAGE, which is
  --    withheld -- so authenticated is subject to the function without being able
  --    to call it (probed: 42501 permission denied for schema private).
  --
  --    Both halves are asserted, because either one drifting is a real problem:
  --    losing the EXECUTE grant breaks the whole app, and gaining schema USAGE
  --    would expose every current and future definer helper in `private` that
  --    forgot its own revoke.
  ----------------------------------------------------------------------------
  for r in
    select g as grantee
    from unnest(array['anon','authenticated']) g
    where has_schema_privilege(g, 'private', 'USAGE')
  loop
    problems := problems || format(
      '%s holds USAGE on schema private -- every definer helper in there becomes callable by name', r.grantee);
  end loop;

  if to_regprocedure('private.is_active_user()') is null then
    problems := problems || 'private.is_active_user() does not exist -- every policy on clients and checkins references it'::text;
  else
    if not has_function_privilege('authenticated', 'private.is_active_user()', 'EXECUTE') then
      problems := problems || 'authenticated CANNOT EXECUTE private.is_active_user() -- every read and write on clients and checkins will fail with 42501 for every signed-in user'::text;
    end if;

    if has_function_privilege('anon', 'private.is_active_user()', 'EXECUTE') then
      problems := problems || 'anon can EXECUTE private.is_active_user() -- revoke it from public, anon'::text;
    end if;

    -- The `=X` PUBLIC entry Postgres adds to every new function. anon reaches a
    -- function through PUBLIC even with no named grant, so this is asserted
    -- separately from the anon check above rather than inferred from it.
    if exists (
      select 1
      from pg_proc p
      cross join lateral aclexplode(p.proacl) acl
      where p.oid = 'private.is_active_user()'::regprocedure
        and acl.grantee = 0
    ) then
      problems := problems || 'private.is_active_user() is granted to PUBLIC -- every role reaches it implicitly'::text;
    end if;
  end if;

  ----------------------------------------------------------------------------
  -- Report.
  ----------------------------------------------------------------------------
  select count(*) into n_tables
  from pg_class c join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public' and c.relkind in ('r','p');

  if array_length(problems, 1) > 0 then
    raise exception E'verify:privileges FAILED with % violation(s):\n  - %',
      array_length(problems, 1), array_to_string(problems, E'\n  - ');
  end if;

  raise notice 'verify:privileges OK -- % table(s) in public, boundary intact', n_tables;
end $$;

-- Echoed so a passing run shows the matrix it just asserted, not merely "ok".
select
  has_column_privilege('authenticated','public.profiles','full_name','UPDATE') as auth_update_full_name,
  has_column_privilege('authenticated','public.profiles','role','UPDATE')      as auth_update_role,
  has_column_privilege('authenticated','public.profiles','is_active','UPDATE') as auth_update_is_active,
  has_table_privilege('authenticated','public.profiles','SELECT')              as auth_select,
  has_table_privilege('anon','public.profiles','SELECT')                       as anon_select,
  (select relrowsecurity from pg_class where oid='public.profiles'::regclass)   as rls_enabled,
  (select relforcerowsecurity from pg_class where oid='public.profiles'::regclass) as rls_forced;

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
        ('profiles', 'authenticated', 'SELECT')
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

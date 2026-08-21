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

  -- Allowlist for section 9, in the same spirit as the table allowlist in
  -- section 4: a definer helper in `private` may be EXECUTE-able by a
  -- browser-reachable role only by deliberate, reviewable entry. Format is
  -- '<signature>|<role>'. Declared once and read by BOTH directions of the
  -- section 9 sweep, so an entry cannot pin one half and drift on the other.
  private_fn_allowed text[] := array[
    -- private.is_active_user(): referenced by all six policies on
    -- public.clients and public.checkins, every one of them `to authenticated`.
    -- Postgres checks EXECUTE on a policy-referenced function at query time
    -- against the querying role, so without this grant every read and write
    -- fails 42501 for every signed-in user. See section 9's header comment.
    'private.is_active_user()|authenticated'
  ];
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
  -- 9. The `private` schema stays unreachable by name, and every definer helper
  --    in it is EXECUTE-able by a browser role only by deliberate allowlist
  --    entry -- with each entry pinned in BOTH directions.
  --
  --    This encodes a measured, non-obvious fact about Postgres (verified on
  --    17.6, this project, 2026-08-21). EXECUTE on a function referenced by a
  --    row-security policy is checked at QUERY time against the role running the
  --    query, not against the table owner. So the blanket
  --      revoke execute on function private.is_active_user()
  --        from public, anon, authenticated
  --    that both the plan and Supabase's own RLS guidance specify makes every
  --    policy on clients/checkins fail 42501 for every signed-in user. Probed
  --    before the migration was written; transcript in
  --    20260821021840_create_clients_and_checkins.sql.
  --
  --    The correct shape is therefore a PATTERN, not a one-off: a policy-
  --    referenced definer helper gets EXECUTE revoked from PUBLIC and anon, and
  --    granted to exactly the roles its policies name. Schema `private` gets NO
  --    usage grant, which is what keeps that narrow -- a policy references the
  --    function by OID and needs only EXECUTE at run time, while calling it by
  --    name needs USAGE on its schema (probed: 42501 permission denied for
  --    schema private). A role can therefore be SUBJECT TO a helper without
  --    being able to CALL it.
  --
  --    Asserted as an allowlist sweep rather than by naming one function,
  --    because Phase 1 Task 7 adds capability helpers to `private` that will
  --    need the same grant. A per-name check would let every one of them through
  --    unexamined; this makes each an entry a reviewer has to approve.
  --
  --    Both directions matter and both are checked:
  --      9b  a grant NOT on the allowlist is a violation -- the widening case.
  --      9c  an allowlist entry whose grant is MISSING is a violation -- the
  --          outage case, which is the one that takes the whole app down.
  --      9d  no helper in `private` may be granted to PUBLIC, which is how anon
  --          reaches a function with no named grant at all.
  ----------------------------------------------------------------------------

  -- 9a. Schema USAGE must stay withheld. If it ever leaks, every helper in
  --     `private` becomes callable by name -- including any future one that
  --     forgot its own revoke, and including argument-taking helpers, which turn
  --     into oracles the moment they can be called directly.
  for r in
    select g as grantee
    from unnest(array['anon','authenticated']) g
    where has_schema_privilege(g, 'private', 'USAGE')
  loop
    problems := problems || format(
      '%s holds USAGE on schema private -- every definer helper in there becomes callable by name', r.grantee);
  end loop;

  -- 9b. Sweep: no unlisted EXECUTE. has_function_privilege is used rather than
  --     reading proacl, so a privilege reached through PUBLIC is caught too.
  for r in
    select (p.oid::regprocedure)::text as fn, g as grantee
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    cross join unnest(array['anon','authenticated']) g
    where n.nspname = 'private'
      and has_function_privilege(g, p.oid, 'EXECUTE')
      and not ((p.oid::regprocedure)::text || '|' || g = any (private_fn_allowed))
    order by 1, 2
  loop
    problems := problems || format(
      'unexpected grant: %s can EXECUTE %s (not in the private_fn_allowed list in scripts/verify-privileges.sql -- if a policy needs it, add it there deliberately)',
      r.grantee, r.fn);
  end loop;

  -- 9c. Reverse sweep: every allowlist entry must still describe reality. A
  --     stale entry naming a dropped function, or an entry whose grant has been
  --     revoked, both fail here. This is the direction that catches the outage.
  for r in
    select
      split_part(entry, '|', 1) as fn,
      split_part(entry, '|', 2) as grantee
    from unnest(private_fn_allowed) entry
    order by 1, 2
  loop
    if to_regprocedure(r.fn) is null then
      problems := problems || format(
        '%s is on the private_fn_allowed list but does not exist -- either a policy references a missing function, or the list is stale', r.fn);
    elsif not has_function_privilege(r.grantee, r.fn::regprocedure, 'EXECUTE') then
      problems := problems || format(
        '%s CANNOT EXECUTE %s -- every policy referencing it fails 42501 at query time for that role, which takes the app down', r.grantee, r.fn);
    end if;
  end loop;

  -- 9d. No helper in `private` may be granted to PUBLIC. Postgres adds a `=X`
  --     PUBLIC entry to every new function, and 20260820232429 measured that no
  --     ALTER DEFAULT PRIVILEGES on this project suppresses it, so this is a
  --     live default rather than a hypothetical. Checked via aclexplode for
  --     grantee 0 so the diagnosis names PUBLIC directly, instead of surfacing
  --     only as an anon violation in 9b.
  for r in
    select (p.oid::regprocedure)::text as fn
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    cross join lateral aclexplode(p.proacl) acl
    where n.nspname = 'private'
      and acl.grantee = 0
      and acl.privilege_type = 'EXECUTE'
    order by 1
  loop
    problems := problems || format(
      '%s is granted EXECUTE to PUBLIC -- every role reaches it implicitly; revoke execute from public', r.fn);
  end loop;

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

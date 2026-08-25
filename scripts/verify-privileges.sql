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
--
-- Sections 1-9 assert GRANTS. Section 10 asserts POLICY BEHAVIOUR, by becoming
-- the `authenticated` role inside this transaction and running real queries.
-- That section was added because without it nothing anywhere exercised a policy
-- predicate: anon holds nothing, so every test in src/lib/rls.test.ts is denied
-- at the grant layer before a policy is consulted, and all six policies on
-- clients/checkins could have been rewritten as `using (true)` with this file
-- and the whole test suite still green. Read section 10's own header for the
-- detail; it is the only part of this repository that tests the access boundary
-- the spec claims to rest on.

do $$
declare
  problems  text[] := '{}';

  -- Kept SEPARATE from `problems` on purpose, and the distinction is the whole
  -- point of having two arrays. A "problem" is a security finding: something is
  -- open that should be shut, or shut that must be open. A "precondition" is
  -- "there is not enough data here to run that check yet" -- no activated
  -- account, no client rows, no check-in rows. Both still exit non-zero, because
  -- a check that could not run must never read as a check that passed. But they
  -- are reported under different headings, because an operator on a freshly
  -- rebuilt project needs to tell "not enough data to check yet" apart from
  -- "something is wrong", and the old single-array version told them their brand
  -- new empty database had a privilege violation.
  preconditions text[] := '{}';

  r         record;
  n_tables  int;

  -- Section 10 (policy behaviour) only.
  active_uid      uuid;
  n_seen          bigint;
  n_clients_total bigint;
  n_checkins_total bigint;
  n_profiles_total bigint;

  -- Section 10f only: the capability checks, which need a real profile row per
  -- role rather than a synthetic subject. Null means "this project has nobody
  -- with that role", which is reported as a precondition and not as a finding.
  viewer_uid      uuid;
  am_uid          uuid;

  -- Section 10g only: the inactive account. New accounts are created inactive,
  -- so this becomes checkable the first time somebody signs up and is not
  -- activated. Null means nobody on this project is inactive.
  inactive_uid    uuid;

  -- Section 10h only: the users admin write path. An ADMIN needs its own
  -- subject there because it is refused by a DIFFERENT clause of the guard than
  -- a viewer is -- the capability check comes first, so only a caller who holds
  -- manage_users ever reaches the self-edit clause at all.
  admin_uid       uuid;

  -- Read as the table owner before 10h impersonates anybody, for the reason
  -- 10a2 exists: "a viewer sees zero invitations" is true for the wrong reason
  -- against an empty table.
  n_allowed_total bigint;

  -- A real client id, read as the table owner before any impersonation, so 10f
  -- can attempt a check-in insert at all: checkins.client_id is NOT NULL and
  -- references public.clients, and referential integrity is checked with the
  -- owner rights rather than through RLS, so this is a valid target even for a
  -- subject who cannot see the row.
  probe_client_id bigint;

  -- The period 10f writes its probe check-ins to. The first of a month, because
  -- checkins.period carries `check (period = date_trunc('month', period))`, and
  -- a century before any real reporting range so it cannot collide with the
  -- unique (client_id, period). Every probe is rolled back regardless; this is
  -- belt and braces on a database with no backups.
  probe_period date := '1900-01-01';

  -- The subject for every negative case in section 10: a syntactically valid
  -- uuid that has no row in public.profiles, so private.has_capability()
  -- returns false for EVERY capability. Chosen rather than synthesised because
  -- it needs no write of any kind -- no auth.users row, no profile row, nothing
  -- to clean up afterwards. Section 10 asserts it really is absent before
  -- relying on it.
  --
  -- It stands in for two of the three ways has_capability can answer false, and
  -- that is exact rather than approximate. The function is
  --   exists (select 1 from public.profiles p
  --            where p.id = auth.uid() and p.is_active
  --              and wanted = any (<the preset for p.role>))
  -- so a missing profile row and a profile row with is_active = false produce
  -- the identical false. Covering the second one separately would mean
  -- INSERTing into auth.users on the live project to get the signup trigger to
  -- make a profile, and a synthetic account in a real auth table is not worth
  -- it to re-prove the same `exists`.
  --
  -- The THIRD way is new with has_capability and cannot be reached with this
  -- uuid: an ACTIVE account whose role's preset does not include the wanted
  -- capability. That is the whole point of the migration, so it gets its own
  -- check -- 10f, which needs real profile rows and says so when they are
  -- absent rather than quietly proving nothing.
  absent_uid uuid := 'ffffffff-0000-4000-8000-ffffffffffff';

  -- Allowlist for section 9, in the same spirit as the table allowlist in
  -- section 4: a definer helper in `private` may be EXECUTE-able by a
  -- browser-reachable role only by deliberate, reviewable entry. Format is
  -- '<signature>|<role>'. Declared once and read by BOTH directions of the
  -- section 9 sweep, so an entry cannot pin one half and drift on the other.
  private_fn_allowed text[] := array[
    -- private.has_capability(text): referenced by all six policies on
    -- public.clients and public.checkins, every one of them `to authenticated`.
    -- Postgres checks EXECUTE on a policy-referenced function at query time
    -- against the querying role, so without this grant every read and write
    -- fails 42501 for every signed-in user. See section 9's header comment.
    --
    -- The argument type is spelled because 9c casts this half with
    -- ::regprocedure, which needs a resolvable signature and will not take a
    -- bare name. It replaced 'private.is_active_user()|authenticated' in
    -- 20260824160306_has_capability.sql; the reasoning above is older than
    -- either function and outlives both.
    'private.has_capability(text)|authenticated'
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
  --    surface on public.profiles is exactly {full_name, role, is_active}, and
  --    the last two are writable ONLY because a trigger conditions them.
  --    `role` and `is_active` are the two that turn a deliberately inactive
  --    viewer into an active admin.
  --
  --    RE-AIMED, NOT RELAXED, by
  --    20260825202320_profiles_admin_write_path.sql. Until that migration this
  --    section asserted that `role` and `is_active` were NOT grantable to
  --    `authenticated`, and that was the correct claim, because the narrow
  --    column grant WAS the entire mechanism: Postgres has no per-column row
  --    level security, so withholding the columns was the only way to stop a
  --    signed-in user promoting themselves.
  --
  --    Slice 3 needs an admin to write those two columns from the browser, and
  --    a column grant belongs to the ROLE, not to the policy that admitted the
  --    row -- so granting them hands the same write to every signed-in user
  --    through profiles_update_own. The enforcement therefore MOVED into a
  --    BEFORE UPDATE trigger, private.guard_profile_privileges, which raises
  --    42501 unless the caller holds manage_users AND is not editing their own
  --    row. Slice 3 design §6.
  --
  --    So the claim this section makes about those two columns is inverted: the
  --    old assertions would now report a violation against a schema working
  --    exactly as designed. Every other assertion below -- full_name, email, id,
  --    and the table-level sweep that is the shape of the original bug -- is
  --    unchanged, and the grant assertions immediately below are paired with an
  --    assertion that the guard itself still exists. The write surface got
  --    wider; the number of things claimed about it went up, not down.
  ----------------------------------------------------------------------------

  -- The two columns the users admin screen writes. Asserted PRESENT now. Their
  -- absence is an outage on that screen rather than a safety property: with the
  -- guard in place, holding the grant is not what makes self-promotion possible.
  if not has_column_privilege('authenticated', 'public.profiles', 'role', 'UPDATE') then
    problems := problems || 'authenticated CANNOT UPDATE public.profiles.role -- the admin write path is gone, so an admin cannot change the role of anybody else from the browser (20260825202320_profiles_admin_write_path.sql)'::text;
  end if;

  if not has_column_privilege('authenticated', 'public.profiles', 'is_active', 'UPDATE') then
    problems := problems || 'authenticated CANNOT UPDATE public.profiles.is_active -- the admin write path is gone, so no admin can activate or deactivate an account from the browser (20260825202320_profiles_admin_write_path.sql)'::text;
  end if;

  -- The grant on role and is_active is only safe because the guard exists.
  -- Asserting the grant without asserting the guard would turn this section from
  -- a regression guard into a rubber stamp for the vulnerability it was written
  -- to catch. Slice 3 design §6.
  if not exists (
    select 1 from pg_trigger
     where tgrelid = 'public.profiles'::regclass
       and tgname  = 'profiles_guard_privileges'
       and not tgisinternal
  ) then
    problems := problems || 'public.profiles has column-level UPDATE granted on role and is_active but NO profiles_guard_privileges trigger -- every signed-in user can promote themselves to admin through profiles_update_own. This is the 20260820225903 vulnerability, reopened.'::text;
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
        -- public.profiles: authenticated may read its own row and -- since the
        -- Slice 2 step 3 widening -- every other profile too, when active. Which
        -- rows are reachable is RLS's job (profiles_select_own OR
        -- profiles_select_active_users, permissive policies being OR-combined);
        -- this entry only says SELECT exists at all. The WRITE surface is
        -- asserted in section 2, and since
        -- 20260825202320_profiles_admin_write_path.sql it is full_name, role and
        -- is_active -- all three by COLUMN-level grants, which need no
        -- table-level entry here, and the last two conditioned by the
        -- profiles_guard_privileges trigger that section 2 also asserts.
        ('profiles', 'authenticated', 'SELECT'),

        -- public.clients: the board reads every active client, creates one, and
        -- edits one. No DELETE: a client is retired by setting `status`, never
        -- destroyed from the browser. Which rows are reachable is RLS's job
        -- (clients_select_view_scores and clients_{insert,update}_manage_clients,
        -- gated on private.has_capability()); these three entries only say the
        -- verbs exist at all -- SELECT being granted is not the same as a viewer
        -- being allowed to INSERT, which is 10f's business.
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
        ('checkins', 'authenticated', 'UPDATE'),

        -- public.allowed_emails: all four verbs, added by
        -- 20260825201024_create_allowed_emails.sql. An invitation is created,
        -- corrected and withdrawn from the users admin screen, so DELETE is a
        -- deliberate entry here where it is refused on clients and checkins --
        -- withdrawing an invitation must actually remove the row, because the
        -- table means exactly one thing (invited, not yet arrived) and a
        -- soft-deleted invitation would be a second meaning.
        --
        -- These four entries say only that the verbs EXIST for authenticated.
        -- Every one of the four policies gates on manage_users, which only
        -- `admin` holds; that a viewer can neither read nor write the
        -- invitation list is section 10h's business, not this allowlist's.
        ('allowed_emails', 'authenticated', 'SELECT'),
        ('allowed_emails', 'authenticated', 'INSERT'),
        ('allowed_emails', 'authenticated', 'UPDATE'),
        ('allowed_emails', 'authenticated', 'DELETE')

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
    -- The advice deliberately does NOT say "revoke from public, anon,
    -- authenticated". That triple is the outage documented in section 9 and in
    -- spec section 7.2: if the function is referenced by a policy, revoking it
    -- from `authenticated` makes every query by every signed-in user fail
    -- 42501. Harmless today only because `public` holds zero functions.
    problems := problems || format(
      '%s can EXECUTE public function %s -- revoke execute from public and anon in its migration, then grant it back to exactly the roles that need to call it (or, if a POLICY references it, exactly the roles those policies name -- see section 9)',
      r.grantee, r.fn);
  end loop;

  ----------------------------------------------------------------------------
  -- 7. RLS must be enabled (section 5) but NOT forced, on EVERY table in
  --    `public`. Forcing it subjects the table owner to policies, which breaks
  --    the security definer signup trigger that creates the profile row, and
  --    subjects service_role to them too, which breaks the admin activation
  --    path (README: "Activating the first admin").
  --
  --    Swept over every table rather than asserted on `profiles` alone. It was
  --    written for profiles because of the signup trigger, but spec section 7.2
  --    states the property generally -- "every table has RLS enabled, but not
  --    forced" -- and section 10 below now DEPENDS on it generally: the
  --    impersonation there only proves anything because the owner is exempt
  --    from policies, so a FORCE appearing on clients or checkins would change
  --    what those assertions mean. It is also what keeps the trigger function
  --    private.touch_updated_at() firing on clients and checkins.
  ----------------------------------------------------------------------------
  for r in
    select c.relname::text as table_name
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public'
      and c.relkind in ('r', 'p')
      and c.relforcerowsecurity
  loop
    problems := problems || format(
      'public.%s has FORCE row level security -- this subjects the table owner and service_role to the policies, which breaks the security definer signup trigger and the admin activation path',
      r.table_name);
  end loop;

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
  --    That function is GONE -- 20260824160306_has_capability.sql replaced it
  --    with private.has_capability(text) and dropped it. The name is left in the
  --    paragraph above because that is where the measurement was actually taken;
  --    the fact is about the pattern, not about that function, which is exactly
  --    why the sweep below is an allowlist rather than a check on one name.
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
  --     live default rather than a hypothetical.
  --
  --     CORRECTION to what this comment used to claim. It said 9d was what
  --     caught that default, "instead of surfacing only as an anon violation in
  --     9b". It was the other way round. A function that has never had an
  --     explicit grant or revoke has proacl = NULL, its `=X` comes from
  --     acldefault('f', owner) rather than from any stored row, and
  --     aclexplode(NULL) returns ZERO rows -- so 9d as written was blind to
  --     exactly the case it named, and 9b (which asks has_function_privilege,
  --     and therefore sees privileges reached through PUBLIC) is what actually
  --     provided the guarantee. That mattered because a reader trusting the old
  --     comment could have "simplified away" 9b as redundant.
  --
  --     The coalesce below is the fix, and is load-bearing: with it 9d sees the
  --     default case too and names PUBLIC directly, which is a far better
  --     diagnosis than an anon violation. 9b still independently covers it. A
  --     new function in `private` therefore trips both, on purpose -- one
  --     naming the grantee, one naming the mechanism.
  --
  --     Measured on this project (Postgres 17.6): `create function private.x()`
  --     yields proacl = NULL and has_function_privilege('anon', ..., 'EXECUTE')
  --     = true. A function in `private` is born PUBLIC-executable just as one in
  --     `public` is; the schema makes no difference to the ACL, only to whether
  --     the function can be reached BY NAME (see 9a).
  for r in
    select (p.oid::regprocedure)::text as fn
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    cross join lateral aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) acl
    where n.nspname = 'private'
      and acl.grantee = 0
      and acl.privilege_type = 'EXECUTE'
    order by 1
  loop
    problems := problems || format(
      '%s is granted EXECUTE to PUBLIC -- every role reaches it implicitly; revoke execute from public', r.fn);
  end loop;

  ----------------------------------------------------------------------------
  -- 10. POLICY BEHAVIOUR -- what a signed-in user can actually SEE.
  --
  --     Sections 1-9 assert the GRANT layer: which role holds which verb on
  --     which object. Necessary, and on its own not close to sufficient. The
  --     gap was total, and is worth stating without softening:
  --
  --       Nothing in this repository exercised a policy predicate. All 13 tests
  --       in src/lib/rls.test.ts use the ANONYMOUS client; anon holds nothing,
  --       so every one is refused at the grant layer before a policy is ever
  --       consulted. Sections 1-9 read pg_class, pg_proc and the ACLs -- never
  --       pg_policies. So all six policies on public.clients and public.checkins
  --       could have been rewritten as `using (true)` and `with check (true)`,
  --       and this file plus the entire test suite would have stayed green.
  --
  --     Which means spec section 7.2's own "practical test of this design" -- an
  --     account without access, querying the data directly and bypassing the app,
  --     gets ZERO ROWS -- and the negative cases spec section 10 mandates had no
  --     automated evidence at all. RLS is the only access boundary this project
  --     has. It was the only part of it that nothing checked.
  --
  --     This section closes that by becoming the `authenticated` role inside
  --     this transaction and running real queries against the real policies.
  --
  --     WHY HERE AND NOT IN VITEST. The JS client cannot become `authenticated`
  --     without a real session, and a real session needs a magic link clicked in
  --     a mailbox. A test that requires a human to click an email is not a test.
  --     `set local role` is the only way to get a policy predicate evaluated on
  --     demand, and it only exists inside the database. The Vitest suite covers
  --     what it can reach -- the anon grant layer -- and says so.
  --
  --     HOW THE IMPERSONATION WORKS, since none of it is guessable:
  --       set local role authenticated
  --         -- stops us being the table owner. The owner bypasses RLS entirely
  --            unless FORCE is set, which section 7 asserts is NOT set, so
  --            without this line every query below would see every row and prove
  --            nothing. This is why section 7 was generalised to every table.
  --       set_config('request.jwt.claims', '{"sub": "..."}', true)
  --         -- becomes the subject. auth.uid() on this project is exactly
  --            coalesce(nullif(current_setting('request.jwt.claim.sub', true), ''),
  --                     nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub')::uuid
  --            so writing that setting is what gives private.has_capability()
  --            someone to be. Both settings are transaction-local (the `true`),
  --            so they expire with this statement no matter how it ends.
  --
  --     ZERO WRITES, and that is a hard property, not an intention. Every
  --     subject below is either the real active account (read-only) or
  --     `absent_uid`, a uuid with no profile row, which needs no setup. The one
  --     write attempted anywhere is the INSERT in 10c, which the policy is
  --     supposed to REFUSE; it runs inside its own plpgsql block, so the refusal
  --     is caught instead of aborting the run, and if the refusal ever stops
  --     happening the block raises to roll its own subtransaction back. Neither
  --     outcome can leave a row behind.
  --
  --     TWO KINDS OF FAILURE. Findings go into `problems`; "this database does
  --     not contain enough data to run that check" goes into `preconditions`.
  --     Both exit non-zero, under different headings. See the declarations.
  --
  --     Every negative assertion here FAILS if its policy is widened to
  --     `using (true)`. That was verified by doing it: the six policies were
  --     rewritten as `using (true)` / `with check (true)` inside a transaction
  --     that was then rolled back, and this section reported violations for
  --     every case. A policy-behaviour assertion that cannot fail is worse than
  --     no assertion, because it reads like evidence.
  ----------------------------------------------------------------------------

  -- 10a. The subject used by every negative case must really have no profile
  --      row, or all of them turn vacuous in the quietest possible way.
  if exists (select 1 from public.profiles where id = absent_uid) then
    problems := problems || format(
      'the uuid used as the "no profile" subject (%s) HAS a row in public.profiles, so every negative assertion in section 10 is meaningless -- pick a different uuid in scripts/verify-privileges.sql',
      absent_uid)::text;
  end if;

  -- 10a2. DATA PRECONDITIONS, read once as the table owner and then reused by
  --       10b, 10c and 10d alike.
  --
  --       Read here rather than inside 10b because 10c and 10d run whether or
  --       not an account is activated, and they depend on these tables being
  --       non-empty just as much as 10b does. An emptiness check that lived
  --       inside 10b would guard 10b's comparison and leave 10c's and 10d's
  --       `n_seen <> 0` reading `0 = 0` -- true for the wrong reason.
  --
  --       WHY THIS IS NOT PEDANTRY. Every assertion in section 10 compares a row
  --       count. Against an empty table every one of them holds no matter what
  --       the policy says, so in the reachable state
  --         {one activated profile, one or more clients, ZERO check-ins}
  --       the run reported OK while all three of the check-in assertions had gone
  --       unexercised in either direction -- and
  --       the check-in select policy -- `checkins_select_view_scores`, called
  --       `checkins_select_active_users` at the time -- widened to
  --       `using (true)` would have passed. `clients` was guarded from the start and `checkins` was not,
  --       which is exactly the defect class this whole file exists to eliminate,
  --       sitting inside the guard built to eliminate it. Both tables are guarded
  --       now, and the guards are here so that one check covers all three
  --       sections.
  select count(*) into n_clients_total  from public.clients;
  select count(*) into n_checkins_total from public.checkins;
  select count(*) into n_profiles_total from public.profiles;

  -- THE PROFILES WIDENING CANNOT BE CHECKED WITH ONE PROFILE ROW, and this is
  -- exactly the vacuity the rest of this section was built to prevent. With a
  -- single row, "an active user sees all 1 of 1 rows in profiles" is TRUE under
  -- profiles_select_own alone -- so 10b's comparison below passes identically
  -- whether or not 20260824180533_widen_profiles_select.sql was ever applied.
  -- Production held exactly one profile row on the day that migration was
  -- written, and staging held none, so this is the state to expect rather than a
  -- hypothetical.
  if n_profiles_total < 2 then
    preconditions := preconditions || format(
      'public.profiles holds %s row(s), so the profiles widening went UNEXERCISED -- with fewer than two rows, "sees every profile" and "sees only its own" are the same assertion and 10b passes either way. This becomes checkable when a second account exists (README: "Activating the first admin")',
      n_profiles_total)::text;
  end if;

  if n_clients_total = 0 then
    preconditions := preconditions || 'public.clients is empty, so every assertion about who can read a client row is true for the wrong reason (0 = 0) and the clients policies went UNEXERCISED -- seed one client and re-run (README: "Seeding the first client")'::text;
  end if;

  if n_checkins_total = 0 then
    preconditions := preconditions || 'public.checkins is empty, so every assertion about who can read a check-in is true for the wrong reason (0 = 0) and the checkins policies went UNEXERCISED -- save one check-in from the app, or seed one, and re-run (README: "Rebuilding this project from scratch")'::text;
  end if;

  -- 10b. The positive case: an active account sees the data.
  --
  --      Asserted as "sees ALL of them" rather than "sees at least one", so it
  --      stays meaningful as the table grows, and so a policy narrowed to
  --      `using (false)` -- the outage direction -- fails here rather than
  --      looking like an empty month.
  --
  --      A missing subject is reported (as a PRECONDITION, see the `preconditions`
  --      declaration) rather than skipped. A run that verified nothing must not
  --      look like a run that verified everything; that is the same rule the
  --      unconditional credentials test in src/lib/rls.test.ts exists to enforce.
  --      It is a precondition and not a violation because on a freshly rebuilt
  --      project it is the expected state, and telling the operator their new
  --      empty database has a privilege violation is how a real finding gets
  --      ignored later.
  select id into active_uid
  from public.profiles
  where is_active
  order by created_at
  limit 1;

  if active_uid is null then
    preconditions := preconditions || 'public.profiles contains no active row, so nothing could be checked from a signed-in point of view and the read path is UNVERIFIED -- activate an account (README: "Activating the first admin") and re-run'::text;
  else
    begin
      perform set_config(
        'request.jwt.claims',
        json_build_object('sub', active_uid, 'role', 'authenticated', 'aud', 'authenticated')::text,
        true);
      set local role authenticated;

      select count(*) into n_seen from public.clients;
      if n_seen <> n_clients_total then
        problems := problems || format(
          'an ACTIVE user sees %s of %s rows in public.clients -- clients_select_view_scores is denying rows it should return, which is an outage for every signed-in user',
          n_seen, n_clients_total)::text;
      end if;

      -- Was `<> 1` until 20260824180533_widen_profiles_select.sql. That was the
      -- old guarantee, and leaving it would have reported a VIOLATION for a
      -- widening working exactly as designed on any project with two accounts.
      -- Asserted as "all of them" for the same reason as the clients comparison
      -- above: it stays meaningful as the staff list grows, and the outage
      -- direction -- a policy narrowed to `using (false)` -- fails here rather
      -- than looking like a small team. The precondition in 10a2 is what stops
      -- this reading as evidence on a one-profile database.
      select count(*) into n_seen from public.profiles;
      if n_seen <> n_profiles_total then
        problems := problems || format(
          'an active user sees %s of %s rows in public.profiles -- profiles_select_active_users is denying rows the Slice 2 step 3 widening is meant to expose, so step 4 owner picker will be empty or short',
          n_seen, n_profiles_total)::text;
      end if;

      select count(*) into n_seen from public.checkins;
      if n_seen <> n_checkins_total then
        problems := problems || format(
          'an ACTIVE user sees %s of %s rows in public.checkins -- checkins_select_view_scores is denying rows it should return',
          n_seen, n_checkins_total)::text;
      end if;

      reset role;
    exception when others then
      -- A raised error here is itself the finding: the most likely cause is a
      -- missing EXECUTE grant on a policy-referenced helper (42501), which is
      -- the total-outage case section 9c pins from the grant side.
      problems := problems || format(
        'the active-user policy check could not run: %s %s -- the read path is UNVERIFIED',
        sqlstate, sqlerrm)::text;
    end;
  end if;

  -- 10c. The negative case the spec calls the practical test of the whole
  --      design: a subject with no profile row -- so has_capability() is false
  --      for every capability -- sees zero rows on both tables and cannot write.
  begin
    perform set_config(
      'request.jwt.claims',
      json_build_object('sub', absent_uid, 'role', 'authenticated', 'aud', 'authenticated')::text,
      true);
    set local role authenticated;

    select count(*) into n_seen from public.clients;
    if n_seen <> 0 then
      problems := problems || format(
        'a user with NO profile row sees %s row(s) in public.clients -- clients_select_view_scores is not gating on private.has_capability() and any signed-in account reads client data',
        n_seen)::text;
    end if;

    select count(*) into n_seen from public.checkins;
    if n_seen <> 0 then
      problems := problems || format(
        'a user with NO profile row sees %s row(s) in public.checkins -- checkins_select_view_scores is not gating on private.has_capability() and any signed-in account reads check-in scores',
        n_seen)::text;
    end if;

    select count(*) into n_seen from public.profiles;
    if n_seen <> 0 then
      problems := problems || format(
        'a user with NO profile row sees %s row(s) in public.profiles -- neither profiles_select_own nor profiles_select_active_users is gating correctly, and any signed-in account reads the staff list',
        n_seen)::text;
    end if;

    -- The write half. `with check` is a separate predicate from `using` and can
    -- be widened on its own, so a read-only assertion would miss it entirely.
    begin
      insert into public.clients (name)
      values ('verify-privileges probe -- must never persist');
      -- Reached only if the policy ALLOWED the insert. Raising rolls this inner
      -- subtransaction back, so the row cannot survive even in that case, and
      -- the handler below turns it into a reported violation.
      raise exception 'probe insert was allowed';
    exception
      when insufficient_privilege then
        -- Expected: 42501, 'new row violates row-level security policy for
        -- table "clients"'. Nothing was written.
        null;
      when others then
        if sqlerrm = 'probe insert was allowed' then
          problems := problems || 'a user with NO profile row was ALLOWED to insert into public.clients -- clients_insert_manage_clients is not gating on private.has_capability() (the row was rolled back by this check, not by the policy)'::text;
        else
          problems := problems || format(
            'the no-profile insert probe failed for an unexpected reason: %s %s',
            sqlstate, sqlerrm)::text;
        end if;
    end;

    reset role;
  exception when others then
    problems := problems || format(
      'the no-profile policy check could not run: %s %s -- the negative case is UNVERIFIED',
      sqlstate, sqlerrm)::text;
  end;

  -- 10d. `authenticated` with NO jwt claims at all. This is not the same subject
  --      as 10c: auth.uid() returns NULL rather than a uuid, so the comparison
  --      inside has_capability() is `p.id = null` and the whole predicate hinges
  --      on null handling rather than on a lookup miss. It is also the shape of a
  --      real request that reaches PostgREST with the authenticated role but a
  --      claim-less or malformed token.
  begin
    perform set_config('request.jwt.claims', '', true);
    perform set_config('request.jwt.claim.sub', '', true);
    set local role authenticated;

    if (select auth.uid()) is not null then
      problems := problems || 'auth.uid() is not null with empty jwt claims -- the claim-less subject test below is not testing what it claims to'::text;
    end if;

    select count(*) into n_seen from public.clients;
    if n_seen <> 0 then
      problems := problems || format(
        'authenticated with NO jwt claims sees %s row(s) in public.clients -- a claim-less request reads client data',
        n_seen)::text;
    end if;

    select count(*) into n_seen from public.checkins;
    if n_seen <> 0 then
      problems := problems || format(
        'authenticated with NO jwt claims sees %s row(s) in public.checkins -- a claim-less request reads check-in scores',
        n_seen)::text;
    end if;

    select count(*) into n_seen from public.profiles;
    if n_seen <> 0 then
      problems := problems || format(
        'authenticated with NO jwt claims sees %s row(s) in public.profiles',
        n_seen)::text;
    end if;

    reset role;
  exception when others then
    problems := problems || format(
      'the claim-less policy check could not run: %s %s -- the negative case is UNVERIFIED',
      sqlstate, sqlerrm)::text;
  end;

  -- 10e. Every policy that section 10 relies on must exist and be scoped to
  --      `authenticated`. Without this, DROPPING a policy would make the
  --      negative assertions above pass for the wrong reason -- no policy means
  --      no rows, which looks identical to a correct denial. This is the one
  --      place in the file that reads pg_policies.
  for r in
    with expected (tbl, policy) as (
      values
        ('profiles', 'profiles_select_own'),
        ('profiles', 'profiles_select_active_users'),
        ('profiles', 'profiles_update_own'),
        -- The admin write path, 20260825202320. Dropping it takes the users
        -- admin screen away entirely, since an admin then reaches no profile row
        -- but their own, and NOTHING ELSE HERE WOULD NOTICE: every 10h probe
        -- below edits its own subject, which profiles_update_own reaches anyway.
        ('profiles', 'profiles_update_manage_users'),
        -- The invitation list, 20260825201024. Listed for exactly the reason
        -- 10e exists:
        -- 10h asserts that a viewer sees zero invitations and cannot insert one,
        -- and dropping these policies would make both pass for the wrong reason.
        ('allowed_emails', 'allowed_emails_select_manage_users'),
        ('allowed_emails', 'allowed_emails_insert_manage_users'),
        ('allowed_emails', 'allowed_emails_update_manage_users'),
        ('allowed_emails', 'allowed_emails_delete_manage_users'),
        ('clients',  'clients_select_view_scores'),
        ('clients',  'clients_insert_manage_clients'),
        ('clients',  'clients_update_manage_clients'),
        ('checkins', 'checkins_select_view_scores'),
        ('checkins', 'checkins_insert_edit_scores'),
        ('checkins', 'checkins_update_edit_scores')
    )
    select e.tbl, e.policy
    from expected e
    where not exists (
      select 1 from pg_policies p
      where p.schemaname = 'public'
        and p.tablename = e.tbl
        and p.policyname = e.policy
        and p.roles = '{authenticated}'
    )
    order by 1, 2
  loop
    problems := problems || format(
      'policy %s on public.%s is missing or is not scoped `to authenticated` -- with it gone the negative checks in section 10 pass for the wrong reason (no policy also means no rows)',
      r.policy, r.tbl)::text;
  end loop;

  -- 10f. THE CAPABILITY CHECKS -- the ones that would have FAILED on every
  --      schema this project has ever had before
  --      20260824160306_has_capability.sql, and the reason that migration
  --      exists.
  --
  --      Until then all six policies gated on private.is_active_user(), which
  --      answers only "does this account exist and is it switched on". So an
  --      active `viewer` -- whose only preset capability is view_scores -- could
  --      insert and update check-ins, and could create and rename clients.
  --      Sections 10b through 10d could not see that: every one of their
  --      subjects is either fully entitled or has no profile row at all, and
  --      both of those answered the same before and after the migration. The
  --      gap was invisible to this file by construction.
  --
  --      BOTH DIRECTIONS, for the reason section 9c exists. A policy that
  --      denies everything passes every negative assertion in this file while
  --      making the app unusable, so a viewer being refused is only half the
  --      evidence -- the other half is an account manager being allowed. The
  --      failure that locks everyone out is the one nobody writes a test for.
  --
  --      PRECONDITIONS, NOT FINDINGS. These checks need an active profile row
  --      with each role. Production has one user and he is an admin, so the
  --      expected result there is two preconditions and nothing checked. That
  --      must not read as a pass: it is reported under the COULD NOT VERIFY
  --      heading, which still exits non-zero.
  --
  --      ZERO WRITES SURVIVE. Two of the four probes below are meant to
  --      SUCCEED, which is new -- 10c only ever probed a refusal. A successful
  --      insert is rolled back by raising inside its own subtransaction, so the
  --      sentinel `probe rollback` means "the policy allowed it" and is read as
  --      a violation in the viewer block and as the expected result in the
  --      account-manager block. What does NOT roll back is clients_id_seq: an
  --      identity sequence advances outside the transaction, so the account
  --      manager probe leaves a gap in the client ids. That is a cosmetic cost
  --      of exercising the real write path and is accepted deliberately.
  select id into probe_client_id from public.clients order by id limit 1;

  select id into viewer_uid
  from public.profiles
  where is_active and role = 'viewer'
  order by created_at
  limit 1;

  select id into am_uid
  from public.profiles
  where is_active and role = 'account_manager'
  order by created_at
  limit 1;

  if probe_client_id is null then
    preconditions := preconditions || 'public.clients is empty, so section 10f could not attempt a check-in insert and NO capability check ran -- seed one client and re-run (README: "Seeding the first client")'::text;
  else
    -- The viewer: reads everything, writes nothing.
    if viewer_uid is null then
      preconditions := preconditions || 'public.profiles contains no ACTIVE row with role = viewer, so the check that a viewer cannot write went UNEXERCISED -- this is the expected state on a project with one admin, and it is the check the has_capability migration was written for'::text;
    else
      begin
        perform set_config(
          'request.jwt.claims',
          json_build_object('sub', viewer_uid, 'role', 'authenticated', 'aud', 'authenticated')::text,
          true);
        set local role authenticated;

        -- view_scores IS in the viewer preset, so the reads must still work.
        -- Asserted as "all of them" for the same reason as 10b.
        select count(*) into n_seen from public.clients;
        if n_seen <> n_clients_total then
          problems := problems || format(
            'an active VIEWER sees %s of %s rows in public.clients -- clients_select_view_scores is denying rows a viewer preset includes (view_scores), so the board is empty for every viewer',
            n_seen, n_clients_total)::text;
        end if;

        select count(*) into n_seen from public.checkins;
        if n_seen <> n_checkins_total then
          problems := problems || format(
            'an active VIEWER sees %s of %s rows in public.checkins -- checkins_select_view_scores is denying rows a viewer preset includes (view_scores)',
            n_seen, n_checkins_total)::text;
        end if;

        -- edit_scores is NOT in the viewer preset.
        begin
          insert into public.checkins (client_id, period)
          values (probe_client_id, probe_period);
          raise exception 'probe rollback';
        exception
          when insufficient_privilege then
            null;
          when others then
            if sqlerrm = 'probe rollback' then
              problems := problems || 'an active VIEWER was ALLOWED to insert into public.checkins -- checkins_insert_edit_scores is not gating on edit_scores, so anybody who can sign in can write scores (the row was rolled back by this check, not by the policy)'::text;
            else
              problems := problems || format(
                'the viewer check-in insert probe failed for an unexpected reason: %s %s',
                sqlstate, sqlerrm)::text;
            end if;
        end;

        -- manage_clients is NOT in the viewer preset.
        begin
          insert into public.clients (name)
          values ('verify-privileges viewer probe -- must never persist');
          raise exception 'probe rollback';
        exception
          when insufficient_privilege then
            null;
          when others then
            if sqlerrm = 'probe rollback' then
              problems := problems || 'an active VIEWER was ALLOWED to insert into public.clients -- clients_insert_manage_clients is not gating on manage_clients, so anybody who can sign in can create clients (the row was rolled back by this check, not by the policy)'::text;
            else
              problems := problems || format(
                'the viewer client insert probe failed for an unexpected reason: %s %s',
                sqlstate, sqlerrm)::text;
            end if;
        end;

        reset role;
      exception when others then
        problems := problems || format(
          'the viewer capability check could not run: %s %s -- whether a viewer can write is UNVERIFIED',
          sqlstate, sqlerrm)::text;
      end;
    end if;

    -- The account manager: the direction that locks everyone out if it is wrong.
    if am_uid is null then
      preconditions := preconditions || 'public.profiles contains no ACTIVE row with role = account_manager, so the check that an account manager CAN still write went UNEXERCISED -- and that is the direction in which a mistake here takes the app away from everybody'::text;
    else
      begin
        perform set_config(
          'request.jwt.claims',
          json_build_object('sub', am_uid, 'role', 'authenticated', 'aud', 'authenticated')::text,
          true);
        set local role authenticated;

        -- edit_scores IS in the account_manager preset. Saving a check-in is the
        -- one write this whole application exists to perform.
        begin
          insert into public.checkins (client_id, period)
          values (probe_client_id, probe_period);
          -- Allowed, which is the expected outcome. Raising rolls the insert
          -- back so a passing check leaves nothing behind.
          raise exception 'probe rollback';
        exception
          when insufficient_privilege then
            problems := problems || 'an active ACCOUNT MANAGER was REFUSED an insert into public.checkins -- checkins_insert_edit_scores is denying edit_scores, which is in the account_manager preset, so nobody but an admin can save a check-in'::text;
          when others then
            if sqlerrm = 'probe rollback' then
              null;
            else
              problems := problems || format(
                'the account-manager check-in insert probe failed for an unexpected reason: %s %s',
                sqlstate, sqlerrm)::text;
            end if;
        end;

        -- manage_clients IS in the account_manager preset.
        begin
          insert into public.clients (name)
          values ('verify-privileges account-manager probe -- must never persist');
          raise exception 'probe rollback';
        exception
          when insufficient_privilege then
            problems := problems || 'an active ACCOUNT MANAGER was REFUSED an insert into public.clients -- clients_insert_manage_clients is denying manage_clients, which is in the account_manager preset, so the clients admin screen is unusable for them'::text;
          when others then
            if sqlerrm = 'probe rollback' then
              null;
            else
              problems := problems || format(
                'the account-manager client insert probe failed for an unexpected reason: %s %s',
                sqlstate, sqlerrm)::text;
            end if;
        end;

        reset role;
      exception when others then
        problems := problems || format(
          'the account-manager capability check could not run: %s %s -- whether an account manager can still write is UNVERIFIED',
          sqlstate, sqlerrm)::text;
      end;
    end if;
  end if;

  -- 10g. An INACTIVE account. This is the subject the profiles widening is
  --      scoped against, and no other check in this file can see it:
  --      has_capability returns false for an inactive account, so
  --      profiles_select_active_users admits nothing, while profiles_select_own
  --      still admits its own row. The answer is therefore exactly ONE, not
  --      zero.
  --
  --      SLICE 2 DESIGN §9 SAYS "an inactive one reads zero", AND THAT IS WRONG
  --      while profiles_select_own exists. Zero would only hold if
  --      20260824180533_widen_profiles_select.sql had REPLACED the own-row
  --      policy, and §8 says "a second policy". Asserting the spec's number here
  --      would have failed a correct schema, so the divergence is recorded
  --      rather than taken on trust -- in this comment, in the migration, and in
  --      the step 3 plan.
  --
  --      What it actually catches: an inactive account reading the STAFF LIST.
  --      New accounts are created inactive by design (profiles.is_active
  --      defaults to false, so signing up must not grant access), which means an
  --      unapproved signup is a reachable state on a project with public
  --      sign-up. If the widening admitted them, they would read every
  --      colleague's email, name and role. Nothing else here would notice: 10b
  --      uses an ACTIVE subject and 10c uses one with no profile row at all.
  --
  --      Reported as a precondition when nobody is inactive, for the same reason
  --      as 10f: a check that could not run must not read as one that passed.
  select id into inactive_uid
  from public.profiles
  where not is_active
  order by created_at
  limit 1;

  if inactive_uid is null then
    preconditions := preconditions || 'public.profiles contains no INACTIVE row, so the check that an inactive account cannot read the staff list went UNEXERCISED -- new accounts are created inactive, so this becomes checkable the first time somebody signs up and is not activated'::text;
  else
    begin
      perform set_config(
        'request.jwt.claims',
        json_build_object('sub', inactive_uid, 'role', 'authenticated', 'aud', 'authenticated')::text,
        true);
      set local role authenticated;

      -- Exactly one, and both directions of that number are findings. More than
      -- one means the widening admits inactive accounts. Zero means
      -- profiles_select_own has stopped working, and profiles_update_own can no
      -- longer see the row it updates -- so an inactive user renaming themselves
      -- would silently affect nothing, which is the failure that migration's
      -- comment exists to prevent.
      select count(*) into n_seen from public.profiles;
      if n_seen <> 1 then
        problems := problems || format(
          'an INACTIVE account sees %s row(s) in public.profiles, expected exactly 1 (its own, via profiles_select_own) -- more than 1 means profiles_select_active_users is admitting inactive accounts and an unapproved signup reads the staff list; 0 means profiles_update_own can no longer see the row it updates',
          n_seen)::text;
      end if;

      -- And nothing else. An inactive account holds no capability at all, so
      -- this is the same guarantee 10c asserts for a subject with no profile
      -- row -- reached by a different route, through a row that DOES exist.
      select count(*) into n_seen from public.clients;
      if n_seen <> 0 then
        problems := problems || format(
          'an INACTIVE account sees %s row(s) in public.clients -- has_capability is admitting an account whose is_active is false, so deactivating somebody does not remove their access',
          n_seen)::text;
      end if;

      select count(*) into n_seen from public.checkins;
      if n_seen <> 0 then
        problems := problems || format(
          'an INACTIVE account sees %s row(s) in public.checkins -- has_capability is admitting an account whose is_active is false',
          n_seen)::text;
      end if;

      reset role;
    exception when others then
      problems := problems || format(
        'the inactive-account check could not run: %s %s -- whether an inactive account reads the staff list is UNVERIFIED',
        sqlstate, sqlerrm)::text;
    end;
  end if;

  -- 10h. THE USERS ADMIN WRITE PATH -- the checks that would have failed on
  --      every schema this project has had before
  --      20260825202320_profiles_admin_write_path.sql, and the only automated
  --      evidence that widening the column grant on public.profiles did not
  --      hand every signed-in user the promotion the 20260820225903 repair took
  --      away.
  --
  --      Section 2 asserts that the GRANT exists and that the TRIGGER exists.
  --      Neither says the trigger DOES anything -- a guard whose body returned
  --      `new` unconditionally satisfies both. This is where it is made to fire.
  --
  --      THE MESSAGE TEXT IS ASSERTED, not merely the SQLSTATE, and that is
  --      deliberate in two directions. The users admin screen matches on these
  --      strings as substrings to tell the two refusals apart, so they are an
  --      INTERFACE and a silent rewording would break a screen with nothing
  --      failing. And 42501 on its own would ALSO be raised if the column grant
  --      had simply been lost -- "permission denied for table profiles" -- so a
  --      probe that accepted any 42501 would report a pass on a schema where the
  --      admin screen is dead and the guard never ran once.
  --
  --      WHICH REFUSAL EACH SUBJECT GETS follows from the order of the two
  --      raises in the guard. The capability check comes first, so a viewer is
  --      told 'insufficient privilege to change role or is_active' and never
  --      reaches the self-edit clause; an admin holds manage_users, passes it,
  --      and is told 'cannot change your own role or active status'. One subject
  --      per branch, and both branches are exercised.
  --
  --      EVERY PRIVILEGED UPDATE BELOW CHANGES THE VALUE, never re-writes it.
  --      `new.role is not distinct from old.role` makes the guard return early
  --      by design, so `set role = <the role it already has>` would succeed
  --      while changing nothing -- and the probe would report the guard as
  --      ALLOWING self-promotion. is_active is flipped with `not is_active` for
  --      the same reason, whichever way it currently sits.
  --
  --      THE FULL_NAME PROBE IS THE REGRESSION GUARD, and is why this subsection
  --      is not only negative assertions. A guard that raised on EVERY update --
  --      the obvious way to write it wrong -- passes every other check here
  --      while making the profile screen read-only for everybody. It runs for
  --      both subjects rather than only the viewer, because the viewer half goes
  --      unexercised on a project with no viewer yet, and on this one that is
  --      the expected state.
  --
  --      ZERO WRITES SURVIVE, by 10f's rule: anything the schema ALLOWS is
  --      rolled back by raising inside its own subtransaction. Nothing here
  --      touches an identity sequence, so unlike 10f it leaves no trace at all.
  --      Where a probe has to check FOUND as well as catch a refusal, it raises
  --      a SECOND, distinct sentinel rather than appending to `problems` before
  --      the rollback -- so no assertion here rests on how a plpgsql variable
  --      survives a caught exception.
  select count(*) into n_allowed_total from public.allowed_emails;

  select id into admin_uid
  from public.profiles
  where is_active and role = 'admin'
  order by created_at
  limit 1;

  -- The viewer: reads no invitations, writes none, cannot touch either
  -- privileged column on their own row -- and can still rename themselves.
  if viewer_uid is null then
    preconditions := preconditions || 'public.profiles contains no ACTIVE row with role = viewer, so the checks that a viewer cannot read the invitation list and cannot promote themselves went UNEXERCISED -- this is the expected state on a project with one admin, and it is the direction in which a mistake reopens the 20260820225903 vulnerability'::text;
  else
    begin
      perform set_config(
        'request.jwt.claims',
        json_build_object('sub', viewer_uid, 'role', 'authenticated', 'aud', 'authenticated')::text,
        true);
      set local role authenticated;

      select count(*) into n_seen from public.allowed_emails;
      if n_seen <> 0 then
        problems := problems || format(
          'an active VIEWER sees %s row(s) in public.allowed_emails -- allowed_emails_select_manage_users is not gating on manage_users, so anybody who can sign in reads the invitation list',
          n_seen)::text;
      elsif n_allowed_total = 0 then
        preconditions := preconditions || 'public.allowed_emails is empty, so "a viewer sees zero invitations" is true for the wrong reason (0 = 0) and the invitation READ gate went UNEXERCISED -- invite somebody from the users admin screen and re-run; the insert gate below is checked either way'::text;
      end if;

      -- The write half. `with check` is a separate predicate from `using`, and
      -- an invitation carries a ROLE, so this is not a lesser write than
      -- self-promotion: it is self-promotion with one extra sign-in in the way.
      begin
        insert into public.allowed_emails (email, role)
        values ('verify-privileges-viewer-probe@example.invalid', 'admin');
        raise exception 'probe rollback';
      exception
        when insufficient_privilege then
          null;
        when others then
          if sqlerrm = 'probe rollback' then
            problems := problems || 'an active VIEWER was ALLOWED to insert into public.allowed_emails -- allowed_emails_insert_manage_users is not gating on manage_users, so anybody who can sign in can invite an address at role admin and then sign in as one (the row was rolled back by this check, not by the policy)'::text;
          else
            problems := problems || format(
              'the viewer invitation insert probe failed for an unexpected reason: %s %s',
              sqlstate, sqlerrm)::text;
          end if;
      end;

      -- SELF-PROMOTION. The vulnerability itself, attempted.
      begin
        update public.profiles set role = 'admin' where id = viewer_uid;
        raise exception 'probe rollback';
      exception
        when insufficient_privilege then
          if sqlerrm <> 'insufficient privilege to change role or is_active' then
            problems := problems || format(
              'an active VIEWER was refused their own role change by %L rather than by private.guard_profile_privileges -- the likeliest cause is the column-level UPDATE grant on public.profiles.role having been lost, which section 2 reports separately; either way the guard went UNEXERCISED and the message the users admin screen matches on has changed',
              sqlerrm)::text;
          end if;
        when others then
          if sqlerrm = 'probe rollback' then
            problems := problems || 'an active VIEWER was ALLOWED to set their own role to admin -- private.guard_profile_privileges is not firing, and the 20260820225903 vulnerability is open again (the change was rolled back by this check, not by the guard)'::text;
          else
            problems := problems || format(
              'the viewer self-promotion probe failed for an unexpected reason: %s %s',
              sqlstate, sqlerrm)::text;
          end if;
      end;

      -- SELF-ACTIVATION. The other half of the same vulnerability: a deliberately
      -- inactive account switching itself on.
      begin
        update public.profiles set is_active = not is_active where id = viewer_uid;
        raise exception 'probe rollback';
      exception
        when insufficient_privilege then
          if sqlerrm <> 'insufficient privilege to change role or is_active' then
            problems := problems || format(
              'an active VIEWER was refused their own is_active change by %L rather than by private.guard_profile_privileges -- the guard went UNEXERCISED for is_active, and the message the users admin screen matches on has changed',
              sqlerrm)::text;
          end if;
        when others then
          if sqlerrm = 'probe rollback' then
            problems := problems || 'an active VIEWER was ALLOWED to change their own is_active -- private.guard_profile_privileges is not firing on is_active, so an unapproved signup can activate itself (the change was rolled back by this check, not by the guard)'::text;
          else
            problems := problems || format(
              'the viewer self-activation probe failed for an unexpected reason: %s %s',
              sqlstate, sqlerrm)::text;
          end if;
      end;

      -- THE REGRESSION GUARD. This update changes neither privileged column, so
      -- the guard must return early and profiles_update_own must work exactly as
      -- it did before the trigger existed. Both failure directions are findings:
      -- a refusal means the guard raises on everything, and zero rows updated
      -- means the row is no longer visible to the statement that writes it,
      -- which is the silent-no-op failure 20260824180533 was careful about.
      begin
        update public.profiles
           set full_name = 'verify-privileges probe -- must never persist'
         where id = viewer_uid;
        if found then
          raise exception 'probe rollback';
        else
          raise exception 'probe rollback -- no rows';
        end if;
      exception
        when insufficient_privilege then
          problems := problems || format(
            'an active VIEWER was REFUSED an update to their own full_name (%L) -- this update changes neither role nor is_active, so private.guard_profile_privileges must let it straight through; as it stands the profile screen is read-only for everybody',
            sqlerrm)::text;
        when others then
          if sqlerrm = 'probe rollback' then
            null;
          elsif sqlerrm = 'probe rollback -- no rows' then
            problems := problems || 'an active VIEWER renaming themselves updated ZERO rows -- profiles_update_own can no longer see the row it updates, so a profile edit silently affects nothing and reports success'::text;
          else
            problems := problems || format(
              'the viewer full_name probe failed for an unexpected reason: %s %s',
              sqlstate, sqlerrm)::text;
          end if;
      end;

      reset role;
    exception when others then
      problems := problems || format(
        'the viewer users-admin check could not run: %s %s -- whether a viewer can promote themselves is UNVERIFIED',
        sqlstate, sqlerrm)::text;
    end;
  end if;

  -- The admin: the direction in which a mistake takes the users admin screen
  -- away from the only person who could put it back.
  if admin_uid is null then
    preconditions := preconditions || 'public.profiles contains no ACTIVE row with role = admin, so the checks that an admin CAN manage invitations and CANNOT edit their own role went UNEXERCISED -- and one of those is the direction that takes the users admin screen away from everybody'::text;
  else
    begin
      perform set_config(
        'request.jwt.claims',
        json_build_object('sub', admin_uid, 'role', 'authenticated', 'aud', 'authenticated')::text,
        true);
      set local role authenticated;

      -- manage_users IS in the admin preset, and it is the only preset that has
      -- it. Insert and delete in one block, because withdrawing an invitation
      -- matters as much as issuing one: the table means exactly one thing --
      -- invited, not yet arrived -- and a delete that finds nothing leaves an
      -- invitation the screen has already reported as withdrawn.
      begin
        insert into public.allowed_emails (email, role)
        values ('verify-privileges-admin-probe@example.invalid', 'viewer');

        delete from public.allowed_emails
         where email = 'verify-privileges-admin-probe@example.invalid';

        if found then
          raise exception 'probe rollback';
        else
          raise exception 'probe rollback -- delete found nothing';
        end if;
      exception
        when insufficient_privilege then
          problems := problems || 'an active ADMIN was REFUSED a write to public.allowed_emails -- the allowed_emails policies are denying manage_users, which only admin holds, so nobody can invite anybody and the users admin screen is unusable for the one role it exists for'::text;
        when others then
          if sqlerrm = 'probe rollback' then
            null;
          elsif sqlerrm = 'probe rollback -- delete found nothing' then
            problems := problems || 'an active ADMIN inserted an invitation and then DELETED ZERO ROWS -- allowed_emails_delete_manage_users is missing or its using clause is wrong, so withdrawing an invitation silently does nothing and the invited address can still sign in and be activated'::text;
          else
            problems := problems || format(
              'the admin invitation probe failed for an unexpected reason: %s %s',
              sqlstate, sqlerrm)::text;
          end if;
      end;

      -- The self-edit clause, reached only by a caller who holds manage_users.
      -- This is the clause that makes lockout impossible: nobody demotes or
      -- deactivates themselves, and only an admin can demote an admin, so at
      -- least one active admin always survives with no counting logic anywhere.
      begin
        update public.profiles set role = 'viewer' where id = admin_uid;
        raise exception 'probe rollback';
      exception
        when insufficient_privilege then
          if sqlerrm <> 'cannot change your own role or active status' then
            problems := problems || format(
              'an active ADMIN was refused their own role change by %L rather than by the self-edit clause of private.guard_profile_privileges -- the refusal came from somewhere else, so the clause that guarantees at least one active admin survives went UNEXERCISED, and the message the users admin screen matches on has changed',
              sqlerrm)::text;
          end if;
        when others then
          if sqlerrm = 'probe rollback' then
            problems := problems || 'an active ADMIN was ALLOWED to demote themselves -- the self-edit clause of private.guard_profile_privileges is not firing, so the last admin can remove the last admin and there is no way back into the users admin screen (the change was rolled back by this check, not by the guard)'::text;
          else
            problems := problems || format(
              'the admin self-demotion probe failed for an unexpected reason: %s %s',
              sqlstate, sqlerrm)::text;
          end if;
      end;

      begin
        update public.profiles set is_active = not is_active where id = admin_uid;
        raise exception 'probe rollback';
      exception
        when insufficient_privilege then
          if sqlerrm <> 'cannot change your own role or active status' then
            problems := problems || format(
              'an active ADMIN was refused their own is_active change by %L rather than by the self-edit clause of private.guard_profile_privileges -- the clause went UNEXERCISED for is_active, and the message the users admin screen matches on has changed',
              sqlerrm)::text;
          end if;
        when others then
          if sqlerrm = 'probe rollback' then
            problems := problems || 'an active ADMIN was ALLOWED to deactivate themselves -- the self-edit clause of private.guard_profile_privileges is not firing on is_active, so the last admin can switch off the last admin account (the change was rolled back by this check, not by the guard)'::text;
          else
            problems := problems || format(
              'the admin self-deactivation probe failed for an unexpected reason: %s %s',
              sqlstate, sqlerrm)::text;
          end if;
      end;

      -- The regression guard again, for the subject that exists on every
      -- project. See the viewer copy above for why both directions are findings.
      begin
        update public.profiles
           set full_name = 'verify-privileges probe -- must never persist'
         where id = admin_uid;
        if found then
          raise exception 'probe rollback';
        else
          raise exception 'probe rollback -- no rows';
        end if;
      exception
        when insufficient_privilege then
          problems := problems || format(
            'an active ADMIN was REFUSED an update to their own full_name (%L) -- this update changes neither role nor is_active, so private.guard_profile_privileges must let it straight through; as it stands the profile screen is read-only for everybody',
            sqlerrm)::text;
        when others then
          if sqlerrm = 'probe rollback' then
            null;
          elsif sqlerrm = 'probe rollback -- no rows' then
            problems := problems || 'an active ADMIN renaming themselves updated ZERO rows -- profiles_update_own can no longer see the row it updates, so a profile edit silently affects nothing and reports success'::text;
          else
            problems := problems || format(
              'the admin full_name probe failed for an unexpected reason: %s %s',
              sqlstate, sqlerrm)::text;
          end if;
      end;

      reset role;
    exception when others then
      problems := problems || format(
        'the admin users-admin check could not run: %s %s -- whether an admin can manage invitations, and whether the self-edit clause fires, are both UNVERIFIED',
        sqlstate, sqlerrm)::text;
    end;
  end if;

  ----------------------------------------------------------------------------
  -- 11. service_role must keep reaching every table in `public`.
  --
  --     The only assertion in this file that checks for TOO LITTLE privilege
  --     rather than too much, and it is here for the same reason as 9c: this is
  --     the direction that locks the owner out. `is_active` defaults to false,
  --     no UI can change it, and the documented way to activate the first admin
  --     is a statement run as service_role (README: "Activating the first
  --     admin"). If service_role loses access there is no way back in at all.
  --
  --     Sections 4 and 8 sweep only anon, authenticated and PUBLIC, so nothing
  --     watched this until 20260821040500_declare_service_role_grants.sql wrote
  --     the grant down. Before that migration the grant existed only because a
  --     pg_default_acl row inherited from this project's vintage happened to
  --     supply it. This assertion is what stops that migration being deleted as
  --     redundant without the loss being noticed.
  ----------------------------------------------------------------------------
  for r in
    select c.relname::text as table_name, priv
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    cross join unnest(array['SELECT','INSERT','UPDATE','DELETE']) priv
    where n.nspname = 'public'
      and c.relkind in ('r', 'p')
      and not has_table_privilege('service_role', c.oid, priv)
    order by 1, 2
  loop
    problems := problems || format(
      'service_role CANNOT %s public.%s -- the admin activation path is broken and there is no other way to activate an account (see 20260821040500_declare_service_role_grants.sql)',
      r.priv, r.table_name);
  end loop;

  ----------------------------------------------------------------------------
  -- Report.
  ----------------------------------------------------------------------------
  select count(*) into n_tables
  from pg_class c join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public' and c.relkind in ('r','p');

  -- Two outcomes, two headings, and the difference matters more than it looks.
  --
  -- A VIOLATION is a security finding. A PRECONDITION is "there is not enough
  -- data in this database to run that check yet". Both exit non-zero -- a check
  -- that could not run must never read as a check that passed -- but conflating
  -- them is actively harmful in both directions: an operator on a fresh project
  -- is told their empty database has a privilege violation, learns that this
  -- script cries wolf, and is then in the habit of ignoring it on the day it is
  -- right.
  --
  -- Violations are reported first and on their own, so a real finding is never
  -- buried under bookkeeping. If any exist, the unmet preconditions are appended
  -- as a footnote so the operator still knows part of the run was unverified.
  if array_length(problems, 1) > 0 then
    raise exception E'verify:privileges FAILED with % violation(s):\n  - %\n%',
      array_length(problems, 1),
      array_to_string(problems, E'\n  - '),
      case
        when array_length(preconditions, 1) > 0 then
          -- %s, not %. This is format(), not RAISE, and the two disagree:
          -- RAISE takes a bare `%` while format() requires `%s` and rejects a
          -- bare one outright with `22023 unrecognized format() type specifier`.
          -- Written with RAISE's syntax at first, which meant the ONE branch
          -- that reports "violations AND unverified checks together" -- a
          -- partly-seeded project that also has a real privilege problem --
          -- replaced the security report with an opaque Postgres error. It still
          -- exited non-zero, so nothing passed silently, but the operator lost
          -- exactly the distinction this section exists to draw.
          --
          -- It survived four proof runs because every one of them had only one
          -- of the two arrays populated, so this branch never executed.
          -- Exercising an assertion is not the same as exercising its reporting
          -- path, and the reporting path is the part a human reads.
          format(E'\nAND %s check(s) could not be run at all:\n  - %s',
            array_length(preconditions, 1),
            array_to_string(preconditions, E'\n  - '))
        else ''
      end;
  end if;

  if array_length(preconditions, 1) > 0 then
    raise exception E'verify:privileges COULD NOT VERIFY the read path -- % precondition(s) unmet.\n\nNO SECURITY VIOLATION WAS FOUND. Every grant check and every policy check that could be run PASSED. This is a "not enough data in the database to check that yet" result, not a "something is wrong" result, and it is the expected outcome on a freshly created or freshly rebuilt project. Work through the list, then re-run -- README: "Rebuilding this project from scratch".\n\n  - %',
      array_length(preconditions, 1), array_to_string(preconditions, E'\n  - ');
  end if;

  raise notice 'verify:privileges OK -- % table(s) in public, boundary intact', n_tables;
end $$;

-- Echoed so a passing run shows the matrix it just asserted, not merely "ok".
--
-- auth_update_role and auth_update_is_active read TRUE since
-- 20260825202320_profiles_admin_write_path.sql, which is alarming at a glance
-- and is exactly why guard_trigger is echoed beside them: those two columns are
-- writable by `authenticated` only while private.guard_profile_privileges is
-- there to condition them. Read the three together or none of them.
select
  has_column_privilege('authenticated','public.profiles','full_name','UPDATE') as auth_update_full_name,
  has_column_privilege('authenticated','public.profiles','role','UPDATE')      as auth_update_role,
  has_column_privilege('authenticated','public.profiles','is_active','UPDATE') as auth_update_is_active,
  exists (
    select 1 from pg_trigger
     where tgrelid = 'public.profiles'::regclass
       and tgname  = 'profiles_guard_privileges'
       and not tgisinternal
  )                                                                            as guard_trigger,
  has_table_privilege('authenticated','public.profiles','SELECT')              as auth_select,
  has_table_privilege('anon','public.profiles','SELECT')                       as anon_select,
  (select relrowsecurity from pg_class where oid='public.profiles'::regclass)   as rls_enabled,
  (select relforcerowsecurity from pg_class where oid='public.profiles'::regclass) as rls_forced;

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

  -- The subject for every negative case in section 10: a syntactically valid
  -- uuid that has no row in public.profiles, so private.is_active_user() must
  -- return false for it. Chosen rather than synthesised because it needs no
  -- write of any kind -- no auth.users row, no profile row, nothing to clean up
  -- afterwards. Section 10 asserts it really is absent before relying on it.
  --
  -- It stands in for BOTH negative cases the spec cares about, and that is
  -- exact rather than approximate: is_active_user() is
  --   exists (select 1 from public.profiles where id = auth.uid() and is_active)
  -- so a missing profile row and a profile row with is_active = false produce
  -- the identical false. Covering the second one separately would mean
  -- INSERTing into auth.users on the live project to get the signup trigger to
  -- make a profile, and a synthetic account in a real auth table is not worth
  -- it to re-prove the same `exists`.
  absent_uid uuid := 'ffffffff-0000-4000-8000-ffffffffffff';

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
  --            so writing that setting is what gives private.is_active_user()
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
  --       `checkins_select_active_users` widened to `using (true)` would have
  --       passed. `clients` was guarded from the start and `checkins` was not,
  --       which is exactly the defect class this whole file exists to eliminate,
  --       sitting inside the guard built to eliminate it. Both tables are guarded
  --       now, and the guards are here so that one check covers all three
  --       sections.
  select count(*) into n_clients_total  from public.clients;
  select count(*) into n_checkins_total from public.checkins;

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
          'an ACTIVE user sees %s of %s rows in public.clients -- clients_select_active_users is denying rows it should return, which is an outage for every signed-in user',
          n_seen, n_clients_total)::text;
      end if;

      select count(*) into n_seen from public.profiles;
      if n_seen <> 1 then
        problems := problems || format(
          'an active user sees %s rows in public.profiles, expected exactly their own -- profiles_select_own is wrong in one direction or the other',
          n_seen)::text;
      end if;

      select count(*) into n_seen from public.checkins;
      if n_seen <> n_checkins_total then
        problems := problems || format(
          'an ACTIVE user sees %s of %s rows in public.checkins -- checkins_select_active_users is denying rows it should return',
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
  --      design: a subject with no profile row -- so is_active_user() is false
  --      -- sees zero rows on both tables and cannot write.
  begin
    perform set_config(
      'request.jwt.claims',
      json_build_object('sub', absent_uid, 'role', 'authenticated', 'aud', 'authenticated')::text,
      true);
    set local role authenticated;

    select count(*) into n_seen from public.clients;
    if n_seen <> 0 then
      problems := problems || format(
        'a user with NO profile row sees %s row(s) in public.clients -- the policy is not gating on private.is_active_user() and any signed-in account reads client data',
        n_seen)::text;
    end if;

    select count(*) into n_seen from public.checkins;
    if n_seen <> 0 then
      problems := problems || format(
        'a user with NO profile row sees %s row(s) in public.checkins -- the policy is not gating on private.is_active_user() and any signed-in account reads check-in scores',
        n_seen)::text;
    end if;

    select count(*) into n_seen from public.profiles;
    if n_seen <> 0 then
      problems := problems || format(
        'a user with NO profile row sees %s row(s) in public.profiles -- profiles_select_own is not gating on auth.uid() and any signed-in account reads every profile',
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
          problems := problems || 'a user with NO profile row was ALLOWED to insert into public.clients -- clients_insert_active_users is not gating on private.is_active_user() (the row was rolled back by this check, not by the policy)'::text;
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
  --      inside is_active_user() is `id = null` and the whole predicate hinges on
  --      null handling rather than on a lookup miss. It is also the shape of a
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
        ('profiles', 'profiles_update_own'),
        ('clients',  'clients_select_active_users'),
        ('clients',  'clients_insert_active_users'),
        ('clients',  'clients_update_active_users'),
        ('checkins', 'checkins_select_active_users'),
        ('checkins', 'checkins_insert_active_users'),
        ('checkins', 'checkins_update_active_users')
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
select
  has_column_privilege('authenticated','public.profiles','full_name','UPDATE') as auth_update_full_name,
  has_column_privilege('authenticated','public.profiles','role','UPDATE')      as auth_update_role,
  has_column_privilege('authenticated','public.profiles','is_active','UPDATE') as auth_update_is_active,
  has_table_privilege('authenticated','public.profiles','SELECT')              as auth_select,
  has_table_privilege('anon','public.profiles','SELECT')                       as anon_select,
  (select relrowsecurity from pg_class where oid='public.profiles'::regclass)   as rls_enabled,
  (select relforcerowsecurity from pg_class where oid='public.profiles'::regclass) as rls_forced;

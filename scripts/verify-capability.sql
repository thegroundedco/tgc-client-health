-- Proves the DEPLOYED private.has_capability answers correctly for every
-- (role, capability) pair. Run with `npm run verify:capability`. Slice 2 design
-- §6 and §9.
--
-- WHY THIS EXISTS SEPARATELY FROM verify-privileges.sql. That file's section 10f
-- checks the same thing the right way round -- it becomes `authenticated` with a
-- viewer's claims and watches a real INSERT be refused -- but it needs an active
-- profile row per role to do it, and neither database has one. On a project with
-- a single admin it reports COULD NOT VERIFY and the preset table goes
-- unexercised. This file needs no rows at all.
--
-- Nothing is inserted and no sequence advances. The CASE expression is read out
-- of pg_proc.prosrc -- the deployed source, not a copy of it -- and evaluated
-- over every combination, the same technique scripts/verify-lifecycle.sql uses
-- on a check constraint and scripts/score-parity.mjs uses on a generated column.
--
-- WHAT THIS DOES NOT PROVE. Only the preset table. The `exists (...)` wrapper
-- around it -- the auth.uid() lookup and the is_active test -- is NOT exercised
-- here, because evaluating that needs a profile row and a subject. So a
-- has_capability that returns the right answer for the right role can still be
-- wired to the wrong subject, and this file would pass. verify-privileges.sql
-- 10b covers the wiring for an active user, and 10c and 10d cover it for
-- subjects that must be refused. The two files together are the coverage;
-- neither is sufficient.
--
-- The two parties to the comparison are the deployed CASE and the presets as
-- restated in `expected` below. They come from the same intent but not from each
-- other, so a typo in either shows up here. A shared misunderstanding of what
-- the presets SHOULD be would not -- which is why they are stated in four
-- places: parent spec §7.1, the migration, src/lib/capabilities.ts, and here.

do $$
declare
  body         text;
  expression   text;
  mismatches   bigint;
  combinations bigint;
begin
  ----------------------------------------------------------------------------
  -- Precondition. "The migration has not been applied here" is by far the most
  -- likely reason this cannot run, and it is not a finding. Reported separately
  -- from a real disagreement, following scripts/verify-privileges.sql: a check
  -- that could not run must never read as a check that passed, and must never
  -- read as a violation either.
  ----------------------------------------------------------------------------
  select p.prosrc into body
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'private'
    and p.proname = 'has_capability'
    and p.pronargs = 1;

  if body is null then
    raise exception E'verify:capability COULD NOT VERIFY -- private.has_capability(text) does not exist on this project.\n\nNO DISAGREEMENT WAS FOUND; nothing was checked. This is the expected result where supabase/migrations/20260824160306_has_capability.sql has not been applied yet. Apply it and re-run.';
  end if;

  -- The deployed CASE, not a copy of it. \y is a Postgres word boundary, so the
  -- lazy match stops at the CASE's own `end` and not at a substring of some
  -- longer word.
  expression := (regexp_match(body, '(case\s+p\.role.*?\yend\y)', 'is'))[1];

  if expression is null then
    raise exception E'verify:capability COULD NOT VERIFY -- private.has_capability exists but no `case p.role ... end` could be found in its body, so the preset table could not be read. The function has been rewritten in a shape this script does not understand -- read it and update this script; do NOT assume it is still correct.\n\nThe deployed body is:\n%', body;
  end if;

  ----------------------------------------------------------------------------
  -- Every (role, capability) pair, with the presets restated. Four roles, not
  -- three: `sales` stands for a role the presets do not know, which must answer
  -- false for everything and so exercises the migration's `else array[]::text[]`
  -- branch. A role text column plus a check constraint means that value is not
  -- reachable today; the branch exists so that adding a role to the constraint
  -- and forgetting the CASE fails closed rather than open, and an unexercised
  -- fail-closed branch is just an intention.
  --
  -- `expected` is %L::boolean, and BOTH simpler spellings are wrong -- measured
  -- on staging 2026-08-24 while building verify-lifecycle.sql. A bare %L quotes
  -- it as 'true', the column comes out text, and the comparison dies with
  -- "operator does not exist: boolean = text". A bare %s renders Postgres's own
  -- boolean output, which is `t`, and an unquoted t parses as a COLUMN
  -- REFERENCE: `42703: column "t" does not exist`.
  --
  -- The VALUES list is aliased `p` because the deployed expression says
  -- `p.role`. That is not a coincidence to be tidied away: substituting the real
  -- expression unchanged is the whole point, so the surroundings bend to it.
  ----------------------------------------------------------------------------
  execute format($fmt$
    select
      count(*) filter (where (p.wanted = any (%s)) is distinct from p.expected),
      count(*)
    from (values
      %s
    ) as p(role, wanted, expected)
  $fmt$,
    expression,
    (select string_agg(
       format('(%L::text, %L::text, %L::boolean)',
              r.role, c.cap,
              case r.role
                when 'admin' then true
                when 'account_manager'
                  then c.cap in ('view_scores', 'edit_scores', 'manage_clients')
                when 'viewer' then c.cap = 'view_scores'
                else false
              end),
       E',\n      ')
     from (values ('admin'), ('account_manager'), ('viewer'), ('sales')) as r(role)
     cross join (values
       ('view_scores'), ('edit_scores'), ('manage_clients'), ('manage_users')
     ) as c(cap)))
  into mismatches, combinations;

  -- Assert a positive expected count, so "0 mismatches" cannot read as success
  -- when the reason is that nothing was compared. A cross join that lost a leg
  -- would otherwise pass silently.
  if combinations <> 16 then
    raise exception 'verify:capability FAILED to build its own input: expected 16 combinations, built %. Nothing about the deployed function was checked.',
      combinations;
  end if;

  if mismatches <> 0 then
    raise exception E'verify:capability FAILED -- the deployed preset table disagrees with parent spec §7.1 on % of % (role, capability) pairs.\n\nThis is a permission model defect: somebody either holds a capability their role should not, or is denied one it should. The deployed CASE is:\n  %',
      mismatches, combinations, expression;
  end if;

  raise notice 'verify:capability OK -- all % (role, capability) pairs agree with the presets', combinations;
end $$;

-- Echoed so a passing run shows what it just asserted, not merely "ok" -- a
-- NOTICE is invisible through `supabase db query`, which returns only the last
-- statement's rows, so this select IS the evidence of a pass.
--
-- The grants are echoed beside the presets because they are the other half of
-- the story and the half that fails catastrophically: authenticated must hold
-- EXECUTE (or every policy naming this function fails 42501 for every signed-in
-- user) and anon must not. Asserted, not merely printed, by
-- verify-privileges.sql §9 in both directions.
select
  p.proname::text                                                    as function,
  pg_get_function_identity_arguments(p.oid)                          as arguments,
  p.prosecdef                                                        as security_definer,
  p.provolatile = 's'                                                as stable,
  has_function_privilege('authenticated', p.oid, 'EXECUTE')          as authenticated_execute,
  has_function_privilege('anon', p.oid, 'EXECUTE')                   as anon_execute
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'private'
  and p.proname = 'has_capability';

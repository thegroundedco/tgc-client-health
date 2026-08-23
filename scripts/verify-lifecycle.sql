-- Proves the DEPLOYED clients_lifecycle_coherent constraint permits exactly the
-- combinations it is meant to, over its whole input space. Run with
-- `npm run verify:lifecycle`. Slice 2 design §5 and §9.
--
-- Nothing is inserted and no sequence advances: the constraint's expression is
-- read out of pg_constraint and evaluated over a VALUES list, the same technique
-- scripts/score-parity.mjs uses on the total_score generated column. So what is
-- tested is what is deployed, not a copy of what was intended.
--
-- The input space is small enough to check all of: 4 statuses x ended_on present
-- or not x end_reason_code present or not x end_reason_note present or not = 32
-- combinations. That is deliberate. The standing lesson on this project is that a
-- hand-picked state list is not verification of a state machine -- twelve
-- hand-picked states passed while two Critical bugs shipped -- and 32 is cheaper
-- to enumerate than a defensible subset is to argue for.
--
-- WHAT THIS DOES NOT PROVE. The two parties to the comparison are the constraint
-- as deployed and the rule as restated in `expected` below. They are written from
-- the same intent but not from each other, so a typo in either one shows up here.
-- A shared misunderstanding of what the rule SHOULD be would not. The rule is
-- stated in three places on purpose -- the slice design, the migration's comment,
-- and here -- so that a wrong understanding has three chances to look wrong.

do $$
declare
  expression  text;
  mismatches  bigint;
  combinations bigint;
  missing     text[] := '{}';
begin
  ----------------------------------------------------------------------------
  -- Preconditions. "The migration has not been applied to this project" is by
  -- far the most likely reason this script cannot run, and it is not a finding.
  -- Reported separately from a real disagreement, following
  -- scripts/verify-privileges.sql: a check that could not run must never read as
  -- a check that passed, and must never read as a violation either.
  ----------------------------------------------------------------------------
  if not exists (
    select 1 from pg_constraint
     where conrelid = 'public.clients'::regclass
       and conname = 'clients_lifecycle_coherent'
  ) then
    missing := missing || 'clients_lifecycle_coherent'::text;
  end if;

  if not exists (
    select 1 from pg_constraint
     where conrelid = 'public.clients'::regclass
       and conname = 'clients_end_reason_code_known'
  ) then
    missing := missing || 'clients_end_reason_code_known'::text;
  end if;

  if array_length(missing, 1) > 0 then
    raise exception E'verify:lifecycle COULD NOT VERIFY -- % constraint(s) are not on public.clients:\n  - %\n\nNO DISAGREEMENT WAS FOUND; nothing was checked. This is the expected result on a project where supabase/migrations/20260823213144_add_client_lifecycle.sql has not been applied yet. Apply it and re-run.',
      array_length(missing, 1), array_to_string(missing, E'\n  - ');
  end if;

  -- The live expression, not a copy of it. pg_get_constraintdef returns
  -- `CHECK (...)`; the CHECK is stripped so the parenthesised expression can be
  -- dropped into a WHERE clause.
  select regexp_replace(pg_get_constraintdef(oid), '^CHECK\s*', '')
    into strict expression
    from pg_constraint
   where conrelid = 'public.clients'::regclass
     and conname = 'clients_lifecycle_coherent';

  ----------------------------------------------------------------------------
  -- Every combination, with the rule restated. Two things about the literals:
  --
  -- Each column is cast explicitly rather than left to inference, because half
  -- the rows in a column are NULL and a VALUES list whose types are guessed is
  -- one edit away from guessing differently.
  --
  -- `expected` uses %s, not %L. %L would quote the boolean as 'true', the column
  -- would come out text, and `(expression) is distinct from v.expected` would
  -- fail with "operator does not exist: boolean = text". Caught before the first
  -- run, by reading the format string rather than by running it.
  ----------------------------------------------------------------------------
  execute format($fmt$
    select
      count(*) filter (where (%s) is distinct from v.expected),
      count(*)
    from (values
      %s
    ) as v(status, ended_on, end_reason_code, end_reason_note, expected)
  $fmt$,
    expression,
    (select string_agg(
       format('(%L::text, %L::date, %L::text, %L::text, %s)',
              s.status, e.ended_on, c.code, n.note,
              case
                when s.status in ('cancelled', 'former')
                  then e.ended_on is not null and c.code is not null
                else e.ended_on is null and c.code is null and n.note is null
              end),
       E',\n      ')
     from (values ('active'), ('paused'), ('cancelled'), ('former')) as s(status)
     cross join (values (null::date), ('2026-08-01'::date)) as e(ended_on)
     cross join (values (null::text), ('price'::text)) as c(code)
     cross join (values (null::text), ('a note'::text)) as n(note)))
  into mismatches, combinations;

  -- Assert a positive expected count, so "0 mismatches" cannot read as success
  -- when the reason is that nothing was compared. A cross join that lost a leg
  -- would otherwise pass silently.
  if combinations <> 32 then
    raise exception 'verify:lifecycle FAILED to build its own input: expected 32 combinations, built %. Nothing about the constraint was checked.',
      combinations;
  end if;

  if mismatches <> 0 then
    raise exception E'verify:lifecycle FAILED -- clients_lifecycle_coherent disagrees with its stated intent on % of % combinations.\n\nThe deployed expression is:\n  %',
      mismatches, combinations, expression;
  end if;

  -- Says only what was checked. The reason-code list is NOT verified here; the
  -- select below prints both constraint definitions so a reader can see it, and
  -- tests/clientLifecycle.test.ts pins its membership and its count in CI.
  raise notice 'verify:lifecycle OK -- all % combinations of clients_lifecycle_coherent agree with its stated intent', combinations;
end $$;

-- Echoed so a passing run shows what it just asserted, not merely "ok" -- and
-- because a NOTICE is easy to miss in the dashboard SQL editor, where "Success.
-- No rows returned" looks identical to having done nothing.
select conname, pg_get_constraintdef(oid) as definition
  from pg_constraint
 where conrelid = 'public.clients'::regclass
   and conname in ('clients_lifecycle_coherent', 'clients_end_reason_code_known')
 order by conname;

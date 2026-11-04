-- Asserts 20261104120000_productive_hours.sql against the live database: that
-- fin_hours_applies follows links and fetches with nobody re-saving, that
-- fin_score and overall_score divide by 4/18 or 3/17 accordingly, that the
-- refresh leaves a check-in's other state alone, and the access boundary on
-- the three new tables. Run with `npm run verify:hours`. Raises, listing every
-- violation, on any mismatch.
--
-- LEAVES NO DATA. The scratch client, its check-ins, links, budgets and fetch
-- stamps, and the temporarily activated viewer all live inside one inner block
-- that always ends by raising a sentinel; its handler catches the sentinel,
-- which rolls the whole block back to its savepoint (the verify-ai-runs.sql
-- pattern). Only the `problems` array survives. clients_id_seq and
-- checkins_id_seq advance a few numbers per run; accepted.
--
-- Subjects are the fixtures scripts/seed-verifier-subjects.sql creates
-- (`npm run seed:verifier-subjects`): the active account_manager (holds
-- view_revenue and manage_clients) and the inactive viewer, activated inside
-- the rolled-back block so it is refused because of its ROLE (no
-- view_revenue), not merely because it is inactive.
--
-- What it checks, on a scratch client "Client A (verify-hours)":
--   (a) unlinked, an October check-in has fin_hours_applies = false and
--       fin_score is the three-answer mean; a September one too.
--   (b) linking a project (as the account manager, so the refresh trigger is
--       fired by `authenticated`) flips October to true -- linked, never
--       fetched -- and fin_score is null until fin_hours_in_budget is set,
--       then the four-answer mean. The refresh leaves suggested_at,
--       submitted_at, submitted_by, notes and ai_suggestion as they were, and
--       is not refused by checkins_guard_ai_suggestion. updated_at moves on
--       the flipped row, as the migration header documents, and on no other:
--       not September's, and not a November row whose answer did not change.
--   (c) record_month_budgets with '[]', as service_role, flips October to
--       false (fetched, no budget) and the stray hours answer stops counting;
--       with one budget it flips back to true.
--   (d) a caller cannot force fin_hours_applies by writing it.
--   (e) deleting the link flips October to false.
--   (f) September stays false throughout.
--   (g) authenticated without view_revenue sees zero budget, fetch and link
--       rows, cannot insert a budget (42501), cannot link a project, and
--       cannot call record_month_budgets; the account manager sees the rows
--       (so the zeros are the policy, not an empty table), and
--       can_view_revenue() answers true for one and false for the other.
--   (h) overall_score from checkin_scores is round(sum/18, 2) with hours and
--       round(sum/17, 2) without.

do $$
declare
  problems  text[] := '{}';
  sentinel  constant text := 'verify-hours rollback sentinel';

  am_uid      constant uuid := '5eed0000-0000-4000-8000-000000000001';
  viewer_uid  constant uuid := '5eed0000-0000-4000-8000-000000000002';

  oct   constant date := '2026-10-01';
  sep   constant date := '2026-09-01';
  -- Numeric, as the link table's check requires; far above any real
  -- Productive project id, and rolled back with everything else.
  probe_project constant text := '999999990001';
  probe_ai      constant jsonb := '{"probe": "verify-hours", "answers": {}}';
  probe_note    constant text  := 'verify-hours probe note -- must never persist';
  long_ago      constant timestamptz := '2000-01-01 00:00:00+00';
  nov   constant date := '2026-11-01';
  one_budget    constant jsonb := jsonb_build_array(jsonb_build_object(
    'productive_deal_id', '__verify_hours_deal_a__',
    'productive_project_id', probe_project,
    'name', 'Budget A',
    'starts_on', '2026-10-01',
    'ends_on', '2026-10-31',
    'budgeted_minutes', 1200,
    'worked_minutes', 1100));

  -- The seventeen non-Advocacy answers. Finances 5, 5, 2 (12: 4.00 over
  -- three; with hours 1, 13: 3.25 over four); the other fourteen 3 (42).
  -- So the seventeen sum to 54 and, with hours 1, the eighteen to 55.
  c_sum17 constant integer := 54;

  v_client  bigint;
  v_oct     bigint;
  v_sep     bigint;
  v_nov     bigint;
  v_at      timestamptz;
  v_applies boolean;
  v_score   numeric;
  v_bool    boolean;
  n_rows    bigint;
  before_row record;
  after_row  record;
begin
  if not exists (select 1 from public.profiles where id = am_uid and is_active and role = 'account_manager') then
    raise exception 'verify:hours COULD NOT RUN -- the seed account_manager % is missing or not an active account_manager; run `npm run seed:verifier-subjects` first', am_uid;
  end if;
  if not exists (select 1 from public.profiles where id = viewer_uid and role = 'viewer') then
    raise exception 'verify:hours COULD NOT RUN -- the seed viewer % is missing; run `npm run seed:verifier-subjects` first', viewer_uid;
  end if;

  begin
    --------------------------------------------------------------------------
    -- Setup, as the owner.
    --------------------------------------------------------------------------
    insert into public.clients (name) values ('Client A (verify-hours)') returning id into v_client;

    -- updated_at is written explicitly on insert (checkins_touch_updated_at
    -- fires on UPDATE only), at a time long past, so a refresh that moves it
    -- -- and one that should not -- can both be seen inside one transaction,
    -- where now() never changes. ai_suggestion, suggested_at, submitted_at,
    -- submitted_by and notes are state the refresh must not disturb (b); set
    -- as the owner, so the guard lets ai_suggestion through.
    insert into public.checkins (client_id, period, fin_rack_rate, fin_pays_on_time, fin_rate_increased,
      comm_constructive, comm_timely, comm_consistent,
      growth_goals_defined, growth_progress_trackable, growth_hitting_goals,
      rel_collaborative, rel_respectful, rel_fun, rel_multi_threaded,
      del_on_time, del_quantity, del_client_likes, del_we_are_proud,
      ai_suggestion, suggested_at, submitted_at, submitted_by, notes, updated_at)
    values (v_client, oct, 5, 5, 2, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3,
      probe_ai, '2026-11-01 14:00:00+00', '2026-11-02 09:00:00+00', am_uid, probe_note, long_ago)
    returning id into v_oct;

    insert into public.checkins (client_id, period, fin_rack_rate, fin_pays_on_time, fin_rate_increased, updated_at)
    values (v_client, sep, 5, 5, 2, long_ago)
    returning id into v_sep;

    --------------------------------------------------------------------------
    -- (a) unlinked.
    --------------------------------------------------------------------------
    select fin_hours_applies, fin_score into v_applies, v_score from public.checkins where id = v_oct;
    if v_applies is distinct from false then
      problems := problems || format('(a) an unlinked October check-in has fin_hours_applies %s, expected false', v_applies);
    end if;
    if v_score is distinct from 4.00 then
      problems := problems || format('(a) an unlinked October fin_score is %s, expected 4.00 (the three-answer mean)', v_score);
    end if;
    select overall_score into v_score from public.checkin_scores where id = v_oct;
    if v_score is distinct from round(c_sum17::numeric / 17, 2) then
      problems := problems || format('(h) without hours overall_score is %s, expected %s (round(%s/17, 2))',
        v_score, round(c_sum17::numeric / 17, 2), c_sum17);
    end if;

    select * into before_row from public.checkins where id = v_oct;

    --------------------------------------------------------------------------
    -- (b) link, as the account manager.
    --------------------------------------------------------------------------
    perform set_config('request.jwt.claims',
      json_build_object('sub', am_uid, 'role', 'authenticated', 'aud', 'authenticated')::text, true);
    set local role authenticated;
    begin
      insert into public.client_productive_projects (client_id, productive_project_id)
      values (v_client, probe_project);
    exception when others then
      problems := problems || format(
        '(b) the account manager (manage_clients) could not link a project: %s %s -- if this is 42501 "ai_suggestion is written only by the AI routine", the refresh is tripping the guard',
        sqlstate, sqlerrm);
    end;
    reset role;
    perform set_config('request.jwt.claims', '', true);

    select * into after_row from public.checkins where id = v_oct;
    if after_row.fin_hours_applies is distinct from true then
      problems := problems || format('(b) linking a project left fin_hours_applies %s, expected true (linked, never fetched)', after_row.fin_hours_applies);
    end if;
    if after_row.fin_score is not null then
      problems := problems || format('(b) hours apply but are blank, yet fin_score is %s, expected null', after_row.fin_score);
    end if;
    if after_row.ai_suggestion is distinct from before_row.ai_suggestion
       or after_row.suggested_at is distinct from before_row.suggested_at
       or after_row.submitted_at is distinct from before_row.submitted_at
       or after_row.submitted_by is distinct from before_row.submitted_by
       or after_row.notes is distinct from before_row.notes then
      problems := problems || '(b) the refresh changed ai_suggestion, suggested_at, submitted_at, submitted_by or notes -- it must set fin_hours_applies only';
    end if;
    -- What the migration header documents: the refresh moves updated_at on
    -- a row whose answer flipped (checkins_touch_updated_at)...
    if before_row.updated_at is distinct from long_ago or after_row.updated_at is distinct from now() then
      problems := problems || format('(b) updated_at went %s -> %s across the refresh, expected %s -> now() (%s), as the migration header documents',
        before_row.updated_at, after_row.updated_at, long_ago, now());
    end if;
    -- ...and on no other row: September is outside the refresh.
    select updated_at into v_at from public.checkins where id = v_sep;
    if v_at is distinct from long_ago then
      problems := problems || format('(b) the refresh moved a September check-in''s updated_at to %s', v_at);
    end if;

    -- A November check-in, inserted while linked and never fetched, applies
    -- from birth. The fetches below are for October only; November's answer
    -- does not change, so the refresh must leave its row, and its
    -- updated_at, alone.
    insert into public.checkins (client_id, period, updated_at)
    values (v_client, nov, long_ago)
    returning id into v_nov;
    select fin_hours_applies into v_applies from public.checkins where id = v_nov;
    if v_applies is distinct from true then
      problems := problems || format('(b) a November check-in inserted while linked has fin_hours_applies %s, expected true', v_applies);
    end if;

    update public.checkins set fin_hours_in_budget = 1 where id = v_oct;
    select fin_score into v_score from public.checkins where id = v_oct;
    if v_score is distinct from 3.25 then
      problems := problems || format('(b) with hours 1 fin_score is %s, expected 3.25 (the four-answer mean)', v_score);
    end if;
    select overall_score into v_score from public.checkin_scores where id = v_oct;
    if v_score is distinct from round((c_sum17 + 1)::numeric / 18, 2) then
      problems := problems || format('(h) with hours overall_score is %s, expected %s (round(%s/18, 2))',
        v_score, round((c_sum17 + 1)::numeric / 18, 2), c_sum17 + 1);
    end if;

    --------------------------------------------------------------------------
    -- (c) fetched, as service_role: no budget, then one.
    --------------------------------------------------------------------------
    begin
      set local role service_role;
      perform public.record_month_budgets(v_client, oct, '[]'::jsonb);
      reset role;
    exception when others then
      reset role;
      problems := problems || format('(c) service_role could not call record_month_budgets(''[]''): %s %s -- falling back to the owner for the rest', sqlstate, sqlerrm);
      perform public.record_month_budgets(v_client, oct, '[]'::jsonb);
    end;

    select fin_hours_applies, fin_score into v_applies, v_score from public.checkins where id = v_oct;
    if v_applies is distinct from false then
      problems := problems || format('(c) fetched with no budget left fin_hours_applies %s, expected false', v_applies);
    end if;
    if v_score is distinct from 4.00 then
      problems := problems || format('(c) with no budget fin_score is %s, expected 4.00 -- the stray hours answer must not count', v_score);
    end if;
    select overall_score into v_score from public.checkin_scores where id = v_oct;
    if v_score is distinct from round(c_sum17::numeric / 17, 2) then
      problems := problems || format('(h) after the no-budget fetch overall_score is %s, expected %s', v_score, round(c_sum17::numeric / 17, 2));
    end if;

    begin
      set local role service_role;
      perform public.record_month_budgets(v_client, oct, one_budget);
      reset role;
    exception when others then
      reset role;
      problems := problems || format('(c) service_role could not call record_month_budgets(one budget): %s %s', sqlstate, sqlerrm);
      perform public.record_month_budgets(v_client, oct, one_budget);
    end;

    select fin_hours_applies, fin_score into v_applies, v_score from public.checkins where id = v_oct;
    if v_applies is distinct from true then
      problems := problems || format('(c) fetched with one budget left fin_hours_applies %s, expected true', v_applies);
    end if;
    if v_score is distinct from 3.25 then
      problems := problems || format('(c) with one budget and hours 1 fin_score is %s, expected 3.25', v_score);
    end if;
    select count(*) into n_rows from public.client_month_budgets where client_id = v_client and period = oct;
    if n_rows <> 1 then
      problems := problems || format('(c) record_month_budgets left %s budget row(s), expected 1', n_rows);
    end if;
    select count(*) into n_rows from public.client_month_budgets
     where client_id = v_client and period = oct and name = 'Budget A'
       and budgeted_minutes = 1200 and worked_minutes = 1100
       and starts_on = '2026-10-01' and ends_on = '2026-10-31'
       and productive_project_id = probe_project;
    if n_rows <> 1 then
      problems := problems || '(c) the saved budget row does not carry the fields record_month_budgets was given';
    end if;

    select fin_hours_applies, updated_at into v_applies, v_at from public.checkins where id = v_nov;
    if v_applies is distinct from true or v_at is distinct from long_ago then
      problems := problems || format('(c) October''s fetches changed November (fin_hours_applies %s, updated_at %s) -- expected true and %s: the refresh must touch only rows whose answer changed',
        v_applies, v_at, long_ago);
    end if;

    --------------------------------------------------------------------------
    -- (d) a caller cannot force the flag.
    --------------------------------------------------------------------------
    update public.checkins set fin_hours_applies = true where id = v_sep;
    select fin_hours_applies into v_applies from public.checkins where id = v_sep;
    if v_applies is distinct from false then
      problems := problems || '(d) writing fin_hours_applies = true on a September check-in stuck -- the BEFORE trigger is not deriving it';
    end if;

    --------------------------------------------------------------------------
    -- (g) the access boundary, while budget, fetch and link rows exist.
    --------------------------------------------------------------------------
    perform set_config('request.jwt.claims',
      json_build_object('sub', am_uid, 'role', 'authenticated', 'aud', 'authenticated')::text, true);
    set local role authenticated;
    begin
      select count(*) into n_rows from public.client_month_budgets where client_id = v_client;
      if n_rows <> 1 then
        problems := problems || format('(g) the account manager (view_revenue) sees %s budget row(s), expected 1', n_rows);
      end if;
      select count(*) into n_rows from public.client_month_hours_fetch where client_id = v_client;
      if n_rows <> 1 then
        problems := problems || format('(g) the account manager sees %s fetch row(s), expected 1', n_rows);
      end if;
      select public.can_view_revenue() into v_bool;
      if v_bool is distinct from true then
        problems := problems || format('(g) can_view_revenue() is %s for the account manager, expected true', v_bool);
      end if;
    exception when others then
      problems := problems || format('(g) the account-manager reads raised: %s %s', sqlstate, sqlerrm);
    end;
    begin
      perform public.record_month_budgets(v_client, oct, '[]'::jsonb);
      problems := problems || '(g) authenticated could call record_month_budgets -- it is for service_role only';
    exception
      when insufficient_privilege then null;
      when others then
        problems := problems || format('(g) authenticated calling record_month_budgets was not refused with 42501: %s %s', sqlstate, sqlerrm);
    end;
    reset role;

    perform set_config('request.jwt.claims', '', true);
    update public.profiles set is_active = true where id = viewer_uid;
    perform set_config('request.jwt.claims',
      json_build_object('sub', viewer_uid, 'role', 'authenticated', 'aud', 'authenticated')::text, true);
    set local role authenticated;
    begin
      select count(*) into n_rows from public.client_month_budgets;
      if n_rows <> 0 then
        problems := problems || format('(g) an active viewer (no view_revenue) sees %s budget row(s), expected 0', n_rows);
      end if;
      select count(*) into n_rows from public.client_month_hours_fetch;
      if n_rows <> 0 then
        problems := problems || format('(g) an active viewer sees %s fetch row(s), expected 0', n_rows);
      end if;
      select count(*) into n_rows from public.client_productive_projects;
      if n_rows <> 0 then
        problems := problems || format('(g) an active viewer sees %s link row(s), expected 0', n_rows);
      end if;
      select public.can_view_revenue() into v_bool;
      if v_bool is distinct from false then
        problems := problems || format('(g) can_view_revenue() is %s for an active viewer, expected false', v_bool);
      end if;
    exception when others then
      problems := problems || format('(g) the viewer reads raised: %s %s', sqlstate, sqlerrm);
    end;
    begin
      insert into public.client_month_budgets
        (client_id, period, productive_deal_id, productive_project_id, name, starts_on, ends_on, budgeted_minutes, worked_minutes)
      values (v_client, oct, '__verify_hours_forged__', probe_project, 'Budget B', oct, '2026-10-31', 60, 0);
      problems := problems || '(g) an active viewer inserted a budget row';
    exception
      when insufficient_privilege then null;
      when others then
        problems := problems || format('(g) a viewer inserting a budget was not refused with 42501: %s %s', sqlstate, sqlerrm);
    end;
    begin
      insert into public.client_productive_projects (client_id, productive_project_id)
      values (v_client, '999999990002');
      problems := problems || '(g) an active viewer (no manage_clients) linked a project';
    exception
      when insufficient_privilege then null;
      when others then
        problems := problems || format('(g) a viewer linking a project was not refused with 42501: %s %s', sqlstate, sqlerrm);
    end;
    reset role;
    perform set_config('request.jwt.claims', '', true);

    --------------------------------------------------------------------------
    -- (e) unlink.
    --------------------------------------------------------------------------
    delete from public.client_productive_projects where client_id = v_client;
    select fin_hours_applies, fin_score into v_applies, v_score from public.checkins where id = v_oct;
    if v_applies is distinct from false then
      problems := problems || format('(e) deleting the link left fin_hours_applies %s, expected false', v_applies);
    end if;
    if v_score is distinct from 4.00 then
      problems := problems || format('(e) after unlinking fin_score is %s, expected 4.00', v_score);
    end if;

    --------------------------------------------------------------------------
    -- (f) September, throughout -- re-linked once more to be sure.
    --------------------------------------------------------------------------
    insert into public.client_productive_projects (client_id, productive_project_id)
    values (v_client, probe_project);
    select fin_hours_applies, fin_score into v_applies, v_score from public.checkins where id = v_sep;
    if v_applies is distinct from false then
      problems := problems || format('(f) a September check-in of a linked client has fin_hours_applies %s, expected false (hours start 2026-10-01)', v_applies);
    end if;
    if v_score is distinct from 4.00 then
      problems := problems || format('(f) a September fin_score is %s, expected 4.00', v_score);
    end if;

    raise exception '%', sentinel;
  exception when others then
    if sqlerrm <> sentinel then
      problems := problems || format(
        'the probe block stopped early: %s %s -- the checks after that point are UNVERIFIED',
        sqlstate, sqlerrm)::text;
    end if;
  end;

  if array_length(problems, 1) > 0 then
    raise exception E'verify:hours FAILED with % violation(s):\n  - %',
      array_length(problems, 1), array_to_string(problems, E'\n  - ');
  end if;

  raise notice 'verify:hours OK -- fin_hours_applies follows links and fetches, fin_score and overall_score switch divisors, the refresh leaves other state alone, and the new tables are gated on view_revenue';
end $$;

-- `db query` does not print RAISE NOTICE, so a pass would otherwise show only
-- an empty result. Reached only if the block above did not raise.
select 'verify:hours OK' as result;

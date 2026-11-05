-- Asserts 20261104120000_productive_hours.sql and
-- 20261105120000_hours_scored_by_db.sql against the live database: that
-- fin_hours_applies AND fin_hours_in_budget follow links and fetches with
-- nobody re-saving, that both are the database's to set (a caller's write is
-- overridden), that fin_score and overall_score divide by 4/18 or 3/17
-- accordingly, that the refresh leaves a check-in's other state alone, and the
-- access boundary on the three tables. Run with `npm run verify:hours`.
-- Raises, listing every violation, on any mismatch.
--
-- LEAVES NO DATA. The scratch client, its check-ins, links, budgets and fetch
-- stamps, and the temporarily activated viewer all live inside one inner block
-- that always ends by raising a sentinel; its handler catches the sentinel,
-- which rolls the whole block back to its savepoint (the verify-ai-runs.sql
-- pattern). Only the `problems` array survives. clients_id_seq and
-- checkins_id_seq advance a few numbers per run; accepted.
--
-- MUST RUN AFTER 2026-10 HAS ENDED IN DENVER: record_month_budgets stamps
-- fetched_at = now(), and October counts as finished only from 2026-11-01
-- Denver. Refuses to run before then rather than reporting false failures.
--
-- Subjects are the fixtures scripts/seed-verifier-subjects.sql creates
-- (`npm run seed:verifier-subjects`): the active account_manager (holds
-- view_revenue, manage_clients and edit_scores) and the inactive viewer,
-- activated inside the rolled-back block so it is refused because of its ROLE
-- (no view_revenue), not merely because it is inactive.
--
-- What it checks, on a scratch client "Client A (verify-hours)". October's
-- budget is 1200 min budgeted, 700 worked: diff -500, score 2.
--   (a) unlinked, an October check-in has fin_hours_applies = false, no hours
--       score, and fin_score is the three-answer mean; a finished fetch with
--       one budget changes nothing while the client is unlinked.
--   (b) linking a project (as the account manager, so the refresh trigger is
--       fired by `authenticated`) flips October to true with score 2 --
--   (s1)  one finished budget gives the right score -- and fin_score is the
--       four-answer mean. The refresh leaves suggested_at, submitted_at,
--       submitted_by, notes and ai_suggestion as they were, and is not refused
--       by checkins_guard_ai_suggestion. updated_at moves on the flipped row,
--       and on no other: not September's, and not November's (linked, never
--       fetched: does not apply).
--   (c) record_month_budgets with '[]', as service_role, flips October to
--       false (fetched, no budget) and clears the score;
--   (s2)  two budgets: does not apply;
--   (s3)  one budget starting 2026-10-15 (part-month): does not apply;
--       one full budget again: applies, score 2.
--   (s4)  fetched mid-month (fetched_at moved to 2026-10-2x): does not apply;
--       at 23:59:59 on Oct 31 Denver, not yet; at 00:00 on Nov 1 Denver, yes.
--   (s5)  the account manager writing fin_hours_in_budget = 5 is overridden:
--       October stays 2, September stays null.
--   (bands) each band edge, -601 to +481, scores as the brief says.
--   (d) a caller cannot force fin_hours_applies by writing it.
--   (e) deleting the link flips October to false and clears the score.
--   (f) September stays false and unscored throughout.
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
    'worked_minutes', 700));
  two_budgets   constant jsonb := one_budget || jsonb_build_array(jsonb_build_object(
    'productive_deal_id', '__verify_hours_deal_b__',
    'productive_project_id', probe_project,
    'name', 'Budget B',
    'starts_on', '2026-10-01',
    'ends_on', '2026-10-31',
    'budgeted_minutes', 600,
    'worked_minutes', 600));
  part_month    constant jsonb := jsonb_build_array(jsonb_build_object(
    'productive_deal_id', '__verify_hours_deal_a__',
    'productive_project_id', probe_project,
    'name', 'Budget A',
    'starts_on', '2026-10-15',
    'ends_on', '2026-10-31',
    'budgeted_minutes', 1200,
    'worked_minutes', 700));
  -- 1200 budgeted, 700 worked: diff -500, band 2.
  c_score       constant smallint := 2;

  -- The seventeen non-Advocacy answers. Finances 5, 5, 2 (12: 4.00 over
  -- three; with hours 2, 14: 3.50 over four); the other fourteen 3 (42).
  -- So the seventeen sum to 54 and, with hours 2, the eighteen to 56.
  c_sum17 constant integer := 54;

  -- (bands): worked minutes against 1200 budgeted, and the expected score.
  band_worked   constant integer[]  := array[599, 600, 719, 720, 839, 840, 1200, 1560, 1561, 1680, 1681];
  band_expected constant smallint[] := array[1,   2,   2,   3,   3,   5,   5,    5,    2,    2,    1];

  v_client  bigint;
  v_oct     bigint;
  v_sep     bigint;
  v_nov     bigint;
  v_at      timestamptz;
  v_applies boolean;
  v_hours   smallint;
  v_score   numeric;
  v_bool    boolean;
  n_rows    bigint;
  i         integer;
  before_row record;
  after_row  record;
begin
  if not exists (select 1 from public.profiles where id = am_uid and is_active and role = 'account_manager') then
    raise exception 'verify:hours COULD NOT RUN -- the seed account_manager % is missing or not an active account_manager; run `npm run seed:verifier-subjects` first', am_uid;
  end if;
  if not exists (select 1 from public.profiles where id = viewer_uid and role = 'viewer') then
    raise exception 'verify:hours COULD NOT RUN -- the seed viewer % is missing; run `npm run seed:verifier-subjects` first', viewer_uid;
  end if;
  if (now() at time zone 'America/Denver')::date < nov then
    raise exception 'verify:hours COULD NOT RUN -- October 2026 has not ended in Denver, so a fetch stamped now() cannot score it';
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
    -- as the owner, so the guard lets ai_suggestion through. The hours answer
    -- is sent as 5 and must not stick: it does not apply yet.
    insert into public.checkins (client_id, period, fin_rack_rate, fin_pays_on_time, fin_rate_increased,
      fin_hours_in_budget,
      comm_constructive, comm_timely, comm_consistent,
      growth_goals_defined, growth_progress_trackable, growth_hitting_goals,
      rel_collaborative, rel_respectful, rel_fun, rel_multi_threaded,
      del_on_time, del_quantity, del_client_likes, del_we_are_proud,
      ai_suggestion, suggested_at, submitted_at, submitted_by, notes, updated_at)
    values (v_client, oct, 5, 5, 2, 5, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3,
      probe_ai, '2026-11-01 14:00:00+00', '2026-11-02 09:00:00+00', am_uid, probe_note, long_ago)
    returning id into v_oct;

    insert into public.checkins (client_id, period, fin_rack_rate, fin_pays_on_time, fin_rate_increased, updated_at)
    values (v_client, sep, 5, 5, 2, long_ago)
    returning id into v_sep;

    --------------------------------------------------------------------------
    -- (a) unlinked.
    --------------------------------------------------------------------------
    select fin_hours_applies, fin_hours_in_budget, fin_score into v_applies, v_hours, v_score from public.checkins where id = v_oct;
    if v_applies is distinct from false then
      problems := problems || format('(a) an unlinked October check-in has fin_hours_applies %s, expected false', v_applies);
    end if;
    if v_hours is not null then
      problems := problems || format('(a) an unlinked October check-in kept fin_hours_in_budget %s from the insert, expected null -- the BEFORE trigger is not overriding it', v_hours);
    end if;
    if v_score is distinct from 4.00 then
      problems := problems || format('(a) an unlinked October fin_score is %s, expected 4.00 (the three-answer mean)', v_score);
    end if;
    select overall_score into v_score from public.checkin_scores where id = v_oct;
    if v_score is distinct from round(c_sum17::numeric / 17, 2) then
      problems := problems || format('(h) without hours overall_score is %s, expected %s (round(%s/17, 2))',
        v_score, round(c_sum17::numeric / 17, 2), c_sum17);
    end if;

    -- A finished fetch with one budget, as service_role, while unlinked:
    -- still does not apply, and the row is not touched.
    begin
      set local role service_role;
      perform public.record_month_budgets(v_client, oct, one_budget);
      reset role;
    exception when others then
      reset role;
      problems := problems || format('(a) service_role could not call record_month_budgets(one budget): %s %s -- falling back to the owner for the rest', sqlstate, sqlerrm);
      perform public.record_month_budgets(v_client, oct, one_budget);
    end;
    select fin_hours_applies, updated_at into v_applies, v_at from public.checkins where id = v_oct;
    if v_applies is distinct from false or v_at is distinct from long_ago then
      problems := problems || format('(a) a fetch for an unlinked client changed October (fin_hours_applies %s, updated_at %s), expected false and %s',
        v_applies, v_at, long_ago);
    end if;

    select * into before_row from public.checkins where id = v_oct;

    --------------------------------------------------------------------------
    -- (b) link, as the account manager. (s1) one finished budget scores.
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
      problems := problems || format('(s1) linking a client with one finished budget left fin_hours_applies %s, expected true', after_row.fin_hours_applies);
    end if;
    if after_row.fin_hours_in_budget is distinct from c_score then
      problems := problems || format('(s1) one finished budget (diff -500) scored %s, expected %s', after_row.fin_hours_in_budget, c_score);
    end if;
    if after_row.fin_score is distinct from 3.50 then
      problems := problems || format('(s1) with hours %s fin_score is %s, expected 3.50 (the four-answer mean)', c_score, after_row.fin_score);
    end if;
    select overall_score into v_score from public.checkin_scores where id = v_oct;
    if v_score is distinct from round((c_sum17 + c_score)::numeric / 18, 2) then
      problems := problems || format('(h) with hours overall_score is %s, expected %s (round(%s/18, 2))',
        v_score, round((c_sum17 + c_score)::numeric / 18, 2), c_sum17 + c_score);
    end if;
    if after_row.ai_suggestion is distinct from before_row.ai_suggestion
       or after_row.suggested_at is distinct from before_row.suggested_at
       or after_row.submitted_at is distinct from before_row.submitted_at
       or after_row.submitted_by is distinct from before_row.submitted_by
       or after_row.notes is distinct from before_row.notes then
      problems := problems || '(b) the refresh changed ai_suggestion, suggested_at, submitted_at, submitted_by or notes -- it must set the two hours columns only';
    end if;
    -- The refresh moves updated_at on a row whose values changed
    -- (checkins_touch_updated_at)...
    if before_row.updated_at is distinct from long_ago or after_row.updated_at is distinct from now() then
      problems := problems || format('(b) updated_at went %s -> %s across the refresh, expected %s -> now() (%s), as the migration header documents',
        before_row.updated_at, after_row.updated_at, long_ago, now());
    end if;
    -- ...and on no other row: September is outside the refresh.
    select updated_at into v_at from public.checkins where id = v_sep;
    if v_at is distinct from long_ago then
      problems := problems || format('(b) the refresh moved a September check-in''s updated_at to %s', v_at);
    end if;

    -- A November check-in, inserted while linked and never fetched: does not
    -- apply ("couldn't reach Productive" is unscored now). The fetches below
    -- are for October only, so its row and updated_at must stay alone.
    insert into public.checkins (client_id, period, fin_hours_in_budget, updated_at)
    values (v_client, nov, 5, long_ago)
    returning id into v_nov;
    select fin_hours_applies, fin_hours_in_budget into v_applies, v_hours from public.checkins where id = v_nov;
    if v_applies is distinct from false or v_hours is not null then
      problems := problems || format('(b) a November check-in, linked but never fetched, has fin_hours_applies %s and fin_hours_in_budget %s, expected false and null',
        v_applies, v_hours);
    end if;

    --------------------------------------------------------------------------
    -- (c) re-fetched, as service_role: no budget.
    --------------------------------------------------------------------------
    begin
      set local role service_role;
      perform public.record_month_budgets(v_client, oct, '[]'::jsonb);
      reset role;
    exception when others then
      reset role;
      problems := problems || format('(c) service_role could not call record_month_budgets(''[]''): %s %s', sqlstate, sqlerrm);
      perform public.record_month_budgets(v_client, oct, '[]'::jsonb);
    end;

    select fin_hours_applies, fin_hours_in_budget, fin_score into v_applies, v_hours, v_score from public.checkins where id = v_oct;
    if v_applies is distinct from false or v_hours is not null then
      problems := problems || format('(c) fetched with no budget left fin_hours_applies %s and fin_hours_in_budget %s, expected false and null', v_applies, v_hours);
    end if;
    if v_score is distinct from 4.00 then
      problems := problems || format('(c) with no budget fin_score is %s, expected 4.00', v_score);
    end if;
    select overall_score into v_score from public.checkin_scores where id = v_oct;
    if v_score is distinct from round(c_sum17::numeric / 17, 2) then
      problems := problems || format('(h) after the no-budget fetch overall_score is %s, expected %s', v_score, round(c_sum17::numeric / 17, 2));
    end if;

    -- (s2) two budgets.
    perform public.record_month_budgets(v_client, oct, two_budgets);
    select fin_hours_applies, fin_hours_in_budget into v_applies, v_hours from public.checkins where id = v_oct;
    if v_applies is distinct from false or v_hours is not null then
      problems := problems || format('(s2) two budgets left fin_hours_applies %s and fin_hours_in_budget %s, expected false and null', v_applies, v_hours);
    end if;

    -- (s3) one part-month budget.
    perform public.record_month_budgets(v_client, oct, part_month);
    select fin_hours_applies, fin_hours_in_budget into v_applies, v_hours from public.checkins where id = v_oct;
    if v_applies is distinct from false or v_hours is not null then
      problems := problems || format('(s3) a part-month budget (starts 2026-10-15) left fin_hours_applies %s and fin_hours_in_budget %s, expected false and null', v_applies, v_hours);
    end if;

    -- One full budget again.
    perform public.record_month_budgets(v_client, oct, one_budget);
    select fin_hours_applies, fin_hours_in_budget into v_applies, v_hours from public.checkins where id = v_oct;
    if v_applies is distinct from true or v_hours is distinct from c_score then
      problems := problems || format('(c) one full budget again gave fin_hours_applies %s and fin_hours_in_budget %s, expected true and %s', v_applies, v_hours, c_score);
    end if;
    select count(*) into n_rows from public.client_month_budgets
     where client_id = v_client and period = oct and name = 'Budget A'
       and budgeted_minutes = 1200 and worked_minutes = 700
       and starts_on = '2026-10-01' and ends_on = '2026-10-31'
       and productive_project_id = probe_project;
    if n_rows <> 1 then
      problems := problems || '(c) the saved budget row does not carry the fields record_month_budgets was given';
    end if;
    select count(*) into n_rows from public.client_month_budgets where client_id = v_client and period = oct;
    if n_rows <> 1 then
      problems := problems || format('(c) record_month_budgets left %s budget row(s), expected 1', n_rows);
    end if;

    select fin_hours_applies, updated_at into v_applies, v_at from public.checkins where id = v_nov;
    if v_applies is distinct from false or v_at is distinct from long_ago then
      problems := problems || format('(c) October''s fetches changed November (fin_hours_applies %s, updated_at %s) -- expected false and %s: the refresh must touch only rows whose values changed',
        v_applies, v_at, long_ago);
    end if;

    --------------------------------------------------------------------------
    -- (s4) fetched before the month ended, in Denver. Moved by the owner;
    -- the update fires the fetch trigger's refresh.
    --------------------------------------------------------------------------
    update public.client_month_hours_fetch set fetched_at = '2026-10-20 12:00:00-06'
     where client_id = v_client and period = oct;
    select fin_hours_applies, fin_hours_in_budget into v_applies, v_hours from public.checkins where id = v_oct;
    if v_applies is distinct from false or v_hours is not null then
      problems := problems || format('(s4) fetched mid-month left fin_hours_applies %s and fin_hours_in_budget %s, expected false and null', v_applies, v_hours);
    end if;

    -- 23:59:59 on Oct 31 in Denver (MDT, UTC-6) is 05:59:59 UTC on Nov 1.
    update public.client_month_hours_fetch set fetched_at = '2026-11-01 05:59:59+00'
     where client_id = v_client and period = oct;
    select fin_hours_applies into v_applies from public.checkins where id = v_oct;
    if v_applies is distinct from false then
      problems := problems || '(s4) a fetch at 23:59:59 on Oct 31 Denver time (Nov 1 in UTC) counted as after month end -- the rule must judge the date in America/Denver';
    end if;

    update public.client_month_hours_fetch set fetched_at = '2026-11-01 06:00:00+00'
     where client_id = v_client and period = oct;
    select fin_hours_applies, fin_hours_in_budget into v_applies, v_hours from public.checkins where id = v_oct;
    if v_applies is distinct from true or v_hours is distinct from c_score then
      problems := problems || format('(s4) a fetch at 00:00 on Nov 1 Denver time gave fin_hours_applies %s and fin_hours_in_budget %s, expected true and %s',
        v_applies, v_hours, c_score);
    end if;

    --------------------------------------------------------------------------
    -- (s5) an app write of the hours answer is overridden, as the account
    -- manager (edit_scores): the check-in screen's own path.
    --------------------------------------------------------------------------
    perform set_config('request.jwt.claims',
      json_build_object('sub', am_uid, 'role', 'authenticated', 'aud', 'authenticated')::text, true);
    set local role authenticated;
    begin
      update public.checkins set fin_hours_in_budget = 5 where id = v_oct;
      update public.checkins set fin_hours_in_budget = 5 where id = v_sep;
    exception when others then
      problems := problems || format('(s5) the account manager''s update raised: %s %s', sqlstate, sqlerrm);
    end;
    reset role;
    perform set_config('request.jwt.claims', '', true);
    select fin_hours_in_budget into v_hours from public.checkins where id = v_oct;
    if v_hours is distinct from c_score then
      problems := problems || format('(s5) an app write of fin_hours_in_budget = 5 on October stuck as %s, expected the computed %s', v_hours, c_score);
    end if;
    select fin_hours_in_budget into v_hours from public.checkins where id = v_sep;
    if v_hours is not null then
      problems := problems || format('(s5) an app write of fin_hours_in_budget = 5 on September stuck as %s, expected null (does not apply)', v_hours);
    end if;

    --------------------------------------------------------------------------
    -- (bands) every edge, 1200 budgeted. As the owner.
    --------------------------------------------------------------------------
    for i in 1 .. array_length(band_worked, 1) loop
      perform public.record_month_budgets(v_client, oct, jsonb_set(one_budget, '{0,worked_minutes}', to_jsonb(band_worked[i])));
      select fin_hours_in_budget into v_hours from public.checkins where id = v_oct;
      if v_hours is distinct from band_expected[i] then
        problems := problems || format('(bands) worked %s of 1200 (diff %s) scored %s, expected %s',
          band_worked[i], band_worked[i] - 1200, v_hours, band_expected[i]);
      end if;
    end loop;
    perform public.record_month_budgets(v_client, oct, one_budget);

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
    select fin_hours_applies, fin_hours_in_budget, fin_score into v_applies, v_hours, v_score from public.checkins where id = v_oct;
    if v_applies is distinct from false or v_hours is not null then
      problems := problems || format('(e) deleting the link left fin_hours_applies %s and fin_hours_in_budget %s, expected false and null', v_applies, v_hours);
    end if;
    if v_score is distinct from 4.00 then
      problems := problems || format('(e) after unlinking fin_score is %s, expected 4.00', v_score);
    end if;

    --------------------------------------------------------------------------
    -- (f) September, throughout -- re-linked once more to be sure.
    --------------------------------------------------------------------------
    insert into public.client_productive_projects (client_id, productive_project_id)
    values (v_client, probe_project);
    select fin_hours_applies, fin_hours_in_budget, fin_score into v_applies, v_hours, v_score from public.checkins where id = v_sep;
    if v_applies is distinct from false or v_hours is not null then
      problems := problems || format('(f) a September check-in of a linked client has fin_hours_applies %s and fin_hours_in_budget %s, expected false and null (hours start 2026-10-01)', v_applies, v_hours);
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

  raise notice 'verify:hours OK -- fin_hours_applies and fin_hours_in_budget follow links and fetches and override callers, fin_score and overall_score switch divisors, the refresh leaves other state alone, and the new tables are gated on view_revenue';
end $$;

-- `db query` does not print RAISE NOTICE, so a pass would otherwise show only
-- an empty result. Reached only if the block above did not raise.
select 'verify:hours OK' as result;

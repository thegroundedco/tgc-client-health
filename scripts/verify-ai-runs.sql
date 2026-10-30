-- Asserts the access boundary of 20261031090000_ai_suggestion_runs.sql against
-- the live database, by becoming the `authenticated` role and running real
-- statements -- the scripts/verify-privileges.sql section 10 pattern. Run with
-- `npm run verify:ai-runs`. Raises, listing every violation, on any mismatch.
--
-- LEAVES NO DATA. Every probe runs inside one inner block that always ends by
-- raising a sentinel; its handler catches the sentinel, which rolls the whole
-- block back to its savepoint -- probe rows, the probe ai_suggestion, the
-- temporarily activated viewer, everything. Only the `problems` array (a
-- plpgsql variable, not table data) survives the rollback. Identity sequences
-- are not transactional, so ai_runs ids skip a few numbers per run; accepted.
--
-- Subjects are the fixtures scripts/seed-verifier-subjects.sql creates
-- (`npm run seed:verifier-subjects`): the active account_manager (holds
-- edit_scores) and the inactive account (role viewer). For the "a viewer cannot
-- run" check the inactive account is activated inside the rolled-back block,
-- so the answer is false because of the ROLE, not merely because the account
-- is inactive -- both are asserted.
--
-- What it checks:
--   (a) an edit_scores user cannot change a check-in's ai_suggestion (42501),
--       on update or on insert, but can change its notes, which leaves
--       ai_suggestion unchanged; the owner role (the routine's path) can.
--   (b) that user cannot insert into ai_runs, but can select from it; a user
--       with no profile sees nothing.
--   (c) public.can_run_ai_suggestions() is true for an edit_scores user and
--       false for a viewer, active or not.
--   (d) a second 'requested' run for the same period violates
--       ai_runs_one_requested_per_period (23505) even as the owner; a 'done'
--       run for that period does not.

do $$
declare
  problems  text[] := '{}';
  sentinel  constant text := 'verify-ai-runs rollback sentinel';

  am_uid      constant uuid := '5eed0000-0000-4000-8000-000000000001';
  viewer_uid  constant uuid := '5eed0000-0000-4000-8000-000000000002';
  absent_uid  constant uuid := '00000000-0000-4000-8000-00000000dead';

  probe_ai    constant jsonb := '{"probe": "verify-ai-runs", "answers": {}}';
  probe_note  constant text  := 'verify-ai-runs probe note -- must never persist';
  probe_period constant date := '1999-01-01';

  checkin_id  bigint;
  client_id_  bigint;
  got_ai      jsonb;
  got_notes   text;
  got_bool    boolean;
  n_rows      bigint;
  n_touched   bigint;
begin
  -- Preconditions, outside the probe block so a missing fixture is reported as
  -- such rather than as a violation.
  if not exists (select 1 from public.profiles where id = am_uid and is_active and role = 'account_manager') then
    raise exception 'verify:ai-runs COULD NOT RUN -- the seed account_manager % is missing or not an active account_manager; run `npm run seed:verifier-subjects` first', am_uid;
  end if;
  if not exists (select 1 from public.profiles where id = viewer_uid and role = 'viewer') then
    raise exception 'verify:ai-runs COULD NOT RUN -- the seed inactive viewer % is missing; run `npm run seed:verifier-subjects` first', viewer_uid;
  end if;
  select id, client_id into checkin_id, client_id_ from public.checkins order by id limit 1;
  if checkin_id is null then
    raise exception 'verify:ai-runs COULD NOT RUN -- public.checkins is empty, so there is no row to probe';
  end if;

  begin
    --------------------------------------------------------------------------
    -- Setup, as the owner. Doubles as the positive half of (a): the role the
    -- routine writes through must be able to set ai_suggestion.
    --------------------------------------------------------------------------
    begin
      update public.checkins set ai_suggestion = probe_ai where id = checkin_id;
    exception when others then
      problems := problems || format(
        'the OWNER role could not set ai_suggestion (%s %s) -- the guard is refusing the routine too, so no AI copy can ever be written',
        sqlstate, sqlerrm)::text;
    end;

    insert into public.ai_runs (period, source, status, summary)
    values (probe_period, 'schedule', 'done', 'verify-ai-runs probe');

    --------------------------------------------------------------------------
    -- (a), (b), (c) as the edit_scores user.
    --------------------------------------------------------------------------
    perform set_config(
      'request.jwt.claims',
      json_build_object('sub', am_uid, 'role', 'authenticated', 'aud', 'authenticated')::text,
      true);
    set local role authenticated;

    -- (a) update of ai_suggestion is refused with 42501.
    begin
      update public.checkins set ai_suggestion = '{"forged": true}' where id = checkin_id;
      get diagnostics n_touched = row_count;
      raise exception 'probe allowed (% row)', n_touched;
    exception
      when insufficient_privilege then
        if sqlerrm <> 'ai_suggestion is written only by the AI routine' then
          problems := problems || format(
            'updating ai_suggestion as an edit_scores user failed with 42501 but the wrong message (%s) -- something other than checkins_guard_ai_suggestion refused it',
            sqlerrm)::text;
        end if;
      when others then
        problems := problems || format(
          'an edit_scores user updating ai_suggestion was not refused with 42501: %s %s',
          sqlstate, sqlerrm)::text;
    end;

    -- (a) clearing it is a change too.
    begin
      update public.checkins set ai_suggestion = null where id = checkin_id;
      raise exception 'probe allowed';
    exception
      when insufficient_privilege then null;
      when others then
        problems := problems || format(
          'an edit_scores user clearing ai_suggestion was not refused with 42501: %s %s',
          sqlstate, sqlerrm)::text;
    end;

    -- (a) an insert carrying ai_suggestion is refused too.
    begin
      insert into public.checkins (client_id, period, ai_suggestion)
      values (client_id_, probe_period, '{"forged": true}');
      raise exception 'probe allowed';
    exception
      when insufficient_privilege then
        if sqlerrm <> 'ai_suggestion is written only by the AI routine' then
          problems := problems || format(
            'inserting a check-in with ai_suggestion failed with 42501 but the wrong message (%s)',
            sqlerrm)::text;
        end if;
      when others then
        problems := problems || format(
          'an edit_scores user inserting a check-in WITH ai_suggestion was not refused with 42501: %s %s',
          sqlstate, sqlerrm)::text;
    end;

    -- (a) notes alone go through and leave ai_suggestion as it was.
    begin
      update public.checkins set notes = probe_note where id = checkin_id;
      get diagnostics n_touched = row_count;
      if n_touched <> 1 then
        problems := problems || format(
          'an edit_scores user updating notes touched %s row(s), expected 1 -- checkins_update_edit_scores is refusing an ordinary save',
          n_touched)::text;
      end if;
    exception when others then
      problems := problems || format(
        'an edit_scores user could not update notes: %s %s -- the guard is blocking ordinary saves',
        sqlstate, sqlerrm)::text;
    end;

    -- (b) no write path into ai_runs.
    begin
      insert into public.ai_runs (period, source) values (probe_period, 'board');
      raise exception 'probe allowed';
    exception
      when insufficient_privilege then null;
      when others then
        problems := problems || format(
          'an edit_scores user inserting into ai_runs was not refused with 42501: %s %s',
          sqlstate, sqlerrm)::text;
    end;

    begin
      update public.ai_runs set status = 'failed' where period = probe_period;
      raise exception 'probe allowed';
    exception
      when insufficient_privilege then null;
      when others then
        problems := problems || format(
          'an edit_scores user updating ai_runs was not refused with 42501: %s %s',
          sqlstate, sqlerrm)::text;
    end;

    -- (b) but it can read, including the probe run.
    begin
      select count(*) into n_rows from public.ai_runs where period = probe_period;
      if n_rows <> 1 then
        problems := problems || format(
          'an edit_scores user sees %s probe run(s) in ai_runs, expected 1 -- ai_runs_select_view_scores is denying a view_scores user',
          n_rows)::text;
      end if;
    exception when others then
      problems := problems || format(
        'an edit_scores user could not select from ai_runs: %s %s', sqlstate, sqlerrm)::text;
    end;

    -- (c) may run.
    begin
      select public.can_run_ai_suggestions() into got_bool;
      if got_bool is distinct from true then
        problems := problems || format(
          'can_run_ai_suggestions() returned %s for an edit_scores user, expected true', got_bool)::text;
      end if;
    exception when others then
      problems := problems || format(
        'can_run_ai_suggestions() raised for an edit_scores user: %s %s -- the button would never show',
        sqlstate, sqlerrm)::text;
    end;

    reset role;

    -- (a) read back as the owner: notes moved, ai_suggestion did not.
    select ai_suggestion, notes into got_ai, got_notes from public.checkins where id = checkin_id;
    if got_ai is distinct from probe_ai then
      problems := problems || format(
        'after the edit_scores user''s probes ai_suggestion is %s, expected the owner''s probe value %s',
        got_ai, probe_ai)::text;
    end if;
    if got_notes is distinct from probe_note then
      problems := problems || format(
        'the edit_scores user''s notes update did not land (notes = %L)', got_notes)::text;
    end if;

    --------------------------------------------------------------------------
    -- (c) the viewer, inactive as seeded, then activated (as the owner, with
    -- no jwt claims so private.guard_profile_privileges lets it through).
    --------------------------------------------------------------------------
    perform set_config(
      'request.jwt.claims',
      json_build_object('sub', viewer_uid, 'role', 'authenticated', 'aud', 'authenticated')::text,
      true);
    set local role authenticated;
    select public.can_run_ai_suggestions() into got_bool;
    if got_bool is distinct from false then
      problems := problems || format(
        'can_run_ai_suggestions() returned %s for an INACTIVE viewer, expected false', got_bool)::text;
    end if;
    reset role;

    perform set_config('request.jwt.claims', '', true);
    update public.profiles set is_active = true where id = viewer_uid;

    perform set_config(
      'request.jwt.claims',
      json_build_object('sub', viewer_uid, 'role', 'authenticated', 'aud', 'authenticated')::text,
      true);
    set local role authenticated;
    begin
      select public.can_run_ai_suggestions() into got_bool;
      if got_bool is distinct from false then
        problems := problems || format(
          'can_run_ai_suggestions() returned %s for an ACTIVE viewer, expected false -- a viewer would see the run button',
          got_bool)::text;
      end if;

      -- (b) a viewer holds view_scores too, so it reads ai_runs.
      select count(*) into n_rows from public.ai_runs where period = probe_period;
      if n_rows <> 1 then
        problems := problems || format(
          'an active viewer sees %s probe run(s) in ai_runs, expected 1', n_rows)::text;
      end if;
    exception when others then
      problems := problems || format(
        'the active-viewer checks raised: %s %s', sqlstate, sqlerrm)::text;
    end;
    reset role;

    -- (b) a signed-in user with no profile (no view_scores) sees nothing, so
    --     the counts above are the policy at work, not an open table.
    perform set_config(
      'request.jwt.claims',
      json_build_object('sub', absent_uid, 'role', 'authenticated', 'aud', 'authenticated')::text,
      true);
    set local role authenticated;
    begin
      select count(*) into n_rows from public.ai_runs;
      if n_rows <> 0 then
        problems := problems || format(
          'a user with NO profile sees %s row(s) in ai_runs -- ai_runs_select_view_scores is not gating on view_scores',
          n_rows)::text;
      end if;
      select public.can_run_ai_suggestions() into got_bool;
      if got_bool is distinct from false then
        problems := problems || format(
          'can_run_ai_suggestions() returned %s for a user with no profile, expected false', got_bool)::text;
      end if;
    exception when others then
      problems := problems || format(
        'the no-profile checks raised: %s %s', sqlstate, sqlerrm)::text;
    end;
    reset role;
    perform set_config('request.jwt.claims', '', true);

    --------------------------------------------------------------------------
    -- (d) as the owner: one 'requested' run per period. The 'done' probe run
    -- above already shares probe_period, so the first 'requested' insert also
    -- proves the index is partial.
    --------------------------------------------------------------------------
    begin
      insert into public.ai_runs (period, source) values (probe_period, 'schedule');
    exception when others then
      problems := problems || format(
        'the first requested run for a period alongside a done one was refused: %s %s -- the index is not partial on status',
        sqlstate, sqlerrm)::text;
    end;

    begin
      insert into public.ai_runs (period, source) values (probe_period, 'board');
      raise exception 'probe allowed';
    exception
      when unique_violation then
        if sqlerrm not like '%ai_runs_one_requested_per_period%' then
          problems := problems || format(
            'a second requested run raised 23505 from the wrong constraint: %s', sqlerrm)::text;
        end if;
      when others then
        problems := problems || format(
          'a second requested run for the same period was not refused with 23505: %s %s',
          sqlstate, sqlerrm)::text;
    end;

    raise exception '%', sentinel;
  exception when others then
    if sqlerrm <> sentinel then
      problems := problems || format(
        'the probe block stopped early: %s %s -- the checks after that point are UNVERIFIED',
        sqlstate, sqlerrm)::text;
    end if;
  end;

  if array_length(problems, 1) > 0 then
    raise exception E'verify:ai-runs FAILED with % violation(s):\n  - %',
      array_length(problems, 1), array_to_string(problems, E'\n  - ');
  end if;

  raise notice 'verify:ai-runs OK -- ai_suggestion guarded, ai_runs read-only to app users, can_run_ai_suggestions gated on edit_scores, one requested run per period';
end $$;

-- `db query` does not print RAISE NOTICE, so a pass would otherwise show only
-- an empty result. Reached only if the block above did not raise.
select 'verify:ai-runs OK' as result;

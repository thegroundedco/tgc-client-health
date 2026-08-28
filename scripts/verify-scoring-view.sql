-- Slice 4 step 1, updated in step 2.5 for Advocacy's yes/no answers. Pins
-- public.checkin_scores: the gate, null propagation, the arithmetic (now
-- including adv_score), and the RLS boundary.
--
-- Safe to re-run. Every fixture it creates is deleted in the same transaction.
-- Aim it at STAGING -- it inserts real rows and advances clients_id_seq.

-- No psql meta-commands: `supabase db query` sends SQL over a connection, not
-- through psql, and no other script in scripts/*.sql uses one. The `do` block
-- raises on any violation, which aborts the transaction and rolls back the
-- fixtures below -- so a failed run leaves nothing behind either.

do $verify$
declare
  -- The 18 answers that are always required, and the 4 that are gated.
  c_core text[] := array[
    'comm_constructive','comm_timely','comm_consistent',
    'growth_goals_defined','growth_progress_trackable','growth_hitting_goals',
    'fin_rack_rate','fin_pays_on_time','fin_rate_increased','fin_on_terms',
    'rel_collaborative','rel_respectful','rel_fun','rel_multi_threaded',
    'del_on_time','del_quantity','del_client_likes','del_we_are_proud'];
  -- The four are boolean now (spec §3.1/§3.2, amended 2026-08-28), not
  -- smallint like c_core -- every literal written against them below is
  -- `true`/`false`/`null`, never a number. Mixing the two arrays into one
  -- (as a pre-amendment `c_all` did) would try to assign an integer into a
  -- boolean column and fail outright, which is the fastest possible way to
  -- notice this file was not updated for the type change.
  c_adv text[] := array[
    'adv_left_review','adv_case_study','adv_would_refer','adv_reference_check'];

  -- The period is FIXED and started_on is what varies. period is always the
  -- first of a month, so moving the period cannot express a one-day boundary:
  -- date_trunc('month', start + 89) collapses to 59 days after the start, and
  -- an assertion on it would pass while proving nothing about 89 vs 90.
  c_period date := date '2026-04-01';
  c_at_89 date := date '2026-01-02';  -- + 90 = 2026-04-02, a day past period
  c_at_90 date := date '2026-01-01';  -- + 90 = 2026-04-01, exactly period
  c_at_91 date := date '2025-12-31';  -- + 90 = 2026-03-31, a day before

  v_start date := c_at_90;
  v_client bigint;
  v_open bigint;      -- the check-in under test once the gate is open
  v_closed bigint;    -- a second check-in kept gated shut, for the §2 loop
  v_col text;
  v_applies boolean;
  v_overall numeric;
  v_count bigint;
  v_total bigint;
  v_inactive uuid;
  v_active uuid;
  v_set_core text;
  v_set_adv text;
begin
  -- Fixture. The name is deliberately unusable as a real client.
  insert into public.clients (name, started_on)
  values ('__verify_scoring_view__', v_start)
  returning id into v_client;

  v_set_core := (select string_agg(format('%I = 3', col), ', ') from unnest(c_core) as col);
  v_set_adv := (select string_agg(format('%I = true', col), ', ') from unnest(c_adv) as col);

  -- ============================================================ §1 the gate
  -- One check-in at a fixed period; started_on moves across the boundary.
  insert into public.checkins (client_id, period)
  values (v_client, c_period)
  returning id into v_open;

  update public.clients set started_on = c_at_89 where id = v_client;
  select advocacy_applies into v_applies
    from public.checkin_scores where id = v_open;
  if v_applies is not false then
    raise exception '§1 FAILED: gate open at 89 days (got %)', v_applies;
  end if;

  update public.clients set started_on = c_at_90 where id = v_client;
  select advocacy_applies into v_applies
    from public.checkin_scores where id = v_open;
  if v_applies is not true then
    raise exception '§1 FAILED: gate shut at exactly 90 days (got %)', v_applies;
  end if;

  update public.clients set started_on = c_at_91 where id = v_client;
  select advocacy_applies into v_applies
    from public.checkin_scores where id = v_open;
  if v_applies is not true then
    raise exception '§1 FAILED: gate shut at 91 days (got %)', v_applies;
  end if;

  -- A null start date must never open the gate.
  update public.clients set started_on = null where id = v_client;
  select advocacy_applies into v_applies
    from public.checkin_scores where id = v_open;
  if v_applies is not false then
    raise exception '§1 FAILED: null started_on opened the gate (got %)', v_applies;
  end if;

  -- Settle on the open state for §2 and §3, and add the gated-shut check-in the
  -- §2 loop needs. Its period is well before the start date, so it stays shut.
  update public.clients set started_on = c_at_90 where id = v_client;
  insert into public.checkins (client_id, period)
  values (v_client, date '2025-06-01')
  returning id into v_closed;

  select advocacy_applies into v_applies
    from public.checkin_scores where id = v_closed;
  if v_applies is not false then
    raise exception '§1 FAILED: the gated-shut fixture is open (got %)', v_applies;
  end if;

  raise notice '§1 ok: shut at 89d, open at exactly 90d and at 91d, shut on a null start date';

  -- ================================================ §2 null propagation, 44
  -- Fill both check-ins completely -- the 18 core answers to 3, the 4
  -- Advocacy answers to true -- then null one answer at a time. Two separate
  -- update lists because the two arrays hold different SQL types (see the
  -- c_adv declaration above).
  execute format('update public.checkins set %s, %s where id in ($1, $2)', v_set_core, v_set_adv)
    using v_open, v_closed;

  -- Gate OPEN, the 18 core answers: nulling any one must null the overall.
  foreach v_col in array c_core loop
    execute format('update public.checkins set %I = null where id = $1', v_col) using v_open;
    select overall_score into v_overall from public.checkin_scores where id = v_open;
    if v_overall is not null then
      raise exception '§2 FAILED: gate open, core % nulled, overall still % ', v_col, v_overall;
    end if;
    execute format('update public.checkins set %I = 3 where id = $1', v_col) using v_open;
  end loop;

  -- Gate OPEN, the 4 Advocacy answers: nulling one must leave the overall
  -- UNCHANGED at 3.00 -- not merely non-null. Spec §3.2 as amended: Advocacy
  -- left overall_score entirely, so it must not affect the score whether the
  -- gate is open or shut. This is the case that would catch a reversion to
  -- the old 22-divisor: a view that still folded Advocacy into the overall's
  -- denominator (with coalesce(.., 0) masking the null) would score 2.86 here
  -- for the gate-open case and pass a not-null-only check; asserting the
  -- exact value catches it even when the gate is open.
  foreach v_col in array c_adv loop
    execute format('update public.checkins set %I = null where id = $1', v_col) using v_open;
    select overall_score into v_overall from public.checkin_scores where id = v_open;
    if v_overall is distinct from 3.00 then
      raise exception
        '§2 FAILED: gate open, Advocacy % nulled, overall moved to % (expected '
        'unchanged 3.00). An Advocacy answer must not affect the score at all, '
        'gate open or shut -- this is the 22-divisor regression case.',
        v_col, v_overall;
    end if;
    execute format('update public.checkins set %I = true where id = $1', v_col) using v_open;
  end loop;

  -- Gate CLOSED, the 18 core answers: nulling any one must null the overall.
  foreach v_col in array c_core loop
    execute format('update public.checkins set %I = null where id = $1', v_col) using v_closed;
    select overall_score into v_overall from public.checkin_scores where id = v_closed;
    if v_overall is not null then
      raise exception '§2 FAILED: gate closed, core % nulled, overall still %', v_col, v_overall;
    end if;
    execute format('update public.checkins set %I = 3 where id = $1', v_col) using v_closed;
  end loop;

  -- Gate CLOSED, the 4 Advocacy answers: same assertion as the gate-open arm
  -- above, repeated here because "in either gate state" is the whole point --
  -- a fix that only special-cased the open gate would still pass a check that
  -- looked only at the shut one.
  foreach v_col in array c_adv loop
    execute format('update public.checkins set %I = null where id = $1', v_col) using v_closed;
    select overall_score into v_overall from public.checkin_scores where id = v_closed;
    if v_overall is distinct from 3.00 then
      raise exception
        '§2 FAILED: gate closed, Advocacy % nulled, overall moved to % (expected '
        'unchanged 3.00). An Advocacy answer must not affect the score at all '
        'while the gate is shut, not merely avoid nulling it.', v_col, v_overall;
    end if;
    execute format('update public.checkins set %I = true where id = $1', v_col) using v_closed;
  end loop;

  raise notice '§2 ok: 44 null cases; the four Advocacy answers never affect overall_score in either gate state';

  -- ======================================================== §3 arithmetic
  -- All 3s is exactly 3.00 in both gate states.
  select overall_score into v_overall from public.checkin_scores where id = v_open;
  if v_overall is distinct from 3.00 then
    raise exception '§3 FAILED: all-3s gate open gave %, expected 3.00', v_overall;
  end if;
  select overall_score into v_overall from public.checkin_scores where id = v_closed;
  if v_overall is distinct from 3.00 then
    raise exception '§3 FAILED: all-3s gate closed gave %, expected 3.00', v_overall;
  end if;

  -- The vector where the two weightings disagree (spec §3.2, amended
  -- 2026-08-28: overall_score is the mean of the EIGHTEEN core answers, never
  -- of the five remaining bucket means -- Advocacy already left both
  -- entirely, so this check no longer touches it). Communication all 5s, the
  -- other 15 core questions all 2s:
  --   question-equal (correct): (3*5 + 15*2) / 18 = 45 / 18 = 2.50
  --   bucket-equal   (wrong):   (5 + 2 + 2 + 2 + 2) / 5 = 13 / 5 = 2.60
  execute format(
    'update public.checkins set %s where id = $1',
    (select string_agg(format('%I = 2', col), ', ') from unnest(c_core) as col)
  ) using v_open;
  update public.checkins
     set comm_constructive = 5, comm_timely = 5, comm_consistent = 5
   where id = v_open;

  select overall_score into v_overall from public.checkin_scores where id = v_open;
  if v_overall is distinct from 2.50 then
    raise exception
      '§3 FAILED: weighting vector gave %, expected 2.50. 2.60 means the overall '
      'reverted to averaging the five remaining bucket means instead of the '
      'eighteen answers.',
      v_overall;
  end if;

  raise notice '§3 ok: 3.00 in both gate states, and 2.50 not 2.60 on the weighting vector';

  -- ==================================================== §3b adv_score
  -- adv_score is a generated column on checkins and a pass-through column on
  -- checkin_scores, even though it never enters overall_score (spec §3.2).
  -- Restore the core answers to all-3s first, so the overall_score assertion
  -- below is checking against a known baseline rather than the weighting
  -- vector this block inherited.
  execute format('update public.checkins set %s where id = $1', v_set_core) using v_open;

  -- Four Nos: 1 + zero yeses = 1.00 -- distinct from null, which is what an
  -- unanswered Advocacy question scores. Conflating the two would let a
  -- client who answered "No" four times read identically to one who was
  -- never asked.
  execute format(
    'update public.checkins set %s where id = $1',
    (select string_agg(format('%I = false', col), ', ') from unnest(c_adv) as col)
  ) using v_open;

  select adv_score into v_overall from public.checkin_scores where id = v_open;
  if v_overall is distinct from 1.00 then
    raise exception '§3b FAILED: four Nos gave adv_score %, expected 1.00', v_overall;
  end if;

  -- Three Yeses and one unanswered: null propagates through adv_score exactly
  -- as it does through overall_score for the eighteen.
  update public.checkins
     set adv_left_review = true, adv_case_study = true, adv_would_refer = true,
         adv_reference_check = null
   where id = v_open;

  select adv_score into v_overall from public.checkin_scores where id = v_open;
  if v_overall is not null then
    raise exception
      '§3b FAILED: three Yeses and one unanswered gave adv_score %, expected null',
      v_overall;
  end if;

  -- Restore to fully answered, and confirm overall_score never moved through
  -- any of the adv_score arithmetic above -- Advocacy is not part of it at
  -- all, in either direction.
  execute format('update public.checkins set %s where id = $1', v_set_adv) using v_open;

  select overall_score into v_overall from public.checkin_scores where id = v_open;
  if v_overall is distinct from 3.00 then
    raise exception
      '§3b FAILED: overall_score read % while adv_score was under test '
      '(expected unchanged 3.00 -- Advocacy must not leak into it)',
      v_overall;
  end if;

  raise notice '§3b ok: adv_score is 1.00 on four Nos, null on three Yeses and a blank, and overall_score never moved';

  -- ============================================================== §4 RLS
  -- WHY THIS SECTION EXISTS: without `with (security_invoker = true)` the view
  -- runs as its owner, every RLS policy on checkins and clients is bypassed,
  -- and any signed-in account reads every client's scores. From the application
  -- the two are indistinguishable. This is the db:which failure class -- a
  -- guard whose absence looks exactly like its presence.
  --
  -- Read as the OWNER first, before switching role, and RAISE (not notice) on
  -- every COULD NOT VERIFY branch below: a `raise notice` here is invisible
  -- through `supabase db query` (measured -- see the closing comment of this
  -- file), so it would exit 0 and echo the same row as a real pass. Against an
  -- empty project v_total = 0 and "an inactive account read 0 rows" would pass
  -- no matter what the policy says -- the same empty-table trap
  -- verify-privileges.sql guards against.
  select count(*) into v_total from public.checkin_scores;
  if v_total = 0 then
    raise exception
      '§4 COULD NOT VERIFY: public.checkin_scores has zero rows visible to the '
      'owner, so neither the inactive- nor the active-account assertion below '
      'can prove anything. This should not happen mid-run -- the fixtures '
      'inserted above are still live at this point -- so something upstream is '
      'wrong. NOT A PASS.';
  end if;

  if not exists (select 1 from public.profiles where is_active = false) then
    raise exception
      '§4 COULD NOT VERIFY: no inactive profile on this project, so the '
      'negative-arm assertion could not run. NOT A PASS. Create an inactive '
      'profile and re-run.';
  end if;

  if not exists (select 1 from public.profiles where is_active = true) then
    raise exception
      '§4 COULD NOT VERIFY: no active profile on this project, so the '
      'positive-arm assertion could not run. NOT A PASS. Create an active '
      'profile and re-run.';
  end if;

  -- Negative arm: an INACTIVE account must read zero rows.
  select id into v_inactive from public.profiles where is_active = false limit 1;
  set local role authenticated;
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_inactive, 'role', 'authenticated')::text, true);

  select count(*) into v_count from public.checkin_scores;

  reset role;
  if v_count <> 0 then
    raise exception
      '§4 FAILED: an inactive account read % of % row(s) through '
      'checkin_scores. The view is almost certainly missing security_invoker.',
      v_count, v_total;
  end if;

  -- Positive arm: an ACTIVE account must read every row the owner does. Without
  -- this arm the section above would pass identically if a later migration
  -- revoked authenticated's grant on the view entirely -- every reader, active
  -- or not, would read zero rows, and only the negative assertion would be
  -- checked, vacuously.
  select id into v_active from public.profiles where is_active = true limit 1;
  set local role authenticated;
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_active, 'role', 'authenticated')::text, true);

  select count(*) into v_count from public.checkin_scores;

  reset role;
  if v_count is distinct from v_total then
    raise exception
      '§4 FAILED: an active account read % of % row(s) through checkin_scores '
      '(expected all of them -- the active-user policy carries no ownership '
      'restriction). Either the view''s grant to authenticated or the RLS '
      'policy on clients/checkins is broken for every reader.',
      v_count, v_total;
  end if;

  raise notice
    '§4 ok: owner sees % row(s); an inactive account reads zero; an active '
    'account reads all %', v_total, v_total;

  -- Fixtures go, including the check-ins, which cascade from the client.
  delete from public.clients where id = v_client;
  raise notice 'verify:scoring-view PASSED';
end
$verify$;

-- A NOTICE is invisible through `supabase db query` (measured), so the evidence
-- of a pass is exit 0 plus this echoed row.
select 'verify:scoring-view completed' as result;

-- Slice 4 step 1. Pins public.checkin_scores: the gate, null propagation, the
-- arithmetic, and the RLS boundary.
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
  c_adv text[] := array[
    'adv_left_review','adv_case_study','adv_would_refer','adv_reference_check'];
  c_all text[] := c_core || c_adv;

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
  v_set text;
begin
  -- Fixture. The name is deliberately unusable as a real client.
  insert into public.clients (name, started_on)
  values ('__verify_scoring_view__', v_start)
  returning id into v_client;

  v_set := (select string_agg(format('%I = 3', col), ', ') from unnest(c_all) as col);

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
  -- Fill both check-ins completely, then null one answer at a time.
  execute format('update public.checkins set %s where id in ($1, $2)', v_set)
    using v_open, v_closed;

  -- Gate OPEN: nulling any of the 22 must null the overall.
  foreach v_col in array c_all loop
    execute format('update public.checkins set %I = null where id = $1', v_col) using v_open;
    select overall_score into v_overall from public.checkin_scores where id = v_open;
    if v_overall is not null then
      raise exception '§2 FAILED: gate open, % nulled, overall still % ', v_col, v_overall;
    end if;
    execute format('update public.checkins set %I = 3 where id = $1', v_col) using v_open;
  end loop;

  -- Gate CLOSED: the 18 core answers null it; the 4 Advocacy answers must not.
  foreach v_col in array c_core loop
    execute format('update public.checkins set %I = null where id = $1', v_col) using v_closed;
    select overall_score into v_overall from public.checkin_scores where id = v_closed;
    if v_overall is not null then
      raise exception '§2 FAILED: gate closed, core % nulled, overall still %', v_col, v_overall;
    end if;
    execute format('update public.checkins set %I = 3 where id = $1', v_col) using v_closed;
  end loop;

  -- An Advocacy answer nulled while the gate is shut must leave the score
  -- UNCHANGED at 3.00, not merely non-null. A view that folded a nulled
  -- Advocacy answer into the 22-question denominator with coalesce(.., 0)
  -- would still return a non-null number here (e.g. 2.86) and pass a
  -- not-null-only check; asserting the exact value catches that.
  foreach v_col in array c_adv loop
    execute format('update public.checkins set %I = null where id = $1', v_col) using v_closed;
    select overall_score into v_overall from public.checkin_scores where id = v_closed;
    if v_overall is distinct from 3.00 then
      raise exception
        '§2 FAILED: gate closed, Advocacy % nulled, overall moved to % (expected '
        'unchanged 3.00). An Advocacy answer must not affect the score at all '
        'while the gate is shut, not merely avoid nulling it.', v_col, v_overall;
    end if;
    execute format('update public.checkins set %I = 3 where id = $1', v_col) using v_closed;
  end loop;

  raise notice '§2 ok: 44 null cases, Advocacy required only when the gate is open';

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

  -- The vector where the two weightings disagree (spec §3.2). Communication all
  -- 5s, the other 19 questions all 2s:
  --   question-equal (correct): (3*5 + 19*2) / 22 = 53 / 22 = 2.41
  --   bucket-equal   (wrong):   (5 + 2 + 2 + 2 + 2 + 2) / 6 = 2.50
  execute format(
    'update public.checkins set %s where id = $1',
    (select string_agg(format('%I = 2', col), ', ') from unnest(c_all) as col)
  ) using v_open;
  update public.checkins
     set comm_constructive = 5, comm_timely = 5, comm_consistent = 5
   where id = v_open;

  select overall_score into v_overall from public.checkin_scores where id = v_open;
  if v_overall is distinct from 2.41 then
    raise exception
      '§3 FAILED: weighting vector gave %, expected 2.41. 2.50 means the overall '
      'reverted to averaging the six bucket means instead of the 22 answers.',
      v_overall;
  end if;

  raise notice '§3 ok: 3.00 in both gate states, and 2.41 not 2.50 on the weighting vector';

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

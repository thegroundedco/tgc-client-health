-- Hours within budget is scored by the database (brief 2026-11-05 A).
--
-- The owner, after reviewing the live check-in: no options to pick for "Hours
-- within budget" -- the screen shows "X / X budgeted hours" and the score comes
-- from the tiers. When the tool cannot score it, it is unscored (with a note on
-- screen), which means the question does NOT apply: it never blocks completion
-- and Finances averages its other three answers.
--
-- So the database owns BOTH values on the check-in row:
--   * checkins.fin_hours_applies, from private.hours_applies (rule replaced
--     below), and
--   * checkins.fin_hours_in_budget, from the new private.hours_score.
-- The app and the AI routine never write fin_hours_in_budget; whatever they
-- send is overwritten by the BEFORE trigger.
--
-- THE RULE. The hours question applies to (client, period) only when all hold:
--   1. period >= 2026-10-01 (HOURS_START_PERIOD in src/lib/buckets.ts);
--   2. the client has a row in client_productive_projects;
--   3. there is a client_month_hours_fetch row for (client, period) whose
--      fetched_at, as a date in America/Denver, is on or after the 1st of the
--      next month -- the data was fetched after the month ended;
--   4. there is exactly ONE client_month_budgets row for (client, period);
--   5. that row's starts_on is the period (not a part-month).
-- Its score, from diff = worked_minutes - budgeted_minutes:
--   5 if -360 <= diff <= 360; 3 if -480 <= diff < -360;
--   2 if -600 <= diff < -480 or 360 < diff <= 480; 1 otherwise.
-- Null when it does not apply. src/checkin/hoursFromBudgets.ts mirrors this
-- rule exactly, for the screen.
--
-- What changed from 20261104120000: "linked but never fetched" no longer
-- applies (it was answered by hand; there is no hand now), and two budgets, a
-- part-month and a month fetched before it ended no longer apply either.
--
-- REFRESH TRIGGERS. Unchanged in shape: the refresh fires on
-- client_productive_projects and client_month_hours_fetch. There is still no
-- trigger on client_month_budgets, and none is needed: budgets are written only
-- through public.record_month_budgets, which writes the fetch row LAST, so the
-- fetch trigger's refresh sees the new budget rows and re-scores. A re-fetch
-- always moves fetched_at, so it always fires the refresh.
--
-- updated_at, ai_suggestion and the rest: as 20261104120000's header says. The
-- refresh and the backfill touch only rows where either column would change,
-- and set nothing else.

----------------------------------------------------------------------------
-- 1. Whether the hours question applies
----------------------------------------------------------------------------

-- Same signature, so the triggers and hours_score bind to it unchanged.
-- Definer so the triggers can read the three tables whoever fired them;
-- nobody may call it directly.
create or replace function private.hours_applies(p_client_id bigint, p_period date)
returns boolean
language sql
stable
security definer
set search_path = ''
return p_period >= date '2026-10-01'
  and exists (select 1 from public.client_productive_projects l where l.client_id = p_client_id)
  and exists (select 1 from public.client_month_hours_fetch f
              where f.client_id = p_client_id and f.period = p_period
                and (f.fetched_at at time zone 'America/Denver')::date >= (p_period + interval '1 month')::date)
  and (select count(*) from public.client_month_budgets b
       where b.client_id = p_client_id and b.period = p_period) = 1
  and exists (select 1 from public.client_month_budgets b
              where b.client_id = p_client_id and b.period = p_period and b.starts_on = p_period);

revoke execute on function private.hours_applies(bigint, date) from public, anon, authenticated;

----------------------------------------------------------------------------
-- 2. The score
----------------------------------------------------------------------------

-- Null unless hours_applies, which guarantees exactly one budget row, so the
-- scalar subquery returns at most one row. Integer minutes throughout, so the
-- band edges are exact.
create function private.hours_score(p_client_id bigint, p_period date)
returns smallint
language sql
stable
security definer
set search_path = ''
return (
  select (case
    when d.diff >= -360 and d.diff <= 360 then 5
    when d.diff >= -480 and d.diff < -360 then 3
    when (d.diff >= -600 and d.diff < -480) or (d.diff > 360 and d.diff <= 480) then 2
    else 1
  end)::smallint
  from (select b.worked_minutes - b.budgeted_minutes as diff
        from public.client_month_budgets b
        where b.client_id = p_client_id and b.period = p_period) d
  where private.hours_applies(p_client_id, p_period)
);

revoke execute on function private.hours_score(bigint, date) from public, anon, authenticated;

----------------------------------------------------------------------------
-- 3. Keeping both columns derived
----------------------------------------------------------------------------

-- On every insert and update of a check-in, whatever the caller sent. BEFORE,
-- so fin_score (generated) sees both values.
create or replace function private.set_fin_hours_applies()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  new.fin_hours_applies := private.hours_applies(new.client_id, new.period);
  new.fin_hours_in_budget := private.hours_score(new.client_id, new.period);
  return new;
end;
$$;

revoke execute on function private.set_fin_hours_applies() from public, anon, authenticated;

-- When a link is added or removed, or a month is (re)fetched. Only rows where
-- either value changes are updated, so updated_at moves on exactly those.
create or replace function private.refresh_fin_hours_applies()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_old bigint;
  v_new bigint;
begin
  if tg_op in ('UPDATE', 'DELETE') then v_old := old.client_id; end if;
  if tg_op in ('INSERT', 'UPDATE') then v_new := new.client_id; end if;

  update public.checkins ch
  set fin_hours_applies = private.hours_applies(ch.client_id, ch.period),
      fin_hours_in_budget = private.hours_score(ch.client_id, ch.period)
  where ch.client_id in (v_old, v_new)
    and ch.period >= date '2026-10-01'
    and (ch.fin_hours_applies is distinct from private.hours_applies(ch.client_id, ch.period)
         or ch.fin_hours_in_budget is distinct from private.hours_score(ch.client_id, ch.period));

  return null;
end;
$$;

revoke execute on function private.refresh_fin_hours_applies() from public, anon, authenticated;

----------------------------------------------------------------------------
-- 4. Backfill
----------------------------------------------------------------------------

-- Every row from the start month whose stored values disagree with the rule:
-- a hand-picked or AI-written hours answer becomes the computed score, or null
-- where the question no longer applies. Rows that already agree are not
-- touched, so their updated_at does not move.
update public.checkins
set fin_hours_applies = private.hours_applies(client_id, period),
    fin_hours_in_budget = private.hours_score(client_id, period)
where period >= date '2026-10-01'
  and (fin_hours_applies is distinct from private.hours_applies(client_id, period)
       or fin_hours_in_budget is distinct from private.hours_score(client_id, period));

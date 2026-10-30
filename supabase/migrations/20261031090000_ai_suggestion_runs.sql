-- AI suggestion runs (spec docs/superpowers/specs/2026-10-30-ai-suggestion-runs-design.md §2).
--
-- Three things:
--   1. checkins.ai_suggestion -- the AI's own copy of what it last suggested
--      for a check-in, so "Revert to AI suggested scores" has something to
--      revert to after a person has edited the answers. Written only by the
--      routine; a trigger refuses any change from the two API roles.
--   2. public.ai_runs -- one row per requested run. App users may read it and
--      nothing else; the Edge Function writes it with the service role and the
--      routine through the Supabase connector.
--   3. public.can_run_ai_suggestions() -- whether the caller may start a run,
--      so the app can decide whether to show the button.

alter table public.checkins add column ai_suggestion jsonb;

comment on column public.checkins.ai_suggestion is
  'The AI routine''s latest suggestion for this check-in: {suggested_at, run_id, '
  'notes, answers}. answers holds the 19 scored answers (every answer except '
  'fin_rack_rate and fin_rate_increased). Written only by the routine; no save '
  'writes or clears it.';

-- The backfill. Rows a person has saved since the AI wrote them have lost the
-- AI's values, so nothing can be recovered for them. Rows still suggested
-- (suggested_at not null) still hold exactly what the AI wrote, so copy them.
-- run_id is null: those rows predate ai_runs.
--
-- The 19 keys are every answer column in src/lib/buckets.ts ALL_QUESTIONS
-- except fin_rack_rate and fin_rate_increased, which the tool fills from
-- revenue data and the AI never scores. tests/aiRunsMigration.test.ts derives
-- the list from ALL_QUESTIONS and checks each key is here.
--
-- One statement. It runs before the guard trigger exists, and as the migration
-- role, not authenticated/anon, so the guard would not refuse it anyway.
update public.checkins
set ai_suggestion = jsonb_build_object(
  'suggested_at', suggested_at,
  'run_id', null,
  'notes', notes,
  'answers', jsonb_build_object(
    'comm_constructive', comm_constructive,
    'comm_timely', comm_timely,
    'comm_consistent', comm_consistent,
    'growth_goals_defined', growth_goals_defined,
    'growth_progress_trackable', growth_progress_trackable,
    'growth_hitting_goals', growth_hitting_goals,
    'fin_pays_on_time', fin_pays_on_time,
    'rel_collaborative', rel_collaborative,
    'rel_respectful', rel_respectful,
    'rel_fun', rel_fun,
    'rel_multi_threaded', rel_multi_threaded,
    'del_on_time', del_on_time,
    'del_quantity', del_quantity,
    'del_client_likes', del_client_likes,
    'del_we_are_proud', del_we_are_proud,
    'adv_left_review', adv_left_review,
    'adv_case_study', adv_case_study,
    'adv_would_refer', adv_would_refer,
    'adv_reference_check', adv_reference_check
  )
)
where suggested_at is not null;

-- The guard. checkins carries a table-wide update grant to authenticated
-- (20260821021840) and checkins_update_edit_scores lets any scorer update a
-- row, so without this any scorer could overwrite the AI's copy through the
-- REST API and revert would bring back their values instead.
--
-- security invoker on purpose: current_user must be the caller's role. Under
-- security definer it would be the function owner and the check would never
-- fire. The routine (Supabase connector) and the Edge Function (service_role)
-- are neither authenticated nor anon, so they pass.
--
-- Insert is covered too: the check-in screen upserts, and an insert carrying a
-- non-null ai_suggestion would otherwise plant one on a new row.
create function private.guard_ai_suggestion()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if current_user in ('authenticated', 'anon') then
    if (tg_op = 'INSERT' and new.ai_suggestion is not null)
       or (tg_op = 'UPDATE' and new.ai_suggestion is distinct from old.ai_suggestion) then
      raise exception 'ai_suggestion is written only by the AI routine'
        using errcode = '42501';
    end if;
  end if;
  return new;
end;
$$;

-- A trigger function needs no EXECUTE for the trigger to fire, so nobody gets
-- one (the profiles guard in 20260825202320 does the same).
revoke execute on function private.guard_ai_suggestion() from public, anon, authenticated;

create trigger checkins_guard_ai_suggestion
  before insert or update on public.checkins
  for each row execute function private.guard_ai_suggestion();

-- Runs.
create table public.ai_runs (
  id                   bigint generated always as identity primary key,
  period               date not null,
  client_ids           bigint[] null,
  overwrite_client_ids bigint[] not null default '{}',
  source               text not null check (source in ('board', 'checkin', 'schedule')),
  requested_by         uuid null references public.profiles(id),
  requested_by_name    text null,
  requested_at         timestamptz not null default now(),
  session_url          text null,
  finished_at          timestamptz null,
  status               text not null default 'requested' check (status in ('requested', 'done', 'failed')),
  summary              text null
);

comment on table public.ai_runs is
  'One row per AI suggestion run. Written by the run-ai-suggestions Edge Function '
  '(service role) and the routine; app users may only read.';
comment on column public.ai_runs.client_ids is
  'Null means every client on the board for period; otherwise exactly these.';
comment on column public.ai_runs.overwrite_client_ids is
  'Manually scored clients the requester ticked to be overwritten.';

-- One run in flight per month. A second request while one is 'requested' fails
-- with 23505, which the Edge Function turns into "already running". Stale
-- 'requested' rows (older than 30 minutes) are the Edge Function's business:
-- it marks them failed before inserting.
create unique index ai_runs_one_requested_per_period on public.ai_runs (period) where status = 'requested';

-- Revoke before grant (20260820232223, rule 1). Select only: no insert, update
-- or delete grant and no write policy for anon or authenticated.
revoke all on public.ai_runs from anon, authenticated;
grant select on public.ai_runs to authenticated;

alter table public.ai_runs enable row level security;

create policy ai_runs_select_view_scores
  on public.ai_runs
  for select
  to authenticated
  using ((select private.has_capability('view_scores')));

-- Whether the caller may start a run. edit_scores, because a run writes scores.
--
-- SQL-standard body (`return ...`), not a quoted one, and that is load-bearing.
-- A quoted SQL body is parsed at call time as the caller, and authenticated
-- has no USAGE on schema private (20260821021840), so it would fail with
-- "permission denied for schema private". A standard body is parsed once at
-- create time and stores the function by OID, so the caller needs only EXECUTE
-- on private.has_capability, which authenticated has -- the same way a policy
-- calls it.
create function public.can_run_ai_suggestions()
returns boolean
language sql
security invoker
stable
set search_path = ''
return private.has_capability('edit_scores');

revoke execute on function public.can_run_ai_suggestions() from public, anon;
grant execute on function public.can_run_ai_suggestions() to authenticated;

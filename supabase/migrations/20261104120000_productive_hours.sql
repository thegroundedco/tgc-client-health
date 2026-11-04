-- Productive budget hours in Finances and Hours. The database half.
--
-- Spec: docs/superpowers/specs/2026-11-04-productive-budget-hours-design.md
-- (sections 4 to 8).
--
-- Four things:
--   1. Three tables: which Productive projects belong to a client
--      (client_productive_projects), the fixed monthly budgets found for a
--      client's month (client_month_budgets), and when that month was last
--      fetched (client_month_hours_fetch).
--   2. public.record_month_budgets(), the one write path for budgets and fetch
--      stamps, for the edge function (service_role); and
--      public.can_view_revenue(), so the edge function can ask whether its
--      caller may see hours before fetching them.
--   3. checkins.fin_hours_in_budget, the new answer, and
--      checkins.fin_hours_applies, whether it counts.
--   4. fin_score and checkin_scores.overall_score rebuilt to divide by 4 / 18
--      when the hours question applies and by 3 / 17 when it does not.
--
-- WHY fin_hours_applies IS A STORED COLUMN. fin_score is a generated column,
-- and a generated column may read only its own row -- not another table. The
-- board and the AI routine read the row (and checkin_scores) too. So whether
-- the question applies has to be ON the row. It is kept derived from data, not
-- from the browser: a BEFORE trigger (checkins_set_fin_hours_applies) sets it
-- on every insert and update from private.hours_applies(), whatever the caller
-- sent, and AFTER triggers on the link and fetch tables refresh it on existing
-- check-ins when a link is added or removed or a month is (re)fetched. A
-- person never has to re-save for the score to follow (review focus 3).
-- private.hours_applies() mirrors rules 1-4 of src/checkin/hoursFromBudgets.ts:
-- before 2026-10-01 never; not linked, no; linked but never fetched, yes (the
-- "couldn't reach Productive" case, answered by hand); fetched, yes only if a
-- budget row exists.
--
-- WHAT THE REFRESH DOES TO checkins.updated_at (and to everything else).
-- public.checkins has two BEFORE triggers besides the new one:
--   * checkins_touch_updated_at sets updated_at = now() on every UPDATE. So a
--     refresh MOVES updated_at, to the moment the link changed or the month was
--     fetched, on exactly the check-ins whose fin_hours_applies flipped -- and
--     on no others, because the refresh and the backfill both update only rows
--     where the value is distinct from the new one. That is honest: those rows'
--     fin_score really did change then. The visible effect is the check-in
--     screen's "Draft saved <time>" line reading the refresh time for a draft
--     whose applicability flipped. Nothing else reads checkins.updated_at
--     (20261029120000's suggested_at backfill used it once and is done).
--   * checkins_guard_ai_suggestion refuses a change to ai_suggestion by the
--     `authenticated` or `anon` role. The refresh runs as the definer (the
--     migration owner), not as either, and never sets ai_suggestion, so the
--     guard passes it -- including when an account manager's link insert is
--     what fires it.
--   The refresh sets fin_hours_applies and nothing else: suggested_at,
--   submitted_at, submitted_by, notes and ai_suggestion are untouched, so an
--   AI-suggested row stays suggested and a submitted row stays submitted.
--   scripts/verify-hours.sql asserts all of this against a real database.
--
-- Budgets are written only through record_month_budgets, which always
-- upserts the fetch stamp last, so the fetch trigger's refresh sees the new
-- budget rows. There is no trigger on client_month_budgets itself; a direct
-- write there by service_role would not refresh check-ins until the next fetch.

----------------------------------------------------------------------------
-- 1. Tables
----------------------------------------------------------------------------

-- A client's Productive projects, zero or more (spec 5). A Productive project
-- belongs to at most one client, hence the unique. on delete RESTRICT, like
-- every table here and like client_retainers: a client with hours history
-- refuses deletion; the operator sets status = 'former' instead.
-- productive_project_id is the number from the project's URL, as text, with no
-- leading zero: Productive returns ids without one, and the edge function
-- refuses a deal whose project id is not exactly a linked id, so '0123' would
-- fail every fetch for the client.
create table public.client_productive_projects (
  client_id             bigint not null,
  productive_project_id text   not null check (productive_project_id ~ '^[1-9][0-9]*$'),
  created_at            timestamptz not null default now(),
  primary key (client_id, productive_project_id),
  unique (productive_project_id),
  constraint client_productive_projects_client_id_fkey
    foreign key (client_id) references public.clients(id) on delete restrict
);

comment on table public.client_productive_projects is
  'Which Productive projects belong to a client. No row means not linked to Productive, and the hours question does not apply.';

-- One row per (client, month, Productive budget), the fixed monthly budgets
-- only (spec 4). Minutes, as Productive gives them. period is the first of the
-- month, same check as checkins.
create table public.client_month_budgets (
  client_id             bigint  not null,
  period                date    not null check (period = date_trunc('month', period::timestamp)::date),
  productive_deal_id    text    not null,
  productive_project_id text    not null,
  name                  text    not null,
  starts_on             date    not null,
  ends_on               date    not null,
  budgeted_minutes      integer not null check (budgeted_minutes > 0),
  worked_minutes        integer not null check (worked_minutes >= 0),
  primary key (client_id, period, productive_deal_id),
  constraint client_month_budgets_client_id_fkey
    foreign key (client_id) references public.clients(id) on delete restrict
);

comment on table public.client_month_budgets is
  'Fixed monthly Productive budgets for a client''s month, in MINUTES. Written only by record_month_budgets.';

-- When a client's month was last fetched from Productive. No row means never
-- fetched; a row with no budget rows means fetched and there is no fixed
-- monthly budget.
create table public.client_month_hours_fetch (
  client_id  bigint      not null,
  period     date        not null check (period = date_trunc('month', period::timestamp)::date),
  fetched_at timestamptz not null,
  primary key (client_id, period),
  constraint client_month_hours_fetch_client_id_fkey
    foreign key (client_id) references public.clients(id) on delete restrict
);

comment on table public.client_month_hours_fetch is
  'When a client''s month was last fetched from Productive. Written only by record_month_budgets.';

----------------------------------------------------------------------------
-- 2. Privileges and RLS on the tables
----------------------------------------------------------------------------

-- Revoke first: on this project a new table in public can be born writable by
-- anon and authenticated. service_role is declared, not inherited (see
-- 20260821040500): record_month_budgets is security invoker and runs as it.
revoke all on public.client_productive_projects from anon, authenticated;
grant select, insert, delete on public.client_productive_projects to authenticated;
grant all on public.client_productive_projects to service_role;

revoke all on public.client_month_budgets from anon, authenticated;
grant select on public.client_month_budgets to authenticated;
grant all on public.client_month_budgets to service_role;

revoke all on public.client_month_hours_fetch from anon, authenticated;
grant select on public.client_month_hours_fetch to authenticated;
grant all on public.client_month_hours_fetch to service_role;

alter table public.client_productive_projects enable row level security;
alter table public.client_month_budgets enable row level security;
alter table public.client_month_hours_fetch enable row level security;

-- Links: read by whoever sees the hours (view_revenue) or manages clients
-- (the Clients admin setting). Added and removed with manage_clients. No
-- update: a wrong link is removed and re-added.
create policy client_productive_projects_select_view_revenue_or_manage_clients
  on public.client_productive_projects
  for select
  to authenticated
  using ((select private.has_capability('view_revenue')) or (select private.has_capability('manage_clients')));

create policy client_productive_projects_insert_manage_clients
  on public.client_productive_projects
  for insert
  to authenticated
  with check ((select private.has_capability('manage_clients')));

create policy client_productive_projects_delete_manage_clients
  on public.client_productive_projects
  for delete
  to authenticated
  using ((select private.has_capability('manage_clients')));

-- Budgets and fetch stamps: read with view_revenue, the same people who see
-- the revenue-based Finances answers (spec 6). No app writes: no write grant
-- and no write policy.
create policy client_month_budgets_select_view_revenue
  on public.client_month_budgets
  for select
  to authenticated
  using ((select private.has_capability('view_revenue')));

create policy client_month_hours_fetch_select_view_revenue
  on public.client_month_hours_fetch
  for select
  to authenticated
  using ((select private.has_capability('view_revenue')));

----------------------------------------------------------------------------
-- 3. record_month_budgets and can_view_revenue
----------------------------------------------------------------------------

-- One call is one transaction: the month's budget rows are replaced and the
-- fetch stamp moved together or not at all. p_budgets is a jsonb array of
-- {productive_deal_id, productive_project_id, name, starts_on, ends_on,
-- budgeted_minutes, worked_minutes} -- Task 2's BudgetRow plus the project id.
-- '[]' records "fetched, no fixed monthly budget".
--
-- SECURITY INVOKER, executable by service_role only: the edge function calls
-- it with the service role after checking its caller's view_revenue. It does
-- nothing the service role could not do in three statements, so it borrows
-- nobody's rights.
create function public.record_month_budgets(p_client_id bigint, p_period date, p_budgets jsonb)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
begin
  delete from public.client_month_budgets
  where client_id = p_client_id and period = p_period;

  insert into public.client_month_budgets
    (client_id, period, productive_deal_id, productive_project_id, name,
     starts_on, ends_on, budgeted_minutes, worked_minutes)
  select p_client_id, p_period, b.productive_deal_id, b.productive_project_id, b.name,
         b.starts_on, b.ends_on, b.budgeted_minutes, b.worked_minutes
  from jsonb_to_recordset(p_budgets) as b(
    productive_deal_id text, productive_project_id text, name text,
    starts_on date, ends_on date, budgeted_minutes integer, worked_minutes integer);

  -- Last, so the fetch trigger's refresh sees the budget rows above.
  insert into public.client_month_hours_fetch (client_id, period, fetched_at)
  values (p_client_id, p_period, now())
  on conflict (client_id, period) do update set fetched_at = excluded.fetched_at;
end;
$$;

revoke execute on function public.record_month_budgets(bigint, date, jsonb) from public, anon, authenticated;
grant execute on function public.record_month_budgets(bigint, date, jsonb) to service_role;

-- Whether the caller may see hours (and revenue). Modelled on
-- public.can_run_ai_suggestions(): SQL-standard body, so it is bound at create
-- time and the caller needs only EXECUTE on private.has_capability, not USAGE
-- on schema private.
create function public.can_view_revenue()
returns boolean
language sql
security invoker
stable
set search_path = ''
return private.has_capability('view_revenue');

revoke execute on function public.can_view_revenue() from public, anon;
grant execute on function public.can_view_revenue() to authenticated;

----------------------------------------------------------------------------
-- 4. Whether the hours question applies
----------------------------------------------------------------------------

-- Rules 1-4 of hoursFromBudgets: from 2026-10-01 (HOURS_START_PERIOD in
-- src/lib/buckets.ts), linked, and either never fetched or fetched with a
-- budget. Definer so the triggers below can read the three tables whoever
-- fired them; nobody may call it directly.
create function private.hours_applies(p_client_id bigint, p_period date)
returns boolean
language sql
stable
security definer
set search_path = ''
return p_period >= date '2026-10-01'
  and exists (select 1 from public.client_productive_projects l where l.client_id = p_client_id)
  and (
    not exists (select 1 from public.client_month_hours_fetch f
                where f.client_id = p_client_id and f.period = p_period)
    or exists (select 1 from public.client_month_budgets b
               where b.client_id = p_client_id and b.period = p_period)
  );

revoke execute on function private.hours_applies(bigint, date) from public, anon, authenticated;

----------------------------------------------------------------------------
-- 5. The new columns, and fin_score and checkin_scores rebuilt
----------------------------------------------------------------------------

-- The order follows 20260831162941_remove_on_terms.sql: the view selects
-- fin_score, so it comes down first; fin_score is generated, so it is dropped
-- and re-added rather than altered.
drop view if exists public.checkin_scores;
alter table public.checkins drop column if exists fin_score;

-- The same 1-5 smallint as every answer, but only the four values the hours
-- options write (src/lib/buckets.ts HOURS_OPTIONS): 4 has no band.
alter table public.checkins
  add column fin_hours_in_budget smallint check (fin_hours_in_budget in (1, 2, 3, 5));

-- False on every existing row: before this migration nothing is linked.
alter table public.checkins
  add column fin_hours_applies boolean not null default false;

comment on column public.checkins.fin_hours_in_budget is
  'Hours within budget (Finances and Hours). 5 within 6h, 3 6-8h under, 2 8-10h under or 6-8h over, 1 beyond. Counts only when fin_hours_applies.';
comment on column public.checkins.fin_hours_applies is
  'Whether the hours question counts for this check-in. Set by trigger from private.hours_applies(); never by the app.';

-- Four answers when the hours question applies, three when it does not. A
-- stray hours answer on a row where it does not apply moves nothing.
alter table public.checkins
  add column fin_score numeric(3,2) generated always as (
    case
      when fin_hours_applies
        then (fin_rack_rate + fin_pays_on_time + fin_rate_increased + fin_hours_in_budget)::numeric / 4
      else (fin_rack_rate + fin_pays_on_time + fin_rate_increased)::numeric / 3
    end
  ) stored;

comment on column public.checkins.fin_score is
  'Mean of the Finances and Hours answers, 1.00-5.00: four with fin_hours_applies, three without. Null if any counted answer is blank.';

-- Every column as before; overall_score is the same CASE, over 18 or 17.
-- Advocacy is still excluded whatever the gate says (spec 3.2).
create view public.checkin_scores
with (security_invoker = true) as
select
  ch.id,
  ch.client_id,
  ch.period,
  ch.comm_score,
  ch.growth_score,
  ch.fin_score,
  ch.rel_score,
  ch.del_score,
  ch.adv_score,
  (c.started_on is not null and ch.period >= (c.started_on + 90)) as advocacy_applies,
  case
    when ch.fin_hours_applies then round(
      (ch.comm_constructive + ch.comm_timely + ch.comm_consistent
       + ch.growth_goals_defined + ch.growth_progress_trackable + ch.growth_hitting_goals
       + ch.fin_rack_rate + ch.fin_pays_on_time + ch.fin_rate_increased + ch.fin_hours_in_budget
       + ch.rel_collaborative + ch.rel_respectful + ch.rel_fun + ch.rel_multi_threaded
       + ch.del_on_time + ch.del_quantity + ch.del_client_likes + ch.del_we_are_proud
      )::numeric / 18, 2)
    else round(
      (ch.comm_constructive + ch.comm_timely + ch.comm_consistent
       + ch.growth_goals_defined + ch.growth_progress_trackable + ch.growth_hitting_goals
       + ch.fin_rack_rate + ch.fin_pays_on_time + ch.fin_rate_increased
       + ch.rel_collaborative + ch.rel_respectful + ch.rel_fun + ch.rel_multi_threaded
       + ch.del_on_time + ch.del_quantity + ch.del_client_likes + ch.del_we_are_proud
      )::numeric / 17, 2)
  end as overall_score
from public.checkins ch
join public.clients c on c.id = ch.client_id;

comment on view public.checkin_scores is
  'The overall score: the mean of the non-Advocacy answers -- eighteen when the '
  'hours question applies (fin_hours_applies), seventeen when it does not. '
  'Advocacy is excluded whatever the gate says (spec 3.2). security_invoker: '
  'RLS is the callers own.';

-- A recreated view has no grants of its own (see 20260831204947).
revoke all on public.checkin_scores from anon, authenticated;
grant select on public.checkin_scores to authenticated;

----------------------------------------------------------------------------
-- 6. Keeping fin_hours_applies derived
----------------------------------------------------------------------------

-- On every insert and update of a check-in, whatever the caller sent.
-- A BEFORE trigger runs before stored generated columns are computed, so
-- fin_score sees the value set here.
create function private.set_fin_hours_applies()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  new.fin_hours_applies := private.hours_applies(new.client_id, new.period);
  return new;
end;
$$;

-- A trigger function needs no EXECUTE for the trigger to fire.
revoke execute on function private.set_fin_hours_applies() from public, anon, authenticated;

create trigger checkins_set_fin_hours_applies
  before insert or update on public.checkins
  for each row execute function private.set_fin_hours_applies();

-- When a link is added or removed, or a month is fetched, re-derive the
-- client's check-ins from the start month on. Only rows whose value changes
-- are updated, so updated_at moves on exactly those (see the header). Both the
-- old and the new client are refreshed, in case a row's client_id is changed.
create function private.refresh_fin_hours_applies()
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
  set fin_hours_applies = private.hours_applies(ch.client_id, ch.period)
  where ch.client_id in (v_old, v_new)
    and ch.period >= date '2026-10-01'
    and ch.fin_hours_applies is distinct from private.hours_applies(ch.client_id, ch.period);

  return null;
end;
$$;

revoke execute on function private.refresh_fin_hours_applies() from public, anon, authenticated;

create trigger client_productive_projects_refresh_fin_hours_applies
  after insert or update or delete on public.client_productive_projects
  for each row execute function private.refresh_fin_hours_applies();

create trigger client_month_hours_fetch_refresh_fin_hours_applies
  after insert or update or delete on public.client_month_hours_fetch
  for each row execute function private.refresh_fin_hours_applies();

-- The backfill. Nothing is linked yet, so on the day this runs every row's
-- answer is already false and this matches nothing -- and because it updates
-- only rows whose value would change, it moves no updated_at. Without that
-- last condition it would touch every October-onward check-in.
update public.checkins
set fin_hours_applies = private.hours_applies(client_id, period)
where period >= date '2026-10-01'
  and fin_hours_applies is distinct from private.hours_applies(client_id, period);

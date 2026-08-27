-- Slice 4 step 1. The six-bucket, 22-question scoring model.
--
-- ADDITIVE ONLY. The five pillar columns and total_score are untouched and the
-- deployed site keeps reading them, because the database is migrated separately
-- from -- and ahead of -- the app deploy. Spec §5.4 renames them to legacy_*;
-- that rename is a LATER step, after nothing reads them. Applying it here would
-- break the live site the instant this ran.

-- The engagement start date. Nothing in the schema could stand in for it:
-- created_at records when the row was typed into this tool, not when the work
-- began. Nullable because the real dates do not exist yet and a not-null column
-- would require inventing them. A null start date closes the Advocacy gate.
alter table public.clients add column started_on date;

comment on column public.clients.started_on is
  'When the engagement began. Drives the 90-day Advocacy gate. Null means the '
  'gate stays closed: the tool never infers tenure it cannot prove.';

-- The 22 answers. Nullable because a draft is a check-in with questions still
-- unanswered; `check between 1 and 5` rather than an enum because that is how
-- status and end_reason_code are already stored on these tables.
alter table public.checkins
  add column comm_constructive smallint check (comm_constructive between 1 and 5),
  add column comm_timely smallint check (comm_timely between 1 and 5),
  add column comm_consistent smallint check (comm_consistent between 1 and 5),
  add column growth_goals_defined smallint check (growth_goals_defined between 1 and 5),
  add column growth_progress_trackable smallint check (growth_progress_trackable between 1 and 5),
  add column growth_hitting_goals smallint check (growth_hitting_goals between 1 and 5),
  add column fin_rack_rate smallint check (fin_rack_rate between 1 and 5),
  add column fin_pays_on_time smallint check (fin_pays_on_time between 1 and 5),
  add column fin_rate_increased smallint check (fin_rate_increased between 1 and 5),
  add column fin_on_terms smallint check (fin_on_terms between 1 and 5),
  add column rel_collaborative smallint check (rel_collaborative between 1 and 5),
  add column rel_respectful smallint check (rel_respectful between 1 and 5),
  add column rel_fun smallint check (rel_fun between 1 and 5),
  add column rel_multi_threaded smallint check (rel_multi_threaded between 1 and 5),
  add column del_on_time smallint check (del_on_time between 1 and 5),
  add column del_quantity smallint check (del_quantity between 1 and 5),
  add column del_client_likes smallint check (del_client_likes between 1 and 5),
  add column del_we_are_proud smallint check (del_we_are_proud between 1 and 5),
  add column adv_left_review smallint check (adv_left_review between 1 and 5),
  add column adv_case_study smallint check (adv_case_study between 1 and 5),
  add column adv_would_refer smallint check (adv_would_refer between 1 and 5),
  add column adv_reference_check smallint check (adv_reference_check between 1 and 5);

-- The six bucket averages, generated so they cannot drift from the answers they
-- summarise -- the same reason total_score is generated. Null propagation
-- through `+` is what enforces "an incomplete bucket has no score" in the
-- database rather than only in TypeScript.
--
-- The explicit ::numeric cast is load-bearing. Without it Postgres does integer
-- division on the smallint sum and (5 + 4 + 4) / 3 is 4, not 4.33.
--
-- numeric(3,2) holds 0.00 to 9.99, so the 1.00-5.00 range fits, and storing
-- into that scale is what rounds each mean to two decimals.
alter table public.checkins
  add column comm_score numeric(3,2) generated always as (
    (comm_constructive + comm_timely + comm_consistent)::numeric / 3
  ) stored,
  add column growth_score numeric(3,2) generated always as (
    (growth_goals_defined + growth_progress_trackable + growth_hitting_goals)::numeric / 3
  ) stored,
  add column fin_score numeric(3,2) generated always as (
    (fin_rack_rate + fin_pays_on_time + fin_rate_increased + fin_on_terms)::numeric / 4
  ) stored,
  add column rel_score numeric(3,2) generated always as (
    (rel_collaborative + rel_respectful + rel_fun + rel_multi_threaded)::numeric / 4
  ) stored,
  add column del_score numeric(3,2) generated always as (
    (del_on_time + del_quantity + del_client_likes + del_we_are_proud)::numeric / 4
  ) stored,
  add column adv_score numeric(3,2) generated always as (
    (adv_left_review + adv_case_study + adv_would_refer + adv_reference_check)::numeric / 4
  ) stored;

comment on column public.checkins.adv_score is
  'Null for two different reasons -- unanswered, and not applicable inside the '
  'first 90 days. public.checkin_scores.advocacy_applies is what tells them apart.';

-- The overall score cannot be a generated column, for two independent reasons
-- either of which alone is decisive: Postgres forbids a generated column
-- referencing another generated column, and a generation expression cannot
-- reference another table -- and the gate needs clients.started_on.
--
-- security_invoker is NOT decoration. Without it this view executes with its
-- owner's privileges, every RLS policy on checkins and clients is bypassed, and
-- any signed-in account reads every client's scores. Requires Postgres 15+;
-- production is 17.6, measured 2026-08-27. verify-scoring-view.sql asserts an
-- inactive account reads zero rows through it, because this is the db:which
-- failure class: a guard whose absence looks exactly like its presence.
create view public.checkin_scores with (security_invoker = true) as
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
  (c.started_on is not null and ch.period >= c.started_on + 90) as advocacy_applies,
  case
    when c.started_on is not null and ch.period >= c.started_on + 90
      then round(
        (ch.comm_constructive + ch.comm_timely + ch.comm_consistent
         + ch.growth_goals_defined + ch.growth_progress_trackable + ch.growth_hitting_goals
         + ch.fin_rack_rate + ch.fin_pays_on_time + ch.fin_rate_increased + ch.fin_on_terms
         + ch.rel_collaborative + ch.rel_respectful + ch.rel_fun + ch.rel_multi_threaded
         + ch.del_on_time + ch.del_quantity + ch.del_client_likes + ch.del_we_are_proud
         + ch.adv_left_review + ch.adv_case_study + ch.adv_would_refer
         + ch.adv_reference_check)::numeric / 22, 2)
    else round(
      (ch.comm_constructive + ch.comm_timely + ch.comm_consistent
       + ch.growth_goals_defined + ch.growth_progress_trackable + ch.growth_hitting_goals
       + ch.fin_rack_rate + ch.fin_pays_on_time + ch.fin_rate_increased + ch.fin_on_terms
       + ch.rel_collaborative + ch.rel_respectful + ch.rel_fun + ch.rel_multi_threaded
       + ch.del_on_time + ch.del_quantity + ch.del_client_likes
       + ch.del_we_are_proud)::numeric / 18, 2)
  end as overall_score
from public.checkins ch
join public.clients c on c.id = ch.client_id;

comment on view public.checkin_scores is
  'The gated overall score. Reads the answer columns, not the generated bucket '
  'columns, so a future change to how a bucket is derived cannot silently move '
  'the headline number. security_invoker: RLS is the callers own.';

-- Step 1 of the standing convention: revoke BEFORE any grant, because revoking
-- a table-level privilege also revokes it on every column.
revoke all on public.checkin_scores from anon, authenticated;
grant select on public.checkin_scores to authenticated;

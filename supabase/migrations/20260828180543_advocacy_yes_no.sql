-- Advocacy becomes yes/no, and leaves the overall score. Spec §3.1, §3.2, §5.2,
-- §5.3, §6 (all amended 2026-08-28).
--
-- Safe as a plain type change because the columns are EMPTY: measured
-- 2026-08-28, staging holds one checkins row with all four adv_* null, and
-- production has never had 20260827192720 applied at all. There is no 1-5
-- Advocacy answer anywhere to translate, which is the whole reason this lands
-- before step 4 rather than after it.

-- The view and the generated column both depend on the four columns, so both
-- come down first. Dropping the view is not destructive -- it holds no data.
drop view if exists public.checkin_scores;
alter table public.checkins drop column if exists adv_score;

alter table public.checkins
  drop column adv_left_review,
  drop column adv_case_study,
  drop column adv_would_refer,
  drop column adv_reference_check;

-- boolean, not a smallint constrained to two values. The column then states what
-- it is, and nobody can later write a 3 into it. Null still means unanswered;
-- false means answered No, and the two must never be conflated.
alter table public.checkins
  add column adv_left_review boolean,
  add column adv_case_study boolean,
  add column adv_would_refer boolean,
  add column adv_reference_check boolean;

-- 1 + the number of yeses, which is exactly 1.00, 2.00, 3.00, 4.00, 5.00 for
-- zero through four yeses -- the same 1.00-5.00 range as the other five buckets,
-- so nothing that consumes a bucket score needs a special case for this one.
--
-- Null propagation is what makes §3.3 hold: `true::int` is 1, `false::int` is 0,
-- and `null::int` is null, so any unanswered question nulls the whole sum and
-- therefore the score. An unanswered Advocacy question can never read as a low
-- one.
alter table public.checkins
  add column adv_score numeric(3,2) generated always as (
    (1 + adv_left_review::int + adv_case_study::int
       + adv_would_refer::int + adv_reference_check::int)::numeric
  ) stored;

comment on column public.checkins.adv_score is
  'Advocacy: 1 + the number of yeses, so 1.00-5.00 like every other bucket. '
  'Null when any of the four is unanswered -- which is NOT the same as four Nos, '
  'which scores 1.00. This bucket does not feed overall_score (spec 3.2).';

-- The overall, rebuilt. The case expression is GONE: Advocacy is excluded
-- whether the gate is open or shut, so there is one branch, not two.
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
  -- Retained even though overall_score no longer consults it: the check-in
  -- screen and the board both need to know whether the gate is open, and
  -- computing it here keeps the database's answer comparable with the
  -- TypeScript gate's (tests/gateParity.test.ts reads the 90 out of this file).
  (c.started_on is not null and ch.period >= c.started_on + 90) as advocacy_applies,
  round(
    (ch.comm_constructive + ch.comm_timely + ch.comm_consistent
     + ch.growth_goals_defined + ch.growth_progress_trackable + ch.growth_hitting_goals
     + ch.fin_rack_rate + ch.fin_pays_on_time + ch.fin_rate_increased + ch.fin_on_terms
     + ch.rel_collaborative + ch.rel_respectful + ch.rel_fun + ch.rel_multi_threaded
     + ch.del_on_time + ch.del_quantity + ch.del_client_likes
     + ch.del_we_are_proud)::numeric / 18, 2) as overall_score
from public.checkins ch
join public.clients c on c.id = ch.client_id;

comment on view public.checkin_scores is
  'The overall score: the mean of the eighteen non-Advocacy answers, always. '
  'Advocacy is excluded whatever the gate says (spec 3.2, amended 2026-08-28). '
  'security_invoker: RLS is the callers own.';

revoke all on public.checkin_scores from anon, authenticated;
grant select on public.checkin_scores to authenticated;

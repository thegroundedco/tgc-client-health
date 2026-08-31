-- Advocacy's four answers become smallint, so an Unsure has somewhere to live.
--
-- Spec §3.1 and §5.2, amended 2026-08-31. Yes = 5, Unsure = 3, No = 1. The
-- conversion is lossless -- the columns hold only true, false and null today --
-- and it moves no score: for a four-question bucket, the mean of 5s and 1s is
-- identical to the retired `1 + yeses` at all five of its reachable points.
--
-- Both dependants come down first. adv_score is generated FROM these columns
-- and checkin_scores SELECTS adv_score, so neither survives an ALTER TYPE.

begin;

drop view if exists public.checkin_scores;

alter table public.checkins drop column if exists adv_score;

-- `case ... when true` rather than `::int * 4 + 1`, so that a null stays null by
-- the ordinary rule that an unmatched CASE yields null, rather than by relying
-- on cast semantics. Null is unanswered and must not become 1.
alter table public.checkins
  alter column adv_left_review type smallint
    using (case adv_left_review when true then 5 when false then 1 end),
  alter column adv_case_study type smallint
    using (case adv_case_study when true then 5 when false then 1 end),
  alter column adv_would_refer type smallint
    using (case adv_would_refer when true then 5 when false then 1 end),
  alter column adv_reference_check type smallint
    using (case adv_reference_check when true then 5 when false then 1 end);

-- The same constraint every other answer carries, named the same way, so the
-- four are indistinguishable from the seventeen in the catalogue.
alter table public.checkins
  add constraint checkins_adv_left_review_check
    check (adv_left_review >= 1 and adv_left_review <= 5),
  add constraint checkins_adv_case_study_check
    check (adv_case_study >= 1 and adv_case_study <= 5),
  add constraint checkins_adv_would_refer_check
    check (adv_would_refer >= 1 and adv_would_refer <= 5),
  add constraint checkins_adv_reference_check_check
    check (adv_reference_check >= 1 and adv_reference_check <= 5);

-- Identical in shape to the other five bucket columns now. The ::numeric cast is
-- required: without it Postgres does integer division and 5 + 5 + 5 + 3 becomes
-- 4 instead of 4.50.
alter table public.checkins
  add column adv_score numeric(3,2) generated always as (
    ((adv_left_review + adv_case_study
      + adv_would_refer + adv_reference_check)::numeric / 4)
  ) stored;

comment on column public.checkins.adv_score is
  'Mean of the four Advocacy answers, 1.00-5.00. Null if any is unanswered. Excluded from checkin_scores.overall_score by ruling (spec 3.2).';

-- Rebuilt exactly as it was. overall_score does not reference adv_* at all --
-- Advocacy is out of the headline number -- so its expression is unchanged and
-- still divides by seventeen.
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
  round(
    (ch.comm_constructive + ch.comm_timely + ch.comm_consistent
     + ch.growth_goals_defined + ch.growth_progress_trackable + ch.growth_hitting_goals
     + ch.fin_rack_rate + ch.fin_pays_on_time + ch.fin_rate_increased
     + ch.rel_collaborative + ch.rel_respectful + ch.rel_fun + ch.rel_multi_threaded
     + ch.del_on_time + ch.del_quantity + ch.del_client_likes + ch.del_we_are_proud
    )::numeric / 17::numeric, 2) as overall_score
from public.checkins ch
join public.clients c on c.id = ch.client_id;

comment on view public.checkin_scores is
  'The overall score: the mean of the seventeen non-Advocacy answers, always. '
  'Advocacy is excluded whatever the gate says (spec 3.2). "On terms" was '
  'removed 2026-08-31 (spec 3.1). security_invoker: RLS is the callers own.';

-- Dropping and recreating the view creates a new object with no grants of its
-- own -- default privileges to anon/authenticated were revoked project-wide
-- (20260820230559), so a bare `create view` here leaves `authenticated` unable
-- to read it at all, which is exactly the regression every prior migration
-- that recreates this view (six-bucket-scoring, advocacy-yes-no, remove-on-
-- terms) re-grants against. verify:privileges asserts
-- ('checkin_scores', 'authenticated', 'SELECT') and would fail without this.
revoke all on public.checkin_scores from anon, authenticated;
grant select on public.checkin_scores to authenticated;

commit;

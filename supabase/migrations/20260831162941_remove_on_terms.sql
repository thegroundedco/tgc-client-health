-- "On terms" is removed. Spec §3.1 as amended 2026-08-31.
--
-- DROP, not rename. Spec §5.4's principle is rename-never-drop, and the five v1
-- pillars were renamed to legacy_* two commits ago on exactly that reasoning.
-- This departs from it BY RULING: the owner instructed the drop on 2026-08-31,
-- after being shown it destroys real answers -- Babaloo's August check-in held
-- fin_on_terms = 3, and by the time this reaches production ten clients will
-- each hold one. That is the decision, not an oversight. Do not "restore" the
-- rename.
--
-- The question was never defined. The source doc read "On they on terms
-- (3-month commitment?)" -- the boss's own question mark -- and the 2026-08-27
-- ruling left the prompt bare for the scorer to interpret. Scoring one client's
-- undefined question against another's is not measurement.
--
-- No preflight guard, deliberately. A second run fails loudly and immediately
-- on `drop column fin_on_terms` with "column does not exist", leaving no
-- partial state and nothing at risk -- unlike 20260828180543, whose second run
-- would have silently destroyed answers and therefore earned a guard.

drop view if exists public.checkin_scores;
alter table public.checkins drop column if exists fin_score;

alter table public.checkins drop column fin_on_terms;

-- Three questions now, not four.
alter table public.checkins
  add column fin_score numeric(3,2) generated always as (
    (fin_rack_rate + fin_pays_on_time + fin_rate_increased)::numeric / 3
  ) stored;

-- The overall, over seventeen. Advocacy is still excluded whatever the gate
-- says (spec §3.2, amended 2026-08-28), so there is still one branch, not two.
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
  round(
    (ch.comm_constructive + ch.comm_timely + ch.comm_consistent
     + ch.growth_goals_defined + ch.growth_progress_trackable + ch.growth_hitting_goals
     + ch.fin_rack_rate + ch.fin_pays_on_time + ch.fin_rate_increased
     + ch.rel_collaborative + ch.rel_respectful + ch.rel_fun + ch.rel_multi_threaded
     + ch.del_on_time + ch.del_quantity + ch.del_client_likes
     + ch.del_we_are_proud)::numeric / 17, 2) as overall_score
from public.checkins ch
join public.clients c on c.id = ch.client_id;

comment on view public.checkin_scores is
  'The overall score: the mean of the seventeen non-Advocacy answers, always. '
  'Advocacy is excluded whatever the gate says (spec 3.2). "On terms" was '
  'removed 2026-08-31 (spec 3.1). security_invoker: RLS is the callers own.';

revoke all on public.checkin_scores from anon, authenticated;
grant select on public.checkin_scores to authenticated;

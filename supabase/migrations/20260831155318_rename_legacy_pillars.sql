-- Spec §5.4. The five pillars and their total become legacy_*, keeping the
-- history rather than dropping it.
--
-- RENAME, NEVER DROP. These columns hold twelve real check-ins from the v1
-- rubric -- the only record that those months were scored at all. A drop would
-- be unrecoverable and buys nothing: the cost of keeping them is a wider table,
-- which is the cheaper mistake.
--
-- Renaming rather than leaving them alone is what makes the table readable: a
-- column named `growth` sitting beside `growth_goals_defined` and
-- `growth_score` is a trap for the next person, and `relationship` beside
-- `rel_score` is the same trap twice.
--
-- ORDERING, AND IT IS NOT OPTIONAL. The deployed app selects these columns by
-- name until the Slice 4 step 3 board ships. Applying this to production before
-- that deploy makes every board load fail with "column does not exist" for
-- real users. Staging first; production only after the deploy.
--
-- total_score is a generated column, expression
-- ((((relationship + delivery) + financial) + sentiment) + growth). Postgres
-- tracks generation dependencies by attribute number, not name, so renaming
-- the five sources rewrites this expression automatically -- renaming is a
-- catalogue operation and recomputes nothing.
--
-- No view and no RLS policy references any of these six columns (checked
-- against staging 2026-08-31; in particular checkin_scores does not), so
-- this rename cannot break anything that reads through either.
--
-- CONSTRAINT NAMES ARE DELIBERATELY LEFT ALONE. Five check constraints --
-- checkins_relationship_check, checkins_delivery_check,
-- checkins_financial_check, checkins_sentiment_check, checkins_growth_check --
-- reference these columns. A column rename rewrites each constraint's
-- expression automatically but does not rename the constraint itself, so
-- after this migration `legacy_sentiment` carries a constraint still named
-- checkins_sentiment_check (and likewise for the other four). That is
-- intentional, not an oversight: renaming five more objects buys nothing
-- functional and only adds five more statements to a migration the owner
-- pastes by hand into a production SQL editor. Nobody scans constraint names
-- to tell a live column from a legacy one -- the column name is what is
-- scanned, and that is exactly what this migration fixes.
--
-- NOT GUARDED WITH A PREFLIGHT, unlike 20260828180543. A plain rename is not
-- idempotent -- a second run fails immediately on the first statement with
-- "column relationship does not exist" -- but that failure is loud, leaves
-- no partial damage beyond columns already renamed by the first (successful)
-- run, and destroys nothing: there is no data loss to guard against here,
-- only a duplicate rename attempt that Postgres itself refuses. That is a
-- sufficient guard on its own.
alter table public.checkins rename column relationship to legacy_relationship;
alter table public.checkins rename column delivery to legacy_delivery;
alter table public.checkins rename column financial to legacy_financial;
alter table public.checkins rename column sentiment to legacy_sentiment;
alter table public.checkins rename column growth to legacy_growth;
alter table public.checkins rename column total_score to legacy_total_score;

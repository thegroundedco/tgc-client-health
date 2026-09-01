# Slice 4 Step 4 — Production Checklist

**This is the owner's checklist. Every step is run by Josh, in this order.** Written 2026-08-31 against measured production state. Production is `tgc-client-health-production` (`jizavsawtbkmvzllxhtk`); staging is `tgc-client-health-staging` (`dexsdhtpfsswgiytxntl`).

---

## STATUS: steps 1-4 complete, 2026-09-01

- **Step 1, deploy** — landed 2026-08-31 21:45:30 GMT as chunk `App-BXt0zbRD.js`.
- **Step 2, board renders** — confirmed by the owner: seven clients with an Advocacy bar, three
  reading "Advocacy begins at 90 days", six Healthy, four Watch, no error banner. The board opened
  on **August, not July**, because the confirmation happened after midnight: 1 September makes the
  previous month August, which is the behaviour this change was built for. Seven Advocacy bars, not
  the six predicted in Step 2 below — the production query in Step 4 confirms seven, so the
  prediction was wrong and the screen was right.
- **Step 3, migration** — applied to production via MCP `apply_migration`, not the SQL editor. The
  clipboard route below was not used.
- **Step 4, verification** — all six queries run and matched: seven unchanged Advocacy scores, one
  non-smallint `adv_*` column (`adv_score`), four check constraints, `{security_invoker=true}`,
  `authenticated / SELECT`, and all ten overall scores identical. **No score moved.**
- **Step 5 remains open** — the two manual checks only the owner can make.

The month arrows named throughout this document were replaced by a dropdown on 2026-09-01
(spec §7, amended; §10 decision 9). Where this checklist says "click →", the control is now a
month list on the heading.

---

## Read this first: the board will look empty, and that is the new default working

**Today is 31 August. The board now opens on the PREVIOUS month, which is July — and production has no July data at all.** Every client will read "Not started" with no bars.

Nothing is broken. Click the **→** arrow once and August appears exactly as it does today. From 1 September onward the default lands on August by itself, which is the whole point: you score a month after it closes, and the old `currentPeriod()` default meant the board showed nothing but em dashes for the first three weeks of every month.

Today is the single day where the new default looks wrong, because you scored August *during* August rather than after it.

**If that annoys you more than it helps**, the alternative was "most recent unsubmitted month" and it is one expression in `Board.tsx` — but note it would not have helped today either, since August is already submitted. Say the word and I will change it.

## What else changes, and what does not

**No score changes anywhere.** Not one number moves. This is the first change in this slice where there is no prediction table to check afterward, because nothing recomputes.

- **Finances and Advocacy now answer No / Unsure / Yes** — three buttons, reading worse-left to better-right like the 1-5 rows above them. This reverses the old Yes-then-No order on Advocacy deliberately: a screen where the leftmost box means "best" on one row and "worst" on the next is a mis-click waiting to happen.
- **Your seven Finance "3"s become "Unsure"** on screen. They were already 3 in the database and stay 3. Of the ten August check-ins, seven answered `fin_rack_rate` as 3 — nobody pays 60% of rack rate, and that is what prompted this change.
- **The scale legend is now sticky.** It always said "1 strongly disagree / 5 strongly agree"; it scrolled away above question fourteen, which is why you asked for it.

## The order is forced

```
1. Deploy          -> the site starts writing 5/3/1 to Advocacy
2. Confirm it renders
3. Migrate         -> the columns accept 5/3/1
```

Deploying first is safe, though not for the reason it first appears: the board DOES select the four raw `adv_*` columns (`cardSummary.ts` builds its column list from every question), it simply discards anything that is not a number, so pre-migration booleans fall away and the six bars keep drawing from `adv_score` throughout.

Migrating first would break the check-in screen's Advocacy rows for anyone who opened one in the gap. **Do not open a check-in between step 1 and step 3** — a save in that window would try to write a 5 into a boolean column and fail. The only cosmetic effect during the gap: an unsubmitted draft's card would read "17 of 21" rather than counting its Advocacy answers.

---

## Step 1 — Deploy

From Terminal.app, not from inside Claude Code — `git push` cannot reach your keychain from there ("Device not configured"), and the `!` prefix fails the same way.

```bash
cd /Users/josh/Downloads/CLAUDE/tgc-client-health
git push origin slice-4-step-4-one-answer-type
git checkout main && git merge slice-4-step-4-one-answer-type && git push origin main
```

**That last push is what deploys.** The workflow runs the full suite first and refuses to publish if it is red.

Watch: https://github.com/thegroundedco/tgc-client-health/actions

## Step 2 — Confirm the board renders

Open the site. Expect the empty July board described above. Click **→** to August and confirm:

- Ten scored cards, Colorfil / LoFli Balls / Gibs Grooming at 5.00 down to York at 3.00
- Six bars for clients past 90 days; five bars and "Advocacy begins at 90 days" for LoFli Balls, Remi and Polar Divide
- Six Healthy, four Watch
- No error banner

**If the board does not render, stop.** Do not migrate. A broken board before the migration is fixed by reverting the deploy; after it, there are two possible causes instead of one.

## Step 3 — Apply the migration

The file is `supabase/migrations/20260831204947_advocacy_smallint.sql`. It is applied to staging, where all six gates pass against it.

Ask me to put its **contents** on your clipboard — not its filename. That mistake cost two rounds on 31 August. Confirm the SQL editor header reads **`tgc-client-health-production`** before running anything.

**`db push` is not a safe route to production.** Its migration history was recorded under regenerated timestamps that do not match the repo's filenames, so the CLI would try to replay migrations that are already applied. Staging does not have this problem; production does.

If it has already been applied, the second run fails at the first `case adv_left_review when true` with **`operator does not exist: smallint = boolean`**. That is the safe failure and it leaves nothing behind: every statement sits inside `begin;` / `commit;`, and Postgres DDL is transactional, so the `drop view` and `drop column adv_score` roll back with it. There is no partial state to clean up and no unrecoverable half-migration.

## Step 4 — Verify

**The one that matters most.** Advocacy scores must be unchanged:

```sql
select c.name, ch.adv_score
from public.checkins ch join public.clients c on c.id = ch.client_id
where ch.period = '2026-08-01' and ch.adv_score is not null
order by c.name;
```

Expect exactly these seven, and no others:

| Client | adv_score |
|---|---|
| Babaloo | 5.00 |
| C.R. Plastics | 1.00 |
| Colorfil | 1.00 |
| Gait Happens | 4.00 |
| Gibs Grooming | 1.00 |
| Juan Valdez | 4.00 |
| York | 1.00 |

**If a single one differs, stop and tell me.** It means the conversion mapping is wrong, and it is wrong for everyone at once.

```sql
select count(*) from information_schema.columns
 where table_schema = 'public' and table_name = 'checkins'
   and column_name like 'adv\_%' and data_type <> 'smallint';
```
Expect **1** — that is `adv_score`, which is `numeric`. The four answers are now `smallint`.

```sql
select count(*) from pg_constraint
 where conrelid = 'public.checkins'::regclass
   and conname in ('checkins_adv_left_review_check','checkins_adv_case_study_check',
                   'checkins_adv_would_refer_check','checkins_adv_reference_check_check');
```
Expect **4**. These are load-bearing: the app's draft filter accepts any number, and this constraint is the only thing keeping an out-of-range value out of a saved answer.

```sql
select reloptions from pg_class where relname = 'checkin_scores';
```
Expect `{security_invoker=true}`. **If this is empty, stop and tell me immediately** — without it the view runs with the owner's privileges and every signed-in account can read every client's scores, with no error and no symptom.

```sql
select grantee, privilege_type from information_schema.role_table_grants
 where table_name = 'checkin_scores';
```
Expect `authenticated / SELECT`. A recreated view gets no grants of its own; without this nobody can read the board at all.

```sql
select c.name, cs.overall_score
from public.checkin_scores cs join public.clients c on c.id = cs.client_id
where cs.period = '2026-08-01' and cs.overall_score is not null
order by cs.overall_score desc;
```
Expect the same ten values as before: 5.00 / 5.00 / 5.00, Gait Happens 4.71, Juan Valdez 4.71, C.R. Plastics 4.06, Babaloo 3.59, Remi 3.35, Polar Divide 3.24, York 3.00.

## Step 5 — Two things only you can check

The test suite cannot reach either of these.

1. **Open a check-in and scroll to the bottom bucket. The 1 / 5 legend must still be on screen.** jsdom does not apply CSS Modules, so stickiness is unverifiable in the suite. If it scrolls away, the change did not take and you are back where you started.

2. **Answer a Finances question "No", then confirm the row still offers Clear.** If it does not, anyone who answers No is stranded with no way back to unanswered. The components are unit-tested for this; this checks the wiring.

Also worth one look: **click back through a few months quickly.** The board has a guard that stops a slow response for an old month overwriting a newer one. Until this release the month could never change, so that guard had never once run in production.

---

## What is left after this

- **Slice 5, the Overview homepage** from your whiteboard sketch: the OVERVIEW / CLIENTS / REVENUE nav lifted into the app shell, six stat lines in two columns, and the client-by-bucket matrix with the initials C G F R D A.
- **Revenue retention still has no data answer.** A single editable retainer field cannot produce it, because editing destroys the value you would compare against. Options owed to you when that page is built.
- **An Unsure and a middling 3 are indistinguishable in the column**, by design (spec §11 item 6). Nothing needs to tell them apart today. If a future screen does, that distinction is not in the data and recovering it is a migration.

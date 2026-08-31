# Slice 4 Step 3 — Production Checklist

**This is the owner's checklist, not an implementer's task.** Every step here is run by Josh, against production, in this order. Nothing in this document is executed as part of building the branch.

Written 2026-08-31, against measured production state. Production is `tgc-client-health-production` (`jizavsawtbkmvzllxhtk`); staging is `tgc-client-health-staging` (`dexsdhtpfsswgiytxntl`).

---

## Read this first: the board comes back to life, it does not go blank

**This section originally warned that the board would go blank. That is no longer true, because you scored the August round on 2026-08-31 before deploying.** The warning is corrected rather than deleted, because the reasoning behind it still matters.

**What you will actually see when this deploys:** ten clients with real six-bucket scores, ordered roughly Colorfil / LoFli Balls / Gibs Grooming at 5.00 down to York at 3.00. Three of them — LoFli Balls, Remi and Polar Divide — will draw **five bars and "Advocacy begins at 90 days"** rather than six, because they are inside their first 90 days. Sno-Go is paused and shows nothing.

**What you will NOT see is your old v1 scores.** They are not lost — step 3 renames them to `legacy_*` and keeps them — but they stop appearing on this board, because it measures something different now.

That is deliberate. The v1 pillars do not map onto the six buckets: old `relationship` measured reply speed and meeting attendance, which is really the new **Communication**; old `sentiment` measured tone, which is the nearest thing to **Advocacy** and is not it; and the new **Relationship** has no v1 equivalent at all. Carrying the numbers across would draw a trend line through a definition change — a chart that misleads precisely because it looks like measurement.

**The spec's timing advice was "deploy just before a scoring round, not just after."** You did exactly that, by accident or otherwise. Had you deployed before scoring, every card would have read an em dash until you worked through them.

## Read this too: step 4 deletes ten real answers

You removed the "On terms" question on 2026-08-31, and ruled that its column be **dropped rather than renamed** — after being shown that this destroys real data. By the time you run this, that means **one answer per client for all ten August check-ins**, gone permanently.

This is your own decision, recorded here so it is not a surprise a week later. If you have changed your mind, say so **before** step 4: renaming the column instead is a one-line change, and everything else in this checklist is unaffected.

What it does to your August scores — measured, no band moves:

| Client | over 18 | over 17 |
|---|---|---|
| Colorfil / LoFli Balls / Gibs Grooming | 5.00 | 5.00 |
| Gait Happens | 4.72 | 4.71 |
| Juan Valdez | 4.61 | 4.71 |
| C.R. Plastics | 4.00 | 4.06 |
| Babaloo | 3.56 | 3.59 |
| Remi | 3.33 | 3.35 |
| Polar Divide | 3.22 | 3.24 |
| York | 3.00 | 3.00 |

Babaloo lands a hundredth under Healthy. Nothing crosses a band.

## The order is forced, and here is why

The live site today still selects `relationship`, `delivery`, `financial`, `sentiment`, `growth` and `total_score`. Renaming those columns before the new board is deployed makes **every board load fail** with a Postgres error, for real users.

```
1. Deploy the new board        -> the site stops reading the old columns
2. Confirm the live board renders
3. Only then rename the old columns   (20260831155318_rename_legacy_pillars.sql)
4. Then remove "On terms"             (20260831162941_remove_on_terms.sql)
5. Verify, and reload the board
```

Steps 3 and 4 are two separate migrations and go in that order. Neither depends on the other, but doing them one at a time means that if something fails you know which one did it.

If you do it the other way round, the failure is immediate and total. Doing it in this order, every step is individually safe.

---

## Step 1 — Deploy

Nineteen commits are waiting on `slice-4-scoring-model`. From Terminal.app (not from inside Claude Code — it cannot reach your keychain):

```bash
cd /Users/josh/Downloads/CLAUDE/tgc-client-health
git push origin slice-4-scoring-model
git checkout main && git merge slice-4-scoring-model && git push origin main
```

The merge is a clean fast-forward. **That last push is what deploys.** The workflow runs the full test suite first and refuses to publish if it is red.

Watch it: https://github.com/thegroundedco/tgc-client-health/actions

---

## Step 2 — Confirm the live board renders. Do not skip this.

Open the site. You should see:

- Every client card present, with the **band** and the client name.
- **Real scores**, not em dashes — Colorfil, LoFli Balls and Gibs Grooming at 5.00, down to York at 3.00. Sno-Go is paused and shows nothing; Test Client is a former client.
- **Six bars** per card for clients past 90 days; **five bars and "Advocacy begins at 90 days"** for LoFli Balls, Remi and Polar Divide.
- Bands: six Healthy, four Watch.
- No error banner.

At this point the scores are still out of **eighteen** — step 4 has not run yet — so they match the left column of the table at the top of this document, not the right. Babaloo reads 3.56 here and 3.59 after step 4.

**If the board does not render, stop here.** Do not proceed to step 3. A broken board before the rename is recoverable by reverting the deploy; a broken board after it is a broken board with two possible causes instead of one.

---

## Step 3 — Rename the old columns

Only after step 2 passes.

The file is `supabase/migrations/20260831155318_rename_legacy_pillars.sql`. It is already applied to staging, where the whole test suite and both verifiers pass against it.

Ask Claude to put it on your clipboard — **paste its contents, not its filename** — then run it in the production SQL editor. Confirm the editor header says `tgc-client-health-production` before you run anything.

It renames six columns and touches no data. `total_score` is a generated column; renaming it is a catalogue operation and recomputes nothing.

**If it fails with `column "relationship" does not exist`, it has already been applied.** That is the safe failure: a rename is not idempotent, and a second run stops immediately with no partial state and nothing at risk.

---

## Step 4 — Remove "On terms"

Only after step 3. The file is `supabase/migrations/20260831162941_remove_on_terms.sql`, already applied to staging where the whole suite and both verifiers pass against it.

Same method: ask Claude to put its **contents** on your clipboard, confirm the editor header says `tgc-client-health-production`, run it.

**This is the step that deletes the ten answers.** It drops `fin_on_terms`, rebuilds `fin_score` over three questions instead of four, and rebuilds `checkin_scores.overall_score` over seventeen instead of eighteen.

If it fails with `column "fin_on_terms" does not exist`, it has already been applied — the safe failure, with no partial state.

## Step 5 — Verify

```sql
select count(*) as rows, count(legacy_total_score) as kept from public.checkins;
```
Expect **12 and 12**. Your v1 history is intact under its new names.

```sql
select count(*) from information_schema.columns
 where table_schema = 'public' and table_name = 'checkins'
   and column_name in ('relationship','delivery','financial','sentiment','growth','total_score');
```
Expect **0**. The old names are gone.

```sql
select count(*) from information_schema.columns
 where table_schema = 'public' and table_name = 'checkins' and column_name = 'fin_on_terms';
```
Expect **0**. "On terms" is gone.

```sql
select c.name, cs.overall_score
from public.checkin_scores cs join public.clients c on c.id = cs.client_id
where cs.period = '2026-08-01' and cs.overall_score is not null
order by cs.overall_score desc;
```
Expect **ten rows**, now scored out of seventeen. Compare against the table at the top of this document — Gait Happens should read 4.71, Juan Valdez 4.71, C.R. Plastics 4.06, Babaloo 3.59. If any client's number does not match, **stop and say so**: the view's divisor is the one thing in this change that would be wrong for every client at once.

---

## Step 6 — Reload the live board

It must look exactly as it did at step 2. If it breaks *here*, the deploy at step 1 did not actually ship the new board — revert the rename by renaming the columns back, and investigate the deploy.

---

## One thing that is true and easy to trip over

**Production's migration history does not match this repo's filenames.** The six-bucket and yes/no migrations were applied on 2026-08-28 through a route that recorded them under regenerated timestamps (`20260828232342_six_bucket_scoring`, `20260828232432_advocacy_yes_no`) rather than the names on disk.

Consequence: **`db push` is not a safe way to apply anything to production.** The CLI would see the local files as unapplied and try to replay them. Apply production migrations by pasting into the SQL editor, as above.

The same mismatch will exist for this rename. That is acceptable — the guard against replaying it is that a second rename fails loudly — but it is worth reconciling the history the next time there is a reason to.

---

## What is left after this

- The **Overview homepage** from your whiteboard sketch, plus the global nav and the manual money fields (Slice 5).
- **Revenue retention** still has no data answer. A single editable retainer field cannot produce it, because editing destroys the number you would compare against. Options owed to you when that page is built.

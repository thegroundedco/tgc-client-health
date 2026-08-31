# Slice 4 Step 3 — Production Checklist

**This is the owner's checklist, not an implementer's task.** Every step here is run by Josh, against production, in this order. Nothing in this document is executed as part of building the branch.

Written 2026-08-31, against measured production state. Production is `tgc-client-health-production` (`jizavsawtbkmvzllxhtk`); staging is `tgc-client-health-staging` (`dexsdhtpfsswgiytxntl`).

---

## Read this before you start: the board will go blank

**When this deploys, every card on the live board shows an em dash and "Not scored."**

Measured on production 2026-08-31: twelve check-in rows, all twelve holding v1 pillar scores, and **zero rows scored under the six-bucket model**. The new board reads the six bucket columns and the view's `overall_score`; every one of those is null for every existing row.

The old scores are not lost. They stay in the database, renamed to `legacy_*` in step 3 below, and can be read at any time. They simply stop appearing on the board, because the board now measures something different.

This is deliberate and the spec explains why (§3, lines 198–205): the v1 pillars do not map onto the six buckets. Old `relationship` measured reply speed and meeting attendance, which is really the new **Communication**. Old `sentiment` measured tone, which is the nearest thing to **Advocacy** and is not it. The new **Relationship** has no v1 equivalent at all. Carrying the numbers across would draw a trend line through a definition change — a chart that misleads precisely because it looks like measurement.

**The spec's timing advice, verbatim:** *"This is best timed just before a scoring round, not just after."*

So: deploy when you are about to score, and the board fills back in as you go. If your next round is weeks away, expect a blank board until then. **That is your call, and it is the only decision in this document.**

---

## The order is forced, and here is why

The live site today still selects `relationship`, `delivery`, `financial`, `sentiment`, `growth` and `total_score`. Renaming those columns before the new board is deployed makes **every board load fail** with a Postgres error, for real users.

```
1. Deploy the new board        -> the site stops reading the old columns
2. Confirm the live board renders
3. Only then rename the columns
```

If you do it the other way round, the failure is immediate and total. Doing it in this order, every step is individually safe.

---

## Step 1 — Deploy

Eleven commits are waiting on `slice-4-scoring-model`. From Terminal.app (not from inside Claude Code — it cannot reach your keychain):

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
- **Em dashes** where the scores were, and "Not scored". This is expected — see the warning above.
- **Six bar slots** per card for clients past 90 days; **five bars and "Advocacy begins at 90 days"** for LoFli Balls, Remi and Polar Divide.
- No error banner.

**If the board does not render, stop here.** Do not proceed to step 3. A broken board before the rename is recoverable by reverting the deploy; a broken board after it is a broken board with two possible causes instead of one.

---

## Step 3 — Rename the old columns

Only after step 2 passes.

The file is `supabase/migrations/20260831155318_rename_legacy_pillars.sql`. It is already applied to staging, where the whole test suite and both verifiers pass against it.

Ask Claude to put it on your clipboard — **paste its contents, not its filename** — then run it in the production SQL editor. Confirm the editor header says `tgc-client-health-production` before you run anything.

It renames six columns and touches no data. `total_score` is a generated column; renaming it is a catalogue operation and recomputes nothing.

**If it fails with `column "relationship" does not exist`, it has already been applied.** That is the safe failure: a rename is not idempotent, and a second run stops immediately with no partial state and nothing at risk.

---

## Step 4 — Verify

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

---

## Step 5 — Reload the live board

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

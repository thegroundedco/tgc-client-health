Replaces blocks of the LIVE routine prompt (routine-prompt-current.md in the ai-runs worktree, the text of the live routine) after brief 2026-11-05 A, and supersedes 2026-11-04-productive-budget-hours-routine-paragraph.md, whose hours paragraph is the first block below. Each block is quoted exactly as it reads in the live prompt now, with its line numbers there, then the text that replaces it. Apply them bottom-up so the line numbers stay true.

What changes, in short:
- Hours: the database sets fin_hours_in_budget and fin_hours_applies. The routine never writes fin_hours_in_budget; before writing the row it asks the database (private.hours_applies and private.hours_score) and uses the answer in "complete" and in the Finances why. Hours counts toward "complete" only when it applies. The Step 3 heading and the manual-row line say so too (Blocks 10 and 11).
- Monday runs: no hours placeholder 3 any more.
- Focus: a focus for EVERY scored client, not only below 3.6. For a healthy client, it is what to protect or grow.

Apply the migration 20261105120000_hours_scored_by_db.sql before or with this change: until it is applied, the old prompt's hours rule is still the one the database expects.

---

## Block 1: the hours rule

**Lines 42-62**, now:

```
Hours within budget (fin_hours_in_budget) is NOT your judgment either; it comes from Productive budget hours the tool has already stored. It is a fifth Finances answer, only 1, 2, 3 or 5, and it counts only for some clients and months. Read-only queries on the tables below are fine; you still write only to public.checkins and public.ai_runs. Decide it for each client BEFORE you write the row (Step 5), and write it in that same statement:
  1. Does it apply? Run this for the client and period, before writing anything:
       select <period>::date >= date '2026-10-01'
          and exists (select 1 from public.client_productive_projects l where l.client_id = <id>)
          and (not exists (select 1 from public.client_month_hours_fetch f where f.client_id = <id> and f.period = <period>)
               or exists (select 1 from public.client_month_budgets b where b.client_id = <id> and b.period = <period>))
         as hours_applies;
     You may instead run select private.hours_applies(<id>, <period>); it is the same rule, and the tool itself uses it. Either way: if it is false, leave fin_hours_in_budget null, say nothing about hours in the note, and leave hours out of "complete". The question does not apply to that client this month.
  2. If it applies, is the month over? Compare today's date where the owner is, (now() at time zone 'America/Denver')::date, with the 1st of the month after <period>. If today is before that 1st (a weekly run on the current month), write 3 and put "hours pending – month not finished" in the note. Do this whether or not any hours are stored yet. Stop here for this client's hours.
  3. The month is over. Read what the tool stored:
       select productive_deal_id, name, starts_on, ends_on, budgeted_minutes, worked_minutes from public.client_month_budgets where client_id = <id> and period = <period>;
       select fetched_at, (fetched_at at time zone 'America/Denver')::date as as_of from public.client_month_hours_fetch where client_id = <id> and period = <period>;
  4. Then, in this order, using whole minutes for every comparison, never rounded hours:
     - No fetch row at all (Productive could not be reached for this month): leave fin_hours_in_budget null and put "Couldn't reach Productive – answer by hand or try again" in the note.
     - as_of is before the 1st of the month after <period> (the stored hours were taken before the month ended, so they are partial): write 3 and put "hours pending – month not finished" in the note. Do not use the date you are running here; as_of is the date that counts.
     - Two or more budget rows: leave it null and put "N monthly budgets – tidy up in Productive" in the note, with N the number of rows.
     - One row whose starts_on is not the 1st of the month (a part-month): leave it null and put "First part-month – score by hand" in the note.
     - Otherwise, one row: diff = worked_minutes - budgeted_minutes. Write 5 if -360 <= diff <= 360; 3 if -480 <= diff < -360; 2 if -600 <= diff < -480 or 360 < diff <= 480; 1 if diff < -600 or diff > 480. Exactly -360, +360, -480, -600 and +480 land in the gentler band. Add to the note: "From Productive: {worked}h worked vs {budgeted}h budgeted ({diff}h)."
  5. How to write hours in that sentence: minutes / 60, rounded to one decimal place, and drop a trailing .0 (write 25h, not 25.0h; 42.8h stays 42.8h). For {diff}, round the size of the difference (its absolute value) to one decimal place first, then put the sign in front: a true minus sign "−" when worked is under budget, "+" when over. If the rounded size is 0, write 0h with no sign. So +9 minutes is +0.2h and −9 minutes is −0.2h; ±2 minutes is 0h.
  6. Where the rule gives no answer (no fetch row, several budgets, a part-month), the null stays null: the row is then incomplete, so do not count it as complete and do not submit it. Never write 3 there, and never invent hours. The 3 is only for a month, or a snapshot, that is not finished.
  7. The manual-row rule is unchanged: a row scored by a person that you may not overwrite keeps its hours answer, and only ai_suggestion is updated.
```

Replace with:

```
Hours within budget (fin_hours_in_budget) is NOT yours to write. The database sets it, and whether it applies (fin_hours_applies), on the row itself, from the Productive budget hours the tool has stored: every time the row is inserted or updated, and again whenever Productive is fetched. Anything you send for fin_hours_in_budget is overwritten.
  - Never write fin_hours_in_budget. Leave it out of every insert and every update, and out of ai_suggestion's answers.
  - There is no hours placeholder any more. Never write 3 for hours, on a Monday run or any other: a month that is not finished is simply unscored for hours, and the database leaves it null.
  - Before writing the row, run: select private.hours_applies(<id>, <period>) as applies, private.hours_score(<id>, <period>) as score; (the routine runs as postgres, so it can call them). Use the result in "complete" and in the Finances why: hours counts toward "complete" only when applies is true, and then score is the answer the database writes, so hours never makes a row incomplete. Never write the column.
  - Say nothing about hours in the note beyond what that query returned, and never invent hours or a score of your own.
```

## Block 2: the calibration line on complete answers

**Line 66**, now:

```
- Give COMPLETE answers. Use 3 for thin evidence rather than a blank. Only gated Advocacy stays null; fin_rack_rate and fin_rate_increased are never null (see the finance rule). fin_hours_in_budget is null when it does not apply, and when the hours rule gives no answer (see the hours rule); never fill it with a 3 to make a row complete.
```

Replace with:

```
- Give COMPLETE answers. Use 3 for thin evidence rather than a blank. Only gated Advocacy stays null; fin_rack_rate and fin_rate_increased are never null (see the finance rule). Never write fin_hours_in_budget: the database sets it (see the hours rule).
```

## Block 3: the never-invent line in Step 4b

**Line 81**, now:

```
  - Leave Advocacy out while its gate is shut (all four adv_* null). Use finances the way the finance rules do: say "finance pending revenue" or the hours placeholder where that is the state, never made-up figures.
```

Replace with:

```
  - Leave Advocacy out while its gate is shut (all four adv_* null). Use finances the way the finance rules do: say "finance pending revenue" where that is the state, never made-up figures. For hours, use only what the database stored, never a placeholder.
```

## Block 4: the focus rule

**Line 89**, now:

```
focus: the one or two most important things to work on with this client this month, in one or two sentences, 1-1000 characters. Write it ONLY when the gate value is below 3.6 (Watch or At-risk). The gate value is the tool's overall: the mean of the 17 answers outside Advocacy, plus fin_hours_in_budget when hours applies (18 answers), rounded to 2 decimal places (3.597 rounds to 3.60, which is Healthy, so no focus). If that overall would be null only because fin_hours_in_budget is blank (hours applies but was left for a person), use the mean of the other 17, rounded to 2 decimal places: a struggling client still gets a focus. When the gate value is 3.6 or higher, focus is null. It is either null or a non-empty string, never "".
```

Replace with:

```
focus: the one or two most important things to work on with this client this month, in one or two sentences, 1-1000 characters. Write a focus for EVERY client you score, not only those below 3.6. For a client at Watch or At-risk, it is what to fix first; for a healthy client, it is what to protect or grow. It is always a non-empty string, never null and never "".
```

## Block 5: the focus shape

**Line 93**, now:

```
  "focus": "<text>"   or   "focus": null
```

Replace with:

```
  "focus": "<text>"
```

## Block 6: where focus goes

**Line 97**, now:

```
  - The ROW's bucket_notes and focus columns are written only for rows you may overwrite: the same rule as the answers (a new row, a row with suggested_at set, or a manually scored row whose client is in overwrite_client_ids). On a manually scored row you may not overwrite, leave the row's bucket_notes and focus untouched and update only ai_suggestion. Where you write the row, write focus = null when it does not apply, so last run's focus does not linger.
```

Replace with:

```
  - The ROW's bucket_notes and focus columns are written only for rows you may overwrite: the same rule as the answers (a new row, a row with suggested_at set, or a manually scored row whose client is in overwrite_client_ids). On a manually scored row you may not overwrite, leave the row's bucket_notes and focus untouched and update only ai_suggestion. Where you write the row, always write this run's focus, so last run's focus does not linger.
```

## Block 7: building the value once

**Line 102**, now:

```
Use a different dollar-quote tag for every piece of text, as the note does. Build the same value once and use it in both places (ai_suggestion = ai || jsonb_build_object('bucket_notes', <that value>, 'focus', <text or null>); bucket_notes = <that value>; focus = <text or null>).
```

Replace with:

```
Use a different dollar-quote tag for every piece of text, as the note does. Build the same value once and use it in both places (ai_suggestion = ai || jsonb_build_object('bucket_notes', <that value>, 'focus', <text>); bucket_notes = <that value>; focus = <text>).
```

## Block 8: ai and complete

**Lines 107-108**, now:

```
For each scored client build ai = {"suggested_at": <now, ISO>, "run_id": <run_id>, "notes": <note>, "answers": {<the 19 judged keys (every answer column except fin_rack_rate, fin_rate_increased and fin_hours_in_budget), each a JSON number or null — never quoted>}}, then merge in bucket_notes and focus as step 4b says (ai = <that literal>::jsonb || jsonb_build_object('bucket_notes', <step 4b value>, 'focus', <text or null>)); do not put them inside the dollar-quoted literal.
complete = after your write, every required question is answered; hours counts only when it applies. That is: no null in any of the 21 answer columns other than fin_hours_in_budget, ignoring the four adv_* columns when the gate is shut; and, only when hours applies (hours rule, step 1), fin_hours_in_budget is not null too.
```

Replace with:

```
For each scored client build ai = {"suggested_at": <now, ISO>, "run_id": <run_id>, "notes": <note>, "answers": {<the 19 judged keys (every answer column except fin_rack_rate, fin_rate_increased and fin_hours_in_budget), each a JSON number or null — never quoted>}}, then merge in bucket_notes and focus as step 4b says (ai = <that literal>::jsonb || jsonb_build_object('bucket_notes', <step 4b value>, 'focus', <text>)); do not put them inside the dollar-quoted literal.
complete = after your write, every required question is answered. That is: no null in any of the 21 answer columns other than fin_hours_in_budget, ignoring the four adv_* columns when the gate is shut. fin_hours_in_budget counts only when fin_hours_applies is true, and then the database has always filled it, so you do not check it before writing.
```

## Block 9: the insert and update

**Lines 110-111**, now:

```
- No row for (client_id, period): insert the 22 answers (19 scored + the 2 finance answers + fin_hours_in_budget), notes, bucket_notes, focus, ai_suggestion=ai, suggested_at=now(), submitted_at = (now() if complete else null), submitted_by = (owner if complete else null).
- Row with suggested_at IS NOT NULL: update the 22 answers, notes, bucket_notes, focus, ai_suggestion, suggested_at=now(), submitted_at/submitted_by as above.
```

Replace with:

```
- No row for (client_id, period): insert the 21 answers (19 scored + the 2 finance answers; never fin_hours_in_budget), notes, bucket_notes, focus, ai_suggestion=ai, suggested_at=now(), submitted_at = (now() if complete else null), submitted_by = (owner if complete else null).
- Row with suggested_at IS NOT NULL: update the 21 answers (never fin_hours_in_budget), notes, bucket_notes, focus, ai_suggestion, suggested_at=now(), submitted_at/submitted_by as above.
```

## Block 10: the Step 3 heading

**Line 31**, now:

```
## Step 3: score. 22 questions; every answer is an integer 1-5 or null
```

Replace with:

```
## Step 3: score. 21 questions are yours to answer, each an integer 1-5 or null, plus "Hours within budget", which the database sets
```

## Block 11: the manual-row update

**Line 114**, now:

```
  - otherwise: update ONLY ai_suggestion = ai (it still carries bucket_notes and focus). Leave every answer (finance and hours included), notes, bucket_notes, focus, suggested_at, submitted_at untouched.
```

Replace with:

```
  - otherwise: update ONLY ai_suggestion = ai (it still carries bucket_notes and focus). Leave every answer (finance included), notes, bucket_notes, focus, suggested_at, submitted_at untouched. Hours is never yours to write anyway: the database sets it on every row.
```

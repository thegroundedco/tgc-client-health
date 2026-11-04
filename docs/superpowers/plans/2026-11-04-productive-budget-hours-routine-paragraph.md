Goes in: routine-prompt-v2.md, as a new paragraph right after the Finance paragraph in Step 3 (after line 41, "Where this gives no answer ..."), and in the live routine trig_01BA2jJY2nCCd1MozSm17pS3. Paste the text between the two lines into the prompt. Then replace the v2 lines listed under "Line changes" below, each quoted as it reads now, so the rest of the prompt agrees with the paragraph.

For the owner, not the prompt: the monthly fetch is a pg_cron job calling `net.http_post`, and its failures are silent (nothing raises, nothing is logged in the job's own status). After the first cron run on the 1st, check `select id, status_code, timed_out, error_msg, created from net._http_response order by id desc limit 5;` and look for a 200 from the function. Rows there are kept for a few hours only, so check the same day.

The time zone is America/Denver, confirmed by the owner on 2026-11-04.

---

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

---

## Line changes in routine-prompt-v2.md

Each quotes the line exactly as it reads now (leading spaces included), then gives the whole line to paste over it.

**Line 31**, now:

```
## Step 3: score. 21 questions; every answer is an integer 1-5 or null
```

Replace with:

```
## Step 3: score. 22 questions; every answer is an integer 1-5 or null
```

**Line 45**, now:

```
- Give COMPLETE answers. Use 3 for thin evidence rather than a blank. Only gated Advocacy stays null; finance is never null (see the finance rule).
```

Replace with:

```
- Give COMPLETE answers. Use 3 for thin evidence rather than a blank. Only gated Advocacy stays null; fin_rack_rate and fin_rate_increased are never null (see the finance rule). fin_hours_in_budget is null when it does not apply, and when the hours rule gives no answer (see the hours rule); never fill it with a 3 to make a row complete.
```

**Line 57**, now:

```
For each scored client build ai = {"suggested_at": <now, ISO>, "run_id": <run_id>, "notes": <note>, "answers": {<the 19 non-finance keys (every answer column except fin_rack_rate and fin_rate_increased), each a JSON number or null — never quoted>}}.
```

Replace with:

```
For each scored client build ai = {"suggested_at": <now, ISO>, "run_id": <run_id>, "notes": <note>, "answers": {<the 19 judged keys (every answer column except fin_rack_rate, fin_rate_increased and fin_hours_in_budget), each a JSON number or null — never quoted>}}.
```

**Line 58**, now:

```
complete = after your write, the row has no null in any of the 21 answer columns, ignoring the four adv_* columns when the gate is shut.
```

Replace with:

```
complete = after your write, every required question is answered; hours counts only when it applies. That is: no null in any of the 21 answer columns other than fin_hours_in_budget, ignoring the four adv_* columns when the gate is shut; and, only when hours applies (hours rule, step 1), fin_hours_in_budget is not null too.
```

**Line 60**, now:

```
- No row for (client_id, period): insert the 21 answers (19 scored + the 2 finance answers), notes, ai_suggestion=ai, suggested_at=now(), submitted_at = (now() if complete else null), submitted_by = (owner if complete else null).
```

Replace with:

```
- No row for (client_id, period): insert the 22 answers (19 scored + the 2 finance answers + fin_hours_in_budget), notes, ai_suggestion=ai, suggested_at=now(), submitted_at = (now() if complete else null), submitted_by = (owner if complete else null).
```

**Line 61**, now:

```
- Row with suggested_at IS NOT NULL: update the 21 answers, notes, ai_suggestion, suggested_at=now(), submitted_at/submitted_by as above.
```

Replace with:

```
- Row with suggested_at IS NOT NULL: update the 22 answers, notes, ai_suggestion, suggested_at=now(), submitted_at/submitted_by as above.
```

**Line 64**, now:

```
  - otherwise: update ONLY ai_suggestion = ai. Leave every answer (finance included), notes, suggested_at, submitted_at untouched.
```

Replace with:

```
  - otherwise: update ONLY ai_suggestion = ai. Leave every answer (finance and hours included), notes, suggested_at, submitted_at untouched.
```

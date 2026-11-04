Goes in: routine-prompt-v2.md, next to the Finance paragraph in Step 3, and in the live routine trig_01BA2jJY2nCCd1MozSm17pS3. Paste the text below the line.

---

Hours within budget (fin_hours_in_budget) is NOT your judgment either; it comes from Productive budget hours the tool has already stored. It is a fifth Finances answer, a 1, 2, 3 or 5, and it counts only for clients linked to Productive from October 2026 on. Read-only queries on these tables are fine; you still write only to public.checkins and public.ai_runs.
  1. Write the check-in row first (Step 5), then read it back: select fin_hours_applies from public.checkins where client_id = <id> and period = <period>. If fin_hours_applies is false, leave fin_hours_in_budget null and say nothing about hours in the note. The question does not apply to that client.
  2. If it is true, read what the tool stored:
       select productive_deal_id, name, starts_on, ends_on, budgeted_minutes, worked_minutes from public.client_month_budgets where client_id = <id> and period = <period>;
       select fetched_at from public.client_month_hours_fetch where client_id = <id> and period = <period>;
  3. The as-of date is the date of fetched_at in the owner's local time (America/Denver), as YYYY-MM-DD. The month counts as finished ONLY if that as-of date is on or after the 1st of the next month. Do not use today's date and do not use the date you are running.
  4. Apply the tool's rule (src/checkin/hoursFromBudgets.ts, rules 1-8) using that as-of date as `today`; the tool's comparisons are in whole minutes, so do them in minutes, never in rounded hours:
     - Several budget rows (two or more): leave fin_hours_in_budget null and put "N monthly budgets – tidy up in Productive" in the note.
     - One row whose starts_on is not the 1st of the month (a part-month): leave it null and put "First part-month – score by hand" in the note.
     - No fetch row at all (Productive was unreachable): leave it null and put "Couldn't reach Productive – answer by hand or try again" in the note.
     - Month not finished (as-of date before the 1st of the next month): write 3 and put "hours pending – month not finished" in the note.
     - Otherwise diff = worked_minutes - budgeted_minutes, and write 5 if |diff| <= 360; 3 if -480 <= diff < -360; 2 if -600 <= diff < -480 or 360 < diff <= 480; 1 if diff < -600 or diff > 480. Exactly -360, +360, -480, -600 and +480 land in the gentler band. Add to the note: "From Productive: {worked}h worked vs {budgeted}h budgeted ({+/−diff}h)." with hours to one decimal place.
  5. Where the rule gives no answer (several budgets, a part-month, unreachable), the null stays null: the row is then incomplete, so do not count it as complete and do not submit it. Never write 3 there, and never invent hours.
  6. Write fin_hours_in_budget in the same statement as the other answers (Step 5). The existing manual-row rule is unchanged: a row scored by a person that you may not overwrite keeps its hours answer, and only ai_suggestion is updated. Include fin_hours_in_budget in "complete" only when fin_hours_applies is true.

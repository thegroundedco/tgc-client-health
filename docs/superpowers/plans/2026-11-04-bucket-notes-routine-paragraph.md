Goes in: routine-prompt-v2.md, as a new paragraph right after Step 4 (after line 52, "2-5 plain sentences of the actual evidence ..."), and in the live routine trig_01BA2jJY2nCCd1MozSm17pS3. Paste the text between the two lines into the prompt. Then replace the v2 lines listed under "Line changes" below so the rest of the prompt agrees with the paragraph.

APPLY AFTER THE HOURS PARAGRAPH (2026-11-04-productive-budget-hours-routine-paragraph.md). Its replacements for lines 31, 45, 57, 58, 60, 61 and 64 are applied first; every line quoted below reads as it does AFTER those replacements. Lines 31, 45 and 58 are not touched here. Applying the hours paragraph alone, or this one on top of it, leaves a prompt that agrees with itself. Nothing here changes an hours rule, and the 22 answers stay 22: notes and focus are not answers and never count toward "complete".

For the owner, not the prompt: applying this to the live routine is a separate step that needs the owner's approval. The columns checkins.bucket_notes and checkins.focus must be on production first (migration 20261104150000_bucket_notes_and_focus); until they are, a write that names them fails.

---

Step 4b: per-bucket notes and a monthly focus. For every client you score, besides the note, write what each bucket's score rests on and what to do about it. These are text for the account manager to read; they never change an answer, a score, or "complete".

bucket_notes: a JSON object with one key per bucket you scored, and only these six keys: communication, growth, finances, relationship, delivery, advocacy. Each value is an object with only two possible fields, why and actions, and nothing else:
  - why: 1-3 plain sentences naming the dated evidence behind that bucket's score (who, what, when), drawn from the Fathom, Gmail and Slack evidence you already gathered.
  - actions: 1-3 short, concrete next steps for the account manager this month. Leave actions out for a bucket where every question you answered scored 5, unless there is a clear opportunity.
  - Never invent evidence. If there is no evidence for a bucket, why says so ("No calls, emails or messages about this in the month."), and you write no actions that pretend otherwise.
  - Leave Advocacy out while its gate is shut (all four adv_* null). Use finances the way the finance rules do: say "finance pending revenue" or the hours placeholder where that is the state, never made-up figures.

Limits (the database refuses anything outside them, and a refused statement loses the whole row write for that client). As a safety margin, keep each why and actions under about 1500 characters and focus under about 750:
  - Only the six bucket keys above. Only why and actions inside a bucket.
  - Every field is a non-empty string of at most 2000 characters. No empty strings, no nulls.
  - A bucket with neither field is OMITTED. Never write an empty object {} for a bucket.
  - If no bucket has anything to say, bucket_notes is {}.

focus: the one or two most important things to work on with this client this month, in one or two sentences, 1-1000 characters. Write it ONLY when the gate value is below 3.6 (Watch or At-risk). The gate value is the tool's overall: the mean of the 17 answers outside Advocacy, plus fin_hours_in_budget when hours applies (18 answers), rounded to 2 decimal places (3.597 rounds to 3.60, which is Healthy, so no focus). If that overall would be null only because fin_hours_in_budget is blank (hours applies but was left for a person), use the mean of the other 17, rounded to 2 decimal places: a struggling client still gets a focus. When the gate value is 3.6 or higher, focus is null. It is either null or a non-empty string, never "".

Exact shape (the same object goes in ai_suggestion and, where allowed, in the row):
  "bucket_notes": {"communication": {"why": "<text>", "actions": "<text>"}, "delivery": {"why": "<text>"}}
  "focus": "<text>"   or   "focus": null

Where it goes:
  - ai_suggestion ALWAYS carries bucket_notes and focus, for every client you score, whether or not you may overwrite its row.
  - The ROW's bucket_notes and focus columns are written only for rows you may overwrite: the same rule as the answers (a new row, a row with suggested_at set, or a manually scored row whose client is in overwrite_client_ids). On a manually scored row you may not overwrite, leave the row's bucket_notes and focus untouched and update only ai_suggestion. Where you write the row, write focus = null when it does not apply, so last run's focus does not linger.

Build the jsonb in SQL with jsonb_build_object (or a parameterised literal), never by pasting notes into a hand-written JSON string, so an apostrophe or a double quote in a note cannot break the statement. For example:
  jsonb_build_object('communication', jsonb_strip_nulls(jsonb_build_object('why', $w1$...$w1$, 'actions', $a1$...$a1$)), 'delivery', jsonb_strip_nulls(jsonb_build_object('why', $w2$...$w2$)))
Wrap each bucket's object in jsonb_strip_nulls(jsonb_build_object('why', ..., 'actions', ...)): the CHECK refuses null fields, and a field you have nothing for would otherwise be written as null. jsonb_strip_nulls leaves an empty object when both fields are null, so still omit a bucket rather than write {}.
Use a different dollar-quote tag for every piece of text, as the note does. Build the same value once and use it in both places (ai_suggestion = ai || jsonb_build_object('bucket_notes', <that value>, 'focus', <text or null>); bucket_notes = <that value>; focus = <text or null>).

---

## Line changes in routine-prompt-v2.md

Each quotes the line as it reads AFTER the hours paragraph's replacement, then gives the whole line to paste over it. Apply these after the hours paragraph.

**Line 3**, now (unchanged by the hours paragraph):

```
Your scores go into the client health tool as SUGGESTIONS that a person reviews. The ONLY database writes allowed are those in steps 0, 5 and 6, all on public.checkins and public.ai_runs. Never DELETE, never ALTER, never touch any other table, never post to Slack, never create drafts, and send email only as step 6 says.
```

No change needed: bucket_notes and focus are columns of public.checkins, so these writes are already inside the rule.

**Line 57**, now (as the hours paragraph leaves it):

```
For each scored client build ai = {"suggested_at": <now, ISO>, "run_id": <run_id>, "notes": <note>, "answers": {<the 19 judged keys (every answer column except fin_rack_rate, fin_rate_increased and fin_hours_in_budget), each a JSON number or null — never quoted>}}.
```

Replace with:

```
For each scored client build ai = {"suggested_at": <now, ISO>, "run_id": <run_id>, "notes": <note>, "answers": {<the 19 judged keys (every answer column except fin_rack_rate, fin_rate_increased and fin_hours_in_budget), each a JSON number or null — never quoted>}}, then merge in bucket_notes and focus as step 4b says (ai = <that literal>::jsonb || jsonb_build_object('bucket_notes', <step 4b value>, 'focus', <text or null>)); do not put them inside the dollar-quoted literal.
```

**Line 59**, now (unchanged by the hours paragraph):

```
Quote notes and the JSON with dollar quotes ($n$...$n$) so apostrophes are safe. One statement per client:
```

Replace with:

```
Quote notes and the JSON with dollar quotes ($n$...$n$) so apostrophes are safe, and build bucket_notes with jsonb_build_object (step 4b) so quotes inside a note cannot break the statement. One statement per client:
```

**Line 60**, now (as the hours paragraph leaves it):

```
- No row for (client_id, period): insert the 22 answers (19 scored + the 2 finance answers + fin_hours_in_budget), notes, ai_suggestion=ai, suggested_at=now(), submitted_at = (now() if complete else null), submitted_by = (owner if complete else null).
```

Replace with:

```
- No row for (client_id, period): insert the 22 answers (19 scored + the 2 finance answers + fin_hours_in_budget), notes, bucket_notes, focus, ai_suggestion=ai, suggested_at=now(), submitted_at = (now() if complete else null), submitted_by = (owner if complete else null).
```

**Line 61**, now (as the hours paragraph leaves it):

```
- Row with suggested_at IS NOT NULL: update the 22 answers, notes, ai_suggestion, suggested_at=now(), submitted_at/submitted_by as above.
```

Replace with:

```
- Row with suggested_at IS NOT NULL: update the 22 answers, notes, bucket_notes, focus, ai_suggestion, suggested_at=now(), submitted_at/submitted_by as above.
```

**Line 64**, now (as the hours paragraph leaves it):

```
  - otherwise: update ONLY ai_suggestion = ai. Leave every answer (finance and hours included), notes, suggested_at, submitted_at untouched.
```

Replace with:

```
  - otherwise: update ONLY ai_suggestion = ai (it still carries bucket_notes and focus). Leave every answer (finance and hours included), notes, bucket_notes, focus, suggested_at, submitted_at untouched.
```

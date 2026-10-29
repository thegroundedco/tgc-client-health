# Suggested check-ins — AI scores that wait for a person

Since 2026-10-28 the owner has asked for "AI suggested scores" each month: Claude reads his Gmail,
Slack and Fathom recaps and writes a check-in per client straight to production. Those rows are
indistinguishable from his own — the only sign is a note starting "AI-suggested:". He has already
corrected three of them by hand (Sno-Go and Triquetra for September, Babaloo for October), which is
the evidence that review is real work and needs a place in the tool.

Agreed with the owner, 2026-10-29:

- **A suggested check-in counts, flagged.** Its score shows and counts everywhere a score counts
  today; a visible "Suggested — review" marker says nobody has looked yet.
- **Review = Confirm, or any save.** A Confirm button clears the flag and changes nothing else.
  Saving the check-in screen — changing an answer or the note — also clears it.

---

## 1. Data

One nullable column on `public.checkins`:

```sql
alter table public.checkins add column suggested_at timestamptz;
```

- `suggested_at is not null` ⇔ the row was written as a suggestion and no person has reviewed it.
- Null ⇔ a person entered it, or reviewed it.
- No CHECK, no new policy, no grant: `checkins_update_edit_scores` already decides who may update a
  row, and the table-level grant covers a new column (the same argument as
  `20260912090000_add_client_context.sql`). Anyone who may score may review.
- `public.checkin_scores` does not need it — the board reads `checkins` directly for the card, and
  the view's columns are unchanged.

### Backfill (in the same migration)

```sql
update public.checkins
set suggested_at = created_at
where notes like 'AI-suggested:%'
  and updated_at <= created_at + interval '1 minute';
```

`updated_at` is touched by `checkins_touch_updated_at` on every update, so a row a person has saved
since it was written has `updated_at` well after `created_at` and stays null. On production at
2026-10-29 this marks **24 rows**: 11 of September's 13 (not Sno-Go, Triquetra) and 13 of October's
14 (not Babaloo). August has no "AI-suggested:" rows. The migration's verification query must
reproduce 24 before it is called applied.

**Note:** setting `suggested_at` itself fires the touch trigger and moves `updated_at` — so the
backfill must be one statement, and the predicate is evaluated against the pre-update row. A second
run would match nothing (updated_at now ≫ created_at), which makes it safe to re-run and impossible
to double-apply.

## 2. Clearing it

- **Confirm** — `update checkins set suggested_at = null where client_id = $1 and period = $2`,
  ending `.select(...).maybeSingle()`; a null result is a failure (the same RLS-filters-silently
  case `useClients` documents), shown as such.
- **Save** — the check-in screen's upsert (`useCheckin`) sends `suggested_at: null` explicitly,
  alongside every answer column. It already sends the whole row on every save; this is one more
  key. Any save by a person is a review.

## 3. Setting it

Claude's monthly AI round writes `suggested_at = now()` on every row it inserts. That is a practice,
recorded in memory, not code — the app never sets the column.

## 4. What the owner sees

- **Card** (`ClientCard`): when the month's check-in has `suggested_at`, a small "Suggested —
  review" marker beside the score. The score still renders, the band still applies.
- **Matrix**: a marker on the client name cell (the same word, visually smaller), so the grid shows
  which rows are unreviewed. Screen-reader text: "Suggested, not yet reviewed".
- **Progress line**: when any member's check-in is suggested, append ` · N to review`, e.g.
  "All 14 check-ins submitted for October 2026 · 12 to review". Absent when N is 0. N counts the
  month's members only (the same set as the line's M).
- **Check-in screen**: when the stored row has `suggested_at`, a line above the totals —
  "Suggested by AI on Oct 29. Check the answers, then Confirm — or change anything and save." —
  and, for a profile with `edit_scores`, a **Confirm** button beside it. After Confirm succeeds the
  line disappears and the save-status region confirms it ("Confirmed <time>."). After a save
  succeeds the line also disappears, because the stored row now has `suggested_at` null.
- A viewer without `edit_scores` sees the line but no button.

## 5. Out of scope

- Who suggested (a `suggested_by`): every suggestion so far is Claude's; add it when that changes.
- Overview, Revenue, trends, the overall-score maths. A suggested score counts exactly as now.
- Bulk "confirm all". One click per check-in is the review; a bulk button would invite skipping it.
- Removing the "AI-suggested:" note prefix. It stays as the historical marker.

## 6. Tests that must exist, each watched to fail

- `CHECKIN_COLUMNS` includes `suggested_at` (cardSummary.test).
- `progressLine` with a review count: 0 → no suffix; N>0 → " · N to review"; only members counted.
- `useBoard` exposes `toReview`: the number of the month's members whose check-in has
  `suggested_at` set. A suggested row and a reviewed row in the same month must give 1, not 2.
- ClientCard renders the marker iff `suggested_at` is set; Matrix likewise, with the hidden text.
- `useCheckin` upsert payload contains `suggested_at: null` (a test that would fail if the key were
  dropped — assert the key is present, not merely falsy).
- Confirm: sends an update filtered on BOTH client_id and period, ends in `.maybeSingle()`, treats
  null as failure, clears the line on success, renders only with `edit_scores`, and is not offered
  when `suggested_at` is null.
- The migration: parsed-SQL assertions (per the repo's generated-SQL rule) that it adds exactly
  `suggested_at timestamptz` and that the backfill's WHERE contains both the note predicate and the
  updated_at predicate.
- Mutation pass: drop `suggested_at: null` from the upsert; drop the period filter from Confirm;
  invert the marker condition; count non-members in the review total — each must fail a test.

## 7. Rollout

1. Apply the migration to **staging** (`dexsdhtpfsswgiytxntl`) via the Supabase MCP; verify the
   column and the backfill count there (staging has its own rows — state the count found).
2. Owner looks at staging in the dev server.
3. Apply to **production** (`jizavsawtbkmvzllxhtk`) via MCP; verify **24** rows suggested and that
   Sno-Go Sept, Triquetra Sept and Babaloo Oct are null. Then merge and push (push = deploy). The
   column must exist in production BEFORE the new bundle is live, because the bundle reads it.

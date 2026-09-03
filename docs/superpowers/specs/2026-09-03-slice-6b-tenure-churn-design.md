# Slice 6b — tenure and churn

Source: the owner's boss asked for a tenure and churn report. It was scoped as "Slice 6" on
2026-08-27 and has waited since. The owner's IA of 2026-09-02 gave it a home: **Revenue** holds
"revenue retention and churn", so this lands there rather than becoming a destination of its own.

Read-only. No migration, no write, nothing this report can break.

## 1. What the data actually says, checked before designing

Production, read 2026-09-02 (`jizavsawtbkmvzllxhtk`). This section exists because the shape of the
report follows from it, and a future reader who assumes a rich churn dataset will misread every
decision below.

| | |
|---|---|
| active clients | **10, and all ten have `started_on`** |
| tenure spread | 0.5 to 14.3 months, mean 6.5 — 3 under three months, 5 between three and twelve, 2 over a year |
| churn events (`cancelled` or `former`) | **1** — a `former` client, ended 2026-08-25, reason `other` |
| churn events with a known start date | **0** |
| `paused` clients | 1, with no `started_on` |

**The tenure half is fully alive. The churn half is one blind row.** The single churn event has no
`started_on`, so tenure-at-churn — the number the report exists to eventually show — is unknowable
for the only churn there is.

That is not a surprise and not a defect. The owner ruled **NO BACKFILL** on 2026-08-27: the tenure
logic applies to current and future clients only, and he was told at the time that the cohorts would
stay empty until a real client churned and somebody recorded the reason. One has, without a start
date. The report is built to be honest about that rather than to hide it.

## 2. What is in this slice, and what is not

**In.** A tenure list of every current client, sorted longest-standing first, with a summary line. A
churn ledger: who left, when, why, the note, and how long they had been with you. Both on the
Revenue destination, above the existing note about revenue retention.

**Not in.** Churn RATE, tenure-at-churn cohorts, and any percentage — §6. Revenue retention itself,
which is blocked on a data model that does not exist (§7). Any database change. Any write.

**Explicitly not in: backfilling `started_on`.** The owner ruled it out on 2026-08-27 and the ruling
stands; this report is the thing that makes its absence visible, not a reason to reopen it. Do not
re-propose entering historical clients.

## 3. Tenure

**Every client who has not left**, which by §4 includes `paused`, sorted longest-standing first.

Counted **to today**. This is a live report and the number moves; the alternative — counting to the
end of the last complete month — was considered and rejected as a number that is stale for up to
thirty days in a tool whose whole subject is how things stand now.

**A client with no `started_on` reads "unknown", never zero and never a dash that could be mistaken
for one.** This is the same rule Slice 5 fixed in the matrix, where `'None yet'` and `'—'` had to
stay distinguishable: an absent measurement and a measurement of zero are different facts, and a
report that renders them alike is lying about one of them.

**The summary line** states the count, the median and the longest. Median rather than mean: with ten
clients one fourteen-month relationship drags a mean somewhere no client actually sits.

**Two things the summary must get right, because both are easy to get wrong quietly.**

The **count** is every current client, including any whose start date is unknown — it answers "how
many clients do we have", and a client with no recorded start date is still a client.

The **median and the longest are computed over the known tenures only**, and the line says how many
were left out when any were. Treating an unknown as zero would drag the median down and silently
report a shorter typical relationship than the firm actually has; dropping those clients from the
count as well would answer a different question from the one the line appears to answer. So: count
everybody, measure only what is measured, and say when the two differ.

**Clients with an unknown start date sort to the END of the list**, after every known tenure, rather
than being treated as the shortest. They are not the newest — they are unmeasured, and putting them
where "two weeks" belongs would assert something the data does not say.

### 3.1 The arithmetic, and the bug it must not have

Dates here are `YYYY-MM-DD` strings, which is what a Postgres `date` renders as. **A bare
`YYYY-MM-DD` parsed with `new Date()` is UTC midnight, and in any western zone its local calendar
day is the day before.** `src/lib/gate.ts` documents this exact trap and solves it with `Date.UTC`
for the 90-day Advocacy gate; the same approach is used here.

Left naive, every tenure would be a day short for roughly half the year, and every test written in
UTC would pass. That is why the arithmetic is a pure module with its own tests rather than a few
inline subtractions.

Tenure is rendered in whole units — "1 yr 2 mo", "9 mo", "2 wk" — because a client relationship is
not a precise quantity and "0.53 months" would claim a precision nobody has.

## 4. `paused`, a status that appears in no spec

Production holds one, and the parent spec's lifecycle section defines only `active`, `cancelled` and
`former`. The database's check constraint is the tiebreaker: it **refuses a paused client an end
date**, so by the schema's own rules a paused client has not ended.

So a paused client **appears in the tenure list, marked** — owner's call, 2026-09-02. Their tenure
still runs, because the relationship has not ended. The marker is what stops them being read as
ordinary; without it the roster count would silently include somebody who is not currently being
served.

They are **not** in the churn half. Counting a pause as a departure would contradict the constraint
and invite reading a paused client as lost.

## 5. Churn

**Who left, when, the coded reason, the note, and how long they had been with you.**

Both halves of the reason are shown, and the parent spec says why: `end_reason_code` is drawn from a
fixed list "so reasons are countable across clients", while `end_reason_note` "carries the nuance —
a coded reason alone loses the story, and free text alone cannot be counted, hence both". A ledger
showing only the code would be the countable half of a thing whose story is the point.

Tenure-at-churn reads **"unknown"** where the client has no `started_on` — which today is the only
row there is. It is not blank and not zero.

**Cancelled and former are both churn**, per the parent spec: they are "the same event at different
ages", one recent and still under review, one settled. They are not separated here.

## 6. No rate, no cohorts, and the page says so

The boss's original ask implies a churn rate and tenure-at-churn cohorts. **This slice ships
neither**, on the owner's decision of 2026-09-02, and the report states plainly why rather than
leaving a reader to wonder.

A rate computed on one event is 9.1% — a number that reads as a fact, carries a decimal place, and
means nothing. Cohorts of tenure-at-churn would render three empty bands, because the one churn
event has no start date to sort into one. Both would be machinery that looks like analysis while
having nothing to analyse, and this codebase's standing rule is the opposite: a blank region reads
as a failed load, and an empty state is an invitation to act.

So the churn section carries a sentence saying a rate needs more than one departure and that
tenure-at-churn needs the departed to have a recorded start date. That sentence stops being true on
its own, the day the data supports it — at which point the cohorts are a separate, easy slice.

## 7. Where it sits

The **Revenue** destination, above the existing paragraph about revenue retention. That paragraph
stays and stays true: revenue retention needs a history of monthly amounts, which one editable
retainer field cannot produce, and no data model for it exists.

So the page reads: what we can tell you about how long clients stay and who left, then what is still
missing and why. It stops being a page that only apologises.

## 8. Modules

- `src/revenue/tenure.ts` — pure arithmetic and sorting. Tenure from a start date to today, the
  summary figures, the split into current and departed. No React, no network, zone-safe dates.
- `src/revenue/useTenure.ts` — one read of every client's lifecycle columns. Mirrors `useBoard`'s
  shape (`status` / `loadError` / rows / `reload`) so the screen's read can be mocked, which is the
  reason that hook exists at all.
- `src/revenue/Tenure.tsx`, `src/revenue/Churn.tsx` + one stylesheet — the two sections.
- `src/shell/Revenue.tsx` — gains them above its existing note.

A new `src/revenue/` directory rather than adding to `src/board/`: this reads different rows, answers
a different question, and belongs to a different destination.

**`useClients` is deliberately not reused**, though it already fetches exactly the right columns. It
carries add, edit, invite and reset machinery for a screen that writes; a read-only report inheriting
all of it would be coupled to every future change made for the admin screen's benefit.

## 9. Testing

| File | Covers |
|---|---|
| `src/revenue/tenure.test.ts` | tenure across a month and a year boundary; **a date that would be a day short under naive parsing**; a null start date yielding "unknown", never zero; the sort; median with even and odd counts; paused included, departed excluded |
| `src/revenue/useTenure.dom.test.ts` | loading, error and ready; that a failed read reports an error rather than an empty list |
| `src/revenue/Tenure.dom.test.tsx` | order, the summary line, the paused marker, "unknown" for a missing start date |
| `src/revenue/Churn.dom.test.tsx` | a row's five parts; "unknown" tenure-at-churn; the empty state; that no percentage is rendered |
| existing suites | must pass unchanged |

The Churn test asserting **no percentage appears** is a tripwire, not a formality: a rate is the
obvious thing to add to a churn report, and §6 is the reason it must not be added while one event is
all there is.

## 10. Decisions, with what each costs

**A sorted list, not a distribution.** Owner's call, 2026-09-02. Costs the at-a-glance shape a chart
gives. Buys knowing *which* client is new and which is established, which at ten clients is the
question actually being asked; a three-band chart hides the names behind counts of two to five.

**Counted to today, not to a month end.** Costs a number that changes under you between visits.
Buys a report that is true when read.

**Paused shown and marked.** Costs one more concept on the page. Buys a roster count that matches
reality, and no silent absence.

**No rate and no cohorts, with a sentence saying why.** Costs the thing the boss probably pictured.
Buys not shipping a 9.1% that reads as fact and is built on one blind row.

**A new `src/revenue/` rather than growing `src/board/`.** Costs a directory. Buys the board not
becoming the place everything lands.

## 11. Open items

- **`started_on` is optional and probably should not be.** A client added without one is invisible
  to this report and silently scores no Advocacy. This report makes that consequence visible for the
  first time; making the field required is a separate change to `clientForm.ts` and its screens.
- **The one churn event has no start date**, so tenure-at-churn is unknowable for it. Nothing to do —
  the no-backfill ruling stands — but it is why the churn half will look thin for a while.
- Carried forward, untouched: Overview's contents still need the owner; the revenue data model is
  still owed as a proposal.

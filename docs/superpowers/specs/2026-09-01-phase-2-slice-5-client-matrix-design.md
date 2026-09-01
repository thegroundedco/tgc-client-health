# Phase 2, Slice 5 — the client × bucket matrix

Source: the owner's boss, "TGC Client Health Scoring" (Google Doc, read 2026-09-01 — the same
document Slice 4 was built from, read directly this time rather than through a summary), plus the
pencil sketch embedded in it, which the owner screenshotted on 2026-09-01. Slice 4's spec recorded
that sketch as "an image this design could not read"; it has now been read, and this slice is
built from it.

The boss's own sentence, which is the whole requirement:

> As a way to see how our clients are doing and also as a way to see how we're doing internally, we
> want to have a matrix that shows our clients on the Y-axis and the health score buckets on the
> X-axis, that way, we can look at how our communication bucket is averaging across all our clients
> vertically, and see how each client is performing horizontally.

## 1. A correction that comes first

Slice 4's plan and its production checklist both describe Slice 5 as "the Overview homepage from the
owner's whiteboard sketch: the OVERVIEW / CLIENTS / REVENUE nav lifted into `App.tsx`'s shell, six
stat lines in two columns, and the client-by-bucket matrix".

**The nav and the six stat lines are not in any source.** That sentence appears in exactly two
files, both written by the assistant as carry-forward notes, and in no spec. Asked about it on
2026-09-01, the owner did not recognise it. The sketch, once read, contains no nav and no stat
lines. Both are dropped, and this section exists so that a future reader who finds the old sentence
knows it was retired deliberately rather than forgotten.

**What the sketch actually contains:** a grid of five clients down the Y-axis against five bucket
columns (Rel., Comms, Deli, Grow, Adv.), cells holding 1-5 scores, a heavy ellipse drawn around the
whole Comms column, and to the right of a rule the legend `12 = yellow`, `20 = green`, `10 = red`.

The circled column is the point of the drawing. Comms reads 2, 2, 1, 2 down the roster — a bucket
that is weak across every client. Nothing in the tool today can show that, because both the board
and the check-in screen are organised one client at a time.

The 20 / 12 / 10 legend is thresholds on a row total out of 25. It agrees with what already
shipped: the bands are 3.6 and 2.2 on a 1-5 mean, which on five buckets is 18 and 11. The sketch
and the live app describe the same cut points from opposite ends, so no threshold moves in this
slice.

## 2. What is in this slice, and what is not

**In.** The matrix itself: every active client against all six buckets, each client's overall score
and band, and a per-bucket average across the roster. A view toggle on the board that switches
between the cards and the matrix. No new columns, no new tables, no migration, and no new query.

**Not in.**

- **Revenue.** The owner's carry-forward notes describe a REVENUE nav item, and the open question
  "revenue retention has no data answer" has been outstanding since Slice 4. The answer is that
  revenue is not a missing field but a missing subsystem, and the v1 spec
  (`2026-08-20-tgc-client-health-design.md`) already designed it and said why it cannot be a column:

  > Revenue lives in its own tables rather than as columns on `checkins` for a structural reason:
  > **row-level security hides rows, not columns.**

  It is two tables (`sows`, `client_month_revenue`), four capabilities (`view_revenue`,
  `view_retention`, `view_sows`, `edit_sows`), and monthly amounts derived from SOWs with a
  per-month override. That spec calls it Phase 2 — Money, and puts net revenue retention in
  Phase 3 — Insight. **Retention needs a history of monthly amounts**, which is exactly what a
  single editable retainer field cannot produce: editing it destroys the value you would compare
  against. This is its own slice, and it is not this one.

- **The tenure and churn-reason report** (the boss's fourth ask) remains Slice 6, unchanged from
  Slice 4 §2.

- **Trends over time.** The matrix shows one month, the month the board is showing. A second month
  beside it is a different design and nobody has asked for one.

## 3. Where it lives

**A view toggle on the board, not a new screen.** `Cards | Matrix`, beside the month dropdown.

Three reasons, in order of weight:

1. **One period, never two.** `Board.tsx` already owns a single `period` and passes it to the
   check-in it opens, with a comment explaining that a card summarising one month while its
   check-in edits another is what makes a person stop trusting the number. A separate matrix screen
   would need its own month control, and there would be two places for a period to drift. As a view
   of the same board, the matrix inherits the month dropdown and cannot disagree.
2. **No new data.** `useBoard` already loads every active client and every check-in row for the
   period, and `CardCheckin` already carries all six generated `*_score` columns because the card's
   bars read them. The matrix reads the same columns from the same state. It is a second rendering
   of data already in memory.
3. **No invented navigation.** Lifting the Clients and People routes out of `Board.tsx` into an app
   shell nav is a real refactor with real value, and it is not required by anything in the source.
   It stays available as its own piece of work rather than being smuggled in here.

The toggle is not persisted, matching every other view state on this screen: a reload lands on the
cards, which is where the monthly work is done.

## 4. The grid

```
                  C      G      F      R      D      A     Overall
Babaloo          3.67   3.33   4.00   3.75   3.50   5.00    3.59   Watch
Colorfil         5.00   5.00   5.00   5.00   5.00   1.00    5.00   Healthy
Gait Happens     4.67   4.67   4.67   5.00   4.75   4.00    4.71   Healthy
LoFli Balls      4.67   5.00   4.33   5.00   5.00    —      5.00   Healthy
York             3.00    —     3.33   3.33   2.75   1.00     —     Not scored
                 ────   ────   ────   ────   ────   ────
Average          4.20   4.50*  4.27   4.42   4.20   2.75
```

Both missing-cell rules are visible in that example, and they behave differently.

**York's Growth is unscored**, so Growth averages the four clients who have a score — 18.00 ÷ 4 =
4.50, not 18.00 ÷ 5 = 3.60 — and carries an asterisk, because a fifth client could have been scored
and was not.

**LoFli Balls has no Advocacy score because they are inside 90 days.** Advocacy therefore has four
eligible clients, all four are scored, and the average is 11.00 ÷ 4 = 2.75 with **no asterisk**.
Nothing is missing; the gate is doing its job.

**York's row shows what a half-finished check-in looks like**, and the two em dashes on it are not
the same kind of gap. One of York's three Growth answers is blank, so `growth_score` is null — a
bucket mean is null if any of its answers is missing, never an average of the ones present. And
because the overall is the mean of all seventeen non-Advocacy answers, that same blank answer makes
`overall_score` null too: York reads **Not scored**, not a low score.

That is the model working as designed rather than an edge case to smooth over. It also means York
still contributes to five of the six column averages — Communication, Finances, Relationship,
Delivery and Advocacy are each complete for them — so a client can be unscorable overall and still
be part of what the agency's numbers are built from.

**Rows are every active client**, always, in alphabetical order. Not "whatever the cards are
showing": the show-archived toggle must not change the Average row, because that number describes
the agency and it should not move because somebody pressed a display control. `isOnBoard(status)`
is the existing definition of active and is reused unchanged.

Alphabetical is what `visibleClients` already produces for the default board view — it sorts by
status rank then name, and with only active clients the status rank is uniform. The matrix therefore
sorts by name directly rather than routing through a helper whose status-grouping arm it never uses.

**Columns are the six buckets in rubric order**, headed by `BUCKET_DEFINITIONS[bucket].label` —
the full words. AMENDED 2026-09-01 by the owner, after seeing it built: the header row reads
`Client`, the six bucket names, `Overall`. The card's bars use the one-letter `initial` because six
letters have to fit under six bars in a 15rem card; a table column has room for the word, and the
word saves the reader knowing the rubric by heart. The `initial` is untouched and still the card's.

**There is no Band column.** AMENDED 2026-09-01 by the owner: the band reads beside the client's
name — `Babaloo - Watch` — in the row header. It sits OUTSIDE the name's button, so the control's
accessible name stays the client and the band does not look clickable. §5's "colour is never the
only carrier" is satisfied better than before: the name cell now prints its own band word and every
numeric cell prints its number.

**Cells are the generated bucket score**, read from `checkin[BUCKET_SCORE_KEY[bucket]]` — the same
Postgres-computed column the card's bar reads. The matrix does not recompute a bucket mean in
TypeScript. This is not an optimisation: it means the matrix and the bars cannot disagree about a
bucket, by construction rather than by test.

Formatted with `toFixed(2)`, matching the card's total. One rounding rule in the app.

**The Overall column** is `overall_score` from `checkin_scores`, `toFixed(2)` — the same number the
card shows. Its band label is in the client cell, above.

**Three heavy gridlines group the sheet.** AMENDED 2026-09-01 by the owner, who reads these tables
the way he reads a spreadsheet: two border weights and no more — the 1px page-coloured gutter
between cells *inside* a block, and a 2px ink rule *between* blocks. The rules go under the header
row, down the left edge of Overall, and above the Average row. That is the whole of it; a third
weight would stop the two carrying meaning.

## 5. Colour

**One rule, everywhere: the existing bands.** `band(value)` from `scoreMath.ts`, thresholds 3.6 and
2.2, tokens `--band-healthy` / `--band-watch` / `--band-risk` / `--band-none`.

- **Client name and Overall** — banded on `overall_score`.
- **Every cell** — banded on that cell's own bucket score.
- **The Average row** — banded on the average.

The owner described the cell rule as "4 and 5 green, 3 and 2 yellow, and 1 red". That agrees with
the shipped bands on 5, 4, 3 and 1, and disagrees on exactly one value: a bucket scoring 2.00 is
below the 2.2 threshold and is therefore At risk, not Watch. Ruled 2026-09-01 in favour of the
existing bands, so that green means the same thing in a cell as it does on a card and there is one
set of thresholds in the codebase rather than two that differ by 0.2.

The owner also asked for the same treatment for "Yes, No and Unsure/Break even". No separate rule is
needed: the Finances and Advocacy buckets are means of answers already stored as 1, 3 and 5, so an
all-Yes bucket is 5.00 (green), an all-Unsure bucket is 3.00 (yellow) and an all-No bucket is 1.00
(red). The existing rule covers it.

**Colour is never the only carrier.** Parent spec §9.3 requires every band to carry a text label,
because the three fills are near-indistinguishable from each other — teal against amber is 1.06:1,
teal against red 1.76:1, amber against red 1.66:1. In the matrix **every coloured thing already
prints its own number**, and the Overall column additionally prints its band word. The rule is
satisfied by the grid's own content; nothing is encoded in hue alone.

## 6. Missing scores, and the Average row

This is the part with the sharp edges, and the part most likely to mislead if it is wrong.

**A cell with no score renders an em dash on `--band-none`.** Never a zero, never a colour. A
missing answer must never read as a low score — the property the whole model is built on.

Three different things produce a missing cell, and the grid does not distinguish them visually:
the client has no check-in for the month, the check-in exists but that bucket is unfinished, or the
bucket is Advocacy and the client is inside their first 90 days. They differ in the Average row's
arithmetic, below, which is where the difference actually matters.

**The Average is the sum of the scored, divided by the count of the scored.** Never divided by the
number of clients. Dividing by the total would pretend an unscored client scored zero and drag every
average down — the same falsehood as a zero in a cell, wearing a different hat. Ruled by the owner
2026-09-01 in these words: "the total of the scored clients divided by the number of scored
clients, not the total of scored clients divided by total clients."

**The asterisk means somebody who could have been scored was not.** It marks an average built from
fewer clients than were eligible for that bucket.

**Advocacy's eligibility is the gate, not the roster.** A client inside their first 90 days cannot
have an Advocacy score, and that is the gate working rather than data going missing. Counting them
as missing would put an asterisk on the Advocacy average every month until the newest client passes
90 days — and an asterisk that is always on stops being read. Ruled by the owner 2026-09-01.

So, per bucket:

- **eligible** — for the five ungated buckets, every active client. For Advocacy, every active
  client with `advocacyApplies(started_on, period)` true. `advocacyApplies` is the existing
  TypeScript gate from `src/lib/gate.ts`, already pinned against the SQL predicate by
  `tests/gateParity.test.ts`. It is used rather than the view's `advocacy_applies` column because
  the view can only answer for a client who has a check-in row, and the matrix has to answer for
  clients who have not been scored at all — which is the case the Average row exists to notice.
- **scored** — eligible clients whose check-in has a non-null value in that bucket's column.
- **the average** — the mean of those scored values, or null when `scored` is 0.
- **the asterisk** — shown when `scored < eligible` and `scored > 0`.
- **no eligible clients at all** — an em dash and no asterisk. In a month before any client has
  passed 90 days, the Advocacy average is genuinely unanswerable, and an asterisk would imply
  somebody had failed to do something.

The asterisk's meaning is stated once, in a footnote under the table, rather than left to be
guessed:

> \* Averaged from the clients scored for that bucket. Not every client who could be scored has been.

And each asterisked average carries a visually-hidden count in its accessible name — "averaged from
8 of 10 clients" — so the exact shortfall is available to a screen reader and on inspection without
putting a second number in every footer cell.

## 7. Semantics and layout

**A real `<table>`.** Not a grid of divs. Client names are `<th scope="row">`, bucket initials are
`<th scope="col">`, and the Average row is a `<tfoot>` with its own `<th scope="row">`. This is what
makes a screen reader announce "Colorfil, Growth, 5.00" instead of reading 60 loose numbers, and it
is the difference between a table that can be navigated and one that can only be recited.

**Each column header carries its full bucket label** in a visually-hidden span beside the visible
initial, so the announcement is "Communication" rather than the letter C.

**A caption** names what the table is and which month it covers, so the table is self-describing
when read out of the page's context.

**Horizontal scroll lives in the table's own container**, never on the page body. Seven columns plus
a name fit a laptop; a phone will scroll the grid sideways while the rest of the screen stays put.

**Clicking a row opens that client's check-in**, the same as clicking a card, and subject to the
same `isOpenable(status)` rule. Since the matrix shows only active clients, that rule never refuses
here — it is applied anyway rather than assumed, because the reason it exists is that
`checkins_insert_edit_scores` carries no status predicate of its own.

## 8. Modules

**`src/board/matrix.ts`** — the arithmetic, with no React and no Supabase client, in the shape
`boardScope.ts` and `cardSummary.ts` already use on this screen.

```ts
export type MatrixRow = {
  client: BoardClient
  checkin: CardCheckin | null
  overall: number | null
}

export type ColumnAverage = {
  mean: number | null
  scored: number
  eligible: number
}

// Every active client, alphabetically, carrying whatever was loaded for them.
export function matrixRows(
  clients: readonly BoardClient[],
  checkins: ReadonlyMap<number, CardCheckin>,
  scores: ReadonlyMap<number, BoardScore>,
): MatrixRow[]

// One bucket, down the roster. `period` is needed only for Advocacy's gate.
export function columnAverage(
  rows: readonly MatrixRow[],
  bucket: Bucket,
  period: string,
): ColumnAverage

// Shown when scored < eligible and scored > 0.
export function needsAsterisk(average: ColumnAverage): boolean

// "averaged from 8 of 10 clients" -- the visually-hidden half of the footer cell.
export function averageDescription(average: ColumnAverage): string
```

**`src/board/Matrix.tsx`** — the table. Reads `matrixRows` and `columnAverage`, renders cells and
bands, emits `onOpen(client)`. No arithmetic of its own.

**`src/board/Matrix.module.css`** — the grid, the cell fills, the scroll container.

**`src/board/Board.tsx`** — gains one piece of state (`view`), the toggle control, and a branch that
renders `Matrix` instead of the card grid. Nothing else changes; the period, the fetch, the archive
toggle and the check-in navigation are all untouched.

The board's existing card list keeps using `visibleClients`, because the cards and the matrix now
answer different questions: the cards are the month's work list and honour the archive toggle, and
the matrix is the roster's health picture and does not.

## 9. Testing

**The arithmetic, as pure functions.** `columnAverage` is where this slice can be wrong in a way
nobody notices, so it carries the most tests:

- an average over a full column equals the plain mean
- one unscored client changes the divisor, not just the numerator — asserted against a case where
  dividing by the wrong count gives a different answer, so the two rules are distinguishable
- a column where nobody is scored yields `mean: null`, never 0
- Advocacy excludes gated clients from `eligible`, so a full column of eligible clients carries no
  asterisk even when three clients have no score
- a bucket with no eligible clients at all yields `mean: null` and no asterisk
- `needsAsterisk` is false for a complete column and false for an empty one

**The grid, in the DOM.** Table semantics (`scope` on both header axes, one `tfoot`), the em dash for
a missing cell, the band class on a cell against its value, and that a cell never renders `0`.

**The invariant worth naming:** a client with no check-in at all must produce a full row of em
dashes and must not appear in any column's `scored` count. That is the single case where a bug
would silently flatter every average in the table.

**What is not testable here:** the cell fills and the scroll container are CSS, and CSS Modules are
stubbed under jsdom. Those are checked by eye on the deployed page, as the sticky legend and the
month dropdown were.

## 10. Decisions, with what each costs

1. **The matrix is a view of the board, not a screen of its own** (§3). Costs: the board screen
   grows a second rendering path and `Board.tsx` gets longer, in a file that already owns three
   routes. Buys: one period for both views, no new query, no invented navigation. Revisit when the
   Clients/People routing is lifted into an app shell, which is the right moment to reconsider
   whether the matrix wants its own address.
2. **Cells use the shipped bands, not the owner's literal 4-5 / 3-2 / 1 mapping** (§5). Costs: a
   bucket scoring exactly 2.00 reads red where the owner's sentence said yellow. Buys: one set of
   thresholds in the codebase. Ruled by the owner 2026-09-01.
3. **The matrix ignores the show-archived toggle** (§4). Costs: the two views of one board list
   different clients when the toggle is on, which has to be understood rather than guessed. Buys:
   the agency's own average does not move when somebody presses a display control.
4. **The Average divides by the scored, not the roster** (§6), ruled by the owner in his own words.
   Costs: an average over two clients looks exactly as confident as one over ten, which is why the
   asterisk and the hidden count exist. Buys: no unscored client is silently counted as a zero.
5. **Gated clients are not "missing"** (§6), ruled by the owner 2026-09-01. Costs: the asterisk means
   two subtly different things across the table — "somebody skipped this" everywhere, and
   "somebody eligible skipped this" in Advocacy. Buys: an asterisk that carries information rather
   than being permanently lit.
6. **Bucket scores are read from the generated columns, never recomputed** (§4). Costs: the matrix
   depends on `CardCheckin` carrying all six, which it does because the bars need them. Buys: the
   matrix and the card's bars cannot disagree.

## 11. Open items carried forward

1. **Revenue is a slice, not a field** (§2). It needs `sows`, `client_month_revenue`, four
   capabilities and a per-month override before net revenue retention is answerable. Owed to the
   owner as a scoped proposal, not as a question.
2. **The tenure and churn report** is Slice 6, and its one real dependency is unchanged: the report
   can only show churn the tool has rows for.
3. **Lifting Clients and People out of `Board.tsx`** into an app shell nav is real work with real
   value and no source requirement. Named here so it stays a deliberate choice rather than
   arriving as a side effect.
4. **The matrix shows one month.** Reading a bucket's average across several months is the obvious
   next question the moment somebody looks at this table, and it is not designed.

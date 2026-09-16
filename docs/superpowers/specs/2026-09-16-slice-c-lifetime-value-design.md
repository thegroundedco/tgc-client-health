# Slice C — What each client is worth

The owner's boss described a lifetime-value formula at a whiteboard. This slice builds it, having
first established that the version that reached us cannot be what he meant, and replaces the
"Retainer vs project" section the owner could not read.

> *"My belief is the monthly retainer is a stronger play for us, we make more money that way, I
> have this belief that we probably keep the retainer clients longer… but I might be wrong, and if
> I'm wrong, that grossly changes what maybe our focus should be."*
> — the owner's boss, 2026-09-11

---

## 1. The formula, and why it is not the one that was transcribed

The formula as it reached us, through a Loom transcript rather than the whiteboard photograph that
never arrived:

> A project client's monthly equivalent is **fee ÷ months to complete**. Their lifetime value is
> that monthly equivalent **× the whole length of the relationship**.

**That cannot be right, and the arithmetic says so.** A $30,000 project delivered in three months,
for a client who stays twelve, scores $10,000 × 12 = **$120,000** — four times what they paid. The
inflation is not a rounding artefact; it scales with every month after delivery in which nothing
was billed.

**It also argues against the man who described it.** His stated belief is that retainers are the
stronger play. A formula that quadruples project revenue and leaves retainer revenue untouched
would manufacture evidence against his own hypothesis. A formula that contradicts its author's
purpose is a transcription error, not a finding.

**The reading that survives:** the *monthly equivalent* is real and useful, and it is a **rate**,
not a lifetime. Fee ÷ months-to-complete turns a $30,000 three-month project into $10,000 a month,
which can be held beside a $5,000 monthly retainer and compared like with like. That comparison is
the thing the whiteboard was for. The multiplication back out to the full relationship is the step
that does not belong.

**So this slice shows two numbers and derives no third:**

| Number | Rule |
|---|---|
| **Lifetime value** | Every cent actually entered for that client. No projection. |
| **Monthly equivalent** | Total billed ÷ the number of months in which anything was billed. |

The monthly equivalent uses one rule for both kinds of client, and that is what makes them
comparable. A $30,000 project across three months is $10,000 a month — exactly the boss's figure,
reached without the step that inflated it. A retainer client billing $4,000 for eighteen months is
$4,000 a month, which is their actual rate.

**Neither number touches `started_on`.** This matters, and §4 explains why.

---

## 2. What the section says

**Heading: "What each client is worth."** It takes the position `Mix` holds now — last on the
Revenue page, in the paired-column area.

### 2.1 The verdict, in a sentence

One sentence on top, answering the question the boss actually asked:

> *"Across all 61 clients ever billed, retainer clients are worth more: the typical one has billed
> $48,000, against $12,000 for the typical project client."*

Real figures, stated as a finding. The current section leaves the reader to infer it from two
medians placed side by side, and the owner reported that he could not.

**The verdict is computed over every client ever billed, and says so** — including departed ones,
and regardless of how the list below it is filtered. Two reasons. A completed relationship is the
only complete lifetime value there is, so a verdict drawn from active clients alone would rest on
the weakest half of the evidence and would drift upward every month as those clients kept billing.
And departed clients are now most of the history: the 2025 backfill created twenty-nine of them.

This means the sentence and the list can describe different populations, which is why the sentence
names its own. A verdict that silently followed the list's filter would change when a reader
pressed a control that was only meant to reveal more rows.

**The sentence must be capable of saying the opposite.** `mixMath`'s existing comment is explicit
that nothing may round in favour of the hypothesis being tested — a client whose revenue splits
exactly evenly is counted as a *project* client, because a dead heat is not evidence for the
belief. That rule is inherited, not revisited, and §7 makes it a test.

**The median, not the mean**, for the reason `medianOf` already gives: on a book where one client
can be a fifth of revenue, a mean describes that client rather than the group.

### 2.2 The ranking

Most valuable first. Per row: the client's name, their lifetime value, their monthly equivalent,
and which kind of engagement their money says they are.

The kind is **derived from the revenue, not entered by hand** — the existing `clientMix` rule,
unchanged: the majority of a client's money decides, ties go to project.

---

## 3. Who is listed, and how much of them

**Active means `status === 'active'`** — the allowlist the clients board uses, not "has no end
date." A paused client is not active. Everything else is **departed** for this section's purposes,
and the control's label says *departed* rather than *archived* because the Churn section beside it
already speaks of departures.

**Active clients by default**, ranked, **top ten**, with two independent controls:

- **Show all / Show top ten** — how much of the list is drawn.
- **Show departed clients** — who is eligible for the list at all.

Revealing departed clients ranks them **into** the same list rather than appending a second one —
the behaviour of SHOW ARCHIVED on the clients board, which is the pattern this repository already
has for exactly this decision.

**A consequence to accept rather than engineer around:** revealing departed clients will often
rearrange the top ten, because a client of four years who left outranks most of the current book.
The ranking is not pinned. That is the number being honest about what lifetime value measures, and
the alternative — freezing the top ten against the roster it was computed from — would show a
ranking that is true of no set of clients.

**A client with no revenue entered does not appear at all** — not at zero, not at the bottom.
This is the rule the whole codebase keeps and slice 6l stated most plainly: a missing row is not a
zero, and a client listed at $0 says the agency bills them nothing rather than that nobody has
typed it. `clientMix` already drops them.

---

## 4. What this slice drops, and why that is the legibility win

The boss asked two things: do retainer clients **last longer** *and* **pay more**. This section
answers "pay more" and drops "last longer."

**The tenure half is the part that could not be read.** Most of the roster arrived through the 2026
import with `started_on` set to the first invoice month — a *floor* on the relationship rather than
its beginning. So the tenure figures understate, and understate unevenly, and the current section
must spend a full paragraph of caveat saying so before any of its numbers can be believed.

**Lifetime value carries no such caveat.** It is money that was actually billed, and it is
indifferent to whether a start date is right, approximate, or missing entirely. Dropping tenure is
what lets this section be read without a disclaimer.

**The question is not lost.** The Revenue page already carries **Tenure** and **Churn** sections
that do that job properly, with the caveat stated where it belongs.

---

## 5. Where it is built

The pure-module-plus-thin-component split this codebase uses everywhere.

- **`src/revenue/mixMath.ts`** — gains `monthsBilled` on `ClientEngagement`: the count of distinct
  periods in which that client billed anything. Two lines inside a loop already accumulating their
  money. **This is the only new arithmetic in the slice.**
- **`src/revenue/valueMath.ts`** *(new, pure)* — the ranking, the active/departed filter, the
  top-ten cut, the monthly equivalent, and the verdict. Every rule in §§1–3 provable without
  rendering anything.
- **`src/revenue/Value.tsx`** *(new, thin)* — draws it, holds the two controls' state.
- **`src/revenue/Mix.tsx`** and **`Mix.dom.test.tsx`** — **deleted.**
- **`src/shell/Revenue.tsx`** — swaps `<Mix>` for `<Value>`.

`mixMath.ts` survives its own component because the verdict still needs its group medians and its
classification rule. Its consumers today are `Mix.tsx` alone, so nothing else is disturbed.

**No new read.** `Value` is handed the same `clients` and `rows` that `Mix` receives today, from
the reads the page already performs.

**No new gate.** The Revenue page is gated on `view_revenue` — held by admin and account manager,
not by viewer — and the section inherits it.

### 5.1 The cleanup that comes with the deletion

Deleting `Mix.tsx` orphans three fields on `mixMath`: `medianTenureDays`, `tenureKnown`, and
`unknownStart`. All three exist solely to caption a section that will no longer exist. **They are
stripped**, along with the `tenureDays` field that feeds them and the `daysBetween` import that
computes it. A comment explaining the caveat for a deleted section is worse than no comment, and
dead fields on a shared type invite a future reader to believe they mean something.

**That change reaches `clientMix`'s signature.** Its `asOf` parameter exists only to close an
active client's tenure at today (`client.ended_on ?? asOf`); with tenure gone, nothing reads it.
`clientMix(clients, rows)` therefore loses its third argument, and `Revenue.tsx` stops passing
`asOf` to this section. The parameter is **removed rather than left unused**, so that a future
caller cannot supply a date under the impression it changes an answer. `asOf` remains in use by
`Tenure` and `Churn`, which is where a date still means something.

---

## 6. Considered and rejected

- **Building the transcribed formula and labelling it a projection.** Considered seriously, because
  it is what was actually said. Rejected: on a page of money that was really billed, one figure
  that is four times its client's payments will be read as revenue by everyone who did not build
  it, and a label does not survive a screenshot.
- **Lifetime value on the client card.** Slice 6l put the *current monthly rate* there and
  deliberately refused to derive anything. Adding a second money figure to a health card is a
  separate decision about that card, not a consequence of this one.
- **Two lists, current and finished.** Honest about the difference between a complete lifetime and
  a running one, at the cost of a longer section and no single answer to "who is worth the most" —
  which is the question the ranking exists to answer.
- **Keeping the tenure comparison alongside.** See §4. It is the caveat, not the comparison, that
  made the section unreadable.
- **A mean rather than a median for the verdict.** `medianOf` already documents why not.

---

## 7. Testing

Pure rules, mutated — this branch's predecessor shipped six tests whose assertions could not fail,
and every one originated in spec or plan prose like this section's.

- **The verdict must be capable of flipping.** A fixture in which project clients win must produce
  a sentence saying project clients win. **A test that only ever sees the boss's hypothesis
  confirmed is the vacuous test this slice is most likely to produce**, and a verdict hard-coded to
  "retainer" would pass it.
- **The tie rule**, inherited from `clientMix`: a client splitting exactly evenly counts as
  project. Mutating the comparison to `>=` must fail a test.
- **The monthly equivalent** — $30,000 across three months is $10,000; a client with one month
  billed is that month; a client with no `started_on` still gets one, because the figure does not
  read start dates.
- **A client with no revenue never appears.** Showing a zero must fail a test.
- **The ranking order**, including that revealing departed clients can displace an active client
  from the top ten — asserted with a fixture built to do it, not assumed.
- **Both controls**, independently: length and eligibility do not interfere.
- **The verdict does not follow the filter.** Pressing "show departed" must leave the sentence
  unchanged while changing the list beneath it. A verdict recomputed from the visible rows would
  pass every other test in this list.
- **Synthetic client names throughout: this repository is public.**

---

## 8. Out of scope

- Any projection of what a client *will* be worth. Everything here is money already billed.
- The client card (§6).
- `Tenure` and `Churn`, which keep the tenure question and its caveat.
- The Overview page, which the owner put last deliberately: *"that will be the final piece once we
  have all other factors working."*

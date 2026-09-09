# Slice 6f-1 — Revenue retention: NRR, GRR, and why they moved

## 1. What this is for

Question 4 of the four the owner wants Revenue to answer: **standard retention rates**. The
2026-09-03 slice 6c spec dated this April 2027 and scoped it as slice 6f. It is buildable now,
and §1.2 below explains what changed.

This slice answers, for a trailing-twelve window:

- **How much of the book did we keep, and is it bigger or smaller than a year ago?** — GRR and NRR.
- **Which clients caused that?** — per-client contributions, largest effect first.

**[owner]** Net is the number that matters; gross is wanted for visibility alongside it. Quoted
from the owner's own message: *"Net is most important, but we still want visibility into gross."*
So NRR is the headline and GRR sits beside it, not behind a control.

### 1.1 One build, not two

NRR and GRR **are** the total of the per-client contributions. Computing who grew, who shrank and
who left produces the headline pair as its sum, so there is no separate "headline" work to
sequence — the contribution table and the two rates are one calculation rendered at two altitudes.

### 1.2 CORRECTION: slice 6c §1.1 is superseded, and must not be re-derived

Slice 6c's spec §1.1 says, marked **[owner]**:

> The owner can enter six months of real history — April 2026 through September 2026 — and no
> more, because six months is what the records support. That is a data fact, not an appetite:
> entering a seventh month would mean entering a remembered number as though it were a record.

**That is no longer true, and it is the sole reason GRR/NRR was dated April 2027.** On 2026-09-09
the owner confirmed thirteen months of real revenue, taken from **invoices in QuickBooks Online**
— records, not recollection. The reasoning in 6c §1.1 was sound on the day it was written; only
its premise has changed.

This is written down because the April 2027 date is derivable from that stale paragraph, and
anyone re-deriving it would conclude this slice cannot ship. A pointer to this section is being
added to 6c §1.1 for the same reason.

### 1.3 What this slice is NOT

The owner asked for four things. They decompose, and only the first is in scope here:

| | | Status |
|---|---|---|
| **6f-1** | Per-client contributions over a fixed trailing-twelve window, totalling to NRR and GRR | **This slice** |
| **6f-2** | Controls: window length, include/exclude clients, each carrying its caveat | After the owner has used 6f-1 |
| **6f-3** | Retention over time — is retention itself improving | **Data-blocked** until autumn 2027 |

**6f-2 is deliberately deferred rather than dropped.** Which cuts are worth building is a question
the owner will answer better after a month with real numbers than either of us can guess now. Two
traps are already identified and belong in that spec when it is written:

- **A selectable window reopens what `MIN_RATE_PERIODS` closed.** "Retention" over two months is a
  number that reads as a fact and is not one — the same objection slice 6b §6 raised to a churn
  rate off one departure. A free-form range control must refuse or label a window too short to
  mean anything.
- **Excluding cancelled clients removes churn from the churn measure.** Applied silently, NRR sits
  at or above 100% permanently, because the only clients left are the ones who stayed. The
  legitimate version — excluding a client who was acquired or went under, to ask how the agency
  did among clients it could realistically have kept — is a *different number* and has to say so
  on its face.

**6f-3 is data-blocked, not deprioritised.** Thirteen months is exactly one trailing-twelve point.
A second point needs twenty-four months.

---

## 2. The decisions this rests on

| | Decision | Source |
|---|---|---|
| Retainer only, never project work | Retention measures what is expected to repeat | 6c spec §2, **[owner]** |
| NRR headline, GRR beside it | **[owner]**, 2026-09-09 | quoted in §1 |
| A client unentered in either month is excluded from both sides, and the count is disclosed | **[owner]**, 2026-09-09 | §3 |
| A client who *left* counts as zero, not as excluded | Derived — see §3.1 | |
| Fixed trailing-twelve window | This slice; controls are 6f-2 | §1.3 |

---

## 3. The classification rule

This is the substance of the slice. For each client the base month and the current month each
either hold a retainer or do not, and **"do not" means three different things**:

| Base month | Current month | Meaning | Treatment |
|---|---|---|---|
| has a row | has a row | Retained, expanded or contracted | Compare the two |
| has a row | no row, `ended_on` ≤ current month | **Churned** | Current counts as **0** |
| has a row | no row, still active | **Unentered** | Excluded from both sides, disclosed |
| no row, `started_on` after the base month | anything | **New business** | Excluded — not retention |
| no row, existed in the base month | anything | **Unentered** | Excluded from both sides, disclosed |
| no row, `started_on` is **null** | anything | **Unknown** — cannot be told from new business | Excluded, counted as unentered |

### 3.1 Why rows two and three cannot be collapsed

They are the same absence — no row in the current month — with opposite handling, and `ended_on`
is the only thing that distinguishes them.

Treat a churned client as unentered and **churn disappears from the churn measure**: the clients
who left drop out of both sides and NRR reports on the survivors alone, which is precisely the
flattering, meaningless number this project keeps refusing to render.

Treat an unentered client as churned and a cell nobody has typed reads as a lost client, which is
the "a missing row is not a zero" rule from 6c §3.3 inverted.

Both mistakes produce a plausible-looking figure. Neither would be caught by any test that does
not name them, so §7 names them.

### 3.1a A null `started_on` is counted as unentered, not as new business

Production carries clients with no start date on file, and for those the fourth and fifth rows of
the table are indistinguishable: with no base row and no start date, there is no way to know
whether the client is new or simply unrecorded. Both are excluded from the arithmetic, so the
choice only decides which count the reader sees — and "we do not know" belongs in the disclosed
unentered figure rather than silently in "new business", which asserts something the data does not
say. This is the same reasoning that keeps a null start date out of tenure rather than guessing it.

### 3.2 New business is excluded, and that is what makes this retention

A client won since the base month has no base figure to be retained against. Including them
measures growth, which is question 1 (slice 6d), not retention. The count is still displayed, so
the reader can see the book has grown even though the retention figure ignores it.

### 3.3 Which two months

The **current month is the most recent month holding any entered revenue**, not today's calendar
month, and the base month is the first of the month twelve before it. Both are named on screen
("September 2026 against September 2025") rather than implied.

Today's calendar month was the obvious alternative and is wrong here: on the 2nd of a month almost
nothing is entered, so the figure would be computed from one or two clients and the disclosure
would read "based on 2 of 11" — honest, but uselessly noisy every month for a week. Anchoring to
the latest month with data means the figure only moves when there is something to move it.

---

## 4. The arithmetic

Over **included** clients only — those with a base figure and either a current figure or a
churn:

```
NRR         = current total / base total
GRR         = Σ min(current, base) / base total
expansion   = Σ max(0, current - base)          -- positive
contraction = Σ min(0, current - base)          -- NEGATIVE, kept signed
```

`contraction` stays signed rather than absolute so that `expansion + contraction` equals the net
movement without the reader having to remember which way to apply it. The screen may render it
with its own wording; the arithmetic keeps the sign.

The `min(current, base)` cap is the whole difference between the two rates: it makes growth
invisible, which is why GRR cannot exceed 100% and NRR can.

Per client, the contribution is `current - base`, and the list is sorted by **absolute** value —
the biggest mover first, whichever direction it moved. That ordering is the answer to "why did it
move".

Integer cents throughout, as everywhere else. The two rates are the only fractions, computed once
at the aggregate level rather than per client and summed, so no rounding accumulates.

### 4.1 What it refuses

Returns null — rendering no figure rather than a wrong one — when:

- the base total is zero (nothing to divide by), or
- the base month holds no entered rows at all.

Same posture as `share()` and `rate()`: a state with no meaningful answer produces no number, not
`NaN%` or `0%`.

### 4.2 `rate()` is not this and is not removed

`rate()` computes last period over first period across a window. That is revenue **growth**, not
retention, and nothing calls it. It stays, for slice 6d's "is it moving" question, and its comment
gains a line saying so — so that nobody mistakes it for this slice's arithmetic or deletes it as
dead.

---

## 5. The screen

On the Revenue destination, as a fourth section beside Concentration, Tenure and Churn — named
**Retention**, matching the one-word headings adopted 2026-09-08.

1. **NRR**, large. **GRR** beside it, smaller but not hidden.
2. The split: expansion, contraction, churn — the three movements that produce those two numbers.
3. **Every figure carries its client count**: *"Based on 9 of 11 clients — 1 had no entry for
   September 2025, 1 started since."* Not a footnote; the disclosure travels with the number.
4. The per-client contributions, largest effect first: name, base → current, and the delta.

The existing paragraph — *"Revenue retention is not here yet: it needs thirteen months of entered
revenue… the earliest month that will have them is April 2027"* — is **removed by this slice**. It
is the third time a sentence on this page has had to be corrected because the data moved underneath
it; the disclosure in point 3 is computed, never written, for exactly that reason.

---

## 6. Where the code goes

| File | Why |
|---|---|
| `src/revenue/retentionMath.ts` | New. `revenueMath.ts` is already 231 lines and four unrelated exports; this is a distinct question with its own vocabulary. Matches `matrixMath` / `tenureMath` / `revenueMath`. |
| `src/revenue/useRetention.ts` | Fetches exactly two months plus the roster — mirrors `useRevenue`'s seam. Two indexed reads, not thirteen months pulled to use two. |
| `src/revenue/Retention.tsx` | Renders it. |
| `src/shell/Revenue.tsx` | Mounts it; deletes the April 2027 paragraph. |

`useRetention` needs `ended_on` and `started_on` on the roster, which the classification rule reads.
Note the trap already hit once in slice 6c: **`useRevenue` casts its response `as EligibleClient[]`,
so a missing select column is invisible to the compiler.** Whatever `useRetention` selects must be
pinned by a test on the query, not trusted to typechecking.

---

## 7. Testing

Pure arithmetic, no DOM, one case per row of §3's table. The two that carry the slice:

- **A churned client counts as zero.** Mutate it to "excluded" and NRR rises — a test must fail.
- **An unentered client counts as nothing at all.** Mutate it to zero and NRR falls — a test must
  fail.

Both proven by mutation, because swapping them produces a plausible number and no other test in
the suite would notice.

Also covered: GRR never exceeding 100% when a client grows; NRR exceeding it when they grow enough;
new business excluded from both; the null cases in §4.1; and the contribution ordering putting the
largest absolute mover first.

---

## 8. Candidate for later, not this slice

**Where health and revenue disagree.** This tool's premise is that client health predicts revenue,
and nothing currently tests that. Once retention exists the question becomes askable: which clients'
retainers fell while their health score stayed green — the scoring model missing something real —
and which held their revenue while their score fell, an early warning that has not cost money yet.

No other view joins those two datasets. It is a different question from retention and deserves its
own spec.

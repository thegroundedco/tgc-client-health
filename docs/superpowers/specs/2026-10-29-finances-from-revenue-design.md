# Finances from revenue — two answers the tool can work out

Finances is the weakest bucket in every AI-suggested round: invoices rarely appear in email or Slack, so the
answers were carried or "Unsure". But the tool already holds monthly revenue per client
(`client_month_revenue`) and each client's package (`client_packages`). Two of the three Finances questions
can be answered from that data. "Pays on time" cannot, and stays a judgement.

Agreed with the owner, 2026-10-29:

- **Rate** compares **total billed** (retainer + project) **this month vs last month**.
- **"Break even" is renamed "No change"**, and the question is relabelled to match what is measured.
- **Rack rate comes from a standard rate per package**: Foundation $10,000 (a total, often paid in monthly
  instalments), Grow $5,000 per month. Scale ($2,500 minimum project payments) is not modelled: nothing in the
  data distinguishes a Scale project from other billing.
- Answers are **pre-filled and editable**, never overwrite a saved answer, and show their reason.

---

## 1. The rate question

`fin_rate_increased` keeps its column and its values (1 / 3 / 5). Only words change (`src/lib/buckets.ts`):

- prompt `Rate over the last 90 days.` → `Rate vs last month.`
- `RATE_OPTIONS`: `Decreased` (1) / `No change` (3) / `Increased` (5) — was `Break even`.

No migration, no stored value moves. Historical answers keep their numbers and now read with the new words.

**Worked out as:** with `T(m)` = retainer_cents + project_cents for month m:

- Both `T(this month)` and `T(last month)` must have a revenue row. Otherwise: no answer.
- `T(last month) = 0` and `T(this month) > 0` → Increased; both 0 → No change.
- Otherwise the change `(T(this) − T(last)) / T(last)`: within ±5% inclusive → **No change**; above → **Increased**;
  below → **Decreased**.

Reason shown, e.g. `From revenue: $14,860 this month vs $15,500 last month.`

## 2. The rack-rate question

The client's package for the month is the latest `client_packages` stint with `started_on` ≤ the month's last
day.

- **Grow**: `T(this month)` ≥ $5,000 → **Yes**; below → **No**. No revenue row for the month → no answer.
  Reason: `From revenue: $4,000 billed vs $5,000 Grow rack rate.`
- **Foundation**: cumulative `T` over every month from the stint's start month through this month.
  ≥ $10,000 → **Yes**; below → **Unsure** (they may still be paying it in). No revenue row for this month → no
  answer. Reason: `From revenue: $5,000 billed since Foundation began vs $10,000 Foundation rate.`
- **No package recorded** → no answer.

Known limit, stated not fixed: `client_packages` records the rung a client SIGNED at, and no graduations are
recorded yet, so a client who moved from Foundation to Grow still reads as Foundation. Under the Foundation rule
that client's cumulative billing is well over $10,000, so the answer is still Yes — the limit does not produce a
wrong answer today, but it would if a graduated Grow client fell below $5,000 a month. Recording graduations is
out of scope.

The rates are constants in one module (`src/checkin/financeRates.ts`): changing a price is a one-line edit and a
deploy.

## 3. How it reaches the check-in screen

A new pure module `src/checkin/financeFromRevenue.ts` takes the period, the month's package stint (or null), and
the client's revenue rows, and returns, per question, either nothing or `{ value: 1 | 3 | 5, reason: string }`.

A new hook `useFinanceSuggestion(clientId, period, enabled)` reads that client's `client_month_revenue` rows up to
the month and their `client_packages` rows, and runs the module. `enabled` is `can(role, 'view_revenue')`; a
viewer without it gets nothing and no read is made. A failed read yields nothing (and says nothing): the
questions are then simply unanswered, as today.

On the check-in screen, once the check-in is ready and the suggestion has arrived:

- For each of the two questions whose **stored** answer is null **and** whose current form answer is empty, the
  computed value is applied **as an edit** (the same path as a click), so the form is honestly "unsaved" until the
  person saves. A stored answer, or anything already in the form, is never replaced.
- Under each of the two questions, whenever a computed answer exists, a caption shows its reason — even when the
  person's own answer differs, so they can see what the data says.

## 4. Out of scope

- "Pays on time".
- Scale, and recording package graduations.
- The board, scores, the overall maths, revenue entry.
- Back-filling past check-ins with computed answers.

## 5. Tests that must exist, each watched to fail

`financeFromRevenue` (pure, table-driven):
- Rate: +4.9% → No change; +5% → No change; +5.1% → Increased; −5.1% → Decreased; last 0 & this > 0 →
  Increased; both 0 → No change; missing this month → nothing; missing last month → nothing.
- Rack, Grow: $5,000 → Yes; $4,999.99 → No; missing month → nothing.
- Rack, Foundation: cumulative $10,000 → Yes; $9,999.99 → Unsure; months before the stint start are excluded;
  months after this month are excluded; missing this month → nothing.
- No package → nothing; the stint chosen is the latest one started on or before the month's last day.
- Reasons format money as whole dollars with thousands separators where the amount is whole, as the Revenue
  screen does (reuse `src/revenue/money`).

Screen:
- A blank check-in with a computed rate gets it filled and the form reads unsaved; a stored answer is not
  replaced; an answer already in the form is not replaced; the caption renders with the reason; no read without
  `view_revenue`.
- The relabel: `RATE_OPTIONS` labels and the prompt (buckets.test pins them).

Mutation pass: flip the ±5% inclusive boundary; drop the stint-start filter; drop the "stored is null" guard;
drop the `enabled` gate — each must fail a test.

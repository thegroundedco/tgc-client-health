# Payments on the check-in — confirm a month's revenue beside its scores

From the first Wednesday of every month, the team holds a meeting that goes client by client: review the
AI-suggested scores, confirm or edit them, and confirm what each client was charged. Today the scores live on the
check-in screen and the revenue lives on a separate admin screen (Revenue entry). The owner wants one view per
client with everything that needs confirming. This is a usability change, not a replacement: the admin Revenue
entry screen stays.

Agreed with the owner, 2026-11-02:

- The check-in screen (the one a board card opens) gets a **payments box** with two fields, **Retainer** and
  **Project**, placed **inside the Finances section, above its questions** (moved there by the owner later on
  2026-11-02, from mockup option B, "above the scores").
- **Clients admin is the source of truth** for a client's monthly retainer. A retainer client's Retainer field
  shows that amount as **ghost text**; one click confirms it.
- Saving a retainer amount **different** from the stored one asks whether to **update the client's retainer
  from now on** or to keep the new amount for **this month only**.
- **Access:** admins enter and change; account managers see the amounts, read-only; viewers see nothing about
  money.
- Each client's retainer is **seeded** from the imported invoice history so the ghost text works at the first
  meeting.

**Settled 2026-11-02 — which month an invoice belongs to:** the month it is dated. See §6.

---

## 1. Where the stored retainer lives

There is no per-client retainer amount today. The "$X a month" on a board card is derived from the latest revenue
row (`src/board/rateMath.ts`).

It must **not** be a column on `public.clients`: that table is readable by `view_scores` (viewers), and viewers
must not see money. It is also writable by `manage_clients`, which account managers hold, and account managers
must not change money.

So it gets its own table gated exactly like `client_month_revenue`:

- `public.client_retainers`: one row per client, `client_id` (primary key, FK to clients, **on delete restrict**
  like `client_month_revenue`), `monthly_cents integer not null check (monthly_cents > 0)`, `updated_by`
  (profiles, on delete set null), `updated_at`.
- RLS: select needs `view_revenue`; insert/update/delete need `edit_revenue`. Same `private.has_capability`
  pattern as `20260903120000_revenue_has_capability.sql`.
- **No row means "not on a retainer".** Removing a retainer deletes the row; zero is not stored.

The builder's call: whether a history of retainer changes is worth keeping. The owner asked only for the current
amount; a single current row is enough for what was asked.

## 2. Clients admin

The edit panel in Clients admin gets a **Monthly retainer** field (dollars, same parsing as Revenue entry,
`src/revenue/money.ts`). Blank = no retainer.

- Admins edit it. Account managers see it read-only. Viewers never reach Clients admin.
- It reads and writes `client_retainers` only, never `clients`, and it is gated at the read (no query for a
  role without `view_revenue`), the way `usePackages` / `useFinanceSuggestion` are.

## 3. The payments box on the check-in

Shown to roles with `view_revenue`; viewers get nothing, and no revenue query is made for them. Sits inside the
Finances section, under its heading and above its questions. Titled with the check-in's month
(e.g. "October payments").

States, for the check-in's month (`client_month_revenue` row for `(client_id, period)`):

1. **No revenue row yet, client has a retainer:** Retainer shows the stored amount as ghost text; Project is
   empty, with $0 as ghost text. A **Confirm $X retainer** button saves the retainer at the stored amount and
   project $0. Typing in either field turns the button into **Save**.
2. **No revenue row yet, no retainer:** Retainer reads "No retainer" (ghost). Project is empty. A **Save** button.
   An admin can still type a retainer amount. Saving it then asks the §4 question ("set a monthly retainer of $X
   from now on?").
3. **A revenue row exists:** both fields show the saved amounts as real values. A line says who entered them and
   when (`entered_by`, `updated_at`). Admins can change them and Save again. This is also how amounts already
   entered on the Revenue entry screen appear. Several October rows already exist in production.
4. **Account manager:** states 1–3 shown read-only, with no buttons. In state 1 or 2 an account manager sees
   "Not entered yet" rather than ghost text, so a ghost is never read as a confirmed amount.

Saving writes one upsert to `client_month_revenue` on `(client_id, period)`, setting `entered_by`, exactly as
Revenue entry does. Blank Project saves as 0. Amounts are parsed with `parseMoney`, capped at `MAX_CENTS`.

**One source, two screens.** Both screens read and write the same row. Whichever saves last wins. Revenue entry
already behaves this way between two admins. If Revenue entry is open with unsaved edits while an amount is
confirmed on a check-in, the next Revenue entry save overwrites it. The builder should make sure Revenue entry
loads fresh values each time it opens, and nothing more is required.

## 4. "Update the retainer?"

When an admin saves a Retainer amount that differs from the stored retainer (including "no retainer" → an amount,
or an amount → $0), the screen asks before writing anything:

> Acme's retainer is **$4,000** a month in Clients admin. Change it to **$3,500** from now on?
> [Yes, update the retainer] [No, just October]

- **Yes:** writes the month's revenue AND updates `client_retainers` (a $0 retainer deletes the row: "no
  retainer from now on").
- **No:** writes the month's revenue only.
- Dismissing the question writes nothing.
- A changed **Project** amount never asks anything; project billing varies month to month by nature.

Changing the stored retainer affects only the ghost text for months not yet entered. Saved months keep what was
saved.

## 5. The finance answers follow the payment

Two Finances answers, rack rate and rate vs last month, are worked out from revenue
(`src/checkin/financeFromRevenue.ts`, spec 2026-10-29). Today the screen fills them **once per visit, and only
where nothing is stored**. That leaves the AI's "finance pending revenue" placeholder 3s untouched even after
the revenue arrives, which defeats the purpose of entering it here.

Required: after a payment save on this screen, the finance suggestion is re-read, and the two finance answers in
the form take the newly computed values, **including over a stored value**, as an ordinary unsaved change the
person then saves or confirms with the rest of the check-in. Where the data still gives no answer, leave the
answer alone.

The builder must reconcile this with the suggested-check-in flow (`SuggestionBanner`'s Confirm is refused while
the form has unsaved changes). The intended meeting sequence is: confirm payment → finance answers update →
review scores → Save or Confirm. The person must never be left unable to finish the check-in after confirming
a payment. Whether the finance answers are written straight into the stored row instead of the form is the
builder's call, provided it never discards a person's unsaved edits.

## 6. Which month an invoice belongs to

Settled with the owner, 2026-11-02: the bulk import put each amount in the month it was labelled with, not shifted
a month. The new screen follows the same rule: **a month's revenue is what was invoiced in that month**. Invoices
go out on the 1st on Net 15, so October's check-in holds the invoice dated Oct 1, which is due mid-October and has
been paid or not by the meeting on the first Wednesday of November.

So history and new entries agree, no historical rows move, and `period` keeps meaning what it means today. The
box's caption says it plainly, e.g. "Invoiced in October".

(Whether a Nov 1 invoice pays for November's work or October's is a billing question the owner may still raise
with their boss. It changes the caption's wording at most, not what is stored.)

## 7. Seeding the retainers

One-off, run against production after the table exists: for each client, take its most recent
`client_month_revenue` row; if that row's `retainer_cents > 0`, insert it as the client's retainer. The list is
shown to the owner to check before it is written. It is data, not a migration, and **the amounts are never
committed to this repository** (the repo is public).

## 8. Not in this project

- **Viewers seeing only overall scores.** The owner wants viewers limited to the overall client scores. Today
  they can open a check-in and read every answer. It is a separate follow-up because it changes read policy on
  check-ins.
- "Paid" vs "charged". The box records what was charged. Whether it was paid on time stays the
  `fin_pays_on_time` judgement.
- Changes to the AI routine. It keeps reading `client_month_revenue` and is unaffected.

## 9. Anti-goals

- A ghost amount ever stored, or shown to anyone, as if it were confirmed.
- Any money figure readable by a viewer, or writable by an account manager, by any path.
- Two places holding different amounts for the same client and month.

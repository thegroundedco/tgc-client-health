# Month-aware board, and ending a client from the check-in

The owner, 2026-10-28, looking at September on the board:

> *"I don't want to see clients who weren't active for the month that I'm looking at. September,
> for example, I'm seeing clients like IMSCA - it doesn't make sense to show them cause I'm / we
> aren't going to be scoring them."*

and, once the first half was agreed:

> *"If a client we're scoring has cancelled for the month we're scoring, we should have the ability
> to hit 'canceled' or 'paused' for that month. I don't want to have to go to the client roster and
> cancel them from there when it makes more sense to be able to make that change when scoring them."*

Two changes, specced together because the second only works on top of the first: "cancelled this
month" means nothing until the board knows which months a client belongs to.

---

## 1. The problem: the board is month-blind

The board has a month picker, but who appears on it is decided by `isOnBoard(status)`
(`src/board/boardScope.ts`), which reads the client's status **today**. So for September 2026:

- **Dormant clients show.** IMSCA, NeuroQ, Pale Blue, PC Enclosures, Heavy Metal Shop were all
  `active` with no September work. (Fixed in the data on 2026-10-28 by pausing them, with Fusion and
  Spy Hop — but the board would still show any client later paused in a month they *were* scored,
  and hide one scored in a month before they were paused. See §2.)
- **Future clients show.** Steep (started 2026-10-21) and Bitches 'n Bubbles (2026-10-07) appear on
  September.
- **Departed clients vanish from months they belonged to.** C.R. Plastics ended 2026-09-30 and is
  now `former`, so it disappears from September — the month it was last scored — and its card cannot
  be opened even to correct that check-in.

**Revenue is not the signal** (considered and rejected with the owner): Colorfil has no revenue rows
yet is scored, Fusion bills every month and is not a client, and no client has October revenue yet,
so October would render empty.

## 2. The rule

A client is **on the board for a month** when either:

1. **They have a check-in for that month** — any saved row, submitted or not. A month's recorded
   work is never hidden by what happened afterwards.
2. **They were a current client that month**, meaning all of:
   - `started_on` is on or before the month's last day, **or is null** (Sno-Go has none; a missing
     start date must not hide a client being scored);
   - `ended_on` is on or after the month's first day, or is null;
   - status is not `paused`.

   `cancelled` and `former` clients pass rule 2 for the months up to and including the one they
   ended in — that is what lets a final month be scored.

Everything else stays behind the existing **Show N archived** toggle, unchanged in behaviour.

**Paused carries no date** — `clients.status` is current state, not history. So pausing a client
hides them from every month in which they have no check-in, past months included. Accepted by the
owner: past months only ever need to show what was scored in them, and rule 1 keeps those.

**Openable** follows the same rule: a card can be opened for a month exactly when the client is on
the board for that month. This replaces `isOpenable(status)`. It widens what can be opened in one
deliberate way: a cancelled/former client within their dates, and a paused client with a check-in,
can now be opened for that month. `checkins_insert_edit_scores` has no status predicate, so the
database already permits this; the rule is the app's.

**The progress line** ("N of M check-ins") counts the same set, so M is the check-ins actually owed
that month.

### Effects on today's production data, so the screen can be checked

Computed on production 2026-10-28 with the rule written as SQL:

- **September 2026 — 13**: exactly the 13 clients with a September check-in. C.R. Plastics returns;
  Steep, Bitches 'n Bubbles and the seven paused clients are archived.
- **August 2026 — 14**: the 13 with an August check-in (Heavy Metal Shop included, by rule 1, though
  now paused) **plus Conduit** (cancelled, ended 2026-08-31, never scored — correct by the rule: it
  was a client in August). **"Test Client" appears**, because it has an August check-in row. That
  row is junk from testing; the owner decides whether it is deleted. Flag it, do not delete it
  unasked.
- **October 2026 — 14**: the twelve continuing active clients plus Steep and Bitches 'n Bubbles; no
  C.R. Plastics.

## 3. Ending a client from the check-in screen

The check-in screen already offers **Edit client** (slice 6l), which navigates to the roster's edit
panel. Beside it, for anyone holding `manage_clients` (the same gate, reused, not a second rule):

- **Paused this month** — opens a one-line confirmation in place ("Pause *Name*? They come off the
  board until you set them active again."). Confirming writes `status = 'paused'` and returns to the
  board. If the client already has a check-in this month they stay on this month's board by rule 1,
  and the confirmation says so rather than leaving it to surprise.
- **Cancelled this month** — opens a small panel in place with:
  - **End date**: a date input bounded to the month being scored (min = the later of the month's
    first day and `started_on`; max = the month's last day), **defaulting to the last day**.
  - **Reason they left**: the same `END_REASON_CODES` list as the roster, required.
  - **Note**: optional, the roster's `end_reason_note`.

  Confirming writes `status = 'cancelled'`, `ended_on`, `end_reason_code`, `end_reason_note`. The
  screen **stays on the check-in**: the client remains on this month's board (their `ended_on` is in
  it), so the final check-in can still be finished. From the next month on they are archived.

`cancelled` not `former`, because that is what STATUS_HINTS says it is for: "Recently left, and still
under review." Settling it to `former` stays a roster action.

**One write path.** Both actions build a `ClientDraft` from the client row and go through
`formProblems` and `updatePayload` in `src/clients/clientForm.ts`, exactly as `EditClientForm` does,
so the lifecycle rules (cancelled needs a date and a reason; non-churned clears them) live in one
place and `clients_lifecycle_coherent` is never the first thing to object. A failed write shows the
roster's own `writeFailureText` and changes nothing on screen.

**Undo** is Edit client, as it is for every other status change. No new undo.

## 4. Out of scope

- A dated pause history (`paused_on` / a status-history table). Rejected above; revisit only if
  past months start hiding clients that matter.
- Changing what `paused` means anywhere other than the board.
- Settling `cancelled` to `former` from the check-in.
- Any change to Revenue, Overview, tenure or churn. `ended_on` is already what they read, and this
  only writes it the way the roster already does.

## 5. Tests that must exist, each watched to fail

Pure, in `boardScope.test.ts`, against a fixed month (2026-09):

- started mid-month (09-15) → on; started next month (10-07) → off; `started_on` null → on.
- ended mid-month (09-15) → on; ended the day before the month (08-31) → off; ended in a later
  month → on.
- paused with no check-in → off; paused **with** a check-in → on.
- former, ended in-month, no check-in → on; former, ended before the month, **with** a check-in → on.
- openable agrees with on-board for every case above (one table, both functions).
- the count equals the number of on-board clients, not the number of active ones.
- The **month boundary** is computed from the period, not hard-coded: include a 30-day and a 31-day
  month and February, so an off-by-one at month end fails a test.

Hook and screen:

- `useBoard` selects `ended_on`; a test whose fake omits it must fail, not default to "no end".
- Board: a cancelled client with a check-in this month renders an openable card; the same client a
  month later is under the archived toggle.
- Check-in screen: neither action renders without `manage_clients`; the cancel panel's date input
  carries the month's bounds and defaults to the last day; a submit without a reason is refused
  before any write; a successful cancel stays on the check-in; a successful pause returns to the
  board; a failed write leaves the screen unchanged and shows the failure.
- Mutation pass over the rule: flip each comparison (`<=`→`<`, `>=`→`>`), drop the null-start
  branch, drop rule 1 — every mutant must fail at least one test.

## 6. Owner checks before merge (on staging)

Staging fixtures differ from production; before opening the dev server, state what September should
show on **staging** (computed from staging's rows at the time), because a correct blank otherwise
reads as a bug.

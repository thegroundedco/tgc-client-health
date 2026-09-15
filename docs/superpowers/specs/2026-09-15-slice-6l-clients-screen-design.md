# Slice 6l — The clients screen, from the owner's walkthrough

Three asks from the first time anybody used the tool with real data in it, plus one question the
2025 backfill created and nobody has ruled on.

> *"In clients, I like that it starts with just the cards. However… I'd like this to just be one
> button… One thing that I would really like is when I have admin access and I click into a card,
> I'd love for there to be an option to hit edit client… If I have admin access, I'd love to be
> able to see revenue in the [a client] card itself."*

---

## 1. One view button, not two

Today the board shows a `Cards` and a `Matrix` button side by side, each carrying `aria-pressed`.
The owner wants one button showing the view you are **not** on.

**The existing code argues against this, in so many words:**

> *"Two buttons rather than one that says what it will become: a single 'Matrix' button gives no
> indication that the current view is the cards, and `aria-pressed` on a pair says which of the two
> is showing without a person having to work it out from the label."*

That objection is real and it is about screen readers, not taste. The owner's instruction stands —
it is his tool and the visual clutter is his to weigh — but the accessibility half is kept rather
than discarded:

- **Visible text is the destination**: `Matrix` while on cards, `Cards` while on matrix.
- **The accessible name is the action**: `Switch to matrix view` / `Switch to cards view`.

A sighted reader gets the single clean button. A screen-reader user hears an unambiguous action
instead of a bare noun. Nothing is lost, and the original comment is rewritten rather than deleted,
because the reasoning behind the pair is what explains why the accessible name is fuller than the
label.

`aria-pressed` goes, because a button that changes what it does on every press is not a toggle. The
current view is evident from the content and from the accessible name of the control that would
change it.

---

## 2. Edit a client from their card

**The careful part is the route, not the form.** `Destination` is a closed union and deliberately
so — its own comment says each impossible combination should be a compile error rather than one of
sixteen states nobody checks. Carrying a client id across a page change widens it:

```ts
| { kind: 'admin'; section: AdminSection; editClientId?: number }
```

`editClientId` is **optional and only meaningful when `section` is `clients`**. That is a looseness
the union was written to avoid, and it is the cost of the feature; §5 records what was considered
instead.

**Flow:** the card's open panel gains an **Edit client** button, visible only to a viewer with
`manage_clients` — the same capability check the board already makes for **Add client**, reused
rather than reinvented. Pressing it navigates to the clients admin section with that id, and
`ClientsAdmin` opens that client's existing edit form on arrival.

**`ClientsAdmin` already holds `editingId` state.** It gains an initial value, not a new mechanism.
The form itself, its validation and its save path are untouched.

**One consequence to handle:** arriving with an id for a client who is not in the admin list — a
stale link, or a client archived between board and arrival — must not leave the screen looking
broken. The section renders its ordinary list, unopened. No error, no empty state: the id is a
request, not a promise.

---

## 3. What a client is worth, on their card

The owner asked for revenue on the card and chose **their current monthly rate** over a rolling
year, the shown month, or lifetime billing.

### 3.1 A project client has no monthly rate, and this slice does not invent one

For a retainer client the figure is what they bill in a month. For a project client there is no
such number, and deriving one means *fee ÷ months to complete* — **which is precisely the formula
the owner's boss described at a whiteboard for lifetime value**, and which is the subject of its own
slice. The whiteboard photograph has not arrived, and the spoken version of the formula contradicts
itself.

**So this slice shows what is true of each kind and derives nothing:**

| Client | Card shows |
|---|---|
| Billing retainer in their latest entered month | that retainer figure, per month |
| Project work only | their most recent project fee, named as project work |
| No revenue entered | nothing — no figure, no zero |

A zero is not shown for a client with no entered revenue. Everywhere else in this codebase a
missing row is not a zero, and a health card reading `$0` would say the agency bills them nothing
rather than that nobody has typed it.

**The derived monthly equivalent belongs to the lifetime-value slice**, built once, from the
owner's boss's own formula, rather than guessed here and corrected there.

### 3.2 The figure is gated, and so is the read

Visible only with `manage_clients`. The **read is gated too, not just the display** — a non-admin
must not issue a query whose rows they should not have. The board already knows the viewer's
capability before it renders.

### 3.3 Where the data comes from

The board has no revenue read today. It gains a narrow one of its own rather than borrowing
`useRetention`, which reads the whole table for a different purpose and would put a hook named for
retention inside the board.

- `src/board/useClientRates.ts` — reads `client_month_revenue`, admin-gated.
- `src/board/rateMath.ts` — **pure**: given rows, the current rate per client. Which month counts
  as current, what a project-only client yields, what an absent client yields.

The split is this codebase's standing pattern, and it is what makes §3.1's rules testable without
rendering anything.

---

## 4. The roster the backfill left behind

Not asked for. Raised because the board now reads **"11 of 19 check-ins submitted"** with **"SHOW
39 ARCHIVED"**, where before the 2025 backfill it was 31 clients and 10 archived. Twenty-nine of
those archived rows are clients slice 6i created, every one of them departed before 2026.

**This is working exactly as designed** — `visibleClients` is an allowlist of `active` and the
board is the month's check-in grid, so a client who left in 2025 has no business on it. The figure
is correct.

**It is still worth the owner's eye**, because a board that shrank from 31 to 19 overnight is the
kind of change that reads as a bug to everyone who did not do it. **Ruling needed**, and the answer
may well be "nothing to do".

Nothing in this slice changes that behaviour without a ruling. Recorded here so it is a decision
rather than a drift.

---

## 5. Considered and rejected

- **A separate destination kind** (`{ kind: 'editClient'; id: number }`) instead of widening the
  admin one. It keeps the union tight, but the screen it lands on *is* the clients admin section,
  and a second kind pointing at the same screen means two routes to one place and a menu bar that
  has to know one of them is not a menu item.
- **Deep-linking by URL.** This app does not route by URL at all; adding it for one button is a
  larger change than the button deserves.
- **Reusing `useRetention` on the board.** Its whole-table read is justified by what retention
  needs, not by what a card needs, and the boundary is worth more than the saved file.
- **A rolling twelve months on the card.** Recommended, and the owner chose the current rate
  instead. Recorded because the reason to prefer it — that it does not lurch when a project client
  bills nothing in a month — is the same reason §3.1 refuses to show a zero.

---

## 6. Testing

- **Pure rate rules** — retainer client, project-only client, client with nothing entered, client
  whose latest month is a zero. Each mutated: showing a zero where nothing was entered must fail a
  test.
- **The toggle** — visible text names the other view; the accessible name names the action; the
  view actually changes. Asserted through the accessible name, not the class.
- **The gate** — a viewer without `manage_clients` sees no rate **and issues no read**. The second
  half is the one that matters and the one a lazy test would skip.
- **The route** — arriving with an id opens that client's form; arriving with an unknown id renders
  the ordinary list and no error.
- Synthetic client names throughout: **this repository is public.**

---

## 7. Out of scope

- The derived monthly rate for project clients (§3.1) — that is the lifetime-value slice.
- Any change to `visibleClients` or the archived toggle, pending §4's ruling.
- The Overview page, which the owner put last deliberately: *"that will be the final piece once we
  have all other factors working."*

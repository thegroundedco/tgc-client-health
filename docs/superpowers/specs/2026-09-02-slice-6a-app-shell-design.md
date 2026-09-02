# Slice 6a — the app shell

Source: the owner, 2026-09-02, in his own words:

> Essentially, I am going to want a menu bar at the top that is something like "Overview" "Clients"
> "Revenue" "Admin" and then the Light/Dark Toggle. Overview is going to be the homepage where it's
> easy to get a quick snapshot of things. Clients is going to be where you can view that months
> scores and the matrix, revenue will be for revenue retention and churn, and Admin will be where
> the admins can manage peoples access and such.

Refined in the same conversation: Admin manages **both** people and clients; the Clients tab also
carries an **Add client** button, so the common action sits where you would reach for it.

## 1. A correction that comes first, and it reverses a correction

Slice 5's spec §1 retired an "Overview homepage" and an `OVERVIEW / CLIENTS / REVENUE` nav as
**never-sourced**: they appeared in two assistant-written carry-forward notes and in no spec, the
owner did not recognise them when asked on 2026-09-01, and that section ends "Do not reintroduce
them."

The owner has now asked for that navigation himself, unprompted, on 2026-09-02.

Both things are true and neither is embarrassing. It was right to retire an idea nobody could
source; it is right to build it now that its source is the owner asking for it in his own sentence,
quoted above. **This section exists so a future reader who finds Slice 5 §1 does not conclude that
somebody ignored it.** What was retired was an unsourced assistant invention. What is being built is
the owner's request. The six stat lines retired alongside it stay retired — Overview's contents are
a separate conversation (§6), and nobody is going to invent them twice.

## 2. What is in this slice, and what is not

**In.** The menu bar with four destinations. One navigation state, replacing five booleans. Every
screen that exists today relocated under it. The theme pill moved into the bar. An Add client button
on the Clients tab. Overview and Revenue as honest, short pages that say what they are for.

**Not in.** Overview's actual content (§6, and it needs the owner). Revenue's actual content — it is
blocked on a data model that does not exist (§6.2). The tenure and churn report, which was the
original Slice 6 and now belongs under Revenue. Any router or URL scheme (§4.1). No database change,
no migration; this slice is entirely front-end.

**Explicitly not in: making `started_on` required.** It is optional today — `clientForm.ts` sends
`null` for an empty field — which is how the `paused` and `former` clients came to have none. It
matters more than it did, because a client with no start date silently scores no Advocacy (the
90-day gate refuses on null, deliberately) and will be invisible to the tenure report. That is a
real decision and it belongs with the tenure work, not with a navigation change. §10.

## 3. The four destinations

| | holds | real on day one |
|---|---|---|
| **Overview** | the snapshot | no — an honest page, §6.1 |
| **Clients** | the month picker, Cards \| Matrix, the check-in screen, Add client | yes |
| **Revenue** | revenue retention, churn, tenure | no — an honest page, §6.2 |
| **Admin** | People (access, roles), Clients (roster, dates) | yes |

The theme pill sits at the right of the bar, beside "Signed in as" and Sign out. It is app chrome
and belongs with the other app chrome; it does not become a fifth destination.

### 3.1 Where you land, and why it is not Overview yet

Overview is the homepage and will be the landing destination. **It is not the landing destination in
this slice**, because in this slice it is empty (§6.1), and making an empty page the first thing
every person sees on every sign-in is a worse tool than the one being replaced.

So sign-in lands on **Clients** until Overview has content, and moves to Overview in the slice that
gives it some. This is one line to change and it is called out here so it is changed deliberately
rather than discovered.

The cost, stated plainly: for as long as that holds, the first item in the menu bar is not where the
app opens, which is mildly odd. The alternative — opening on a page that says only what it will one
day contain — is worse, and it would be the very first thing the owner's boss saw.

**Admin is capability-gated, and the two halves gate separately.** `ROLE_CAPABILITIES` gives
`admin` all four capabilities, `account_manager` everything except `manage_users`, and `viewer` only
`view_scores`. So the **Admin tab appears when a person holds `manage_clients` OR `manage_users`**,
and inside it the People section needs `manage_users` while the Clients section needs
`manage_clients`. An account manager therefore opens Admin and correctly sees one section, not two;
a viewer never sees the tab. This is convenience rather than security, exactly as Board.tsx's
existing comments say: a viewer who reached the screen anyway has every write refused by
`profiles_update_manage_users`, `clients_insert_manage_clients` and `clients_update_manage_clients`.

The **Add client** button on the Clients tab carries the same `manage_clients` gate and opens the
`AddClientForm` that already exists. It does not navigate to Admin — being thrown to a different
destination by a button called "Add client" is a worse experience than the one it replaces — and on
success the board re-reads, the way `ClientsAdmin`'s own `onBack` already does, so a client added
here appears immediately rather than after a manual refresh.

## 4. One union, not five booleans

`Board.tsx` today holds navigation in five independent `useState` values — `selected`,
`showingClients`, `showingUsers`, `showArchived`, `view` — and renders through a sequence of
`if (...) return <X/>` early returns. **The order of those returns is what resolves a conflict**, so
`showingClients` and `showingUsers` both being true is representable and silently decided rather
than impossible.

Three booleans represent eight states, most of them nonsense. A fourth destination makes it sixteen.
This is precisely the failure `appState.ts` was written to prevent one layer up, where a
discriminated union makes each impossible combination a compile error instead of a runtime surprise
— and the board container never received that treatment.

So navigation becomes one union:

```
type Destination =
  | { kind: 'overview' }
  | { kind: 'clients' }
  | { kind: 'revenue' }
  | { kind: 'admin'; section: 'people' | 'clients' }
```

**The check-in screen is a sub-state of Clients, and is therefore NOT a variant above.** An earlier
draft of this section listed `{ kind: 'checkin'; client }` alongside the four, which contradicted
the sentence it sat next to: a thing cannot be both a sub-state of Clients and a sibling of Admin.
Resolved in favour of sub-state, for a reason the code makes concrete — `CheckIn` needs `period` and
`board.reload()`, both of which live inside `Board`, so promoting it to a sibling would force
`period` up into the shell and turn a navigation change into a data-ownership change.

So `selected: BoardClient | null` stays in `Board`, where it already is. It cannot produce an
impossible state on its own: one nullable value has two states and no way to disagree with itself.
The overlaps this slice exists to remove were between the DESTINATIONS — `showingClients` and
`showingUsers` both true, resolved silently by the order of two early returns — and those are gone
because Admin's two screens become one destination with a section.

**The menu bar stays visible during a check-in**, which is new: today the check-in screen returns
before the nav is even defined, so there is no way out of it except Back. Being able to leave is
better than being trapped, and it is safe here specifically because `draftCache.ts` writes every
click and keystroke to local storage as they happen — leaving mid-edit loses nothing, which is not
a claim this design could make in a tool without that cache.

`{ kind: 'admin' }` carries its section because Admin has two, and **the section it opens on is the
first the person can actually see**: `people` for somebody holding `manage_users`, otherwise
`clients`. An account manager holds `manage_clients` and not `manage_users` (§3), so opening Admin on
a hardcoded `people` would land them on a section that is not theirs — an empty screen reached by a
button that looked like it worked.

`showArchived` and `view` are **not** in the union and must not be moved into it. They are not
destinations; they are scope questions asked *within* Clients, and folding them in would multiply
the union by six for no gain.

### 4.1 No router, still

Spec §5.1's decision stands and its reasoning is unchanged: no router, therefore no URL change,
therefore a refresh returns to a predictable place. Real URLs on GitHub Pages need the `404.html`
redirect trick, and that is not worth buying until somebody wants to send a colleague a link to one
screen.

What changes is that it becomes **cheaper to buy later**. Today five booleans in one file decide
what is showing; after this slice one union does, so a router would have one place to drive rather
than five to reconcile.

## 5. Where each existing screen lands

Nothing is rewritten. Every screen below moves under a destination and is otherwise untouched.

- `Board`'s cards and matrix, the month picker and the archive toggle → **Clients**
- `CheckIn` → **Clients**, as `{ kind: 'checkin' }`
- `ClientsAdmin` → **Admin**, section `clients`
- `UsersAdmin` → **Admin**, section `people`
- `SignIn`, `PendingAccess`, the database-error and startup-error screens → unchanged, and outside
  the shell entirely. They are `deriveAppState` branches, not destinations, and that distinction is
  load-bearing: `deriveAppState` stays the single place that decides what the *app* is showing,
  while `Destination` decides only what a signed-in, active person is looking at.

**The menu bar renders only in the `active` branch.** A signed-out visitor gets no navigation,
because there is nowhere for them to go.

## 6. Overview and Revenue, honestly

Both are short pages, not spinners and not the words "coming soon". Each says what will live there
and — where it is true — what it is waiting on. A page that admits what it does not have yet is
better than a page that looks broken, and this codebase already takes that position with the boot
fallback and the startup-error screen.

### 6.1 Overview

Says it will carry the snapshot, and that its contents are being designed. **Nobody invents the
contents here.** An earlier assistant proposed six stat lines for exactly this page, the owner did
not recognise them, and they were retired as never-sourced (§1). Overview's design is its own
conversation with the owner, and this slice deliberately leaves it empty rather than fill it with a
second guess.

### 6.2 Revenue

Says it will carry revenue retention, churn and tenure, and that revenue retention is waiting on a
data model that has not been designed. That is not a placeholder apology; it is the truth and it is
the reminder the owner will want. The specifics, carried forward from earlier notes: `sows` and
`client_month_revenue` are proposed and unbuilt, and **retention needs a HISTORY of monthly amounts,
which one editable retainer field cannot produce.**

Churn, unlike revenue retention, is not blocked — production holds exactly one `former` client, and
the tenure and churn work is scoped and waiting. It lands here in a later slice.

## 7. Modules

- `src/shell/destination.ts` — the `Destination` union and its transitions. Pure, unit-tested, the
  same shape and for the same reasons as `src/appState.ts`.
- `src/shell/MenuBar.tsx` + `.module.css` — the bar. Renders from a list so the destinations and
  their order live in one place, the way `ThemeControl` renders from `THEME_PREFERENCES`.
- `src/shell/Overview.tsx`, `src/shell/Revenue.tsx` — the two honest pages.
- `src/board/Board.tsx` — loses its five navigation booleans and its four early returns, keeping
  `showArchived` and `view`. It is 329 lines today and doing two jobs, board and navigation host;
  this removes the second.

The `src/shell/` directory is new and deliberate: the shell is not part of the board, and leaving it
in `board/` is what let one file become both.

## 8. Testing

| File | Covers |
|---|---|
| `src/shell/destination.test.ts` | every transition; that the union admits no impossible state |
| `src/shell/MenuBar.dom.test.tsx` | four entries, current one marked, Admin hidden without either capability, Admin shown with only one |
| `src/board/Board.dom.test.tsx` | Add client is gated by `manage_clients`; the board re-reads after an add |
| existing suites | must pass unchanged — the screens themselves are not being rewritten |

The capability tests matter more than their size suggests: `admin`, `account_manager` and `viewer`
must each be asserted, because the account manager case — Admin visible, People hidden — is the one
a single admin-versus-viewer test would miss.

## 9. Decisions, with what each costs

**A union, not a fourth boolean.** Costs ~40 lines and a refactor of a file that currently works.
Buys impossible states becoming compile errors, and a single place a router could later drive.

**No router.** Costs shareable links, which the tool has never had. Buys no dependency, no
`404.html` trick, no redirect map to maintain. Revisit when somebody asks to send a link.

**Admin holds both management screens; Clients gets an Add button.** Owner's call. Costs one
capability-gated button rendered in two places rather than one. Buys the split being *viewing versus
administering* while the frequent action stays where the hand reaches.

**Overview and Revenue ship empty.** Costs a first deploy where half the menu is honest about being
unfinished. Buys the structure being live and reviewable now, and every later piece dropping into a
place that already works.

**The check-in screen becomes a sub-state of Clients.** Costs nothing. Buys the union matching how
the screen is actually reached and left.

## 10. Open items

- **`started_on` is optional and probably should not be.** A client added without one silently
  scores no Advocacy and is invisible to tenure. Belongs with the tenure work. §2.
- **`paused` is a real status in production and appears in no spec.** The parent spec's lifecycle
  section lists `active`, `cancelled` and `former`. Production holds one `paused` client, and the
  check constraint treats it as not-churn. Whatever Revenue reports on will have to say what a
  paused client is.
- **Overview's contents** — its own conversation, §6.1.
- **The revenue data model** — still owed as a proposal, §6.2.
- Carried forward, untouched here: the §9 grid inversion on band fills in dark, and whether
  `color-scheme` reaches the platform widgets.

# Slice D — Moving up the ladder

The owner's boss asked, on the 2026-09-11 call, to see which brands climb the package ladder and
whether climbing predicts loyalty. The schema he needed shipped the next day and nothing has read
it since. This slice puts the answer on the Overview page, having first established that the
comparison he described would have flattered its own conclusion.

> *"I would love to see a brand join us and we're in foundation. And then I'd love to see them
> graduate from foundation into grow… almost being able to see which brands are moving up the
> ladder with us. What's the correlation of someone who signed with us on foundation and then
> graduates to grow? Do they stay with us longer… than a brand who skips foundation and jumps
> straight into grow?"*
> — the owner's boss, 2026-09-11

This is the page's own next step, written down at the time. `tests/overviewProvenance.test.ts`
asserts the Overview page contains no mention of Foundation, and the comment above that assertion
says progression "was asked for by the owner's boss on the same call and needs a schema change.
When it arrives it belongs here, and this assertion should be the thing that gets updated."

The schema arrived on 2026-09-12: `client_packages`, a table of stints, with `journeyOf` already
computing `climbed | stayed | descended` and an intake form in the client editor. Only the reading
half is missing.

---

## 1. The question, and the trap inside it

The comparison as he framed it pairs **clients who signed at Foundation and then graduated**
against **clients who skipped Foundation and joined at Grow or above**.

**The first group is defined by an outcome, and that breaks it.** A client who joined at Foundation
and left before anyone promoted them falls into neither group. So the Foundation side contains only
the on-ramp's *successes*, while the other side contains everyone who came in above it, winners and
losers alike. It would report Foundation as the stronger on-ramp whatever the truth is, and the
reader would have no way to see that from the sentence.

Two further problems are real but solvable, and worth recording because they shaped the rules in §3:

- **A running tenure is not a lifetime.** Most clients are still here, and their tenure is a figure
  that keeps growing. `Tenure` already splits `currentRows` from `departedRows` for exactly this
  reason. Mixing the two understates whichever group holds more completed relationships.
- **Climbing takes time.** Any grouping that depends on *having climbed* also depends on having
  survived long enough to be promoted, so it measures survival twice.

**The reading that survives: define both groups at the moment they signed, and measure only
relationships that have ended.** Where a client entered the ladder is fixed on their first day and
nothing that happens afterwards can move them between groups, so there is no selection on the
outcome. Restricting to ended relationships removes the running-tenure problem. Both fixes together
leave a comparison that can genuinely come out either way.

**It also still answers the decision he is making.** His stated worry — *"if I'm wrong, that grossly
changes what maybe our focus should be"* — is about whether Foundation is a good on-ramp, not about
the mechanics of promotion. "Do clients who join at Foundation stay longer than clients who join
above it" is that question, asked in a form that cannot flatter itself.

**One consequence worth stating plainly: the verdict does not use `journeyOf` at all.** It needs
only the entry rung. The journey still drives the movement lists in §2.2; it simply stops being
load-bearing for the claim.

---

## 2. What the section says

**Heading: "Moving up the ladder."** Plain words, like Billing, Retention, Concentration, Tenure and
Churn. It sits **below** "What needs attention" on the Overview page: the alarm list is what this
page is for, and this section is context rather than an alarm.

### 2.1 Where everyone is today

A count of active clients per rung — Foundation, Grow, Scale — in ladder order, beside **the number
of active clients with no package recorded at all**, given the same weight rather than tucked away.

That last number is the honest denominator. `packageLabel(null)` already returns "No package
recorded" and `clientPackages.ts` already refuses to read null as Foundation, on the grounds that
defaulting to the first rung "would invent a journey for every client on the roster". A ladder
showing three counts and hiding a fourth would undo that decision at the last step. It is also the
number most likely to get the data entered, which is what everything below it waits on.

### 2.2 Who moved

Two lists, kept separate: clients who **climbed**, and clients who **descended**.

Each names the move — entry rung to highest rung reached, matching how `journeyOf` decides. When the
client has since come back down, the line also names where they are now, so that "Foundation →
Scale" cannot imply Scale is current.

**The descents list was not asked for.** It is this document's proposal, approved by the owner on
2026-09-24, and recorded as such because the Overview page has a history here: six stat lines were
once invented for it, the owner did not recognise them, and they were retired as never-sourced. The
argument for it is that this page exists to surface what needs attention, a client stepping down the
ladder is closer to that than a promotion is, and a page that shows only promotions is a page that
flatters. The argument against it was that nobody asked. The provenance test records which of the
section's contents came from the call and which did not.

### 2.3 The verdict

One sentence, in the shape slice C established:

> *"Of the relationships that have ended with a package recorded, those who joined at Foundation
> stayed longer: a median of 1 yr 2 mo, against 7 mo for those who joined above it — from 6 and 5
> ended relationships."*

**The sample sizes are always printed.** They are the real defence against over-reading a median,
and more useful than any threshold.

**Below `MIN_GROUP` measured relationships in either group it prints no number at all** (§3.4). Instead it says what it is waiting
for — that recording packages for clients who have already left is what makes this sentence
possible. On the day this ships that is the likely state, and it is the more useful of the two
states, because it is the only one that tells anybody what to do.

**One caveat rides in the caption**, because it is true of both groups and not necessarily equally:
clients brought in by the 2026 import have `started_on` set to their first invoice month — the
earliest the relationship *can* have begun, not when it did — so tenure understates, unevenly
(slice 6h §3.3).

---

## 3. The rules

A new pure module, `src/clients/packageProgress.ts`. No React, no Supabase, no clock of its own:
every date arrives as a `YYYY-MM-DD` string and `asOf` is a parameter, the discipline `tenureMath`
documents at length.

It imports and reimplements nothing: `sortStints` and `journeyOf` from `clientPackages.ts`,
`tenureDays` from `tenureMath.ts`, `medianOf` from `mixMath.ts`.

### 3.1 `entryRung(stints): string | null`

The package code of the **earliest stint by date**, via `sortStints` — not the first row returned.
Rows arrive in whatever order the database gives them, and somebody correcting history enters an
older stint after a newer one. Null when there are no stints.

Unlike `journeyOf`, an unrecognised code is returned as-is rather than collapsing to null: a client
who entered on a rung this vocabulary does not know still entered somewhere, and §3.4 only ever asks
whether that rung *is* `foundation`.

### 3.2 `ladderStanding(clients, byClient, asOf)`

Counts of **active** clients per rung, in `PACKAGE_CODES` order, plus `unrecorded`. A client's rung
is `currentStint(stints, asOf)`, which already ignores stints dated in the future — a move recorded
ahead of time is a plan, not the current state.

Active means **not churned** — `!isChurned(status)`, the predicate `currentRows` already uses — and
that deliberately **includes paused clients**. `clientForm.ts` describes paused as "still a client,
but not being scored right now", so a paused client sits on a rung and belongs in this count;
`status === 'active'` would be the wrong test and is the easy mistake here.

Departed clients are absent entirely; where they sat on a ladder they have left is not a fact about
today.

### 3.3 `movements(clients, byClient)`

`{ climbed, descended }`, each an array of `{ clientId, name, from, to, now }`, where `from` is the
entry rung, `to` the highest (or lowest) rung reached, and `now` the current rung when it differs
from `to`, else null. Membership is `journeyOf` and nothing else, so the lists cannot disagree with
the function that defines the words.

Both lists cover every client, departed included: a client who climbed and then left still climbed,
and dropping them would quietly make the lists a story about the current roster.

### 3.4 `onRampComparison(clients, byClient, asOf)` and `MIN_GROUP`

Population: **`departedRows`**, filtered to clients with at least one recorded stint. Reused rather
than refiltered, so this section and the Tenure report cannot come to different views of who has
left or of how long they stayed — `departedRows` already measures to the day they left rather than to
today, and already returns `days: null` when either date is missing. Active clients are out because
their tenure is still running; clients with no stint are out because there is nothing to group them
by.

Two groups, by `entryRung`: **`foundation`**, and **above** (any other rung, recognised or not, that
is not `foundation`).

**Counted and measured are not the same number**, the distinction `summarise` already documents:
every client in the group is counted, and the median is taken over those whose tenure is measurable.
A departed client with no `started_on` is in the group and out of the median, because treating an
unknown as a zero would drag the median down and dropping them from the count would answer a
different question from the one the sentence appears to answer. **`MIN_GROUP` gates on the measured
count**, since that is what the median actually rests on, and the measured count is what the sentence
prints. When the two differ, the caption says how many were left out for want of a start date.

Returns a discriminated union: `{ kind: 'waiting', foundation: n, above: n }` when either measured
group is smaller than `MIN_GROUP`, else `{ kind: 'ready', foundation: { count, measured, medianDays
}, above: { count, measured, medianDays }, longer: 'foundation' | 'above' | 'tie' }`.

**`MIN_GROUP = 3`**, exported, so the rule and the sentence that describes it cannot drift apart.
Three is a judgement, set by the owner on 2026-09-24: low enough that the sentence can appear within
a few months of the data being recorded, high enough that one unusual departure cannot set a median
by itself.

`longer` is computed, never assumed. A fixture in which the above-Foundation group wins must produce
a verdict saying so — see §7.

---

## 4. Where the code lives, and what it reads

| File | Role |
|---|---|
| `src/clients/packageProgress.ts` | §3's rules, pure |
| `src/clients/usePackages.ts` | the one new read |
| `src/shell/Overview.tsx` | the section, and a new `role` prop |
| `src/shell/Overview.module.css` | its layout |
| `src/shell/destination.ts` | `LANDING` (§6) |
| `tests/overviewProvenance.test.ts` | the pinned contents, updated deliberately |

**`packageProgress.ts` lives in `clients/`, not `shell/`.** It is domain arithmetic about clients
rather than anything to do with this application's chrome. That distinction is about to matter: this
tool is to be folded into another the company is building, and a pure domain module survives being
re-hosted while a page's layout does not.

**The roster is already loaded.** `useRetention` reads `id, name, status, started_on, ended_on,
end_reason_code` for every client and Overview already mounts it. The verdict needs no second roster
read and must not add one, or the two halves of this page could disagree about who has left.

**`usePackages(enabled)` is the only new read** — its own hook rather than `useClients`, which is an
admin hook carrying owner options and two write paths that this page has no business mounting. It
selects `PACKAGE_COLUMNS` ordered by `started_on` and returns `{ status, loadError, byClient }`.

### 4.1 Two gates, and both are load-bearing

`client_packages` is `select`-gated on `manage_clients` in RLS. So, per slice 6l:

- **Display**: Overview renders the section only when `can(role, 'manage_clients')`.
- **Read**: `usePackages` issues no query when `enabled` is false.

Drawing the section for a `viewer` and letting RLS return nothing would render an empty ladder that
looks like a roster with no packages recorded, which is a different and false statement. Threading
`role` means Overview takes a prop for the first time, from Shell, exactly as slice 6l threaded
Edit client through Shell → Board → CheckIn.

### 4.2 How this page fails, which is a change

Overview currently composes one status from its two reads, so an error in either blanks the whole
page. **The stints read does not join that composition.** If it fails, the ladder section says so
and the at-risk list still renders.

A secondary section must never be able to hide the clients who need attention — that is the page's
entire purpose, and the existing rule that it must never say "all clear" on a read it could not make
points the same way. The same holds while loading: the ladder says it is loading, the alarm list
does not wait for it.

---

## 5. The landing moves to Overview

`LANDING` in `destination.ts` becomes `{ kind: 'overview' }`.

Slice 6a §3.1 made this conditional and the condition has been met for a fortnight: sign-in lands on
Clients "until Overview has content, and moves to Overview in the slice that gives it content."
Overview was filled on 2026-09-11 and the landing was not moved with it. The primary reader of the
Overview page currently has to navigate away from his landing screen to reach the page built for
him, every time.

Overview is in `DESTINATIONS` for every role, and a `viewer` who cannot read revenue or packages
still sees the at-risk list, so no role lands on a screen it cannot use.

**Recorded against the fold:** the host tool will bring its own home screen and this line is likely
to be discarded then. It is five lines and a test against a daily cost today, and the owner's call
on 2026-09-24 was to pay it.

---

## 6. Considered and rejected

- **The comparison as transcribed** — Foundation graduates against Grow joiners. §1. It is his
  literal question, and he would recognise it instantly, which is the argument for it. Rejected
  because a group defined by an outcome cannot lose.
- **Both sentences, his and the fair one.** Two medians on a page whose value is brevity, and a
  reader offered two answers will take the one they like.
- **Climbers against non-climbers, regardless of entry rung.** Answers "does climbing predict
  loyalty" rather than "is Foundation a good on-ramp", and reintroduces the survival-measured-twice
  problem the entry-rung grouping exists to remove.
- **Including active clients with their running tenure, marked as incomplete.** A larger sample
  immediately, at the cost of comparing a finished thing with an unfinished one. `Tenure` already
  refuses this.
- **A third group: joined at Foundation and never climbed.** The cleanest test of whether climbing
  itself predicts anything, and unusable at these sample sizes — three groups over a population that
  cannot yet fill two.
- **Putting the section on the Clients screen instead.** It is a roster fact, and Clients is where
  the roster lives. Rejected on the source: he asked to open the overview and see it.
- **Showing the ladder to every role and letting RLS empty it.** §4.1.

---

## 7. Testing

Pure rules, mutated. Slice 6l shipped six tests whose assertions could not fail and slice 6k four,
and every one of the ten originated in spec or plan prose exactly like this section's. A test is not
evidence until it has been watched to fail.

The mutants that must each break at least one test:

- **The verdict flipped.** A fixture in which the above-Foundation group has the longer median must
  produce a verdict saying so. **This is the vacuous test this slice is most likely to produce**: a
  `longer` hard-coded to `'foundation'` would pass every test that only ever sees Foundation win.
- **`MIN_GROUP` 3 → 1.** A fixture with two ended relationships in a group must print no number.
- **The population widened** to include active clients must fail.
- **The population narrowed** — dropping the requirement for a recorded stint, so unrecorded clients
  count as "above Foundation" — must fail.
- **`entryRung` fed stints in reverse date order** must still return the earliest.
- **`ladderStanding` dropping the unrecorded count**, or folding nulls into Foundation, must fail.
- **`ladderStanding` counting departed clients** must fail, and **`ladderStanding` excluding paused
  clients** must fail — the two halves of §3.2, each provable on its own.
- **A departed client with no `started_on` folded into the median as a zero**, or dropped from the
  group count, must each fail.
- **`movements` omitting departed clients** must fail.
- **The display gate deleted** must fail.
- **`if (!enabled) return` deleted from the read** must fail. That exact mutant survived all 1,674
  tests on slice 6l.
- **The stints read made fatal to the page** — the at-risk list must still render when it errors,
  and must not wait for it while it loads.

Also: synthetic client names throughout, because this repository is public. DOM tests carry
`// @vitest-environment jsdom`; `vite.config.ts` defaults to node. No `.toBeInTheDocument()` — there
is no jest-dom here. Nothing under `src/` imports `node:*`; the provenance test reads source and
therefore lives in `tests/`.

**What no test here can check.** The ladder counts and the two movement lists are layout, and jsdom
computes none. This needs the owner's eyes in staging before it merges, as every positional change
on this project has.

---

## 8. Out of scope

- **Any projection of who will climb.** Everything here is movement already recorded.
- **Backfilling package history.** The data is entered by hand in the client editor, and this slice
  reads whatever is there. Whether historical stints are worth reconstructing for departed clients
  is a decision about the owner's time, not a consequence of this design — though §2.3's waiting
  state is what will make the cost of not doing it visible.
- **Lead-source breakdown**, called "much further down the road" and living in a different system.
- **A general note on a client**, asked for on the same call. No such field exists.
- **The survival analysis that would properly separate climbing from tenure.** Named here so it is
  not mistaken for an oversight: comparing like-for-like from a common point in the relationship is
  the right way to ask whether promotion predicts loyalty, and it is a great deal more than a
  section on a summary page.

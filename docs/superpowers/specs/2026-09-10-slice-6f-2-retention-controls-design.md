# Slice 6f-2 — Retention controls, and its visual hierarchy

## 1. What this is for

Deferred from 6f-1 §1.3 until **[owner]** had used real numbers. He has, and on 2026-09-10 he
also confirmed the original ask: *"change the date range of the results, change between gross and
net, include/exclude clients who have cancelled."*

Bundled with 6d §8's deferred item — the same section he called *"too many numbers at once"* —
because both change the same component and the visual question is now answerable: the page has a
lead, and Retention sits in a half-width column beside Concentration.

---

## 2. The decisions

| | Decision | Source |
|---|---|---|
| Named windows: 1, 3, 6, 12 months | **[owner]**, chosen over free month pickers | §3 |
| A short window is CAUTIONED, never refused | Derived — §3.1 | |
| Gross/net swaps which rate is the HEADLINE; neither is ever hidden | **[owner]** | §4 |
| Exclusions leave out only *Ended by us* and *Project completed* | **[owner]** | §5 |
| Contributions collapse to top movers + "N others" | **[owner]** | §6 |
| The contributions list folds; the rate, movement and basis do NOT | Derived — §6.1 | |
| Movement becomes a diverging bar | **[owner]** | §7 |

---

## 3. The window

Four buttons. The anchor stays the latest month holding an entry — never today's calendar month,
the rule `latestPeriod` has always applied. The window sets how far back the comparison reaches.

`retention()` already takes an arbitrary base period, added in slice 6e for the month panel. This
slice adds no arithmetic; it chooses the argument.

### 3.1 Cautioned, not refused

6f-1 §1.3 recorded the trap: *"a selectable window reopens what `MIN_RATE_PERIODS` closed —
retention over two months is a number that reads as a fact and is not one."*

The answer is a **visible caution on short windows**, not a refusal. Refusing here would be
incoherent: slice 6e's month panel already shows a **one-month** rate, on the owner's approval,
and a section that refuses the same figure the panel prints would be two rules for one number.

The caution names the reason rather than scolding: a short window on a roster this size moves
sharply on one client's invoice timing. It appears for windows under six months.

---

## 4. Gross and net

Both stay on screen always. The toggle chooses which one is the **headline** — the large figure —
and which sits beside it small.

Hiding one was offered and rejected. **[owner]**'s boss: *"Net is most important, but we still
want visibility into gross."* A control that lets the section be screenshotted with no net figure
anywhere defeats that.

---

## 5. Exclusions, and why the obvious version is a lie

6f-1 §1.3's second trap: *"excluding cancelled clients removes churn from the churn measure.
Applied silently, NRR sits at or above 100% permanently, because the only clients left are the
ones who stayed."*

So the control is **not** "include/exclude cancelled clients". It excludes only departures that
were not retention failures, by `end_reason_code`:

| Code | Excluded? | Why |
|---|---|---|
| `agency_initiated` — Ended by us | **Yes** | We chose it. Nothing was lost that we were trying to keep. |
| `project_completed` — Project completed | **Yes** | The work finished. There was nothing left to retain. |
| `price`, `scope_fit`, `went_quiet`, `in_housed`, `other` | No | Losses. |

`in_housed` stays IN deliberately. **[owner]** was offered it and declined: a client building an
internal team is a competitive loss to most readers, and excluding it reads as flattering to
anyone checking the figure.

**The result is a different number and says so on its face.** When the toggle is on, the section
states what was left out and how many, in the same place the basis sentence lives. It never
presents itself as plain "retention".

---

## 6. The visual hierarchy

**[owner]** selected all four offered changes. Three compose directly; the fourth needed
reconciling.

1. The chosen rate stays large; the other sits beside it.
2. Movement becomes a bar (§7).
3. Contributions collapse to the top movers with the remainder in one row — the shape
   Concentration already uses.
4. More air, and the figures grouped into bands, rather than one undifferentiated stack.

### 6.1 What does NOT fold, and why

"One headline, the rest folded away" was selected. Taken literally it would fold the **basis
sentence** — *"Based on 5 of 16 clients · 1 had no entry"* — and slice 6e §3.1 established that
this sentence is the thing that makes the rate defensible and must travel WITH it. That was the
whole argument for keeping the rate out of a tooltip; hiding the same sentence one slice later
would contradict it.

So the **contributions list folds** — the bulk of the section — and the rate, the movement bar,
the caution and the basis sentence stay visible. Reported to **[owner]** at the time rather than
resolved silently.

The "N others" row expands rather than truncates: nothing is removed, only staged. That is what
reconciles "collapse the list" with "don't remove anything".

---

## 7. The movement bar, and a palette that ran out

Expansion, contraction and churn as a diverging bar: gains one side of a baseline, losses the
other, figures on hover and in text. Contraction and churn stay separate marks — 6f-1 keeps them
apart because *"a client shrank" and "a client left" are different events that a single number
would blend*, and a bar that merges them undoes that.

### 7.1 THE VALIDATOR REFUSED A THIRD LOSS COLOUR, and that is the finding

Three quantities suggested three hues. Run against the page's existing series — `--chart-retainer`
`#0D9488` and `--chart-project` `#C2410C` — with `--pairs all`:

| Candidate set | Result |
|---|---|
| + red `#B91C1C` | **FAIL** — ΔE 6.1 against the project orange to NORMAL vision, 5.0 deutan |
| + blue `#3B82F6`, purple `#9333EA` | **FAIL** — ΔE 5.3 deutan between the two new ones |
| + blue `#2563EB`, violet `#7C3AED` | **FAIL** — ΔE 0.4 deutan, 12.4 normal |
| + blue `#2563EB`, magenta `#A21CAF` | **PASS**, both modes |
| the same, plus a third magenta step | **FAIL** — outside the lightness band in both modes |

Four hues is this page's ceiling. A fifth cannot be added that a colourblind reader — or in the
red case, *any* reader — can separate from what is already there.

So the bar carries **two** colours and splits the loss side by **texture**: contraction solid,
churn hatched, both in `--chart-loss`. Secondary encoding is the skill's own sanctioned answer
when hues run out, and it is the honest one: the two losses ARE the same kind of thing.

`--chart-gain: #2563EB` and `--chart-loss: #A21CAF`. Both pass all five checks in light and dark,
so both join the pinned tokens that do not flip. Dark raises one WARN — `#A21CAF` at 2.75:1
against the dark surface — which the skill discharges with visible labels or a table view. The
bar has both.

---

## 8. Not in this slice

- **6f-3, retention over time.** Still data-blocked: twenty-four months are needed for a second
  trailing-twelve point.
- **Free month-pair selection.** Offered and declined in favour of named windows.
- **Concentration's month control.** Still open, recorded in 6e §6.

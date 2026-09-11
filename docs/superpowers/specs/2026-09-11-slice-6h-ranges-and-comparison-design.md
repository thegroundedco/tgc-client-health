# Slice 6h — Date ranges, comparison, and what the 11 September call added

Written after the work rather than before it, on the owner's instruction: *"It's gonna be
easier for me to see it in staging and give you feedback than to give you feedback based on
this."* What follows is therefore a record of decisions actually made and measurements actually
taken, not a plan. Where a decision was reversed, both halves are kept — the reversals are the
most useful part.

---

## 1. The range picker

**[owner]** asked for Shopify-style range selection: presets plus a Custom option with two month
pickers. Thirteen presets, so a native `<select>` rather than a button row — the Retention window
control is four buttons and reads well; thirteen would wrap into a wall.

### 1.1 Everything resolves against the DATA, never the calendar

The anchor is the latest month holding an entry, the rule `latestPeriod` has enforced since 6f-1.
On the 2nd of a month almost nothing is entered, and a calendar-anchored "last three months"
would quietly include a month nobody has typed.

### 1.2 Clamping is the substance

Unclamped, "Full year" runs to December and draws October, November and December as *unentered* —
a claim about months that have not happened, which is the same lie as a zero for a month nobody
typed. Clamping the start likewise stops a twelve-month window padding columns over months that
predate the records.

**A preset left empty by clamping is not offered at all.** Q4 is absent until Q4 exists, rather
than being a choice that blanks the chart.

### 1.3 The control governs Billing and Concentration — and says so

Originally **[owner]** scoped the range to Billing alone. After using it he asked for
Concentration to follow: *"so we can see where we were most exposed during said date range."*

That moved the control to page level, because a control that silently changes a section three
screens further down reads as a bug. It names what it covers out loud, because it does **not**
govern Retention, Tenure or Churn, and unstated a reader would take three sections as answers to
a question they never asked.

Concentration's shares are of the **range's** total, so a client present for part of it ranks
smaller — the honest answer to where the money was concentrated over a period, and not the answer
to who is biggest right now, which a single month already gives.

---

## 2. The comparison, and two reversals

**[owner]**, after Shopify: compare a range against the previous period or the previous year. The
comparison is always the **same length** as the primary, offset backwards. Two ranges of
different lengths cannot share an x axis honestly, because month three of one would sit above
month three of the other while meaning something else.

### 2.1 REVERSAL ONE — the outline became a bar

First built as a dashed outline behind each bar, chosen by **[owner]** from three options. On
seeing it he rejected it: *"The dashed outline is hard to compare against the solid colored
months that it's comparing against."*

He was right, and the reason is worth keeping: comparing an **edge** with an **area** is a harder
perceptual task than comparing two lengths from a common baseline. It is now a solid bar beside
the period's own.

**The reasoning that produced the outline was over-constrained.** A fifth HUE was correctly
refused — every candidate failed CVD separation against the page's existing four — but "no fifth
hue" was then wrongly taken to mean "no fill". A neutral is not a hue; it reads as *not a
category*, which is what a reference series should be.

### 2.2 The grey was measured twice, because the first one was wrong

`#8C8578` was the obvious pick and measured **ΔE 2.6 protan, 11.2 to NORMAL vision** against the
retainer teal. "Grey is safe because it is achromatic" is false at that lightness.

The pair in use is `#B5AE9E` and `#5C5548`, separating from each other at 3.34:1 and **swapping
between themes** rather than each having a counterpart: the quiet one is whichever sits closer to
its ground. They are the first chart colours in this project that flip, and `themeParity`
asserts the flip positively so nobody pins them back.

Against the series they FAIL the chroma floor and the lightness band — both checks for a
*categorical* series of equal weight, which this deliberately is not — and WARN on CVD separation
and contrast. Both warnings are discharged as the skill requires: three secondary encodings
(fixed position beside the period's bar, a legend entry, every figure in the table) and a table
view.

### 2.3 REVERSAL TWO — the comparison gained the split

Built first as one flat grey block, on the reasoning that four quantities per month is where a
bar chart stops being readable. **[owner]** rejected that too: with the bars paired rather than
overlaid, a divided bar beside an undivided one made the halves incomparable. It now stacks
retainer and project exactly as the period's bar does.

### 2.4 Null is never zero

A comparison month nobody entered draws no bar and is excluded from the comparison total. A
comparison period entirely before the records says so in words rather than reporting the range as
an infinite rise — the most flattering lie available here.

---

## 3. What the 11 September call added

**[owner]** showed the tool to **[owner's boss]**. The transcript produced five things.

### 3.1 The reader is colourblind

Established in passing. It turns the palette validation from good practice into a hard
requirement, and it decided §3.2 and the form of the exposure flag.

### 3.2 The exposure flag

**[owner's boss]**: *"anytime we have a single client that breaks 20% of our revenue, like it
should be flagged, because to me, that's a major concern."*

**Breaks**, not reaches: at exactly a fifth nothing has been broken, and a boundary firing there
would cry wolf on four clients splitting the book evenly. Marked **in words**, not colour, per
§3.1. The threshold is derived from the constant rather than typed into the sentence.

The collapsed "others" row is never flagged — it can carry any share and is not one client
carrying that risk.

**A pie chart was also floated and is NOT built.** Pie segments are identified by colour alone
and there are more of them than this page's four-hue ceiling. For a colourblind reader it is the
worst available form. Recorded so it is not rediscovered as a new idea.

### 3.3 Retainer versus project

**[owner's boss]**: *"my belief is the monthly retainer is a stronger play for us... but I might
be wrong, and if I'm wrong, that grossly changes what maybe our focus should be."*

Since the answer may contradict him, nothing rounds toward the hypothesis: an exactly even split
counts as a **project** client. Kind is derived from the revenue, because asking for a typed
client type would mean a judgement per client before the question could be asked at all.

Medians, never means — on a book where one client can be a fifth of revenue, a mean describes
that client rather than the group.

**Half the answer is currently unreliable and the section says so.** Most of the roster arrived
through the 2026 import with a start date set to the first invoice month — the earliest the
relationship *can* have begun, not when it did — so tenure understates, unevenly. The revenue
half carries no such caveat.

### 3.4 Two data corrections

**GCC and Juan Valdez are one client**, filed as Juan Valdez: one relationship invoiced under a
different name per entity. The rename happens BEFORE the months are summed, or the two names
produce two cells for the same client-month and `planImport` refuses them as duplicates.

**Randy Rent removed** on **[owner]**'s instruction, though **[owner's boss]** described it as
real revenue — a photographer at $300/month.

**Fusion was never removed.** **[owner]** believed he had removed it and asked for it back; it had
been in all along, at $25,000, because "CE is a mistype of CEO" had already merged both line
items into the retainer.

### 3.5 Deferred, with reasons

- **Lead-source breakdown** — **[owner's boss]** called it "much further down the road"; it lives
  in a different system.
- **Foundation → Grow progression** — wants to see which brands climb and whether climbers stay
  longer. A schema change plus intake changes; feeds the Overview page.
- **A general note on a client** — asked for, to explain what Fusion's invoice is. No such field
  exists; only `end_reason_note`, for departures.
- **Elaborate churn-reason capture** — explicitly steered AWAY from: *"I don't think we need the
  context in it... it's more about having the visibility into what happened."*

---

## 4. What this slice's guards caught

Recorded because the pattern matters more than any one instance. Four tests written during this
slice passed **against the wrong thing**, and every one was found by mutating the code rather
than by reading the test:

| Test | Why it could not fail |
|---|---|
| "scales to the top gridline" | asserted height < 200, which the 2px inter-segment gap already guarantees |
| five clickable-row cases | the bars carry the same accessible name, so an unscoped query found a bar |
| "em dash where the comparison is missing" | asserted the ROW contains one; the Change column prints one too |
| "median" | `[3,1,2]` has a median of 2 and a mean of 2 |

Two more requirements were written in comments and enforced by nothing: the axis ceiling taking
the higher of the two series, twice.

**Three commits went in with a broken build**, each because the checks and the commit message
were composed in one command, so the claim was written before the exit code was read.

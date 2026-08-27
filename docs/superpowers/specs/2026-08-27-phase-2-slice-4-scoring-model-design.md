# Phase 2, Slice 4 — The Six-Bucket Scoring Model — Design

Status: designed 2026-08-27, unbuilt.
Source: the owner's boss, "TGC Client Health Tools Requirements" (Google Doc, read 2026-08-27).

Supersedes the five-pillar model in `2026-08-21-phase-1-slice-1-design.md` §5. That model is not
extended here; it is replaced, and its data is retained as history it is no longer comparable to.

## 1. Why this slice exists

The five pillars were a first guess at what "healthy" means, written before anyone had scored a
client with them. Having scored twelve, the boss rewrote the question. Two things changed:

1. **A bucket is no longer one judgement.** Scoring "Delivery: 4" asks one person to compress
   on-time rate, volume, client reaction and internal pride into a single number, and the number
   that comes out cannot be argued with because nobody can see what went into it. The new model
   asks the four questions separately and derives the 4.
2. **Advocacy became its own bucket, and it is time-gated.** Whether a client would refer us is
   meaningless in week three and diagnostic in month six, so it is excluded until a client has been
   with us 90 days.

The old `sentiment` pillar is the closest thing to Advocacy and is not close enough — it asked about
tone on calls; Advocacy asks four near-factual questions about reviews, case studies, referrals and
reference calls. That gap is the reason §2 retires the old data instead of migrating it.

## 2. What is in this slice, and what is not

**In.** The 22 questions and their six buckets; the bucket-average and overall-score arithmetic; the
90-day Advocacy gate; `clients.started_on`; the rewritten check-in screen; the board card's six
bars; new bands; the rebuilt score verifier.

**Not in, and each has a reason.**

- **The client x bucket matrix** (his third ask) is Slice 5. It reads bucket scores, which do not
  exist until this slice ships, and the sketch in the source doc is an image this design could not
  read.
- **The tenure and churn-reason report** (his fourth ask) is Slice 6 and is blocked on data, not on
  code: seven of the ten clients he names — NuKava, Neon Banjo, Bin Blasters, Coral, Naboso, Toms
  Key Company, Dixxon — have no row in `clients`. Two more, York and Gait Happens, are `active` in
  the roster while he describes them as three-to-six-month churns. That contradiction is a question
  for the owner before it is a schema.
- **Reading each client's notes to explain why they churned** (his fifth ask) is not a build at all.
  No client notes live in this tool, and the parent spec's settled position is that there is no paid
  API, so AI help is a copy-paste bridge. §11 carries the answer he should be given.
- **Migrating the twelve existing check-ins.** See §3.4.

## 3. The scoring model

### 3.1 The six buckets and their 22 questions

Wording is the boss's, lightly normalised to statements. Column names are fixed here because §5
turns them into a migration and §9 verifies them by name.

**Communication** — `comm_constructive`, `comm_timely`, `comm_consistent`
  Provides constructive feedback / timely feedback / consistent feedback.

**Growth** — `growth_goals_defined`, `growth_progress_trackable`, `growth_hitting_goals`
  Short and long term goals are clearly defined / we can track progress towards goals / we are
  hitting our goals.

**Finances** — `fin_rack_rate`, `fin_pays_on_time`, `fin_rate_increased`, `fin_on_terms`
  Paying rack rate / pays on time / increased rate over the last 90 days / is on terms.

**Relationship** — `rel_collaborative`, `rel_respectful`, `rel_fun`, `rel_multi_threaded`
  Collaborative / respectful / do they have fun / are we and they multi-threaded (are we working
  with their partners, are they working with ours).

**Delivery** — `del_on_time`, `del_quantity`, `del_client_likes`, `del_we_are_proud`
  Delivering on time / delivering a healthy quantity / the client likes our assets / we are proud of
  what we are delivering.

**Advocacy** — `adv_left_review`, `adv_case_study`, `adv_would_refer`, `adv_reference_check`
  Have they left a review / could we use them for a case study / would they refer us unprompted /
  could we send leads to them as a reference check.

Three plus three plus four plus four plus four plus four is 22.

### 3.2 The arithmetic, and the property that makes it work

Every question is scored 1-5. A bucket's score is the mean of its own questions. A client's overall
score is the mean of their buckets.

The consequence worth stating plainly, because the whole design leans on it: **a bucket score and an
overall score are both on the same 1.00-5.00 scale as a single question**, and they stay there
whether the bucket holds three questions or four, and whether the client has five buckets or six.
The 90-day gate therefore needs no special-casing at comparison time. A 60-day client scored on five
buckets and a two-year client scored on six produce numbers that can sit in the same column of the
same table and mean the same thing. Under the old raw-total model — 25 points across five pillars —
adding a sixth would have moved the ceiling to 30 and silently rebased every threshold.

**Buckets weigh equally; questions do not.** Each of Communication's three questions carries a third
of that bucket, while each of Delivery's four carries a quarter, so a single Communication answer
moves the overall score more than a single Delivery answer does. This is deliberate — the bucket is
the unit of meaning — but it is invisible on screen, so §10 records it as a decision rather than
letting it read as an accident.

### 3.3 Incompleteness

The rule from the original migration survives unchanged and is worth restating because it is the
reason the arithmetic lives in the database: **a missing answer must never read as a low score.** A
false "at risk" is as harmful as a false "healthy".

So a bucket with any unanswered question has no score — null, not a partial mean — and a check-in
missing any required bucket has no overall score. This is enforced by null propagation through `+`
in the generated expressions, exactly as `total_score` enforces it today, rather than by a rule in
TypeScript that a second caller can forget.

`adv_score` is null for two different reasons — unanswered, and not applicable — and §4 is where
those are told apart.

### 3.4 The twelve existing check-ins are retained, not migrated

Production holds 12 clients and approximately 12 check-ins (a live `pg_class` row estimate; raw SQL
against production is refused by the MCP safety classifier, so an exact count was not taken).

They stay in the table. The application stops reading them. Nothing is deleted and the history is
recoverable by query if it is ever wanted.

Migration was considered and rejected. It is arithmetically trivial — an old pillar score of 4 is a
valid bucket score of 4.00, no rescaling needed — and semantically wrong. Old `relationship`
measured reply speed and meeting attendance, which is the new **Communication**; old `sentiment`
measured tone, which is the nearest thing to the new **Advocacy** and is not it; and the new
**Relationship** has no old equivalent at all. A migrated history would draw a trend line across a
definition change, which is the kind of chart that misleads precisely because it looks like
measurement. With at most one scoring round per client there is also no trend there to protect.

**The visible cost, which the owner must be warned about before deploy:** the board shows no scores
at all until the first new round of check-ins is complete. This is best timed just before a scoring
round, not just after.

## 4. The 90-day Advocacy gate

### 4.1 What it reads

`clients.started_on date` — a new column, because nothing in the schema can stand in for it.
`created_at` records when the row was typed into this tool — the bulk of them when the roster was
seeded on 2026-08-21 — and says nothing about when the engagement began.

### 4.2 The rule

Advocacy is scored when the check-in's period begins at least 90 days after the client started:

```sql
c.started_on is not null and ch.period >= c.started_on + 90
```

**It reads `period`, not `now()`.** A check-in must be reproducible: reopening January's check-in in
December must not change the rules January was scored under. Anchoring to the period makes a
check-in's shape a function of its own row plus one client column, and therefore auditable.

### 4.3 When the start date is unknown

`started_on` is nullable, because eleven of them do not exist yet and a `not null` column would
require inventing them.

A null start date excludes Advocacy and **says so on screen**. The tool does not guess tenure. The
distinction §3.3 defers to here is resolved by the gate rather than by the data: Advocacy is
incomplete when it applies and an answer is missing, and not applicable when the gate is closed. The
null in `adv_score` is identical in both cases; the gate is what interprets it.

### 4.4 Completeness varies

A gated-out check-in requires 18 answers; a gated-in one requires 22. Every count on screen — the
save button's label, the draft line, the board's progress sentence — is against the required number
for that client and period, never a hardcoded 22.

## 5. The migration

One migration, on `public.checkins` and `public.clients`. No new tables, which is the point of the
shape chosen in §5.4: the existing RLS policies, the `authenticated` grants, the
`unique (client_id, period)` guard, the three indexes and the single-statement upsert all continue
to work untouched.

### 5.1 `clients.started_on`

```sql
alter table public.clients add column started_on date;
```

No constraint tying it to `ended_on`. A client whose engagement ended before it began is a data
entry error worth catching, but `clients_lifecycle_coherent` is already load-bearing and adding a
second predicate to it risks refusing an update the clients admin screen currently makes. Deferred,
and recorded in §11.

**The screen to edit it already exists and is deployed.** `src/clients/EditClientForm.tsx` and
`AddClientForm.tsx` already render the lifecycle fields, revealing `ended_on` and the reason
conditionally on a churned status. `started_on` is an unconditional date field beside the name and
owner — no new screen, no dashboard SQL, and therefore the owner can enter the eleven dates himself
the moment this ships.

### 5.2 The 22 answer columns

Each nullable, each `smallint check between 1 and 5`, matching the existing pillar columns exactly.
Nullable because a draft is a check-in with unanswered questions, and the check constraint rather
than an enum because that is how `status` and `end_reason_code` are already stored on these tables.

### 5.3 The six bucket columns

Generated, stored, `numeric(3,2)` — three significant digits and two decimals holds 0.00 to 9.99, so
the 1.00-5.00 range fits with room to spare.

```sql
comm_score numeric(3,2) generated always as
  ((comm_constructive + comm_timely + comm_consistent)::numeric / 3) stored
```

and the same shape for the other five. The explicit `::numeric` cast is required: without it
Postgres does integer division on the smallints and 4 + 4 + 5 becomes 4 instead of 4.33.

### 5.4 The old columns are renamed, not dropped

`relationship`, `delivery`, `financial`, `sentiment`, `growth` and `total_score` become
`legacy_relationship` and so on. Renaming rather than dropping keeps the twelve rows of history;
renaming rather than leaving them buys the thing that matters on a table about to hold 28 new
columns — a reader can tell at a glance which columns are live. Leaving a column named `growth`
beside `growth_goals_defined` and `growth_score` is a trap for the next person.

`total_score` is a generated column; renaming it is a catalogue operation and does not recompute
anything. **`npm run verify:score` breaks the moment this rename lands**: it runs
`scripts/score-parity.mjs`, which generates SQL that looks the expression up by name
(`a.attname = 'total_score'`). That generator must change in the same commit — §9 rewrites it
regardless.

## 6. The overall score lives in a view

It cannot be a generated column, for two independent reasons, either of which alone is decisive:

1. **Postgres forbids a generated column referencing another generated column**, so the overall
   cannot be built from the six bucket columns.
2. **A generation expression cannot reference another table**, and the gate needs
   `clients.started_on`.

So:

```sql
create view public.checkin_scores with (security_invoker = true) as
select
  ch.id,
  ch.client_id,
  ch.period,
  ch.comm_score, ch.growth_score, ch.fin_score,
  ch.rel_score, ch.del_score, ch.adv_score,
  (c.started_on is not null and ch.period >= c.started_on + 90) as advocacy_applies,
  case
    when c.started_on is not null and ch.period >= c.started_on + 90
      then (ch.comm_score + ch.growth_score + ch.fin_score
            + ch.rel_score + ch.del_score + ch.adv_score) / 6
    else (ch.comm_score + ch.growth_score + ch.fin_score
          + ch.rel_score + ch.del_score) / 5
  end as overall_score
from public.checkins ch
join public.clients c on c.id = ch.client_id;
```

Null propagation carries through both branches of the `case`, so §3.3's rule holds for the overall
score without a line of code asserting it.

**`security_invoker = true` is not optional and is not decoration.** A view without it executes
against the privileges of its owner, so every RLS policy on `checkins` and `clients` would be
bypassed and any signed-in account could read every client's scores. Production is Postgres 17.6
(confirmed 2026-08-27), so the option is available; it was introduced in Postgres 15. **A test must
assert the view refuses an inactive account**, because this is the same class of failure as the
`db:which` guard that printed a warning and exited 0 — a security mechanism whose absence looks
exactly like its presence until someone checks.

## 7. The check-in screen

Six sections in the boss's order — Communication, Growth, Finances, Relationship, Delivery,
Advocacy — each a heading followed by its questions, each question a 1-5 radio group reusing the
existing `PillarRow` control renamed to `QuestionRow`.

**Nothing collapses.** 22 questions is a long screen and the temptation is to fold the sections, but
a collapsed section hides unanswered work, and the whole point of §3.3 is that unanswered work must
be impossible to miss.

**The scale gets one legend, not 66 anchors.** The five-pillar rubric wrote anchors for 1, 3 and 5
on each pillar; doing the same for 22 questions means 66 pieces of new copy the boss has not
written. The questions are already specific statements, so a single agreement legend — 1 strongly
disagree through 5 strongly agree — carries them. §10 records what this costs.

**When the gate is closed**, the Advocacy section renders with its questions disabled and a line
explaining why: either that the client is inside their first 90 days, or that their start date is
missing. It is shown rather than hidden so the scorer learns the bucket exists.

**The draft cache must reject old drafts rather than migrate them.** `draftCache` stores partial
scores in `localStorage` keyed by client and period, and its stored shape is about to change from
five keys to 22. A stale draft restored into the new form would populate a screen with values from
retired pillars. The cache key gains a version segment and old entries are discarded on read. This
is the same failure that produced ruling 16 — a value that means one thing being read as though it
means another.

## 8. The board

Each card grows from five bars to six, keeping the per-bar initial letters added in `befc08f`.
The six initials are C, G, F, R, D and A: Growth, Relationship and Delivery keep theirs, Finances
inherits F from the retired `financial`, Communication and Advocacy are new, and Sentiment's S
retires with it. All six are distinct, and `pillars.test.ts` already asserts both that they are
distinct and that each equals its label's first letter — so it extends to six unchanged and is what
would catch a future collision.

A gated-out client shows five bars and a note that Advocacy begins at 90 days, not an empty sixth
bar, which would read as a zero.

The card's total and the board's progress sentence read `overall_score` from the view and the
required-answer count from §4.4.

## 9. Verification

### 9.1 The score verifier survives, by decomposing

`npm run verify:score` today enumerates all 7,776 states of five pillars over six values (1-5 plus
null), computes each in TypeScript, then reads the live expression out of `pg_attrdef` and evaluates
it against them — so it checks what is deployed rather than a copy of it.

Extended naively to 22 questions that is 6^22 states and the check is dead. It survives because
**each bucket's generated expression references only its own questions**, so the space decomposes
per bucket: 6^3 = 216 states for each of the two three-question buckets, and 6^4 = 1,296 for each of
the four four-question buckets. 432 + 5,184 = **5,616 states, fewer than the 7,776 checked today,
and still exhaustive** — every reachable input to every deployed bucket expression.

This property is the reason §5.4's shape was chosen over a normalised answers table or a `jsonb`
column. Neither has a per-bucket expression in the catalogue to read and evaluate, so both would
have replaced an exhaustive proof with a sample.

### 9.2 The view is verified separately

`overall_score` takes six nullable bucket scores and a boolean, so its behaviour is pinned by
enumerating the 2 x 2^6 = 128 shapes of (gate, which buckets are null) and asserting null propagates
in exactly the cases §3.3 requires, plus arithmetic spot checks on known values. The gate predicate
itself is checked at its boundaries: 89, 90 and 91 days, and a null `started_on`.

### 9.3 What only a person can check

Per the standing rule from Slice 1: the slice is not done until the owner has scored a real client
on the deployed site and confirmed the number that comes back is the number he expects. Twenty-two
radio groups is a screen nobody has used before, and no test can report that it is exhausting to
fill in.

## 10. Decisions recorded, with what they cost if wrong

1. **Bands stay at 3.6 and 2.2**, the exact arithmetic equivalents of the current 18 and 11 out of
   25. The bucket definitions are already changing this cycle; moving the thresholds at the same
   time would make it impossible to tell whether a client's band moved because the client changed or
   because we did. Cost if wrong: a cycle of bands that feel miscalibrated on the new questions.
   Cheap to change — two numbers in `bandFor`, no migration. Revisit after one real scoring round.
2. **Buckets weigh equally, questions do not** (§3.2). If the boss expects all 22 questions to carry
   equal weight, the overall becomes a mean of 22 rather than a mean of six, and the gate stops
   being free — the denominator would move from 22 to 18. Worth confirming with him before build.
3. **One agreement legend instead of 66 written anchors** (§7). Costs calibration: written anchors
   are what stop two scorers meaning different things by "4", and this model has more scorers coming.
   Revisit if two people scoring the same client diverge.
4. **The old columns are renamed rather than dropped** (§5.4). Costs a wider table forever. Dropping
   them destroys the only record of the first twelve check-ins.
5. **Questions live in code, not a table**, consistent with the ruling that deferred
   `pillar_definitions`. Costs a migration per question change — and unlike the five pillars, which
   changed zero times in a year, this list is three days old. If it moves twice more, revisit.

## 11. Open items carried forward

1. **Eleven start dates, from the owner.** Nothing in this slice ships usefully without them: with
   every `started_on` null, the gate is closed for every client and Advocacy is never scored. They
   are entered through the existing clients admin screen once §5.1's field is added — this needs no
   dashboard SQL and no new screen.
2. **The answer to the boss's fifth ask.** He hopes the tool will read each client's notes and
   explain the churn. It will not, and the reason is worth giving him straight: the notes are not in
   this tool, and the project runs on no paid API by design. What is achievable is a copy-paste
   bridge — the tool assembles a client's scores and history into a prompt he pastes into Claude.
   That should be offered as what it is rather than allowed to look like a missing feature.
3. **York and Gait Happens are `active` here and churned in his notes.** Resolve before Slice 6.
4. **The seven clients with no row.** Slice 6 is blocked on them, and on their start and end dates.
5. **`Test Client` (production id 2)** is still `active` and will render a twelfth card with six
   empty bars. Offered to the owner three times, still unanswered.

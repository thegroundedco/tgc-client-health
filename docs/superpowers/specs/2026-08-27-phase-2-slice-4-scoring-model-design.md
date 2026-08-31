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

**In.** The 21 questions and their six buckets (22 until "On terms" was removed 2026-08-31); the bucket-average and overall-score arithmetic; the
90-day Advocacy gate; `clients.started_on`; the rewritten check-in screen; the board card's six
bars; new bands; the rebuilt score verifier.

**Not in, and each has a reason.**

- **The client x bucket matrix** (his third ask) is Slice 5. It reads bucket scores, which do not
  exist until this slice ships, and the sketch in the source doc is an image this design could not
  read.
- **The tenure and churn-reason report** (his fourth ask) is Slice 6. **The client names in his
  notes are illustrative, not real** — confirmed by the owner 2026-08-27 — so the cohorts and
  reasons he wrote are a sketch of the format he wants, not data to reconcile against the roster.
  Structurally the schema is nearly ready: `ended_on`, `end_reason_code` and `end_reason_note`
  already exist from Slice 2 step 1, and the missing piece is `started_on`, which this slice adds.
  So Slice 6 is unblocked by Slice 4 rather than blocked on anything else.

  Its one real dependency is that **the report can only show churn the tool has rows for.** Whether
  any client currently carries `cancelled` or `former` was not confirmed here — raw SQL against
  production is refused by the MCP safety classifier — but the roster was seeded entirely active,
  so the churn cohorts likely render empty until past clients are entered. That is a data-entry
  decision for the owner, not a design problem.
- **Reading each client's notes to explain why they churned** (his fifth ask) is not a build at all.
  No client notes live in this tool, and the parent spec's settled position is that there is no paid
  API, so AI help is a copy-paste bridge. §11 carries the answer he should be given.
- **Migrating the twelve existing check-ins.** See §3.4.

## 3. The scoring model

### 3.1 The six buckets and their 21 questions

*Amended 2026-08-31: 22 became 21 when "On terms" was removed. See the Finances entry below.*

*Amended 2026-08-31 (step 4): the count is unchanged at 21, but the ANSWER TYPES collapse to one.
Every question — all 21 — is a nullable smallint 1-5. What varies is only the control the check-in
screen draws over it. See §3.2.*

Wording is the boss's, lightly normalised to statements. Column names are fixed here because §5
turns them into a migration and §9 verifies them by name.

**Communication** — `comm_constructive`, `comm_timely`, `comm_consistent`
  Provides constructive feedback / timely feedback / consistent feedback.

**Growth** — `growth_goals_defined`, `growth_progress_trackable`, `growth_hitting_goals`
  Short and long term goals are clearly defined / we can track progress towards their goals / we are
  hitting their goals.

  **Whose goals: the CLIENT's.** Ruled by the owner 2026-08-27. The source doc reads "we are hitting
  our goals", which this spec first transcribed literally, and it is ambiguous — it could mean the
  agency's targets for the account. It does not. Growth measures whether the client's own short and
  long term goals are defined, trackable and being met. Every prompt in this bucket therefore says
  "their goals", and the implementation was already correct where this spec was not.

**Finances** — `fin_rack_rate`, `fin_pays_on_time`, `fin_rate_increased`

  Paying rack rate / pays on time / increased rate over the last 90 days.

  **AMENDED 2026-08-31: "On terms" is REMOVED, and the column is DROPPED.** Finances is a
  THREE-question bucket, and the model has 21 questions, not 22.

  The question was never defined. The source doc read "On they on terms (3-month commitment?)" —
  the boss's own question mark — and the 2026-08-27 ruling left the prompt as a bare "On terms."
  for the scorer to interpret. Scoring one client's undefined question against another's is not
  measurement, and after one real scoring round the owner ruled on 2026-08-31 to remove it rather
  than define it.

  **The consequences, which reach further than one prompt.** The overall is the mean of the
  non-Advocacy answers, so its divisor falls from eighteen to **seventeen**; `required` falls from
  22/18 to **21/17**; `fin_score` divides by three, not four; and §9.1's state space shrinks
  because Finances becomes a 6³ bucket rather than a 6⁴ one.

  **The column is dropped, not renamed**, on the owner's explicit instruction of 2026-08-31, given
  after being shown that it destroys the one real answer that existed — Babaloo's August 2026
  check-in, where `fin_on_terms` was 3. That check-in's Finances moves 3.25 → 3.33 and its overall
  3.56 → 3.59, and its band stays Watch. This is the one place the project departs from §5.4's
  rename-never-drop principle, and it does so by ruling, not by oversight.

  **AMENDED 2026-08-31 (step 4): all three are answered Yes / Unsure / No.** The owner ruled it
  after the first real scoring round, and his own data is the argument. Of the ten August 2026
  check-ins, SEVEN answered `fin_rack_rate` as 3. Nobody pays 60% of rack rate. That 3 was not a
  measurement, it was a refusal to commit to a question with only two honest answers — the same
  failure "On terms" was removed for, in a milder form.

  **No migration, and no score moves.** These three columns are already
  `smallint check between 1 and 5`. Yes writes 5, Unsure writes 3, No writes 1, and August's
  recorded values stay exactly as they are. A legacy 2 or 4 remains a valid, correctly scored answer
  that the new control simply cannot produce. This is the whole reason the model collapses to one
  answer type rather than growing a second one (§3.2).

**Relationship** — `rel_collaborative`, `rel_respectful`, `rel_fun`, `rel_multi_threaded`
  Collaborative / respectful / do they have fun / are we and they multi-threaded (are we working
  with their partners, are they working with ours).

**Delivery** — `del_on_time`, `del_quantity`, `del_client_likes`, `del_we_are_proud`
  Delivering on time / delivering a healthy quantity / the client likes our assets / we are proud of
  what we are delivering.

**Advocacy** — `adv_left_review`, `adv_case_study`, `adv_would_refer`, `adv_reference_check`
  Have they left a review / could we use them for a case study / would they refer us unprompted /
  could we send leads to them as a reference check.

  **AMENDED 2026-08-28: these four are YES/NO, not 1-5.** The owner ruled it, and the reason is that
  the questions are not opinions: "they have left a review" is a fact that either happened or did
  not, and a 3 out of 5 against it records nothing anyone can act on. They are stored as `boolean`
  rather than as a smallint constrained to two values, so the column states what it is and nobody can
  later write a 3 into it. §3.2 gives the bucket arithmetic that keeps the result on the same
  1.00-5.00 scale as the other five buckets.

  **AMENDED 2026-08-31 (step 4): they gain an UNSURE, and are therefore no longer booleans.** The
  owner asked for it after the first round, and the reason it is not a nicety: "would they refer us
  without being prompted?" is a claim about someone else's intent, and "I don't know" is a different
  claim from "no". Recording an unsure as a No understates the client. Recording it as unanswered
  makes the check-in permanently unsubmittable, because §3.3 counts a null as missing.

  So the column type changes from `boolean` to the same `smallint check between 1 and 5` every other
  answer uses, with Yes = 5, Unsure = 3, No = 1. **This is the one migration in step 4.** It is
  lossless: `true` becomes 5, `false` becomes 1, null stays null, and §3.2 proves the resulting
  bucket scores are identical to what `1 + yeses` produced — so not one Advocacy bar moves.

  The 2026-08-28 reasoning for `boolean` — "the column states what it is and nobody can later write
  a 3 into it" — is what this reverses, and it is worth being honest that it was a good argument
  that the Unsure requirement simply defeats. A 3 is now a meaningful answer.

Three plus three plus three plus four plus four plus four is **21**. *Corrected 2026-08-31 (step
4): this sentence still read "three plus three plus four plus four plus four plus four is 22" after
"On terms" was removed earlier the same day. The count in the section heading was updated and the
sentence that proves it was not.*

### 3.2 The arithmetic, and the property that makes it work

**AMENDED 2026-08-31 (step 4). Read this block first. The 2026-08-28 block below it is superseded
in one respect and stands in the other.**

**There is now ONE scoring formula and ONE answer type.** Every question, in every bucket, is a
nullable smallint 1-5. Every bucket score is the mean of its own questions. `yesNoScore` — the
`1 + the number of yeses` rule introduced 2026-08-28 — is deleted.

**This changes no number.** For a four-question bucket, mapping Yes to 5 and No to 1 and taking the
mean is arithmetically identical to `1 + yeses` at every one of its five reachable points:

| yeses | `1 + yeses` | mean of 5s and 1s |
|---|---|---|
| 0 | 1.00 | (1+1+1+1)/4 = 1.00 |
| 1 | 2.00 | (5+1+1+1)/4 = 2.00 |
| 2 | 3.00 | (5+5+1+1)/4 = 3.00 |
| 3 | 4.00 | (5+5+5+1)/4 = 4.00 |
| 4 | 5.00 | (5+5+5+5)/4 = 5.00 |

So the mean is not an approximation of the old rule, it is a generalisation of it — and it is the
generalisation that made Finances possible. `1 + yeses` only lands on 1.00-5.00 for a bucket of
exactly FOUR questions. Applied to three-question Finances it would have produced 1, 2, 3 and 4, and
Finances' bar could never have filled. The mean produces 1.00, 2.33, 3.67 and 5.00 — the full range,
for any bucket size.

**`Question.kind` stops meaning "how is this scored" and means only "what control is drawn".** A
`scale` question renders five numbered radios; a `choice` question renders three labelled ones that
write 5, 3 and 1. Nothing downstream of the answer knows the difference, which is the point.

**The latent defect this fixes, which would have bitten on the very next change.** Before this
amendment the overall's question list was built by filtering `kind === 'scale'` — so it excluded
Advocacy *because Advocacy was answered with booleans*, which is not the reason Advocacy is
excluded. Advocacy is excluded because the owner ruled it out of the headline number (below).
Changing Finances to a yes/no control would therefore have silently dropped Finances out of the
overall as well: divisor 17 to 14, every client's score moved, and nothing failing. The exclusion is
now an explicit named list of one bucket, and a test asserts the overall counts seventeen answers.

---

**AMENDED 2026-08-28. The paragraph below records the superseded rule; read this block first.**

The seventeen non-Advocacy questions are scored 1-5 and each bucket's score is the mean of its own
questions, unchanged. Advocacy is now different in two ways, both ruled by the owner 2026-08-28:

1. *(Point 1 superseded 2026-08-31 step 4: the questions are three-way and the bucket score is a
   mean. The numbers it produces are unchanged — see the table above.)*
   **Its four questions are yes/no**, and its bucket score is **`1 + the number of yeses`** — which
   lands on exactly 1.00, 2.00, 3.00, 4.00, 5.00 for zero through four yeses. That is deliberate:
   it puts Advocacy on the identical 1.00-5.00 scale as the other five, so the board's bar, the
   matrix's cell and the bands need no special case for it. A null in any of the four still yields a
   null bucket score, never a low one (§3.3).
2. **Advocacy is excluded from the overall score entirely.** The overall is ALWAYS the mean of the
   seventeen non-Advocacy answers, whether the gate is open or shut. The owner's reason: the matrix in
   Slice 5 compares clients side by side, and measuring one client on 22 questions and another on 18
   makes that comparison unfair — the more so because Advocacy is the hardest bucket to score well
   on. Every client's headline number is now on one basis.

**The consequence to carry everywhere: `required` and the overall's divisor have DECOUPLED.** They
were the same number until this ruling and are now two. `required` — how many answers a check-in
needs before it counts as complete, and what every count on screen reads against — is still 22 when
the gate is open and 18 when it is shut. The overall's divisor is 18, always. *(Corrected
2026-08-31: after "On terms" was removed these are 21 gate-open and 17 gate-shut, and the divisor is
17. The figures are left as written because the DECOUPLING is this paragraph's point, and it
survives every change to the counts.)* A gate-open check-in
therefore asks four questions that do not move the headline number, and that is intended: they feed
the Advocacy bucket, the board's sixth bar and the matrix's A column.

**The 90-day gate survives and still matters.** It no longer decides the overall's divisor; it
decides whether the four Advocacy questions are ASKED at all — which is the point, because "would
they refer us without being prompted?" is not a question anyone can answer about a three-week-old
client.

---

*Superseded 2026-08-28, retained because §10 and §11 argue against it:* Every question is scored 1-5.
A bucket's score is the mean of its own questions. A client's overall
score is the mean of **every question they were required to answer** — not the mean of the six
bucket scores. The owner ruled this 2026-08-27; §10 records what it costs.

The consequence worth stating plainly, because the whole design leans on it: **a bucket score and an
overall score are both on the same 1.00-5.00 scale as a single question**, and they stay there
whether the bucket holds three questions or four, and whether the client has five buckets or six.
The 90-day gate therefore needs no special-casing at comparison time. A 60-day client scored on five
buckets and a two-year client scored on six produce numbers that can sit in the same column of the
same table and mean the same thing. Under the old raw-total model — 25 points across five pillars —
adding a sixth would have moved the ceiling to 30 and silently rebased every threshold.

**Every question weighs the same; buckets therefore do not.** *Amended 2026-08-28: the fractions
below are restated over eighteen, not twenty-two, and Advocacy is out of this comparison entirely.*

*Further amended 2026-08-31: the arithmetic in this subsection is left AS WRITTEN, over eighteen.
It is an argument about how bucket size translates into weight, and it makes that argument with the
numbers that were true when it was made. Removing "On terms" takes the divisor to seventeen and
makes Finances a three-question bucket like Communication and Growth — which strengthens the
conclusion rather than changing it, since there are now three three-question buckets and two
four-question ones. Rewriting the worked figures would obscure that this was reasoned before the
change, not after it.*
A four-question bucket moves the overall score by a third more than a three-question bucket, because
it owns four eighteenths of it against three. Communication and Growth are consequently the two
quietest buckets that count, purely because they hold one question fewer.

**Advocacy weighs nothing at all against the overall**, by §3.2's amendment, and that is worth saying
plainly rather than leaving a reader to derive it: a client can answer all four Advocacy questions No
and their headline health number does not move. Advocacy shows up in its own bar and its own matrix
column, and nowhere else.

The alternative — averaging the bucket means, so each bucket owns an equal share — was the first
draft of this design and was overruled. *Amended 2026-08-28:* with Advocacy excluded the comparison
is now over five buckets and eighteen questions. A Communication answer is worth 1/15 of the score
under bucket-equal and 1/18 under question-equal, about 20% more influence; a Delivery answer is
1/20 against 1/18, about 10% less. The shape of the trade-off is unchanged; only the denominators
moved.

**The six bucket columns survive this decision unchanged.** They are what the matrix averages down
its columns and what the board draws as bars. *Amended 2026-08-28:* §5.3 stands as written for five
of them; `adv_score` changes shape because its inputs became booleans, but it still produces
numeric(3,2) on the 1.00-5.00 range, so nothing that CONSUMES a bucket score has to change. Only the
view's overall expression differs, which is why this choice binds late and costs one line to
reverse.

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

**AMENDED 2026-08-28: eighteen smallints and four booleans, not twenty-two smallints.**
**AMENDED 2026-08-31: SEVENTEEN smallints and four booleans — `fin_on_terms` is dropped.**
**AMENDED 2026-08-31 (step 4): TWENTY-ONE smallints and no booleans at all.** §3.2 collapsed the
model to one answer type, so `adv_left_review`, `adv_case_study`, `adv_would_refer` and
`adv_reference_check` change from `boolean` to `smallint check between 1 and 5`.

The seventeen non-Advocacy answers are each nullable `smallint check between 1 and 5`, matching the
existing pillar columns exactly. Nullable because a draft is a check-in with unanswered questions,
and the check constraint rather than an enum because that is how `status` and `end_reason_code` are
already stored on these tables.

The four Advocacy answers are each nullable `boolean` (§3.1). Null still means unanswered; `false`
means answered No, and the two must never be conflated — a false read as a null would make a
complete check-in look incomplete, and a null read as a false would invent an answer nobody gave.

*Superseded 2026-08-31 (step 4): the four Advocacy answers are nullable `smallint` like every other
answer, holding 5 (Yes), 3 (Unsure) or 1 (No). The conflation warning above survives the type change
unaltered, and is if anything sharper — null still means unanswered, 1 still means answered No, and
a 1 read as a null would still make a complete check-in look incomplete.*

**This amendment is only cheap while production is unmigrated.** These columns exist on staging
alone and hold no real answers, so today this is an edit to an unapplied migration. Once §5's
migration has run on production and one scoring round has happened, the same change becomes a data
migration on real answers.

**That warning came due.** Production is migrated and one real scoring round has happened, so step
4's boolean-to-smallint change IS a data migration on real answers — seven August check-ins with
Advocacy answered, four of them all-No. It is lossless (§3.1) and it is the only migration in step
4, but it is no longer an edit to an unapplied file.

### 5.3 The six bucket columns

Generated, stored, `numeric(3,2)` — three significant digits and two decimals holds 0.00 to 9.99, so
the 1.00-5.00 range fits with room to spare.

```sql
comm_score numeric(3,2) generated always as
  ((comm_constructive + comm_timely + comm_consistent)::numeric / 3) stored
```

and the same shape for the other four 1-5 buckets. The explicit `::numeric` cast is required:
without it Postgres does integer division on the smallints and 4 + 4 + 5 becomes 4 instead of 4.33.

**AMENDED 2026-08-31 (step 4): Advocacy no longer differs.** With its inputs on the same smallint
scale as every other answer, `adv_score` takes the identical shape as its five siblings:

```sql
adv_score numeric(3,2) generated always as
  ((adv_left_review + adv_case_study
      + adv_would_refer + adv_reference_check)::numeric / 4) stored
```

Null propagation is unchanged, and now arrives by the same mechanism as everywhere else — null
through `+` is null — rather than through a boolean-to-int cast. §3.2's table proves the values are
identical to what the superseded expression below produced. **All six bucket columns now have one
shape**, which is what lets §9.1's verifier drop its per-bucket dispatch.

*Superseded 2026-08-31 (step 4), retained because §3.2's proof of equivalence refers to it:*
**Advocacy differs, per §3.2's amendment.** Its four inputs are booleans, so its generated column
counts yeses and offsets by one:

```sql
adv_score numeric(3,2) generated always as
  ((1 + adv_left_review::int + adv_case_study::int
      + adv_would_refer::int + adv_reference_check::int)::numeric) stored
```

Null propagation still holds: `::int` on a null boolean is null, and null through `+` is null, so an
unanswered Advocacy question yields a null bucket score exactly as §3.3 requires. The result is
exactly 1.00 through 5.00, so this column is comparable with its five siblings with no rescaling.

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
  -- AMENDED 2026-08-28 (§3.2): the case expression is GONE. The overall is always the
  -- seventeen non-Advocacy answers (amended 2026-08-31), so one branch, not two.
  (ch.comm_constructive + ch.comm_timely + ... + ch.del_we_are_proud)::numeric / 17
    as overall_score
from public.checkins ch
join public.clients c on c.id = ch.client_id;
```

The sum is elided above for length; the migration writes all seventeen column names out in full.
`advocacy_applies` stays in the view even though the overall no longer consults it — the check-in
screen and the board both need to know whether the gate is open, and computing it once here keeps
the database's answer and the TypeScript gate's answer comparable (tests/gateParity.test.ts). The `::numeric` cast is required for the same reason as §5.3 — without it Postgres divides
smallint sums with integer division and every overall score truncates to a whole number.

Note that the overall reads the **answer** columns, not the six generated bucket columns. That falls
out of §3.2's ruling, and it has a useful side effect: the view does not depend on the generated
columns at all, so a future change to how a bucket is derived cannot silently move the headline
number.

Null propagation carries through the sum, so §3.3's rule holds for the overall score without a line
of code asserting it. Note what this now means: a gate-open check-in with all four Advocacy answers
blank still has an overall score, because Advocacy is not in the sum. It does not yet count as
COMPLETE — `required` is 22 for that client (§3.2) — but the number it shows is real.

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

**AMENDED 2026-08-31 (step 4): the period is chosen, not assumed.**

`Board.tsx` computed the period as `currentPeriod()` and offered no way to change it. The owner's
real workflow is that **August is scored during September** — a month has to close before it can be
judged — so the tool as built could only ever score a month that was not finished, and the previous
month became unreachable the moment the calendar turned.

The board owns one `period` in state, defaulting to `previousPeriod(currentPeriod())`, with previous
and next controls beside the month heading it already renders. The check-in screen inherits that
period and repeats the control in its own header, so the month being scored is visible at the moment
of scoring rather than remembered from two screens ago.

**One period, never two.** The board and the check-in screen must not show different months. A card
reading "Draft, 8 of 21" for one month while opening a check-in for another is the kind of quiet
mismatch that makes a person stop trusting the number.

**Forward is capped at the current month; backward is not capped.** You cannot score a month that
has not started. Going back needs no limit — the query simply returns nothing for a month before the
client existed.

**The gate is already correct under backdating**, for free: `advocacyGate(startedOn, period)` takes
the period, so scoring August during September correctly shuts Advocacy for a client whose 90th day
fell in September. Nothing in §4 changes.

**The default follows the owner's ruling of 2026-08-31, taken against a recommendation.** The
alternative offered was "the most recent unsubmitted month", which needs no clicking in either
direction; he chose the simpler and more predictable rule. The cost he accepted: once August is
submitted, working on September takes one click forward, every time. It is also the better default
for the board, which under `currentPeriod()` showed nothing but em dashes for the first three weeks
of every month.

**The scale legend already says what it should, and is in the wrong place.** §7's one-legend ruling
produced `1 — strongly disagree / 5 — strongly agree`, which is exactly the anchoring the owner
asked for on 2026-08-31 — he asked for it because he had not seen it. It renders once, above the
first bucket, and scrolls out of view long before question fourteen. **The fix is placement, not
copy:** the legend becomes sticky within the scrolling region. This is not a new decision, it is
§10's decision 3 failing in practice for a reason that decision did not anticipate.

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

Extended naively to 21 questions that is 6^21 states and the check is dead. It survives because
**each bucket's generated expression references only its own questions**, so the space decomposes
per bucket: 6^3 = 216 states for each of the two three-question buckets, and 6^4 = 1,296 for each of
the four-question buckets. **Amended 2026-08-31:** with Finances down to three questions and
Advocacy on booleans, it is 3 x 6^3 + 2 x 6^4 + 3^4 = 648 + 2,592 + 81 = **3,321 states,
and still exhaustive** — every reachable input to every deployed bucket expression.

**Amended 2026-08-31 (step 4):** with every question a smallint 1-5, the verifier loses its
per-bucket dispatch and enumerates six values for every question uniformly:
3 x 6^3 + 3 x 6^4 = 648 + 3,888 = **4,536 states**.

That total goes UP, and deliberately. The obvious alternative is to enumerate only the values the
new controls can write — null, 5, 3 and 1 — giving 4^3 and 4^4 and a smaller sweep. That would be a
verifier that checks the UI's habits rather than the database's contract. The columns accept any
smallint 1 to 5, and **August 2026's Finance answers contain 2s and 4s that no current control can
produce**. A restricted sweep would stop verifying values that are actually in the table. The sweep
enumerates what the column can hold, not what the screen can write.

This property is the reason §5.4's shape was chosen over a normalised answers table or a `jsonb`
column. Neither has a per-bucket expression in the catalogue to read and evaluate, so both would
have replaced an exhaustive proof with a sample.

### 9.2 The view is verified separately

*Amended 2026-08-28 for §3.2's ruling, and 2026-08-31 for the removal of "On terms".*
`overall_score` sums seventeen nullable answers in a single
branch, so it cannot be enumerated exhaustively and is not pinned that way. Instead: for each of the
seventeen answers, assert that nulling that one answer nulls the overall — seventeen cases, complete
coverage of the null behaviour that matters. Then assert the property the amendment introduced:
**nulling any of the four Advocacy answers must NOT null the overall**, in either gate state — four
more cases, and they are the ones that would catch a silent reversion to the old 22-divisor. Add
arithmetic spot checks on known vectors, including the all-3s case (overall exactly 3.00 regardless
of gate state or Advocacy) and a vector where the two readings of §3.2 disagree, so a reversion to
bucket-averaging fails loudly rather than drifting.

The exhaustive bucket sweep in §9.1 shrinks too, and gets cheaper: Advocacy's four booleans have
three states each (null, true, false) rather than six, so its arm is 3^4 = 81 rather than 6^4 = 1296.
The total falls from 5,616 to 4,401 (2026-08-28), and to **3,321** (2026-08-31, "On terms"
removed). *Amended 2026-08-31 (step 4): and rises to **4,536**, which is the right direction — §9.1
says why.*

The gate predicate is checked at its boundaries: 89, 90 and 91 days, and a null `started_on`.

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
2. **Every question weighs the same** (§3.2), ruled by the owner 2026-08-27 as the provisional
   answer — "for now" — while his boss has not been asked. The consequence he accepted is that
   Communication and Growth are structurally quieter than the other four buckets purely because they
   hold three questions instead of four. If the boss turns out to mean the buckets should be equal,
   the fix is one expression in the view and one function in `score.ts`; no migration, no data
   change, because the bucket columns exist either way. **Cheap to reverse — do not let anyone
   rebuild the schema over it.**
3. **One agreement legend instead of 66 written anchors** (§7). Costs calibration: written anchors
   are what stop two scorers meaning different things by "4", and this model has more scorers coming.
   Revisit if two people scoring the same client diverge.
4. **The old columns are renamed rather than dropped** (§5.4). Costs a wider table forever. Dropping
   them destroys the only record of the first twelve check-ins.
5. **Questions live in code, not a table**, consistent with the ruling that deferred
   `pillar_definitions`. Costs a migration per question change — and unlike the five pillars, which
   changed zero times in a year, this list is three days old. If it moves twice more, revisit.
6. **One answer type and one scoring formula** (§3.2), ruled 2026-08-31. Costs the ability to let a
   column state its own domain: a `boolean` could not hold a 3, whereas a smallint holds anything
   1-5 and only a check constraint and the UI stop it. Bought: the Unsure the owner asked for, a
   Finances bucket that can reach 5.00 on three questions, one code path instead of two, and the
   removal of a defect that derived the overall's divisor from how questions were rendered.
   Reversing it is a data migration now, not a code change.
7. **Yes = 5, Unsure = 3, No = 1** (§3.1, §3.2). This mapping is what makes the collapse lossless
   and the existing numbers stable. Cost if wrong: an Unsure sits at the exact centre of the range
   and is therefore never neutral in effect — it pulls a strong client down and a weak client up.
   The alternative considered was dropping Unsure from its bucket's divisor, which makes "I don't
   know" free and lets a scorer dodge every hard question without penalty. Revisit after one round
   in which Unsure is actually used.
8. **The board defaults to the previous month** (§7), ruled by the owner 2026-08-31 against a
   recommendation of "most recent unsubmitted". Cheap to change — one expression in `Board.tsx` —
   and worth revisiting after a month of clicking forward.

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
3. **RESOLVED 2026-08-27: no backfill.** The owner ruled that the tenure logic applies to current
   and future clients only; historical clients are not being entered. Slice 6 stays a read-only
   report and never becomes a data-entry project.

   **What that costs, and it is visible to the person who asked for the feature:** the 0-3 / 3-6 /
   6+ grouping of *active* clients works from day one, but the churn reasons — the part the boss's
   sketch is mostly about — stay empty until a client actually churns and someone records why
   through the clients admin screen. The report will look half-finished for a while, and that is the
   decision working as intended rather than a defect. Worth saying to him in advance.
4. **The seven end-reason codes may not cover the real vocabulary.** `price`, `scope_fit`,
   `in_housed`, `went_quiet`, `project_completed`, `agency_initiated`, `other` — the boss's sketch
   reaches for "lack of funding" and "unclear expectations", and only the second maps cleanly
   (`scope_fit`). His examples were illustrative, so this is a prompt to check the list against real
   churns rather than a confirmed gap. Adding a code is a one-line constraint change.
5. **`Test Client` (production id 2)** is still `active` and will render a twelfth card with six
   empty bars. Offered to the owner three times, still unanswered.
6. **Whether an Unsure needs to stay distinguishable downstream.** A 3 written by a three-way
   control and a 3 written by a five-point scale are indistinguishable in the column, by design.
   Nothing today needs to tell them apart. If a future screen wants to show "three questions unsure"
   as something other than "three questions middling", that distinction does not exist in the data
   and recovering it is a migration. Flagged now because it is cheap to notice and expensive to
   retrofit.

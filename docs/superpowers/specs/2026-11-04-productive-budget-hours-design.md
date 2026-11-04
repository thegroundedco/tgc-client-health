# Productive budget hours in Finances

In the first week of each month the owner reviews the previous month for every client. For clients on a
**fixed monthly hours budget**, part of that review today means opening Productive to compare the hours the
client was allotted with the hours the team actually worked. This brings those numbers into the check-in,
flags anyone outside ±6 hours, and counts it in the score.

Agreed with the owner, 2026-11-04. Anything marked **(Claude's call)** was not discussed and is open to
change.

## Why, and what counts

- **Fixed monthly budgets are what matter.** A client gets a set number of hours each calendar month.
  Landing within ±6 hours of it is healthy. Outside that range is a concern either way, and **going over is
  more concerning than coming in under**.
- **Open-hour budgets are out of scope.** They are project work with no allotted hours, where the aim is to
  finish as lean as possible to protect margin. They are not a cap to hit, so they are never scored here.

**Goals:** show budgeted vs worked hours per client for the month; flag anyone outside ±6; fill a new
Finances answer from it, the same way the revenue-based answers are filled.

**Non-goals:** margin or profitability on open-hour work; time-entry breakdowns by person or task; writing
anything back to Productive; scoring Scale-style project budgets.

**Anti-goals (failures even if it "works"):**
- The Productive API token reaching the browser or the repo. **The repo is public.**
- The tool guessing a score in a situation the owner said to leave to him (§4).
- The check-in screen and the AI routine giving different answers for the same month.

## 1. What Productive holds (checked 2026-11-04, read-only)

Productive's API calls these "deals" (`GET /api/v2/deals`, `filter[type]=2` = budgets). Each fixed monthly
budget is **one deal per client project per calendar month**. Its attributes include:

- `date` and `end_date`: the month, e.g. `2026-10-01` → `2026-10-31`
- `budgeted_time`: the allotted time, **in minutes** (1800 = 30h)
- `worked_time`: time logged against the budget, in minutes
- `closed_at`: set once the month has been closed

The project is available through `include=project`. Open-hour budgets have `budgeted_time = null` and are
sometimes open-ended (`end_date = null`).

October 2026, as an example. Times are in hours; the score is the rule in §3:

| Project | Budgeted | Worked | Difference | Score |
|---|---|---|---|---|
| Babaloo \| TGC | 30 | 35.5 | +5.5 | 5 |
| Sno-Go | 25 | 42.8 | +17.8 | 1 |
| Colorfil | 5 | 11.3 | +6.3 | 2 |
| Remi | 25 | 12.0 | −13.0 | 1 |
| York | 30 | 18.0 | −12.0 | 1 |
| C.R. Plastic | 60 | 0 | −60 | 1 |
| Gait Happens (two budgets) | 30 + 30 | 4.1 + 0 | n/a | blank (§4) |
| Steep (starts Oct 13) | 25 | 7.0 | −18 | blank (§4) |
| Gibs Grooming | none | 0 | n/a | n/a (§4) |

## 2. Naming

- **The bucket label changes from "Finances" to "Finances and Hours"** (owner). The initial `F`, the key
  `finances` and the `fin_` column prefix stay the same.
- **New question:** prompt `Hours within budget.`, key and column `fin_hours_in_budget` (Claude's call on
  the wording and the key).

## 3. The scoring rule (owner)

`diff = worked − budgeted`, in hours. "Under" means `diff < 0`.

| Difference | Score |
|---|---|
| within 6 either way (`|diff| ≤ 6`) | **5** |
| 6–8 under | **3** |
| 8–10 under, or 6–8 over | **2** |
| more than 10 under, or more than 8 over | **1** |

The rule never gives a 4, and the 2 is a value no other Finances question uses. Over is penalised harder
than under, as the owner intended.

**Edges (Claude's call):** each band includes its upper limit. So exactly 6 off scores 5, exactly 8 under
scores 3, exactly 10 under scores 2, and exactly 8 over scores 2. Work in minutes so the edges are exact.

**Options shown on the question (Claude's call):** 5 `Within 6h`, 3 `6–8h under`,
2 `8–10h under or 6–8h over`, 1 `Over 10h under or 8h over`. A person can pick any of the four.

**Reason shown with the answer** (same pattern as the revenue answers), e.g.
`From Productive: 42.8h worked vs 25h budgeted (+17.8h).`

## 4. Cases the tool does not score (owner)

| Case | Shown | Score |
|---|---|---|
| **More than one** fixed monthly budget for the client in the month (e.g. Gait Happens retainer + website migration) | One line per budget | Left blank, with the note `2 monthly budgets – tidy up in Productive` |
| **First part-month**: a budget whose `date` is after the 1st (e.g. Steep, Oct 13) | Its hours | Left blank, with a note that it's a first part-month |
| **No fixed monthly budget** (only open-hour budgets, or none) | `No fixed monthly budget` | **Not applicable** (see below) |
| **Capped budget with no end date** (e.g. Triquetra "Solborne Launch", 30h) | Ignored, since it isn't monthly (Claude's call) | — |

**What counts as a fixed monthly budget (Claude's call):** `budgeted_time` is set, **and** `date` and
`end_date` fall in the same calendar month. That excludes open-hour budgets (no hours), open-ended capped
budgets (no end date), and any multi-month capped budget. Checked against every budget from September to
November 2026, it picks out exactly the monthly ones.

**Not applicable vs. left blank (owner, 2026-11-04):**
- **Not applicable.** The question is hidden and does not count. The Finances and Hours score averages the
  other three answers, the overall score leaves it out, and the check-in can be complete without it. This
  applies to clients with **no fixed monthly budget** for the month, clients **not linked to Productive**
  (§5), and **every month before October 2026** (§7).
- **Left blank.** The question applies, the owner picks the score, and the check-in isn't complete until
  he does. This applies to **two or more budgets**, a **first part-month**, and **Productive being
  unreachable**. (In the last case the fetch has failed, so the tool can't tell whether a budget exists.
  The question shows with a note so the person can answer or retry.)
- Whether the question applies is decided by the saved hours rows, not by the browser, so the screen, the
  scoring and the AI routine all agree. How applicability is stored or derived, so that `fin_score`,
  `checkin_scores` and the TypeScript mirror (`scoreV2`, `scoreMath`, `scripts/score-parity.mjs`) all use
  divisors of 3 or 4 (17 or 18 overall), is left to the builder. The parity script must cover both cases.

The part-month test is "starts after the 1st" (Claude's call). A client whose first budget starts on the
1st has a full month and is scored normally.

## 5. Matching Productive to clients (Claude's call)

Productive projects don't map one-to-one to clients: Babaloo's project is "Babaloo | TGC", and Gait Happens
has two projects. **Each client gets a setting in Clients admin listing its Productive project IDs (zero or
more).** The tool only looks at budgets on linked projects. A client with no linked projects shows
`Not linked to Productive`, and the question is not applicable for them (§4).

Budgets are matched on `date` to the check-in month. A budget belongs to month M when its `date` falls
inside M.

## 6. Where the data lives and how it moves (Claude's call)

- **The token stays on the server.** A Supabase edge function holds the Productive token, org ID and base
  URL as function secrets. It only reads from Productive (GET requests to the deals endpoint). The token
  never reaches the client bundle, the repo, or chat. The owner sets the secrets in the Supabase dashboard,
  as he did for the AI routine.
- **The hours are saved in the database** in a new table, one row per (client, month, Productive budget):
  budget id, project id, name, date, end_date, budgeted minutes, worked minutes, and when it was fetched.
  This is needed because the AI routine (§7) reads the database through its Supabase connector, and it
  **cannot** call Productive or the edge function: the cloud environment blocks requests to `*.supabase.co`.
- **When the edge function runs:**
  1. When a check-in opens for a month, the screen calls it for that client and month, then reads the
     table. This also works for past months, because Productive keeps history.
  2. On a schedule that runs **before** the AI routine (the routine's cron is `0 14 1 * 1`), for all linked
     clients, for the previous month. The builder chooses how (for example pg_cron + pg_net). The routine
     must find fresh rows.
- **Who can see it:** the same people who can see the revenue-based Finances answers (the `view_revenue`
  capability). Table reads are RLS-gated at the read, following `useFinanceSuggestion`'s pattern. The edge
  function checks the caller's capability before fetching.
- If Productive is down, or the function fails, the question is simply left unfilled for the person to
  answer. It is never guessed.

## 7. Behaviour on the check-in and in the AI routine

- **The check-in** fills `fin_hours_in_budget` exactly like `financeFromRevenue` fills the revenue answers:
  once per visit, only when it is blank in both the database and the form, never overwriting a saved
  answer, editable, with its reason shown. The hours lines (budgeted / worked / difference per budget) sit in
  the Finances and Hours section beside the question. A line outside ±6 is flagged visibly, **and not by
  colour alone** (one of the owners is colourblind).
- **The AI routine** fills the new question with the same rule from the same table, so the two never
  disagree. Add `fin_hours_in_budget` to the finance keys in `src/checkin/aiSuggestion.ts` that the AI
  doesn't judge, and update the routine prompt (stored on routine `trig_01BA2jJY2nCCd1MozSm17pS3` and in
  the local `routine-prompt-v2.md`). For §4 cases, it follows the same "leave blank" rule.
- **Pure rule in its own module** (like `financeFromRevenue.ts`): budgets for a month in, answer + reason +
  per-budget lines out, or "no answer" with the reason why. Both the screen and the documented routine
  behaviour follow it.

**Months that haven't ended, and the start month (Claude's call):**
- **Current month:** the screen shows the running hours but does not fill the answer until the month's
  last day has passed. Otherwise every client would be "far under" mid-month. When the AI routine runs on a
  Monday for an unfinished month, it writes 3 with the note `hours pending – month not finished`, the same
  way it handles missing revenue. A later run, or opening the check-in after month end, replaces it. Whether
  Productive has closed the month (`closed_at`) is ignored: the review happens in the first week, often
  before closing, and the edge function refetches on every open.
- **Start month:** the hours question applies from **October 2026** onward. That's the month the owner is
  reviewing now, and October's scores were cleared on 2026-11-03 for a re-run. Earlier months are never
  filled, so their scores stay the same.
- **Updating the live routine** (the prompt on the trigger, and the local copy at
  `../tgc-client-health-ai-runs/.superpowers/sdd/2026-10-30-ai-suggestion-runs/routine-prompt-v2.md`) is a
  step in the build. It changes an external system, so it needs the owner's OK at that step. It ships
  together with the screen change.

## 8. Score and schema

- New nullable `smallint` column `fin_hours_in_budget` on `public.checkins`, constrained to 1, 2, 3 or 5.
- The Finances bucket score (`fin_score`, a generated column, and the scoring view) includes the new
  answer when it applies and leaves it out when it doesn't (§4). Months before October 2026 are not
  applicable, so their scores are unchanged. A test must show that.
- Migrations follow the repo's definer-function and grant rules, and `scripts/verify-privileges.sql` gets
  the new table and function.

## 9. Left to the builder

- The table and function names, the edge function's request shape, and caching (for example, skip
  refetching a month that was closed in Productive and fetched after it closed).
- How the hours lines are laid out inside the Finances and Hours section, within the existing look. The
  owner will check positioning by eye.
- How pagination and rate limits on the Productive API are handled.
- Seeding the client ↔ project links for the current clients. Propose them from the project names and have
  the owner confirm. **Client names in this repo are real** and must not be invented or used as fake data.

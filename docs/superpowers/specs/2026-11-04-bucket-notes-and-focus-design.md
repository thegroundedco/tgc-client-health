# Per-bucket notes and a monthly focus

Source: the "Client Health" call with Kurt and Nick, 2026-11-04 (Fathom 889601924). The owner asked to skip the
questions and build. Everything not quoted from the call is **(Claude's call)**.

## Why

The scores are not useful until they say what to do next month.

- Nick: "it's not valuable until it's giving us actionable steps for the next month" (21:00).
- Nick: "I'm not sure it's going to help us change anything unless we've clearly decided and documented what the
  focus should be" (44:47).
- Kurt (31:17): rather than one long note about every score, have "a little box to the right of communication that
  has the notes specifically for why it scored communication that way … that's where you put the action items". He
  doesn't want to read the whole excerpt when he already knows communication is the problem.
- The meeting flow (29:16): confirm the Healthy clients quickly, and dig into Watch and At-risk clients to decide
  the account-management move.

**Goals**
1. Each bucket on the check-in gets its own **Why this score** and **Action items**, beside its questions.
2. Each client-month gets a **This month's focus**: the one or two things we'll work on.
3. The AI routine suggests all of these, and a person edits them, the same way it suggests the scores.
4. The focus is visible on the board, so the meeting can see it without opening the check-in.

**Non-goals:** month-over-month arrows (item 3 from the call); retainer/project revenue (item 4); new data sources;
win/loss signal analysis. These are separate pieces of work.

**Anti-goals**
- Notes that block submitting a check-in. They're optional and never count in a score.
- Losing the general notes box. It stays as is, for anything that isn't about one bucket.
- A layout that squeezes the questions unreadably on a laptop or phone.

## 1. Data (Claude's call)

- `checkins.bucket_notes jsonb not null default '{}'`.
  - Shape: `{ "<bucket>": { "why"?: string, "actions"?: string } }`. Keys are only the six bucket names
    (`communication`, `growth`, `finances`, `relationship`, `delivery`, `advocacy`).
  - Each string is non-empty, at most 2000 characters, and trimmed by the app. A bucket with neither field is
    absent.
  - Enforced by a CHECK that calls an immutable validation function in `private`, following the definer and
    search_path rules.
- `checkins.focus text`, null, or non-empty and at most 1000 characters.
- Both columns live on the `checkins` row, so the existing checkins RLS policies and grants already cover them. No
  new policy is needed. `verify-privileges` must still pass.
- `checkins.ai_suggestion` (written only by the routine) may now carry `bucket_notes` and `focus` alongside
  `answers` and `notes`. Older suggestions without them still parse.

## 2. Check-in screen (Claude's call on layout and copy)

**Focus box**
- At the top of the check-in, above the first bucket: a box headed `This month's focus`.
- One textarea, hinted `The one or two things we'll work on with this client this month.`
- Beneath it, when last month had a focus: `Last month: <text>`, so the meeting can ask whether it happened.

**Bucket notes**
- Each bucket section becomes two columns on wide screens: the questions on the left at about 62%, and a notes
  panel on the right.
- On narrow screens the panel stacks under the questions.
- Use CSS grid or flex with percentages or `fr`, never fixed pixel positions.
- The notes panel has two labelled textareas, `Why this score` and `Action items`.
- When last month had action items for that bucket, show them faintly under the box as `Last month's actions:
  <text>`.
- A shut Advocacy bucket (gate closed) shows no notes panel.

**Behaviour**
- Notes and focus are part of the same draft, save, local-draft cache and "unsaved changes" logic as the answers
  and the general notes.
- Saving writes them in the same upsert. They never affect completeness, the counts or any score.
- A read-only viewer sees the text and cannot edit it.

**Accepting and reverting the AI's suggestion**
- Confirm: unchanged. It still only clears `suggested_at`.
- Revert to the AI's suggestion: brings back the AI's `bucket_notes` and `focus` as well as its answers and notes.
  If the suggestion has none (an older one), revert leaves the person's bucket notes and focus as they are.

## 3. Board (Claude's call)

- A client card whose check-in has a focus shows it under the band, as `Focus: <text>`, clamped to two lines.
- This is the first thing to read in the meeting for Watch and At-risk clients.
- Cards with no focus are unchanged.

## 4. AI routine (Claude's call; paste-ready text, like the hours paragraph)

Add a section to the routine prompt (`routine-prompt-v2.md` and the live routine `trig_01BA2jJY2nCCd1MozSm17pS3`).
For every client it scores, the routine writes:

- **bucket_notes:** for each bucket it scored, `why` (1–3 sentences naming the dated evidence) and `actions` (1–3
  short, concrete next steps for the account manager this month).
  - Leave out actions for a bucket that scored 5 on every question, unless there's a clear opportunity.
  - Never invent evidence. If there is no evidence, `why` says so.
- **focus:** when the suggested overall is below 3.6 (Watch or At-risk), the one or two most important actions this
  month, in one or two sentences. Otherwise it's left null.
- Both go into the row, for rows it may overwrite, and into `ai_suggestion`, for every row it scores, under the
  same overwrite rules as the answers.

The text lives at `docs/superpowers/plans/2026-11-04-bucket-notes-routine-paragraph.md`. Applying it to the live
routine is a separate owner-approved step.

## 5. Rollout

Local `main` also carries the unpushed Productive-hours work, and `.github/workflows/deploy.yml` deploys on any push to `main`, so one push ships both features. The order is therefore fixed, and every step is an [OWNER] step:
1. Both migrations, `20261104120000_productive_hours` and `20261104150000_bucket_notes_and_focus`, must be on production before the push to `main`. (The schedule migration `20261104130000` goes with the hours one.)
2. Then run the read-only checks. `verify-privileges` writes test data and must not be pointed at production unless the owner says so.
3. Then push, and confirm the live bundle hash changed.
4. Then paste the routine text, applying the hours paragraph first and then the notes paragraph.

If the push goes first, the board breaks, because `CHECKIN_COLUMNS` selects `focus`, and every Save fails, because the upsert sends `bucket_notes` and `focus`; PostgREST answers 400 for a missing column.

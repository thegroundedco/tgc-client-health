# Bucket Notes and Focus Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give every check-in bucket its own "Why this score" and "Action items", and every client-month a "This month's focus". The AI suggests them, people edit them, and the board shows the focus.

**Architecture:**
- **Data:** two new columns on `public.checkins`. `bucket_notes` is jsonb, validated by a CHECK through an immutable private function. `focus` is text.
- **App:** both columns ride the existing draft, save, cache and revert paths beside `notes`.
- **Screen:** a `BucketNotes` panel inside each bucket section, a `FocusBox` at the top of the check-in, and a focus line on the board card.
- **Routine:** the AI routine gets a paste-ready paragraph.

**Tech Stack:** React 19 + TypeScript 6 + Vite 8, Vitest 4 (jsdom), Supabase Postgres + RLS.

**Spec:** `docs/superpowers/specs/2026-11-04-bucket-notes-and-focus-design.md`

## Global Constraints

- **Workspace:** a worktree at `../tgc-client-health-bucket-notes` on branch `bucket-notes`, created from local `main` at e0a28bd or later.
  - Run `git branch --show-current` before every commit.
  - Stage explicit paths. Never use `git commit -a`.
- **Copy, exactly:**
  - `This month's focus`
  - hint `The one or two things we'll work on with this client this month.`
  - `Last month: ` + text
  - `Why this score`
  - `Action items`
  - `Last month's actions: ` + text
  - board `Focus: ` + text
- **Data limits:**
  - `bucket_notes` keys ⊂ {communication, growth, finances, relationship, delivery, advocacy}.
  - Each value is an object with only `why` and/or `actions`.
  - Each value is a non-empty string, at most 2000 characters.
  - An empty object for a bucket is not allowed (omit the key instead).
  - `focus` is null, or 1–1000 characters.
- **The app trims text.** It stores an empty string as absent: the key is removed, or the focus is null.
- **Notes never count.** They never affect completeness, counts or any score.
- **Layout:** grid or flex with `fr` or percentages. No fixed pixel positions. Questions about 62%, notes about 38%. Stacks under 720px.
- **Test data:** no real client names in fixtures. Use `Acme` or `Client A`.
- **Definer functions:** `private` schema, `set search_path = ''`, execute revoked from `public, anon, authenticated`.
- **Migration names:** every name ≤ 63 characters. `tests/identifierLength.test.ts` enforces it.
- **Checks before each commit:** `npm test`, `npm run lint` and `npm run build`. Once before the final review, also the CI-style run: Node 26, `NODE_OPTIONS=--no-experimental-webstorage`, `.env.local` moved aside, `--exclude '**/rls.test.ts'`.
- **No database or network calls** inside tasks. The migration is applied later, with the owner's approval.

## Review Focus

1. **A draft restored from localStorage that predates bucket notes** (cache `v4`) loads with empty notes. It doesn't crash or drop the answers. Owned by Task 2.
2. **An AI suggestion without `bucket_notes` or `focus`** (every existing one). Revert leaves the person's notes and focus alone. Owned by Task 2.
3. **Whitespace-only text** is saved as absent, not as `"  "`. Otherwise the DB CHECK rejects the save. Owned by Task 2.
4. **Typing in a notes box marks the check-in unsaved, and saving clears that.** Notes alone with no answers is a "draft", not "Not started". Owned by Task 2 and Task 3.
5. **A shut Advocacy bucket** draws no notes panel. Stored advocacy notes stay on save. Owned by Task 3.

---

### Task 1: Schema

**Files:**
- Create: `supabase/migrations/20261104150000_bucket_notes_and_focus.sql`
- Modify: `src/types/database.ts` (hand edit: checkins Row, Insert and Update gain `bucket_notes: Json` and `focus: string | null`)
- Test: `tests/bucketNotesMigration.test.ts`

**Interfaces:**
- Produces:
  - `private.valid_bucket_notes(p jsonb) returns boolean`: immutable, definer, true iff `p` meets the Data limits.
  - `checkins.bucket_notes jsonb not null default '{}'::jsonb`, with `constraint checkins_bucket_notes_valid check (private.valid_bucket_notes(bucket_notes))`.
  - `checkins.focus text`, with `constraint checkins_focus_length check (focus is null or char_length(focus) between 1 and 1000)`.

- [ ] **Step 1:** Write source tests that strip comments and slice to one statement each. They must cover:
  - both columns, with their exact types and default;
  - both constraint names;
  - that the function is definer, in `private`, with an empty search_path and execute revoked;
  - that the function body names all six bucket keys and only `why` and `actions`, and the limits 2000 and 1000.
- [ ] **Step 2:** Run `npx vitest run tests/bucketNotesMigration.test.ts` and confirm it FAILS.
- [ ] **Step 3:** Write the migration. Header comment: spec path, why jsonb on the row (it inherits checkins RLS, and one upsert saves everything), and that no new grant or policy is needed. Edit `database.ts`.
- [ ] **Step 4:** Confirm it passes. Mutate the 2000 limit, one bucket key and `security definer`, confirming a test goes red each time. Run `npm test && npm run lint && npm run build`.
- [ ] **Step 5:** Commit: `feat(db): per-bucket notes and a monthly focus on each check-in`.

### Task 2: Model: draft, save, cache, revert

**Files:**
- Create: `src/checkin/bucketNotes.ts`
- Modify:
  - `src/checkin/draftCache.ts`
  - `src/checkin/useCheckin.ts`
  - `src/checkin/aiSuggestion.ts`
  - `src/checkin/useRevertSuggestion.ts`
  - `src/board/cardSummary.ts` (CHECKIN_COLUMNS gains `focus`, and `cardFooter` treats notes or focus alone as content only if the existing footer logic counts the general notes; keep parity with `notes`)
- Test: `src/checkin/bucketNotes.test.ts`, `src/checkin/draftCache.test.ts`, `src/checkin/useCheckin.dom.test.ts`, `src/checkin/aiSuggestion.test.ts`, `src/checkin/useRevertSuggestion.dom.test.ts`

**Interfaces:**
- Produces, in `bucketNotes.ts`:
```ts
export type BucketNote = { why?: string; actions?: string }
export type BucketNotes = Partial<Record<Bucket, BucketNote>>
export function cleanBucketNotes(raw: unknown): BucketNotes   // tolerant parse of DB/cache/AI json; drops unknown keys, non-strings, empties; trims
export function bucketNotesForSave(notes: BucketNotes): BucketNotes  // trimmed, empties removed — what the upsert sends
export function setBucketNote(notes: BucketNotes, bucket: Bucket, field: 'why' | 'actions', text: string): BucketNotes
```
- `Draft` becomes `{ answers, notes, bucketNotes: BucketNotes, focus: string }`.
  - Bump `DRAFT_VERSION` to `v5`.
  - `readDraft` still reads a `v4` entry, giving empty `bucketNotes` and `focus`.
  - `draftsDiffer` and `isDraftEmpty` include both fields.
- `useCheckin`:
  - selects `bucket_notes` and `focus`;
  - `draftFromRow` fills them;
  - new `setBucketNote(bucket, field, text)` and `setFocus(text)`;
  - the upsert sends `bucket_notes: bucketNotesForSave(...)` and `focus: focus.trim() || null`;
  - exposes `lastMonthBucketNotes: BucketNotes` and `lastMonthFocus: string | null`.
- `AiSuggestion` gains optional `bucket_notes?: BucketNotes` and `focus?: string | null`. They're parsed with `cleanBucketNotes`, and a suggestion without them is still valid.
- Revert writes `bucket_notes` and `focus` from the AI only when the suggestion carries them. Otherwise it leaves them untouched.

- [ ] **Step 1:** Write the tests:
  - `cleanBucketNotes`: drops an unknown bucket, a non-string, a whitespace-only value and an empty object; trims.
  - Reading a `v4` draft gives empty notes and keeps its answers (Review Focus 1).
  - Typing whitespace-only notes saves nothing for that bucket, and focus `'  '` saves null (Review Focus 3).
  - `setBucketNote` marks the check-in unsaved, and saving clears it (Review Focus 4).
  - The upsert payload contains `bucket_notes` and `focus`.
  - `parseAiSuggestion` of a suggestion without notes is non-null with `bucket_notes` undefined.
  - Revert with an AI suggestion that has no notes leaves the person's `bucket_notes` and `focus` unchanged in the update payload (Review Focus 2). Revert with notes writes them.
- [ ] **Step 2:** Run `npx vitest run src/checkin src/board` and confirm the new tests FAIL.
- [ ] **Step 3:** Implement the interfaces above.
- [ ] **Step 4:** Confirm they pass. Mutate the v4 fallback, the trim in `bucketNotesForSave` and the "only when carried" revert guard, confirming a test goes red each time. Run `npm test && npm run lint && npm run build`.
- [ ] **Step 5:** Commit: `feat(checkin): bucket notes and focus ride the draft, save and revert`.

### Task 3: Screen: notes panels, focus box, board line

**Files:**
- Create: `src/checkin/BucketNotesPanel.tsx`, `src/checkin/BucketNotesPanel.module.css`, `src/checkin/FocusBox.tsx`, `src/checkin/FocusBox.module.css`
- Modify: `src/checkin/CheckIn.tsx` and `CheckIn.module.css` (bucket section grid), `src/board/ClientCard.tsx`
- Test: `src/checkin/BucketNotesPanel.dom.test.tsx`, `src/checkin/FocusBox.dom.test.tsx`, `src/checkin/CheckIn.dom.test.tsx`, `src/board/ClientCard.dom.test.tsx`

**Interfaces:**
- Consumes: Task 2's `draft.bucketNotes`, `draft.focus`, `setBucketNote`, `setFocus`, `lastMonthBucketNotes` and `lastMonthFocus`.
- `<BucketNotesPanel bucket note lastActions disabled onChange(field, text) />`
  - Two labelled textareas, with the labels linked to them (`<label htmlFor>`).
  - Shows `Last month's actions: …` only when `lastActions` is present.
- `<FocusBox value lastFocus disabled onChange />`
- The card shows `Focus: …` when the check-in row has a focus, clamped to two lines by CSS line-clamp, with the full text in `title`.

- [ ] **Step 1:** Write the tests:
  - Panel: both labels exist and are clickable to focus their textareas. Typing calls `onChange` with the field. The last-month line appears only when given. `disabled` makes both read-only.
  - FocusBox: the heading, the hint and the last-month line.
  - CheckIn:
    - every open bucket renders a panel, and a shut Advocacy renders none (Review Focus 5);
    - a viewer without `edit_scores` gets read-only panels;
    - typing in a panel shows the unsaved state.
  - ClientCard: the focus line appears only with a focus.
- [ ] **Step 2:** Confirm they FAIL.
- [ ] **Step 3:** Implement. The bucket section becomes `display:grid; grid-template-columns: minmax(0,62fr) minmax(0,38fr)`, collapsing to one column under 720px. The panel sits in the second column, spanning the questions.
- [ ] **Step 4:** Confirm they pass. Mutate the shut-Advocacy guard and the disabled prop, confirming a test goes red each time. Run `npm test && npm run lint && npm run build`.
- [ ] **Step 5:** Commit: `feat(checkin): why-this-score and action items beside each bucket, and this month's focus`.

### Task 4: Routine paragraph

**Files:**
- Create: `docs/superpowers/plans/2026-11-04-bucket-notes-routine-paragraph.md`
- Test: `src/checkin/bucketNotesRoutineParagraph.test.ts`. This is a source test pinning the shape keys `bucket_notes`, `why`, `actions` and `focus`, the 3.6 threshold, "never invent evidence", and the rule that row writes happen only for rows the routine may overwrite.

- [ ] **Step 1:** Read `../tgc-client-health-ai-runs/.superpowers/sdd/2026-10-30-ai-suggestion-runs/routine-prompt-v2.md` (read only) and the hours paragraph `docs/superpowers/plans/2026-11-04-productive-budget-hours-routine-paragraph.md`, to match their style and line references.
- [ ] **Step 2:** Write the paragraph per spec §4.
  - Include exact replacement or insertion text for the v2 lines describing what the routine writes and what `ai_suggestion` holds.
  - The JSON shape must satisfy the Data limits.
- [ ] **Step 3:** Write the test, watch it pass, mutate one pinned phrase and watch it fail. Run `npm test && npm run lint && npm run build`.
- [ ] **Step 4:** Commit: `docs(routine): AI writes per-bucket notes and a focus`.

## Rollout

All [OWNER] steps. Local `main` also carries the unpushed Productive-hours work and `.github/workflows/deploy.yml` deploys on any push to `main`, so one push ships both features.

1. **[OWNER] Migrations first.** Both `20261104120000_productive_hours` and `20261104150000_bucket_notes_and_focus` must be on production before the push to `main`. (The schedule migration `20261104130000` goes with the hours one.)
2. **[OWNER] Then the read-only checks.** `verify-privileges` writes test data and must not be pointed at production unless the owner says so.
3. **[OWNER] Then push**, and confirm the live bundle hash changed. A push is not a deploy.
4. **[OWNER] Then paste the routine text**, applying the hours paragraph first and then the notes paragraph.

If the push goes first, the board breaks, because `CHECKIN_COLUMNS` selects `focus`, and every Save fails, because the upsert sends `bucket_notes` and `focus`.

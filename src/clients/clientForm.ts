import { formatSavedAt } from '../lib/month.ts'

// Every decision the clients admin screen makes, with no React and no Supabase
// client in sight. Spec §9 states the rule this file exists to keep: "The rules
// are not ternaries in JSX." The three rules in §7 are all enforced by a
// database constraint that will refuse the write if the form gets them wrong,
// so they are worth more than a condition inside a render nobody can test
// without a browser.
//
// This module also cannot import ../lib/supabase, and that is load-bearing
// rather than tidy: the client calls readSupabaseConfig at module scope and
// THROWS when VITE_ config is absent, and CI runs vitest with no VITE_ env at
// all. A test importing this file has to run anywhere. Same reason
// src/board/cardSummary.ts keeps its column literal beside its type instead of
// in the hook.

export type ClientStatus = 'active' | 'paused' | 'cancelled' | 'former'

// The four the check constraint on public.clients permits, in the order the
// list reads them: the active roster first (spec §7). tests/clientFormDrift.test.ts
// asserts this is the same set the migration declares.
export const CLIENT_STATUSES: readonly ClientStatus[] = [
  'active',
  'paused',
  'cancelled',
  'former',
]

export const STATUS_LABELS: Record<ClientStatus, string> = {
  active: 'Active',
  paused: 'Paused',
  cancelled: 'Cancelled',
  former: 'Former',
}

// Rule 3 of spec §7, and it is here rather than in the markup because the spec
// is explicit about why it exists: "former and cancelled differ only in age, per
// the parent spec, so the form says so rather than making the reader guess."
export const STATUS_HINTS: Record<ClientStatus, string> = {
  active: 'On the board, and expecting a check-in every month.',
  paused: 'Still a client, but not being scored right now. Off the board.',
  cancelled: 'Recently left, and still under review. Needs an end date and a reason.',
  former: 'Settled and archived. Needs an end date and a reason.',
}

// Hands an unrecognised value straight back. A status this screen does not know
// is a row somebody wrote outside this screen, and relabelling it into one of
// the four would hide that rather than surface it.
export function statusLabel(status: string): string {
  return STATUS_LABELS[status as ClientStatus] ?? status
}

// Spec §6.1's seven, and the same seven clients_end_reason_code_known permits.
export const END_REASON_CODES: readonly string[] = [
  'price',
  'scope_fit',
  'in_housed',
  'went_quiet',
  'project_completed',
  'agency_initiated',
  'other',
]

export const END_REASON_LABELS: Record<string, string> = {
  price: 'Price',
  scope_fit: 'Scope did not fit',
  in_housed: 'Brought in house',
  went_quiet: 'Went quiet',
  project_completed: 'Project completed',
  agency_initiated: 'Ended by us',
  other: 'Other',
}

export function reasonLabel(code: string | null): string {
  if (code === null) return 'No reason recorded'
  return END_REASON_LABELS[code] ?? code
}

// The two statuses the lifecycle constraint calls churn. Written against the
// same literal list the constraint uses rather than as "not active and not
// paused", so a fifth status arriving later does not silently become churn.
export function isChurned(status: string): boolean {
  return status === 'cancelled' || status === 'former'
}

// Only the columns this screen reads, and the literal that fetches them, kept
// side by side -- the src/board/cardSummary.ts pattern. supabase-js infers the
// row type from the string, so a mistyped column fails `npm run build`; a
// computed string would degrade the row to untyped and the mistake would
// surface at runtime as undefined.
//
// `id` is here because the update needs it. `created_at` is not, because
// nothing on this screen shows it.
export const CLIENT_COLUMNS =
  'id, name, owner_id, status, started_on, ended_on, end_reason_code, end_reason_note, updated_at'

export type AdminClient = {
  id: number
  name: string
  owner_id: string | null
  // `string`, not ClientStatus, because that is what the column is: text with a
  // check constraint. Narrowing it here would be a claim this code cannot
  // verify, and formProblems() below is what turns an unknown value into a
  // refusal a person can read instead of a crash.
  status: string
  // Read by the 90-day Advocacy gate (spec §4), which lives on the check-in
  // screen rather than here. This screen is only where it is entered: the gate
  // is shut for every client whose start date is null, so an empty column here
  // is why a whole bucket is unscored two screens away.
  started_on: string | null
  ended_on: string | null
  end_reason_code: string | null
  end_reason_note: string | null
  updated_at: string
}

// Strings throughout, including the date and the code, because that is what an
// <input> and a <select> hand back. The null-vs-empty-string translation happens
// once, in the payload builders below, so no other file has to remember it.
export type ClientDraft = {
  name: string
  ownerId: string | null
  status: string
  startedOn: string
  endedOn: string
  endReasonCode: string
  endReasonNote: string
}

export const EMPTY_DRAFT: ClientDraft = {
  name: '',
  ownerId: null,
  status: 'active',
  startedOn: '',
  endedOn: '',
  endReasonCode: '',
  endReasonNote: '',
}

export function draftFromRow(row: AdminClient): ClientDraft {
  return {
    name: row.name,
    ownerId: row.owner_id,
    status: row.status,
    startedOn: row.started_on ?? '',
    endedOn: row.ended_on ?? '',
    endReasonCode: row.end_reason_code ?? '',
    endReasonNote: row.end_reason_note ?? '',
  }
}

export type FormProblem = {
  field: 'name' | 'status' | 'startedOn' | 'endedOn' | 'endReasonCode'
  text: string
}

// Rule 1 of spec §7, plus the two things the table itself requires. Every
// problem this returns is one the database would refuse -- the point is to
// refuse it here first, in a sentence, rather than after a round trip in
// Postgres's words.
export function formProblems(draft: ClientDraft): FormProblem[] {
  const problems: FormProblem[] = []

  if (draft.name.trim() === '') {
    problems.push({ field: 'name', text: 'A client needs a name.' })
  }

  // Unreachable through the <select>, which only ever offers the four. Reachable
  // through a row somebody wrote elsewhere: draftFromRow copies the stored
  // status across verbatim, so opening such a row lands here. Blocking the save
  // is the honest outcome -- the alternative is quietly rewriting a status
  // nobody on this screen chose.
  if (!CLIENT_STATUSES.includes(draft.status as ClientStatus)) {
    problems.push({
      field: 'status',
      text: `This client's status is "${draft.status}", which is not one of the four this screen understands, so it cannot be saved here.`,
    })
  }

  if (isChurned(draft.status)) {
    if (draft.endedOn.trim() === '') {
      problems.push({ field: 'endedOn', text: 'A cancelled or former client needs the date they left.' })
    }
    if (draft.endReasonCode === '') {
      problems.push({
        field: 'endReasonCode',
        text: 'A cancelled or former client needs a reason from the list.',
      })
    }
  }

  // The note is never required. Spec §10 decision 3: the countable half is the
  // half that has to be there, and a mandatory note invites a full stop typed to
  // get past a form.

  return problems
}

// Rule 2 of spec §7. Not a confirmation dialog -- a sentence shown before the
// press, because the screen "must say it is doing that ... because it is
// destroying a recorded fact".
export function reactivationWarning(from: string, to: string): string | null {
  if (!isChurned(from)) return null
  if (isChurned(to)) return null
  return 'Saving will clear the end date and the reason. Those are recorded facts, and this screen cannot bring them back.'
}

// Status is fixed at 'active' and the two end-reason columns and the end date
// are absent entirely, not sent as nulls. Spec §7: "the form does not offer a
// churned status on creation, because a client who has already left is not
// something anybody needs to add."
//
// started_on is the exception, and it is sent explicitly. It is not a lifecycle
// column -- clients_lifecycle_coherent constrains ended_on and the two reason
// columns only, and says nothing about a start date -- and a client being added
// is exactly the moment somebody knows when the engagement began. Sent as null
// rather than omitted when blank, because the value being absent is itself the
// thing the gate reads.
export function insertPayload(draft: ClientDraft) {
  return {
    name: draft.name.trim(),
    owner_id: draft.ownerId,
    status: 'active',
    started_on: draft.startedOn === '' ? null : draft.startedOn,
  }
}

// All seven columns, every time, whatever the status. This is what makes rule
// 2's three-column clear structurally impossible to forget: the constraint is
// bidirectional (spec §10 decision 2), so an update that moves a client off
// `former` without nulling all three is refused by Postgres. Sending only the
// changed columns would make that a thing each caller had to remember.
// started_on rides along unconditionally too, for the same reason it is
// unconditional on the row itself: it is not one of the three the constraint
// governs, so there is no status-dependent rule to apply to it here.
export function updatePayload(draft: ClientDraft) {
  const churned = isChurned(draft.status)
  const note = draft.endReasonNote.trim()
  return {
    name: draft.name.trim(),
    owner_id: draft.ownerId,
    status: draft.status,
    started_on: draft.startedOn === '' ? null : draft.startedOn,
    ended_on: churned && draft.endedOn !== '' ? draft.endedOn : null,
    end_reason_code: churned && draft.endReasonCode !== '' ? draft.endReasonCode : null,
    // Null rather than an empty string, matching how the check-in screen stores
    // an empty note. An empty string is a value; the absence of a note is not.
    end_reason_note: churned && note !== '' ? note : null,
  }
}

// Four of the things this table can refuse, translated -- not all of them, and
// the difference matters. Anything not matched below reaches the person raw,
// including two known cases: an UPDATE that matched no row (see
// UPDATE_MATCHED_NOTHING_TEXT, which is why useClients handles that outcome
// before it ever gets here) and a foreign-key violation on owner_id, which
// arrives as `clients_owner_id_fkey` and would be shown verbatim.
//
// Every branch ends with the same promise, because the screen deliberately keeps
// the form populated after a failure: the person is then looking at values that
// are NOT in the database, and a message that does not say so is Slice 1's
// defect wearing a new mask.
export function writeFailureText(message: string, name: string): string {
  const tail = ' Nothing was changed, and pressing save again costs nothing.'

  if (message.includes('clients_name_unique')) {
    return `A client called "${name}" already exists. Names are compared ignoring case, so "acme" and "Acme" count as the same client.${tail}`
  }

  if (message.includes('clients_lifecycle_coherent')) {
    return `A cancelled or former client needs an end date and a reason, and an active or paused one must have neither.${tail}`
  }

  if (message.includes('clients_end_reason_code_known')) {
    return `That end reason is not one of the seven this tool records.${tail}`
  }

  // 42501 and the RLS refusal read differently but mean the same thing to the
  // person: their account is not allowed to do this. Spec §7.2 -- the database
  // refusing IS the security, and this is what that refusal looks like on screen.
  if (message.includes('permission denied') || message.includes('row-level security')) {
    return `Your account is not allowed to change clients. Ask an admin.${tail}`
  }

  return `${message}.${tail}`
}

// The two refusals that never arrive as a Postgres error, so writeFailureText
// above never sees either of them. They live here rather than in useClients.ts
// for the same reason every other sentence on this screen does: what the screen
// SAYS is a decision, and decisions are testable without a browser.

// A second save pressed inside one round trip. The old code returned silently:
// no request, no message, nothing at all. A control that does nothing is its own
// defect, and the silence was also what let the first write's confirmation land
// beside the second row. This one is safe to retry, and says so, because the
// condition clears itself the moment the first write lands.
export const CONCURRENT_SAVE_TEXT =
  'Another save is still finishing, so this change was not sent. Nothing was changed. Try again in a moment.'

// An UPDATE that matched no row. clients_update_manage_clients is
// `using (...) with check (...)`, and when the caller lacks manage_clients the
// USING clause filters the row out rather than raising: zero rows updated, no
// error, and .single() then answers PGRST116 ("JSON object requested, multiple
// (or no) rows returned"), which is not a sentence to put in front of an account
// manager. The INSERT path is different -- WITH CHECK does raise, and the
// 'row-level security' branch above catches it.
//
// Deliberately no invitation to retry. Every retry will be refused identically,
// so "pressing save again costs nothing" would be sending somebody to press a
// button that cannot ever succeed. The reachable route is an admin deactivating
// or demoting an account while its holder has this screen open: useProfile holds
// the profile from mount, so the UI never notices.
export const UPDATE_MATCHED_NOTHING_TEXT =
  'That change was not applied, and nothing was changed. The database matched no client to update, which is what happens when the account signed in here is no longer allowed to change clients. Ask an admin.'

export type WriteState =
  | { kind: 'idle' }
  | { kind: 'saving' }
  | { kind: 'saved'; at: string; what: string }
  | { kind: 'failed'; message: string }

export type StatusTone = 'confirm' | 'error' | 'quiet'

export type StatusLine = { text: string; tone: StatusTone }

// Returns a line in every state, never null and never an empty string -- the
// contract the screen relies on to render something whenever this region is
// visible. Slice 1's Critical 1 was a state with no branch at all: a routine
// saved draft, reopened, said nothing.
//
// The time is named on the confirmation, per spec §7. The durable half of that
// promise is not this line -- it is the "Updated ..." line on the client's own
// row in the list, which comes from updated_at and therefore survives a reload.
// This line is the immediate half.
export function writeStatusLine(
  state: WriteState,
  problems: readonly FormProblem[],
): StatusLine {
  switch (state.kind) {
    case 'saving':
      return { text: 'Saving…', tone: 'quiet' }

    case 'saved':
      return { text: `${state.what} ${formatSavedAt(state.at)}.`, tone: 'confirm' }

    case 'failed':
      return { text: state.message, tone: 'error' }

    case 'idle': {
      if (problems.length > 0) {
        return { text: problems.map((problem) => problem.text).join(' '), tone: 'quiet' }
      }
      return { text: 'Ready to save.', tone: 'quiet' }
    }

    default: {
      // Exhaustiveness check: a new WriteState kind stops this compiling
      // instead of falling through and returning nothing.
      const exhaustive: never = state
      throw new Error(`Unhandled write state: ${JSON.stringify(exhaustive)}`)
    }
  }
}

// Spec §7: the picker "lists active profiles by name, or email where full_name
// is null". Whitespace counts as null -- a name of three spaces is not a name,
// and it would render as an unlabelled option.
export function ownerLabel(profile: { full_name: string | null; email: string }): string {
  const name = profile.full_name?.trim() ?? ''
  return name === '' ? profile.email : name
}

// The order statuses read in, extracted from sortClients in Slice 2 step 5 so
// the board and this screen cannot disagree about it. An unknown status ranks
// LAST rather than -1: -1 would sort a status nobody meant to the top of the
// board, which is the opposite of what an unrecognised value deserves.
export function statusRank(status: string): number {
  const index = CLIENT_STATUSES.indexOf(status as ClientStatus)
  return index === -1 ? CLIENT_STATUSES.length : index
}

// Status then name, so the active roster reads first (spec §7). A status the
// four do not cover sorts last rather than being dropped: this screen is the
// only place such a row is visible at all.
export function sortClients(rows: readonly AdminClient[]): AdminClient[] {
  // Copied first: sorting the array the hook holds in state would mutate it in
  // place, and React compares by identity.
  return [...rows].sort(
    (a, b) => statusRank(a.status) - statusRank(b.status) || a.name.localeCompare(b.name),
  )
}

import { PILLARS } from '../lib/score'
import { formatSavedAt } from '../lib/month'

// The save path as a pure reducer. Slice 1 spec §5.6.
//
// Why a reducer and not a handful of booleans in the component: the defect this
// whole slice exists to fix is that a save which worked looked exactly like a
// save that failed. Nothing automated in the project could see that, because
// every reviewer verified a write by querying the database rather than by
// asking what a person would see. A reducer makes the answer to "what does the
// screen say now" a value a test can hold, so the next reviewer can check the
// confirmation without a browser.

export type SaveState =
  | { kind: 'clean' }
  | { kind: 'dirty' }
  | { kind: 'saving' }
  | { kind: 'saved'; at: string; by: string; complete: boolean }
  | { kind: 'failed'; error: string }

export type SaveEvent =
  | { type: 'loaded' }
  | { type: 'edited' }
  | { type: 'submitted' }
  | { type: 'succeeded'; at: string; by: string; complete: boolean }
  | { type: 'failed'; error: string }

export const INITIAL_SAVE_STATE: SaveState = { kind: 'clean' }

export function saveReducer(state: SaveState, event: SaveEvent): SaveState {
  switch (event.type) {
    case 'loaded':
      return { kind: 'clean' }

    case 'edited':
      // Refused while a write is in flight. The screen disables every input
      // during a save, so a person cannot reach this; the reducer refuses it
      // anyway, because leaving `saving` would strand the response that is
      // still coming and make the `succeeded` guard below meaningless.
      return state.kind === 'saving' ? state : { kind: 'dirty' }

    case 'submitted':
      // Unguarded, unlike `edited` above, and that is deliberate rather than an
      // oversight: re-entering `saving` from `saving` is the same state, so
      // there is nothing here to protect. What stops a second press starting a
      // second write is not this line -- it is submitBlock returning blocked
      // while the state is `saving`, and the caller's own in-flight guard.
      // Adding a check here would read as the protection and would not be it.
      return { kind: 'saving' }

    case 'succeeded':
    case 'failed': {
      // Only a save that is actually in flight may report its outcome. A
      // confirmation for a write the person can no longer see is the same class
      // of lie as no confirmation at all -- it is the defect this slice exists
      // to fix, wearing the opposite mask.
      //
      // Honest about reachability, in the same terms as the `edited` guard
      // above: as the screen is wired today, nothing takes the state out of
      // `saving` before the response lands, so neither of these refusals can
      // currently fire. An earlier version of this comment narrated a concrete
      // race -- going back to the board and returning while a save was still in
      // flight -- and that story does not hold: returning mounts a new screen
      // with its own reducer, so the abandoned request's dispatch belongs to the
      // old one and cannot reach the new one's state.
      //
      // The guard stays anyway. It costs one comparison, and it is the only
      // thing that would keep a late response from painting over a form it no
      // longer describes if a future change gave the screen a way to leave
      // `saving` early -- a reload during a save, an edit that is no longer
      // disabled, a cancel control. Its tests pin the behaviour so that change
      // cannot quietly reopen the defect.
      if (state.kind !== 'saving') return state
      return event.type === 'succeeded'
        ? { kind: 'saved', at: event.at, by: event.by, complete: event.complete }
        : { kind: 'failed', error: event.error }
    }

    default: {
      // Exhaustiveness check: a new event stops this compiling instead of
      // silently falling through and returning the old state.
      const _exhaustive: never = event
      throw new Error(`Unhandled save event: ${JSON.stringify(_exhaustive)}`)
    }
  }
}

// §5.4: one control, whose label reflects the state it is in. The label is the
// only place the draft/submitted distinction is visible before the press, and it
// is the deliberate opposite of `Score all 3s`, which wrote a constant whatever
// the state was.
export function submitLabel(scored: number): string {
  return scored === PILLARS.length ? 'Submit check-in' : 'Save draft'
}

export type SubmitBlock = { blocked: false } | { blocked: true; reason: string }

export function submitBlock(args: {
  state: SaveState
  readFailed: boolean
  canEdit: boolean
  hasContent: boolean
  storedSubmitted: boolean
}): SubmitBlock {
  // Checked before readFailed below, and that ordering is deliberate rather
  // than incidental. readFailed's reason says "this could not be read, so
  // saving is blocked" -- which is honest for an account that could
  // otherwise save, because a retry that reads successfully really would
  // unblock it. For an account without edit_scores that implication is
  // false: no read, however clean, would ever let this press through, and
  // the reducer's caller (a viewer, today) never gets a working save no
  // matter what the database says back. Putting this check first is what
  // keeps the reason permanent instead of borrowing a transient one that
  // happens to be true right now and stops being true the moment the read
  // succeeds. See CheckIn.tsx: this is also enforced above the reducer, by
  // disabling the pillar rows and the notes field themselves -- this check
  // is what keeps the submit button itself honest even so, and it is the
  // only backstop if a future caller ever wires a control this file does not
  // already know about.
  if (!args.canEdit) {
    return {
      blocked: true,
      reason:
        'You can view this check-in, but your account cannot save changes to it. ' +
        'An admin can change that if this should be different.',
    }
  }

  // Checked next, ahead of everything else that follows: parent spec §8.1,
  // never write after a failed read. If the read failed, the form on screen is
  // not this month's check-in -- it is an empty form -- and saving it would
  // replace real pillars with nothing.
  if (args.readFailed) {
    return {
      blocked: true,
      reason:
        'This check-in could not be read, so saving is blocked. Saving now could ' +
        'replace real scores with an empty form.',
    }
  }

  if (args.state.kind === 'saving') {
    return { blocked: true, reason: 'Saving…' }
  }

  if (!args.hasContent) {
    return {
      blocked: true,
      reason: 'Score at least one pillar, or write a note, before saving.',
    }
  }

  if (args.state.kind === 'saved') {
    return { blocked: true, reason: 'Saved. Change something to save again.' }
  }

  // `clean` means the form matches the database. A stored row that is already
  // submitted therefore has nothing left to write, and a press that cannot
  // change anything must not look like a press that can -- that is `Score all
  // 3s`'s defect stated as a rule. A stored *draft* is the other case: it is
  // clean and unsubmitted, and pressing submit genuinely changes it.
  if (args.state.kind === 'clean' && args.storedSubmitted) {
    return {
      blocked: true,
      reason: 'This check-in is already submitted, and nothing has changed since it loaded.',
    }
  }

  return { blocked: false }
}

// §5.3: the total belongs to the database, and local arithmetic exists so the
// number moves as pillars are clicked. The moment the form matches what is
// stored, the stored number is what shows -- so a disagreement between
// score.ts and the generated column appears on screen rather than being hidden
// behind a local sum that always agrees with itself.
export function displayedTotal(args: {
  state: SaveState
  localTotal: number | null
  storedTotal: number | null
}): number | null {
  const formDiffers =
    args.state.kind === 'dirty' ||
    args.state.kind === 'saving' ||
    args.state.kind === 'failed'
  return formDiffers ? args.localTotal : args.storedTotal
}

export type SaveStatusTone = 'confirm' | 'error' | 'quiet'

export type SaveStatusLine = { text: string; tone: SaveStatusTone }

// Fix round 1: the save-status region used to be an ad-hoc chain of JSX
// conditions in CheckIn.tsx. `clean` + not blocked had no branch at all -- a
// routine saved draft, reopened, said nothing. `dirty` + blocked did have a
// branch, but an incomplete one: it always rendered "Unsaved changes." and
// never the reason submitBlock had just disabled the button. Both were
// wrong in the chain itself, not in whether a test could have caught them --
// src/checkin/CheckIn.test.tsx renders CheckIn with useCheckin mocked and
// asserts the save-status markup by id, and would have failed on either gap.
// This function is the same decision made a value as well as a rendered
// result: every SaveState kind is handled in the switch below, the default
// case is a compile-time exhaustiveness check exactly like the one in
// saveReducer above, and saveState.test.ts sweeps every kind against every
// shape `block` can take to prove the result is never empty, without needing
// a render to do it.
//
// Returns one or more lines, never zero, and no line's text is ever empty --
// that is the contract the caller relies on to render *something* every time
// this region is visible.
export function saveStatus(args: {
  state: SaveState
  block: SubmitBlock
  scored: number
  storedUpdatedAt: string | null
}): SaveStatusLine[] {
  const { state, block, scored } = args

  // Appended to `dirty`'s state line below, when submitBlock also blocked
  // the press -- the fix for Critical 2, where a blocked `dirty` press used
  // to render only "Unsaved changes." with no reason. This is the only case
  // that calls it: `clean` when blocked returns `block.reason` as its sole
  // line, by a separate branch below, since there is no state line there to
  // append it to in the first place.
  function blockedReason(): SaveStatusLine | null {
    return block.blocked ? { text: block.reason, tone: 'quiet' } : null
  }

  // `saving` and `saved`, below, never call blockedReason() at all -- each
  // returns a single line built from the state itself, and block.reason is
  // not consulted either way. For `saving` that reason is always "Saving…"
  // (submitBlock's `saving` check runs before its `!hasContent` check, so
  // nothing else can reach it first). For `saved` it is usually "Saved.
  // Change something to save again." too, but not always: submitBlock checks
  // `!hasContent` before it checks `saved`, so a `saved` state paired with
  // `hasContent: false` gets "Score at least one pillar…" instead. That exact
  // shape cannot arise through this screen's own flow -- any edit dispatches
  // `edited` and leaves `saved` immediately, so a live `saved` state's
  // content is always whatever was just submitted -- but the property test in
  // saveState.test.ts deliberately constructs it anyway, and the switch's
  // behaviour for it is still correct regardless of what the reason says: the
  // `saved` case prints its own sentence and stops.
  switch (state.kind) {
    case 'saving':
      return [{ text: 'Saving…', tone: 'quiet' }]

    case 'saved': {
      const verb = state.complete ? 'Check-in submitted' : 'Draft saved'
      const tail = state.complete
        ? ''
        : ` ${scored} of ${PILLARS.length} pillars scored.`
      return [
        {
          text: `${verb} ${formatSavedAt(state.at)} by ${state.by}.${tail}`,
          tone: 'confirm',
        },
      ]
    }

    case 'failed':
      return [
        {
          text:
            `Could not save: ${state.error}. Nothing was lost — everything you ` +
            `entered is still on screen, and pressing ${submitLabel(scored)} ` +
            'again costs nothing.',
          tone: 'error',
        },
      ]

    case 'dirty': {
      const lines: SaveStatusLine[] = [{ text: 'Unsaved changes.', tone: 'quiet' }]
      const reason = blockedReason()
      if (reason) lines.push(reason)
      return lines
    }

    case 'clean': {
      if (block.blocked) return [{ text: block.reason, tone: 'quiet' }]

      // Not blocked while `clean` is the missing case Critical 1 found: a
      // routine saved draft, reopened, said nothing. submitBlock blocks
      // unconditionally whenever `!hasContent` (checked ahead of the
      // clean+storedSubmitted rule) and whenever `storedSubmitted` is true
      // while `clean` (the rule right above this one in submitBlock), so
      // reaching here with `blocked: false` means `hasContent` is true AND
      // `storedSubmitted` is false. `clean` itself means the draft on screen
      // matches the stored row (see the `loaded`/`edited` dispatch in
      // useCheckin.ts): the database's empty case, `draftFromRow(null)`, is
      // EMPTY_DRAFT, which has no content. So a `clean` form with content can
      // only be a form that matches a real, non-empty stored row -- meaning
      // `storedUpdatedAt` cannot be null in this branch. The null-guard below
      // is defensive rather than reachable today, in the same spirit as the
      // guard on the merged succeeded/failed case above: it costs one check,
      // and it stops a future change from printing an empty date if this
      // invariant ever stops holding.
      const at = args.storedUpdatedAt ? formatSavedAt(args.storedUpdatedAt) : null
      return [
        {
          text: at
            ? `Draft saved ${at}. ${scored} of ${PILLARS.length} pillars scored.`
            : `Draft saved. ${scored} of ${PILLARS.length} pillars scored.`,
          tone: 'confirm',
        },
      ]
    }

    default: {
      const _exhaustive: never = state
      throw new Error(`Unhandled save state: ${JSON.stringify(_exhaustive)}`)
    }
  }
}

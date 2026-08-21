import { PILLARS } from '../lib/score'

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
  hasContent: boolean
  storedSubmitted: boolean
}): SubmitBlock {
  // Checked first, and deliberately ahead of everything else: parent spec §8.1,
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

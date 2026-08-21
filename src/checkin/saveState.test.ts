import { describe, expect, it } from 'vitest'
import {
  INITIAL_SAVE_STATE,
  displayedTotal,
  saveReducer,
  submitBlock,
  submitLabel,
} from './saveState'
import type { SaveState } from './saveState'

const CLEAN: SaveState = { kind: 'clean' }
const DIRTY: SaveState = { kind: 'dirty' }
const SAVING: SaveState = { kind: 'saving' }
const SAVED: SaveState = { kind: 'saved', at: '2026-08-21T15:42:00.000Z', by: 'you', complete: true }
const FAILED: SaveState = { kind: 'failed', error: 'network refused' }

const ALL_STATES: readonly SaveState[] = [CLEAN, DIRTY, SAVING, SAVED, FAILED]

describe('saveReducer', () => {
  it('starts clean', () => {
    expect(INITIAL_SAVE_STATE).toEqual({ kind: 'clean' })
  })

  it('a completed read returns to clean from anywhere', () => {
    for (const state of ALL_STATES) {
      expect(saveReducer(state, { type: 'loaded' })).toEqual({ kind: 'clean' })
    }
  })

  it('an edit makes the screen dirty', () => {
    expect(saveReducer(CLEAN, { type: 'edited' })).toEqual({ kind: 'dirty' })
    expect(saveReducer(SAVED, { type: 'edited' })).toEqual({ kind: 'dirty' })
    expect(saveReducer(FAILED, { type: 'edited' })).toEqual({ kind: 'dirty' })
  })

  it('refuses an edit while a write is in flight', () => {
    // The screen disables every input during a save, so this is unreachable by
    // clicking. The reducer refuses it anyway: if `saving` could be left by an
    // edit, the response arriving afterwards would have nothing to attach its
    // confirmation to, and `succeeded` below could no longer be trusted.
    expect(saveReducer(SAVING, { type: 'edited' })).toBe(SAVING)
  })

  it('a submission starts a save', () => {
    expect(saveReducer(DIRTY, { type: 'submitted' })).toEqual({ kind: 'saving' })
    expect(saveReducer(CLEAN, { type: 'submitted' })).toEqual({ kind: 'saving' })
    expect(saveReducer(FAILED, { type: 'submitted' })).toEqual({ kind: 'saving' })
  })

  it('names the time, the person and whether it counted as a submission', () => {
    const next = saveReducer(SAVING, {
      type: 'succeeded',
      at: '2026-08-21T15:42:00.000Z',
      by: 'you',
      complete: false,
    })
    expect(next).toEqual({
      kind: 'saved',
      at: '2026-08-21T15:42:00.000Z',
      by: 'you',
      complete: false,
    })
  })

  it('keeps the failure message, so retrying can be offered', () => {
    expect(saveReducer(SAVING, { type: 'failed', error: 'network refused' })).toEqual({
      kind: 'failed',
      error: 'network refused',
    })
  })

  it('ignores a response for a save that is no longer in flight', () => {
    // What this pins, stated without inventing a scenario for it: a response
    // is honoured only from `saving`. As the screen is wired today no path
    // leaves `saving` before the response lands, so this is a guard against a
    // future change rather than against a race that exists -- see the comment
    // on the merged `succeeded`/`failed` case in saveState.ts, which says why
    // it is kept and why the race it used to describe does not hold.
    //
    // The behaviour is worth pinning regardless: painting "Saved" over a form
    // that no longer describes the write would be a confirmation for something
    // the person can no longer see, which is the same class of lie as no
    // confirmation at all.
    for (const state of [CLEAN, DIRTY, SAVED, FAILED]) {
      expect(
        saveReducer(state, { type: 'succeeded', at: 'x', by: 'you', complete: true }),
      ).toBe(state)
      expect(saveReducer(state, { type: 'failed', error: 'late' })).toBe(state)
    }
  })

  it('never leaves a press with nothing to show for it', () => {
    // Spec §5.6: "No transition leaves the screen unchanged after a click."
    // Pressing the one control is a `submitted`, and it must move the state
    // from every state it can be pressed in -- otherwise the press does
    // nothing and the screen says nothing, which is the exact defect this
    // slice exists to fix.
    for (const state of [CLEAN, DIRTY, SAVED, FAILED]) {
      expect(
        saveReducer(state, { type: 'submitted' }),
        `${state.kind} + submitted left the save state unchanged`,
      ).not.toEqual(state)
    }
  })

  it('an edit always leaves the form unsaved, whether or not that is a change', () => {
    // The weaker half of the property above, stated honestly rather than
    // folded into it. `edited` moves clean, saved and failed to dirty -- a
    // visible change. From `dirty` it returns `dirty`, which is the SAME
    // state, and that is correct: the visible change was the pillar the
    // person just clicked, not the save state. Asserting `.not.toEqual` here
    // would be asserting something false about the reducer.
    for (const state of [CLEAN, SAVED, FAILED]) {
      expect(saveReducer(state, { type: 'edited' })).toEqual({ kind: 'dirty' })
    }
    expect(saveReducer(DIRTY, { type: 'edited' })).toEqual(DIRTY)
  })
})

describe('submitLabel', () => {
  it('reads Save draft below five pillars and Submit check-in at five', () => {
    expect(submitLabel(0)).toBe('Save draft')
    expect(submitLabel(4)).toBe('Save draft')
    expect(submitLabel(5)).toBe('Submit check-in')
  })
})

describe('submitBlock', () => {
  const ready = { state: DIRTY, readFailed: false, hasContent: true, storedSubmitted: false }

  it('lets an edited form with content through', () => {
    expect(submitBlock(ready)).toEqual({ blocked: false })
  })

  it('blocks every write while the read has failed', () => {
    // Parent spec §8.1, "never write after a failed read". This is the rule
    // that stops a transient outage replacing real pillars with an empty form,
    // so it is checked before anything else.
    const blocked = submitBlock({ ...ready, readFailed: true })
    expect(blocked.blocked).toBe(true)
    if (blocked.blocked) expect(blocked.reason).toMatch(/could not be read/i)
  })

  it('blocks a second press while the first is in flight', () => {
    expect(submitBlock({ ...ready, state: SAVING }).blocked).toBe(true)
  })

  it('blocks a save with nothing in it', () => {
    const blocked = submitBlock({ ...ready, hasContent: false })
    expect(blocked.blocked).toBe(true)
    if (blocked.blocked) expect(blocked.reason).toMatch(/at least one pillar/i)
  })

  it('blocks a repeat press that would write exactly what is already stored', () => {
    // This is `Score all 3s`'s defect, stated as a rule: a press that cannot
    // change anything must not look like a press that can. `clean` means the
    // form matches the database, and a stored row that is already submitted
    // has nothing left to gain.
    const blocked = submitBlock({ ...ready, state: CLEAN, storedSubmitted: true })
    expect(blocked.blocked).toBe(true)
    if (blocked.blocked) expect(blocked.reason).toMatch(/already submitted/i)
  })

  it('lets a loaded draft be submitted without editing it first', () => {
    // The other side of the rule above. Someone who scored four pillars
    // yesterday and the fifth is already there must be able to press submit
    // without touching a control to unlock it.
    expect(submitBlock({ ...ready, state: CLEAN, storedSubmitted: false })).toEqual({
      blocked: false,
    })
  })

  it('blocks a press immediately after a successful save', () => {
    const blocked = submitBlock({ ...ready, state: SAVED })
    expect(blocked.blocked).toBe(true)
    if (blocked.blocked) expect(blocked.reason).toMatch(/saved/i)
  })

  it('offers a retry after a failure', () => {
    expect(submitBlock({ ...ready, state: FAILED })).toEqual({ blocked: false })
  })

  it('always explains itself', () => {
    // A dead button with no explanation is the same failure as a silent save,
    // in a smaller box. Every blocking path must carry a sentence.
    const cases = [
      { ...ready, readFailed: true },
      { ...ready, state: SAVING },
      { ...ready, hasContent: false },
      { ...ready, state: SAVED },
      { ...ready, state: CLEAN, storedSubmitted: true },
    ]
    for (const input of cases) {
      const result = submitBlock(input)
      expect(result.blocked).toBe(true)
      if (result.blocked) expect(result.reason.trim()).not.toBe('')
    }
  })

  it('reports the failed read even when the form is also empty', () => {
    // Precedence, not just presence. An empty form and a failed read are the
    // same picture on screen; only the order of these checks decides whether
    // the person is told the safe thing or the trivial one.
    const blocked = submitBlock({
      state: CLEAN,
      readFailed: true,
      hasContent: false,
      storedSubmitted: false,
    })
    expect(blocked.blocked).toBe(true)
    if (blocked.blocked) expect(blocked.reason).toMatch(/could not be read/i)
  })
})

describe('displayedTotal', () => {
  it('shows the local sum while the form differs from the database', () => {
    // §5.3: the number has to move as pillars are clicked, or the control gives
    // no feedback at all.
    for (const state of [DIRTY, SAVING, FAILED]) {
      expect(displayedTotal({ state, localTotal: 19, storedTotal: 12 })).toBe(19)
    }
  })

  it('shows the database column once the form matches it', () => {
    // §5.3: the total belongs to the database. Showing the stored value here is
    // what makes a disagreement between score.ts and the generated column
    // visible on screen instead of hidden behind local arithmetic.
    for (const state of [CLEAN, SAVED]) {
      expect(displayedTotal({ state, localTotal: 19, storedTotal: 12 })).toBe(12)
    }
  })

  it('carries null through, because incomplete has no number', () => {
    expect(displayedTotal({ state: DIRTY, localTotal: null, storedTotal: 12 })).toBeNull()
    expect(displayedTotal({ state: CLEAN, localTotal: 19, storedTotal: null })).toBeNull()
  })
})

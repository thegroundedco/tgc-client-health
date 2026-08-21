import { describe, expect, it } from 'vitest'
import {
  INITIAL_SAVE_STATE,
  displayedTotal,
  saveReducer,
  saveStatus,
  submitBlock,
  submitLabel,
} from './saveState'
import type { SaveState, SubmitBlock } from './saveState'
import { PILLARS } from '../lib/score'

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

describe('saveStatus', () => {
  // Fix round 1, Critical 1 and 2: the save-status region used to be a chain
  // of JSX conditions. `clean` + not blocked had no branch at all -- a
  // routine `clean` draft rendered nothing. `dirty` + blocked did have a
  // branch, but an incomplete one: it always rendered "Unsaved changes." and
  // never the reason the button had just been disabled for. saveStatus() is
  // that decision made a value instead of a chain, so completeness is
  // something this file can assert rather than something a reviewer has to
  // notice missing in a browser -- and src/checkin/CheckIn.test.tsx checks
  // the same completeness again in the rendered markup, since nothing here
  // proves CheckIn.tsx actually uses this function's result correctly.

  const BLOCKED = (reason = 'test reason'): { blocked: true; reason: string } => ({
    blocked: true,
    reason,
  })
  const UNBLOCKED: SubmitBlock = { blocked: false }

  function nonEmptyText(lines: readonly { text: string }[]) {
    return lines.length > 0 && lines.every((line) => line.text.trim() !== '')
  }

  it('never returns nothing, for any combination of state, block and stored facts', () => {
    // The property, not a case list: every SaveState kind, crossed with
    // whether submitBlock happened to block and whether there is anything to
    // report as saved. `block` is constructed directly here rather than run
    // through submitBlock -- some of the 20 combinations below (e.g. `saved`
    // with `blocked: false`) cannot actually occur through submitBlock, and
    // the point of this sweep is that saveStatus's own switch must not go
    // silent on ANY input shape, reachable today or not. `storedSubmitted`
    // is not swept here: saveStatus's signature does not take it (removed in
    // fix round 2 -- `block` already folds in everything submitBlock decided
    // from it), so there is nothing left for this function to vary on.
    for (const state of ALL_STATES) {
      for (const block of [BLOCKED(), UNBLOCKED]) {
        for (const hasContent of [true, false]) {
          const lines = saveStatus({
            state,
            block,
            scored: hasContent ? 3 : 0,
            storedUpdatedAt: hasContent ? '2026-08-21T15:42:00.000Z' : null,
          })
          expect(
            nonEmptyText(lines),
            `${state.kind} + blocked:${block.blocked} + hasContent:${hasContent} ` +
              `produced ${JSON.stringify(lines)}`,
          ).toBe(true)
        }
      }
    }
  })

  it('Critical 1: a clean, unblocked draft says it was saved', () => {
    // Reachable in the most ordinary way possible: score some pillars, press
    // Save draft, come back later. load() finds no local-draft disagreement,
    // dispatches `loaded`, and the screen is `clean` with a stored, unsubmitted
    // row -- exactly the combination the old JSX chain had no branch for.
    const lines = saveStatus({
      state: CLEAN,
      block: UNBLOCKED,
      scored: 3,
      storedUpdatedAt: '2026-08-21T15:42:00.000Z',
    })
    expect(nonEmptyText(lines)).toBe(true)
    expect(lines[0].text).toMatch(/draft saved/i)
    expect(lines[0].text).toContain(`3 of ${PILLARS.length} pillars scored`)
  })

  it('Critical 1, the nullability question: storedUpdatedAt cannot be null when clean is unblocked, but the guard does not print an empty date if it ever is', () => {
    const lines = saveStatus({
      state: CLEAN,
      block: UNBLOCKED,
      scored: 3,
      storedUpdatedAt: null,
    })
    expect(lines[0].text).not.toMatch(/invalid date/i)
    // No trailing space before the period where a date would otherwise sit --
    // "Draft saved ." is the exact defect the brief's dead branch would have
    // printed, from formatSavedAt('') returning its input unchanged.
    expect(lines[0].text).not.toContain(' .')
    expect(lines[0].text).toBe(`Draft saved. 3 of ${PILLARS.length} pillars scored.`)
  })

  it('Critical 2: a blocked dirty press still says why', () => {
    // Reachable: score one pillar, then Clear it with notes empty. The form
    // is dirty (something changed since it loaded) and empty (nothing left to
    // save), so submitBlock blocks it -- and the old code only ever rendered
    // "Unsaved changes." for `dirty`, never the reason the button disabled.
    const block = BLOCKED('Score at least one pillar, or write a note, before saving.')
    const lines = saveStatus({
      state: DIRTY,
      block,
      scored: 0,
      storedUpdatedAt: null,
    })
    expect(lines).toHaveLength(2)
    expect(lines[0].text).toBe('Unsaved changes.')
    expect(lines[1].text).toBe(block.reason)
  })

  it('does not echo the block reason when the state line already says it', () => {
    // `saving` and `saved` never call blockedReason() at all -- see the
    // comment above the switch in saveState.ts. For `saving` the reason is
    // always "Saving…"; for `saved` it is usually "Saved. Change something
    // to save again." too, though not for every input (a `saved` state paired
    // with `hasContent: false` gets a different reason from submitBlock --
    // see the property test above, which feeds that exact shape). Either
    // way, only one line comes back here, because the reason is never read.
    const saving = saveStatus({
      state: SAVING,
      block: BLOCKED('Saving…'),
      scored: 3,
      storedUpdatedAt: null,
    })
    expect(saving).toHaveLength(1)

    const saved = saveStatus({
      state: SAVED,
      block: BLOCKED('Saved. Change something to save again.'),
      scored: 5,
      storedUpdatedAt: null,
    })
    expect(saved).toHaveLength(1)

    // The shape the comment above names explicitly: `saved` with a reason
    // that does NOT restate the state, because submitBlock reached it via the
    // `!hasContent` check rather than the `saved` check. Still one line.
    const savedEmpty = saveStatus({
      state: SAVED,
      block: BLOCKED('Score at least one pillar, or write a note, before saving.'),
      scored: 0,
      storedUpdatedAt: null,
    })
    expect(savedEmpty).toHaveLength(1)
  })

  it('names the time, the person, and how far along a draft is', () => {
    const submitted = saveStatus({
      state: SAVED,
      block: BLOCKED('Saved. Change something to save again.'),
      scored: 5,
      storedUpdatedAt: null,
    })
    expect(submitted[0].text).toMatch(/^Check-in submitted /)
    expect(submitted[0].text).toContain('by you.')
    expect(submitted[0].text).not.toMatch(/pillars scored/)

    const draft = saveStatus({
      state: { kind: 'saved', at: '2026-08-21T15:42:00.000Z', by: 'you', complete: false },
      block: BLOCKED('Saved. Change something to save again.'),
      scored: 4,
      storedUpdatedAt: null,
    })
    expect(draft[0].text).toMatch(/^Draft saved /)
    expect(draft[0].text).toContain(`4 of ${PILLARS.length} pillars scored`)
  })

  it('keeps the failed message and the no-cost-to-retry reassurance', () => {
    const lines = saveStatus({
      state: FAILED,
      block: UNBLOCKED,
      scored: 3,
      storedUpdatedAt: null,
    })
    expect(lines).toHaveLength(1)
    expect(lines[0].text).toContain('network refused')
    expect(lines[0].text).toMatch(/nothing was lost/i)
  })
})

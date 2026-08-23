import { describe, expect, it } from 'vitest'
import { PILLARS } from './score'
import { ANCHOR_VALUES, PILLAR_DEFINITIONS } from './pillars'

describe('the pillar rubric', () => {
  it('defines every pillar, and only the pillars', () => {
    // Record<Pillar, …> makes a missing pillar a compile error, which `npm test`
    // does not run. This asserts it at runtime too, because the screen renders
    // by iterating PILLARS and a missing entry would throw there instead.
    expect(Object.keys(PILLAR_DEFINITIONS).sort()).toEqual([...PILLARS].sort())
  })

  it.each([...PILLARS])('gives %s a label, a hint and three anchors', (pillar) => {
    const definition = PILLAR_DEFINITIONS[pillar]
    expect(definition.label.trim()).not.toBe('')
    expect(definition.hint.trim()).not.toBe('')
    for (const value of ANCHOR_VALUES) {
      expect(definition.anchors[value].trim()).not.toBe('')
    }
  })

  // The card draws five bars and, before this, gave a sighted reader no way to
  // tell which bar was which pillar -- the aria-label carried the mapping and
  // the eye got five anonymous columns. Found by the owner on the deployed
  // board, which is the only place it was visible.
  describe('the single-letter initials the card labels its bars with', () => {
    it('gives every pillar one', () => {
      for (const pillar of PILLARS) {
        expect(PILLAR_DEFINITIONS[pillar].initial, pillar).toMatch(/^[A-Z]$/)
      }
    })

    it('agrees with the label, so the letter is guessable', () => {
      for (const pillar of PILLARS) {
        const definition = PILLAR_DEFINITIONS[pillar]
        expect(definition.initial, pillar).toBe(definition.label[0])
      }
    })

    it('keeps all five distinct', () => {
      // The reason this is written data rather than label[0]: two pillars
      // sharing a first letter would silently label two bars the same, and a
      // derivation would have no way to complain. Renaming a pillar to one that
      // collides fails here instead.
      const initials = PILLARS.map((pillar) => PILLAR_DEFINITIONS[pillar].initial)
      expect(new Set(initials).size).toBe(PILLARS.length)
    })
  })

  it('anchors 1, 3 and 5 only', () => {
    // Two and four are deliberately unwritten: they read as "between these
    // two", which is how a five-point scale with three written anchors works.
    // Asserted so a later edit that adds a fourth anchor has to change this
    // line and think about it.
    expect(ANCHOR_VALUES).toEqual([1, 3, 5])
  })
})

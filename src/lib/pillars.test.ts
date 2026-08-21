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

  it('anchors 1, 3 and 5 only', () => {
    // Two and four are deliberately unwritten: they read as "between these
    // two", which is how a five-point scale with three written anchors works.
    // Asserted so a later edit that adds a fourth anchor has to change this
    // line and think about it.
    expect(ANCHOR_VALUES).toEqual([1, 3, 5])
  })
})

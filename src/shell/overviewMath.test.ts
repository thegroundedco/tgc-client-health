import { describe, expect, it } from 'vitest'
import { flagged } from './overviewMath'

// The owner, 2026-09-11, describing this screen to his boss: "I imagine you'll
// want to see anything that's flagged like the clients that are taking up 20%
// at least 20% of revenue as far as concentration goes, and then clients who
// are flagged as at risk in the scores. I just don't want you to have to go
// through and sort all this if you aren't wanting to."

const EXPOSED = [
  { clientId: 1, name: 'Acme', share: 0.31 },
  { clientId: 2, name: 'Beta', share: 0.24 },
  { clientId: 3, name: 'Gamma', share: 0.05 },
]

describe('flagged', () => {
  it('raises a client over a fifth of the revenue', () => {
    const list = flagged({ shares: EXPOSED, bands: new Map() })

    expect(list.map((entry) => entry.name)).toEqual(['Acme', 'Beta'])
    expect(list[0].flags).toEqual([{ kind: 'exposure', share: 0.31 }])
  })

  it('raises a client whose score puts them at risk', () => {
    const list = flagged({
      shares: [],
      bands: new Map([[9, { name: 'Delta', band: 'at_risk' as const, score: 1.8 }]]),
    })

    expect(list[0].flags).toEqual([{ kind: 'at_risk', score: 1.8 }])
  })

  // "Watch" is the band that says keep an eye out; this screen is for what
  // needs acting on. Raising both would make the list the whole roster on any
  // month with a few soft scores.
  it('does not raise a client merely on watch', () => {
    const list = flagged({
      shares: [],
      bands: new Map([[9, { name: 'Delta', band: 'watch' as const, score: 3.0 }]]),
    })

    expect(list).toEqual([])
  })

  it('does not raise a client whose check-in is incomplete', () => {
    // No score is not a bad score. A false "at risk" is as harmful as a false
    // "healthy" -- the rule the board already follows.
    const list = flagged({
      shares: [],
      bands: new Map([[9, { name: 'Delta', band: 'incomplete' as const, score: null }]]),
    })

    expect(list).toEqual([])
  })

  it('gives one client BOTH reasons rather than listing them twice', () => {
    const list = flagged({
      shares: EXPOSED,
      bands: new Map([[1, { name: 'Acme', band: 'at_risk' as const, score: 1.4 }]]),
    })

    expect(list).toHaveLength(2)
    expect(list[0].name).toBe('Acme')
    expect(list[0].flags).toHaveLength(2)
  })

  // Worst first: a client who is both a big share AND scoring badly is the one
  // to look at, and a list that buried it under an alphabetical sort would
  // make the reader do the sorting this screen exists to save them.
  it('puts the client with most reasons first', () => {
    const list = flagged({
      shares: EXPOSED,
      bands: new Map([[2, { name: 'Beta', band: 'at_risk' as const, score: 1.2 }]]),
    })

    expect(list[0].name).toBe('Beta')
  })

  it('orders equal clients by the larger exposure', () => {
    const list = flagged({ shares: EXPOSED, bands: new Map() })

    expect(list.map((entry) => entry.name)).toEqual(['Acme', 'Beta'])
  })

  it('is empty when nothing needs attention', () => {
    const list = flagged({
      shares: [{ clientId: 3, name: 'Gamma', share: 0.05 }],
      bands: new Map([[3, { name: 'Gamma', band: 'healthy' as const, score: 4.5 }]]),
    })

    expect(list).toEqual([])
  })

  it('ignores a share it cannot compute', () => {
    // share() is null when the whole is zero -- every client billed nothing.
    // A flag there would be an alarm about no revenue at all.
    const list = flagged({
      shares: [{ clientId: 1, name: 'Acme', share: null }],
      bands: new Map(),
    })

    expect(list).toEqual([])
  })
})

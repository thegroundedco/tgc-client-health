import { describe, expect, it } from 'vitest'
import {
  PACKAGE_CODES,
  currentStint,
  journeyOf,
  packageLabel,
  sortStints,
  stintProblems,
} from './clientPackages'
import type { PackageStint } from './clientPackages'

function stint(started_on: string, package_code = 'foundation'): PackageStint {
  return { id: 1, client_id: 1, package_code, started_on, note: null }
}

describe('the package vocabulary', () => {
  // The three named on the 2026-09-11 call, in the order a client climbs them.
  // Unlike the client-type list, these were actually spoken -- "I would love to
  // see them graduate from foundation into grow", and scale ranked above both.
  it('is the three tiers, in ladder order', () => {
    expect(PACKAGE_CODES).toEqual(['foundation', 'grow', 'scale'])
  })

  it('labels each one the way a person would say it', () => {
    expect(packageLabel('foundation')).toBe('Foundation')
    expect(packageLabel('grow')).toBe('Grow')
    expect(packageLabel('scale')).toBe('Scale')
  })

  it('hands an unrecognised code straight back', () => {
    // A value this screen does not know was written outside it, and
    // relabelling it into one of the three would hide that.
    expect(packageLabel('enterprise')).toBe('enterprise')
  })

  it('says so when a client has never been put on one', () => {
    expect(packageLabel(null)).toBe('No package recorded')
  })
})

describe('currentStint', () => {
  it('is the latest by start date, not the last one entered', () => {
    // Rows arrive in whatever order the database gives them, and somebody
    // correcting history will enter an older stint after a newer one.
    const current = currentStint([
      stint('2026-06-01', 'grow'),
      stint('2026-01-01', 'foundation'),
    ])

    expect(current?.package_code).toBe('grow')
  })

  it('is null for a client with no history', () => {
    // Not "foundation". Nobody has said, and defaulting to the first rung
    // would invent a journey for every client on the roster.
    expect(currentStint([])).toBeNull()
  })

  it('ignores a stint that has not started yet', () => {
    // A move recorded ahead of time is a plan, not the current state.
    const current = currentStint(
      [stint('2026-01-01', 'foundation'), stint('2026-12-01', 'scale')],
      '2026-09-30',
    )

    expect(current?.package_code).toBe('foundation')
  })
})

describe('sortStints', () => {
  it('reads oldest first, because a journey is read forwards', () => {
    const sorted = sortStints([stint('2026-06-01', 'grow'), stint('2026-01-01', 'foundation')])

    expect(sorted.map((s) => s.package_code)).toEqual(['foundation', 'grow'])
  })
})

describe('journeyOf', () => {
  // What the boss actually asked: did they climb, or did they start at the top
  // and stay there? "What's the correlation of someone who signed with us on
  // foundation and then graduates to grow? Do they stay with us longer... than
  // a brand who skips foundation and jumps straight into grow."
  it('calls a client who moved up a climber', () => {
    expect(
      journeyOf([stint('2026-01-01', 'foundation'), stint('2026-06-01', 'grow')]),
    ).toBe('climbed')
  })

  it('calls two rungs up a climb as well', () => {
    expect(
      journeyOf([stint('2026-01-01', 'foundation'), stint('2026-06-01', 'scale')]),
    ).toBe('climbed')
  })

  it('calls a client who never moved a stayer', () => {
    expect(journeyOf([stint('2026-01-01', 'grow')])).toBe('stayed')
  })

  it('calls a client who moved DOWN a descent, not a climb', () => {
    // It happens, and folding it into "stayed" would let a downgrade count as
    // evidence for the ladder working.
    expect(
      journeyOf([stint('2026-01-01', 'scale'), stint('2026-06-01', 'foundation')]),
    ).toBe('descended')
  })

  it('judges by the HIGHEST rung reached, not the last one', () => {
    // Foundation to Scale and back to FOUNDATION is still a client who climbed.
    // The question is whether the ladder works, not where they sit today.
    //
    // The return has to reach the bottom rung for this to bite: an earlier
    // version ended on Grow, where the last rung is still above the first, so
    // judging by the last rung gave the same answer and the test could not
    // fail. Caught by mutation, not by reading.
    expect(
      journeyOf([
        stint('2026-01-01', 'foundation'),
        stint('2026-04-01', 'scale'),
        stint('2026-08-01', 'foundation'),
      ]),
    ).toBe('climbed')
  })

  it('is null for a client with no recorded packages', () => {
    expect(journeyOf([])).toBeNull()
  })

  it('is null when a rung is not one it recognises', () => {
    // An unknown tier has no position on the ladder, so no movement can be
    // judged. Guessing would put a client in a group they may not belong to.
    expect(journeyOf([stint('2026-01-01', 'enterprise')])).toBeNull()
  })
})

describe('stintProblems', () => {
  it('wants a package and a date', () => {
    expect(stintProblems({ packageCode: '', startedOn: '2026-01-01', note: '' }, [])).toContainEqual({
      field: 'packageCode',
      text: 'Choose a package.',
    })
    expect(stintProblems({ packageCode: 'grow', startedOn: '', note: '' }, [])).toContainEqual({
      field: 'startedOn',
      text: 'Give the date they moved.',
    })
  })

  // The unique constraint would refuse it anyway, and a form that lets the
  // database say no is a form that loses what the person typed.
  it('refuses a second stint on a date already recorded', () => {
    const problems = stintProblems({ packageCode: 'grow', startedOn: '2026-01-01', note: '' }, [
      stint('2026-01-01', 'foundation'),
    ])

    expect(problems.map((p) => p.field)).toContain('startedOn')
  })

  it('refuses a move to the package they are already on', () => {
    // Not an error the database would catch, and it produces a journey with a
    // step that goes nowhere.
    const problems = stintProblems({ packageCode: 'grow', startedOn: '2026-06-01', note: '' }, [
      stint('2026-01-01', 'grow'),
    ])

    expect(problems.map((p) => p.text).join(' ')).toMatch(/already on Grow/i)
  })

  it('allows a move back to a package they were on before', () => {
    // Foundation, Grow, back to Foundation is a real thing that happens, and
    // only the CURRENT package makes a move redundant.
    expect(
      stintProblems({ packageCode: 'foundation', startedOn: '2026-09-01', note: '' }, [
        stint('2026-01-01', 'foundation'),
        stint('2026-06-01', 'grow'),
      ]),
    ).toEqual([])
  })

  it('is happy with a first stint', () => {
    expect(stintProblems({ packageCode: 'foundation', startedOn: '2026-01-01', note: '' }, [])).toEqual([])
  })
})

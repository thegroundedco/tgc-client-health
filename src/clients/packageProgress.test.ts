import { describe, expect, it } from 'vitest'
import { MIN_GROUP, entryRung, ladderStanding, movements, onRampComparison } from './packageProgress'
import type { PackageStint } from './clientPackages'

let nextId = 1
function stint(client_id: number, package_code: string, started_on: string): PackageStint {
  return { id: nextId++, client_id, package_code, started_on, note: null }
}

function client(id: number, name: string, over: Partial<{ status: string; started_on: string | null; ended_on: string | null }> = {}) {
  return {
    id,
    name,
    status: 'active',
    started_on: '2025-01-01',
    ended_on: null,
    ...over,
  }
}

function byClient(...stints: PackageStint[]) {
  const map = new Map<number, PackageStint[]>()
  for (const entry of stints) {
    const found = map.get(entry.client_id) ?? []
    found.push(entry)
    map.set(entry.client_id, found)
  }
  return map
}

const TODAY = '2026-09-24'

describe('entryRung', () => {
  it('is the earliest stint by date, not the first row handed over', () => {
    // Reversed on purpose: rows arrive in whatever order the database gives
    // them, and somebody correcting history enters an older stint last.
    const stints = [stint(1, 'grow', '2026-03-01'), stint(1, 'foundation', '2025-06-01')]

    expect(entryRung(stints)).toBe('foundation')
  })

  it('is null when nothing is recorded', () => {
    expect(entryRung([])).toBeNull()
  })

  it('returns a rung this vocabulary does not know, rather than null', () => {
    // Unlike journeyOf, which cannot place an unknown rung on the ladder. A
    // client who entered on one still entered somewhere, and the only question
    // asked of this value is whether it IS foundation.
    expect(entryRung([stint(1, 'platinum', '2025-06-01')])).toBe('platinum')
  })
})

describe('ladderStanding', () => {
  it('counts active clients on each rung, in ladder order', () => {
    const clients = [client(1, 'Acme'), client(2, 'Beta'), client(3, 'Gamma')]
    const map = byClient(
      stint(1, 'foundation', '2025-01-01'),
      stint(2, 'grow', '2025-01-01'),
      stint(3, 'grow', '2025-01-01'),
    )

    expect(ladderStanding(clients, map, TODAY).rungs).toEqual([
      { code: 'foundation', count: 1 },
      { code: 'grow', count: 2 },
    ])
  })

  it('counts a paused client, who is still a client', () => {
    const clients = [client(1, 'Acme', { status: 'paused' })]
    const map = byClient(stint(1, 'grow', '2025-01-01'))

    expect(ladderStanding(clients, map, TODAY).rungs).toContainEqual({ code: 'grow', count: 1 })
  })

  it('does not count a client who has left', () => {
    const clients = [client(1, 'Acme', { status: 'former', ended_on: '2026-02-01' })]
    const map = byClient(stint(1, 'grow', '2025-01-01'))

    expect(ladderStanding(clients, map, TODAY).rungs).toContainEqual({ code: 'grow', count: 0 })
    expect(ladderStanding(clients, map, TODAY).unrecorded).toBe(0)
  })

  it('counts a client with no package recorded, rather than dropping them', () => {
    const clients = [client(1, 'Acme'), client(2, 'Beta')]
    const map = byClient(stint(1, 'foundation', '2025-01-01'))

    const standing = ladderStanding(clients, map, TODAY)

    expect(standing.unrecorded).toBe(1)
    expect(standing.rungs).toContainEqual({ code: 'foundation', count: 1 })
  })

  it('does not read an unrecorded client as Foundation', () => {
    const standing = ladderStanding([client(1, 'Acme')], new Map(), TODAY)

    expect(standing.rungs).toContainEqual({ code: 'foundation', count: 0 })
    expect(standing.unrecorded).toBe(1)
  })

  it('reads a stint dated in the future as a plan, not the present', () => {
    const clients = [client(1, 'Acme')]
    const map = byClient(stint(1, 'foundation', '2025-01-01'), stint(1, 'grow', '2027-01-01'))

    expect(ladderStanding(clients, map, TODAY).rungs).toContainEqual({
      code: 'foundation',
      count: 1,
    })
  })

  it('counts a rung this vocabulary does not know as its own entry, after the two it does', () => {
    // Somebody IS on it -- silently dropping this client, or folding them into
    // unrecorded, would both be wrong in ways every other test here is blind to.
    const clients = [client(1, 'Acme')]
    const map = byClient(stint(1, 'platinum', '2025-01-01'))

    const standing = ladderStanding(clients, map, TODAY)

    expect(standing.rungs).toEqual([
      { code: 'foundation', count: 0 },
      { code: 'grow', count: 0 },
      { code: 'platinum', count: 1 },
    ])
    expect(standing.unrecorded).toBe(0)
  })
})

describe('movements', () => {
  it('names a climb from where they entered to the highest rung reached', () => {
    const clients = [client(1, 'Acme')]
    const map = byClient(stint(1, 'foundation', '2025-01-01'), stint(1, 'grow', '2026-01-01'))

    expect(movements(clients, map, TODAY).climbed).toEqual([
      { clientId: 1, name: 'Acme', from: 'foundation', to: 'grow', now: null },
    ])
  })

  it('names where a client is now when they have come back down', () => {
    const clients = [client(1, 'Acme')]
    const map = byClient(
      stint(1, 'foundation', '2025-01-01'),
      stint(1, 'grow', '2025-06-01'),
      stint(1, 'foundation', '2026-01-01'),
    )

    expect(movements(clients, map, TODAY).climbed).toEqual([
      { clientId: 1, name: 'Acme', from: 'foundation', to: 'grow', now: 'foundation' },
    ])
  })

  it('separates a descent from a climb', () => {
    const clients = [client(1, 'Acme'), client(2, 'Beta')]
    const map = byClient(
      stint(1, 'foundation', '2025-01-01'),
      stint(1, 'grow', '2026-01-01'),
      stint(2, 'grow', '2025-01-01'),
      stint(2, 'foundation', '2026-01-01'),
    )

    const moved = movements(clients, map, TODAY)

    expect(moved.climbed.map((move) => move.name)).toEqual(['Acme'])
    expect(moved.descended).toEqual([
      { clientId: 2, name: 'Beta', from: 'grow', to: 'foundation', now: null },
    ])
  })

  it('leaves out a client who has stayed put', () => {
    const clients = [client(1, 'Acme')]
    const map = byClient(stint(1, 'grow', '2025-01-01'))

    expect(movements(clients, map, TODAY)).toEqual({ climbed: [], descended: [] })
  })

  it('includes a client who climbed and then left', () => {
    // A completed relationship still climbed. Dropping them would quietly make
    // these lists a story about the current roster instead.
    const clients = [client(1, 'Acme', { status: 'former', ended_on: '2026-06-01' })]
    const map = byClient(stint(1, 'foundation', '2025-01-01'), stint(1, 'grow', '2025-09-01'))

    expect(movements(clients, map, TODAY).climbed.map((move) => move.name)).toEqual(['Acme'])
  })

  it('puts the most recent move first', () => {
    const clients = [client(1, 'Acme'), client(2, 'Beta')]
    const map = byClient(
      stint(1, 'foundation', '2025-01-01'),
      stint(1, 'grow', '2025-03-01'),
      stint(2, 'foundation', '2025-01-01'),
      stint(2, 'grow', '2026-08-01'),
    )

    expect(movements(clients, map, TODAY).climbed.map((move) => move.name)).toEqual([
      'Beta',
      'Acme',
    ])
  })

  // The mirror of ladderStanding's "reads a stint dated in the future as a
  // plan, not the present". Without asOf filtering membership, this client's
  // planned scale move would be read as an accomplished climb -- and, because
  // it is dated in the future, sorted to the very top of "Moved up".
  it('reads a stint dated in the future as a plan, not an accomplished move', () => {
    const clients = [client(1, 'Acme')]
    const map = byClient(stint(1, 'foundation', '2025-01-01'), stint(1, 'grow', '2027-01-01'))

    expect(movements(clients, map, TODAY)).toEqual({ climbed: [], descended: [] })
  })
})

// A departed client with a start date, an end date and a recorded entry rung.
function departed(
  id: number,
  name: string,
  rung: string,
  started_on: string,
  ended_on: string,
) {
  return {
    client: client(id, name, { status: 'former', started_on, ended_on }),
    stint: stint(id, rung, started_on),
  }
}

function comparisonOf(entries: ReturnType<typeof departed>[], extra: PackageStint[] = []) {
  return onRampComparison(
    entries.map((entry) => entry.client),
    byClient(...entries.map((entry) => entry.stint), ...extra),
  )
}

describe('onRampComparison', () => {
  it('waits until there are enough ended relationships on both sides', () => {
    const result = comparisonOf([
      departed(1, 'Acme', 'foundation', '2025-01-01', '2025-07-01'),
      departed(2, 'Beta', 'grow', '2025-01-01', '2025-04-01'),
    ])

    expect(result).toEqual({ kind: 'waiting', foundation: 1, above: 1 })
  })

  it('says Foundation stayed longer when they did', () => {
    const result = comparisonOf([
      departed(1, 'Acme', 'foundation', '2025-01-01', '2026-01-01'),
      departed(2, 'Beta', 'foundation', '2025-01-01', '2026-01-01'),
      departed(3, 'Gamma', 'foundation', '2025-01-01', '2026-01-01'),
      departed(4, 'Delta', 'grow', '2025-01-01', '2025-03-01'),
      departed(5, 'Epsilon', 'grow', '2025-01-01', '2025-03-01'),
      departed(6, 'Zeta', 'grow', '2025-01-01', '2025-03-01'),
    ])

    expect(result.kind).toBe('ready')
    if (result.kind !== 'ready') return
    expect(result.longer).toBe('foundation')
    expect(result.foundation.measured).toBe(3)
    expect(result.above.measured).toBe(3)
  })

  // THE TEST THIS SLICE MOST NEEDS. A verdict hard-coded to 'foundation' would
  // pass every other case in this file.
  it('says the other side stayed longer when THEY did', () => {
    const result = comparisonOf([
      departed(1, 'Acme', 'foundation', '2025-01-01', '2025-03-01'),
      departed(2, 'Beta', 'foundation', '2025-01-01', '2025-03-01'),
      departed(3, 'Gamma', 'foundation', '2025-01-01', '2025-03-01'),
      departed(4, 'Delta', 'grow', '2025-01-01', '2026-01-01'),
      departed(5, 'Epsilon', 'grow', '2025-01-01', '2026-01-01'),
      departed(6, 'Zeta', 'grow', '2025-01-01', '2026-01-01'),
    ])

    expect(result.kind).toBe('ready')
    if (result.kind !== 'ready') return
    expect(result.longer).toBe('above')
    expect(result.above.medianDays).toBeGreaterThan(result.foundation.medianDays)
  })

  it('calls an exact draw a tie', () => {
    const result = comparisonOf([
      departed(1, 'Acme', 'foundation', '2025-01-01', '2025-07-01'),
      departed(2, 'Beta', 'foundation', '2025-01-01', '2025-07-01'),
      departed(3, 'Gamma', 'foundation', '2025-01-01', '2025-07-01'),
      departed(4, 'Delta', 'grow', '2025-01-01', '2025-07-01'),
      departed(5, 'Epsilon', 'grow', '2025-01-01', '2025-07-01'),
      departed(6, 'Zeta', 'grow', '2025-01-01', '2025-07-01'),
    ])

    expect(result.kind).toBe('ready')
    if (result.kind !== 'ready') return
    expect(result.longer).toBe('tie')
  })

  it('leaves out clients who are still here', () => {
    // Three ended Foundation clients and three ACTIVE ones above. The active
    // side cannot reach MIN_GROUP, so the answer is still waiting.
    const ended = [
      departed(1, 'Acme', 'foundation', '2025-01-01', '2026-01-01'),
      departed(2, 'Beta', 'foundation', '2025-01-01', '2026-01-01'),
      departed(3, 'Gamma', 'foundation', '2025-01-01', '2026-01-01'),
    ]
    const active = [client(4, 'Delta'), client(5, 'Epsilon'), client(6, 'Zeta')]

    const result = onRampComparison(
      [...ended.map((entry) => entry.client), ...active],
      byClient(
        ...ended.map((entry) => entry.stint),
        stint(4, 'grow', '2025-01-01'),
        stint(5, 'grow', '2025-01-01'),
        stint(6, 'grow', '2025-01-01'),
      ),
    )

    expect(result).toEqual({ kind: 'waiting', foundation: 3, above: 0 })
  })

  it('leaves out a departed client with no package recorded', () => {
    const ended = [
      departed(1, 'Acme', 'foundation', '2025-01-01', '2026-01-01'),
      departed(2, 'Beta', 'foundation', '2025-01-01', '2026-01-01'),
      departed(3, 'Gamma', 'foundation', '2025-01-01', '2026-01-01'),
    ]
    const unrecorded = client(9, 'Omega', { status: 'former', ended_on: '2026-01-01' })

    const result = onRampComparison(
      [...ended.map((entry) => entry.client), unrecorded],
      byClient(...ended.map((entry) => entry.stint)),
    )

    // Omega is not silently read as "joined above Foundation".
    expect(result).toEqual({ kind: 'waiting', foundation: 3, above: 0 })
  })

  it('counts a departed client with no start date, and does not measure them', () => {
    const entries = [
      departed(1, 'Acme', 'foundation', '2025-01-01', '2026-01-01'),
      departed(2, 'Beta', 'foundation', '2025-01-01', '2026-01-01'),
      departed(3, 'Gamma', 'foundation', '2025-01-01', '2026-01-01'),
      departed(4, 'Delta', 'grow', '2025-01-01', '2025-04-01'),
      departed(5, 'Epsilon', 'grow', '2025-01-01', '2025-04-01'),
      departed(6, 'Zeta', 'grow', '2025-01-01', '2025-04-01'),
    ]
    const nostart = {
      client: { ...client(7, 'Eta', { status: 'former', ended_on: '2026-01-01' }), started_on: null },
      stint: stint(7, 'grow', '2025-01-01'),
    }

    const result = onRampComparison(
      [...entries.map((entry) => entry.client), nostart.client],
      byClient(...entries.map((entry) => entry.stint), nostart.stint),
    )

    expect(result.kind).toBe('ready')
    if (result.kind !== 'ready') return
    // In the count, out of the median: an unknown treated as a zero would drag
    // the median down, and dropping them from the count answers a different
    // question from the one the sentence appears to answer.
    expect(result.above.count).toBe(4)
    expect(result.above.measured).toBe(3)
  })

  it('gates on a group measured count, not its total count', () => {
    // Foundation's COUNT clears MIN_GROUP (Acme, Beta, Gamma: three departed
    // clients) but its MEASURED count does not (Gamma has no start date, so
    // only two of the three can go into a median). A gate that reads `count`
    // would print a Foundation median built from two relationships while
    // still claiming three were measured.
    const entries = [
      departed(1, 'Acme', 'foundation', '2025-01-01', '2026-01-01'),
      departed(2, 'Beta', 'foundation', '2025-01-01', '2026-01-01'),
      departed(4, 'Delta', 'grow', '2025-01-01', '2025-04-01'),
      departed(5, 'Epsilon', 'grow', '2025-01-01', '2025-04-01'),
      departed(6, 'Zeta', 'grow', '2025-01-01', '2025-04-01'),
    ]
    const nostart = {
      client: {
        ...client(3, 'Gamma', { status: 'former', ended_on: '2026-01-01' }),
        started_on: null,
      },
      stint: stint(3, 'foundation', '2025-01-01'),
    }

    const result = onRampComparison(
      [...entries.map((entry) => entry.client), nostart.client],
      byClient(...entries.map((entry) => entry.stint), nostart.stint),
    )

    expect(result).toEqual({ kind: 'waiting', foundation: 2, above: 3 })
  })

  it('groups an unrecognised entry rung above Foundation', () => {
    const result = comparisonOf([
      departed(1, 'Acme', 'foundation', '2025-01-01', '2026-01-01'),
      departed(2, 'Beta', 'foundation', '2025-01-01', '2026-01-01'),
      departed(3, 'Gamma', 'foundation', '2025-01-01', '2026-01-01'),
      departed(4, 'Delta', 'platinum', '2025-01-01', '2025-04-01'),
      departed(5, 'Epsilon', 'grow', '2025-01-01', '2025-04-01'),
      departed(6, 'Zeta', 'grow', '2025-01-01', '2025-04-01'),
    ])

    expect(result.kind).toBe('ready')
    if (result.kind !== 'ready') return
    expect(result.above.measured).toBe(3)
  })

  it('uses the rung they ENTERED on, not the one they left on', () => {
    // Three clients who entered at Foundation and climbed out of it before
    // leaving. Grouping by the latest rung would put all three in `above` and
    // leave Foundation empty.
    const result = comparisonOf(
      [
        departed(1, 'Acme', 'foundation', '2025-01-01', '2026-01-01'),
        departed(2, 'Beta', 'foundation', '2025-01-01', '2026-01-01'),
        departed(3, 'Gamma', 'foundation', '2025-01-01', '2026-01-01'),
        departed(4, 'Delta', 'grow', '2025-01-01', '2025-04-01'),
        departed(5, 'Epsilon', 'grow', '2025-01-01', '2025-04-01'),
        departed(6, 'Zeta', 'grow', '2025-01-01', '2025-04-01'),
      ],
      [stint(1, 'grow', '2025-06-01'), stint(2, 'grow', '2025-06-01'), stint(3, 'grow', '2025-06-01')],
    )

    expect(result.kind).toBe('ready')
    if (result.kind !== 'ready') return
    expect(result.foundation.measured).toBe(3)
    expect(result.above.measured).toBe(3)
  })

  it('names the threshold once, where the rule and the sentence both read it', () => {
    expect(MIN_GROUP).toBe(3)
  })
})

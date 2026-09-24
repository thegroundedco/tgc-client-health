import { describe, expect, it } from 'vitest'
import { entryRung, ladderStanding, movements } from './packageProgress'
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
      { code: 'scale', count: 0 },
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
    const map = byClient(stint(1, 'foundation', '2025-01-01'), stint(1, 'scale', '2027-01-01'))

    expect(ladderStanding(clients, map, TODAY).rungs).toContainEqual({
      code: 'foundation',
      count: 1,
    })
  })

  it('counts a rung this vocabulary does not know as its own entry, after the three it does', () => {
    // Somebody IS on it -- silently dropping this client, or folding them into
    // unrecorded, would both be wrong in ways every other test here is blind to.
    const clients = [client(1, 'Acme')]
    const map = byClient(stint(1, 'platinum', '2025-01-01'))

    const standing = ladderStanding(clients, map, TODAY)

    expect(standing.rungs).toEqual([
      { code: 'foundation', count: 0 },
      { code: 'grow', count: 0 },
      { code: 'scale', count: 0 },
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
      stint(1, 'scale', '2025-06-01'),
      stint(1, 'grow', '2026-01-01'),
    )

    expect(movements(clients, map, TODAY).climbed).toEqual([
      { clientId: 1, name: 'Acme', from: 'foundation', to: 'scale', now: 'grow' },
    ])
  })

  it('separates a descent from a climb', () => {
    const clients = [client(1, 'Acme'), client(2, 'Beta')]
    const map = byClient(
      stint(1, 'foundation', '2025-01-01'),
      stint(1, 'grow', '2026-01-01'),
      stint(2, 'scale', '2025-01-01'),
      stint(2, 'grow', '2026-01-01'),
    )

    const moved = movements(clients, map, TODAY)

    expect(moved.climbed.map((move) => move.name)).toEqual(['Acme'])
    expect(moved.descended).toEqual([
      { clientId: 2, name: 'Beta', from: 'scale', to: 'grow', now: null },
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
})

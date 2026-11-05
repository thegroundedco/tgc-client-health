// @vitest-environment jsdom

import { renderHook, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

// A fake of the Supabase chained builder, and the chain is part of what is
// asserted: the board's client query must NOT carry .eq('status', …) any more,
// and a fake that ignored its arguments could not tell. Same technique, and the
// same reason, as src/clients/useClients.dom.test.ts -- the hook test written in
// step 4 because a screen test that mocks the hook away cannot see inside it.
type Result = { data: unknown; error: unknown }

const db = vi.hoisted(() => ({
  // Every filter the client query applied, in order. The point of the file.
  clientFilters: [] as [string, unknown][],
  // The column list the client query passed to .select().
  clientSelect: undefined as string | undefined,
  clients: async (): Promise<Result> => ({ data: [], error: null }),
  // Both take the `.eq('period', …)` value, ignored by every test except the
  // stale-response one below, which needs it to tell an old run's request
  // apart from a new one that arrives while the old one is still in flight --
  // call order alone cannot do that, because the old run may still be
  // awaiting an earlier query when the new run starts making the same call.
  checkins: async (_period?: string): Promise<Result> => ({ data: [], error: null }),
  scores: async (_period?: string): Promise<Result> => ({ data: [], error: null }),
  // Brief 2026-11-04 B: last month's bucket scores and overall, for the
  // card's arrows. Told apart from this month's reads by their column list,
  // and each records the period it was asked for.
  lastCheckins: async (_period?: string): Promise<Result> => ({ data: [], error: null }),
  lastScores: async (_period?: string): Promise<Result> => ({ data: [], error: null }),
  // Every [table, columns, period] the checkins and checkin_scores reads made.
  reads: [] as [string, string | undefined, unknown][],
}))

vi.mock('../lib/supabase', () => ({
  supabase: {
    from: (table: string) => {
      if (table === 'clients') {
        return {
          select: (columns?: string) => {
            db.clientSelect = columns
            const chain = {
              eq: (column: string, value: unknown) => {
                db.clientFilters.push([column, value])
                return chain
              },
              order: () => db.clients(),
            }
            return chain
          },
        }
      }
      if (table === 'checkins' || table === 'checkin_scores') {
        return {
          select: (columns?: string) => ({
            eq: (_column: string, value: unknown) => {
              db.reads.push([table, columns, value])
              const last = columns === (table === 'checkins' ? LAST_CHECKIN_COLUMNS : LAST_SCORE_COLUMNS)
              if (table === 'checkins') return last ? db.lastCheckins(value as string) : db.checkins(value as string)
              return last ? db.lastScores(value as string) : db.scores(value as string)
            },
          }),
        }
      }
      // Unmocked table: throw rather than silently fall through to some other
      // table's double. Before this branch existed, anything that was not
      // 'clients' resolved to the checkins double -- a mistyped table name in
      // useBoard.ts would have returned an empty success and the board would
      // have rendered with no error and no scores, indistinguishable from a
      // client with nothing to show.
      throw new Error(`useBoard.dom.test.ts's fake Supabase does not know table '${table}'`)
    },
  },
}))

import { LAST_CHECKIN_COLUMNS, LAST_SCORE_COLUMNS, useBoard } from './useBoard'

const ROSTER = [
  { id: 1, name: 'Zinc', status: 'active', ended_on: null },
  { id: 2, name: 'Acme', status: 'active', ended_on: null },
  { id: 3, name: 'Bellwether', status: 'paused', ended_on: null },
  // clients_lifecycle_coherent makes a former client without an end date impossible in the database.
  { id: 4, name: 'Test Client', status: 'former', ended_on: '2026-03-31' },
]

beforeEach(() => {
  db.clientFilters = []
  db.clientSelect = undefined
  db.clients = async () => ({ data: ROSTER, error: null })
  db.checkins = async () => ({ data: [], error: null })
  db.scores = async () => ({ data: [], error: null })
  db.lastCheckins = async () => ({ data: [], error: null })
  db.lastScores = async () => ({ data: [], error: null })
  db.reads = []
})

// An arrow, not a bare reference: useBoard takes the period argument, and
// there is no zero-argument form to pass by reference the way
// src/clients/useClients.dom.test.ts does for the argument-free useClients.
// react/rules-of-hooks -- which this repo runs as an error -- does not object
// to a hook call inside an arrow; it is calling a hook conditionally, or
// outside a component or another hook, that trips it, and this arrow does
// neither.
async function ready() {
  const rendered = renderHook(() => useBoard('2026-08-01'))
  await waitFor(() => expect(rendered.result.current.status).toBe('ready'))
  return rendered
}

// A second entry point, for the scores tests below: those fixtures name their
// own clients/checkins/scores instead of relying on ROSTER and the
// beforeEach defaults, and they need to reach 'error' as well as 'ready'.
function renderUseBoard(fixtures: {
  clients?: unknown[]
  checkins?: unknown[]
  scores?: unknown[]
  scoresError?: { message: string }
}) {
  if (fixtures.clients !== undefined) {
    db.clients = async () => ({ data: fixtures.clients, error: null })
  }
  if (fixtures.checkins !== undefined) {
    db.checkins = async () => ({ data: fixtures.checkins, error: null })
  }
  if (fixtures.scoresError !== undefined) {
    db.scores = async () => ({ data: null, error: fixtures.scoresError })
  } else if (fixtures.scores !== undefined) {
    db.scores = async () => ({ data: fixtures.scores, error: null })
  }
  return renderHook(() => useBoard('2026-08-01'))
}

describe('the board hook', () => {
  it('does not filter the client query by status any more', () => {
    // The whole point of this step. A .eq('status', 'active') here would make
    // the toggle structurally unable to show anything, and no screen test could
    // see it because they all mock this hook.
    return ready().then(() => {
      expect(db.clientFilters.map(([column]) => column)).not.toContain('status')
    })
  })

  it('hands back every client, whatever its status', async () => {
    const { result } = await ready()
    expect(result.current.clients.map((client) => client.name).sort()).toEqual([
      'Acme',
      'Bellwether',
      'Test Client',
      'Zinc',
    ])
  })

  it('counts only the active clients as the check-in denominator', async () => {
    // The sharpest requirement in this step. If this number grew to 4, the
    // board would report that four check-ins are owed this month -- two of them
    // for a paused client and a client who has left.
    const { result } = await ready()
    expect(result.current.activeTotal).toBe(2)
  })

  it("counts a former client's submitted check-in for the month as both submitted and owed", async () => {
    // Spec §2 rule 1: a check-in for the month makes the client a member, whatever their status.
    db.checkins = async () => ({
      data: [
        { client_id: 1, total_score: 20, submitted_at: '2026-08-01T00:00:00.000Z', submitted_by: null },
        { client_id: 4, total_score: 15, submitted_at: '2026-08-01T00:00:00.000Z', submitted_by: null },
      ],
      error: null,
    })

    const { result } = await ready()
    expect(result.current.submitted).toBe(2)
    expect(result.current.activeTotal).toBe(3)
  })

  it('counts the members whose check-in is an unreviewed suggestion', async () => {
    db.clients = async () => ({
      data: [
        { id: 1, name: 'A', status: 'active', started_on: '2026-01-01', ended_on: null },
        { id: 2, name: 'B', status: 'active', started_on: '2026-01-01', ended_on: null },
        { id: 3, name: 'C', status: 'active', started_on: '2026-01-01', ended_on: null },
      ],
      error: null,
    })
    db.checkins = async () => ({
      data: [
        { client_id: 1, submitted_at: null, submitted_by: null, suggested_at: '2026-10-29T10:00:00Z' },
        { client_id: 2, submitted_at: null, submitted_by: null, suggested_at: null },
      ],
      error: null,
    })
    const { result } = await ready()
    expect(result.current.activeTotal).toBe(3)
    expect(result.current.toReview).toBe(1)
  })

  it('selects ended_on, because membership needs it', async () => {
    await ready()
    expect(db.clientSelect).toContain('ended_on')
  })

  it('counts a cancelled client in their final month, and not a paused one without a check-in', async () => {
    db.clients = async () => ({
      data: [
        { id: 1, name: 'Active', status: 'active', started_on: '2026-01-01', ended_on: null },
        { id: 2, name: 'Cancelled', status: 'cancelled', started_on: '2026-01-01', ended_on: '2026-09-30' },
        { id: 3, name: 'Paused', status: 'paused', started_on: '2026-01-01', ended_on: null },
        { id: 4, name: 'Later', status: 'active', started_on: '2026-10-07', ended_on: null },
      ],
      error: null,
    })
    db.checkins = async () => ({
      data: [{ client_id: 2, total_score: 20, submitted_at: '2026-09-30T12:00:00Z', submitted_by: null }],
      error: null,
    })
    const { result } = renderHook(() => useBoard('2026-09-01'))
    await waitFor(() => expect(result.current.status).toBe('ready'))
    expect(result.current.activeTotal).toBe(2)
    expect(result.current.submitted).toBe(1)
    expect([...result.current.members].sort()).toEqual([1, 2])
  })

  it('reports a failed client read and writes no clients', async () => {
    // Never write after a failed read, and never let a failure look empty.
    db.clients = async () => ({ data: null, error: { message: 'permission denied for table clients' } })

    const rendered = renderHook(() => useBoard('2026-08-01'))
    await waitFor(() => expect(rendered.result.current.status).toBe('error'))
    expect(rendered.result.current.loadError).toContain('permission denied')
    expect(rendered.result.current.clients).toEqual([])
  })

  it('exposes a score row per client, keyed by client_id', async () => {
    const { result } = renderUseBoard({
      clients: [{ id: 1, name: 'Acme', status: 'active', started_on: '2026-01-01', ended_on: null }],
      checkins: [{ client_id: 1, submitted_at: null, submitted_by: null, comm_score: 4 }],
      scores: [{ client_id: 1, overall_score: 3.5, advocacy_applies: true }],
    })
    await waitFor(() => expect(result.current.status).toBe('ready'))
    expect(result.current.scores.get(1)?.overall_score).toBe(3.5)
    expect(result.current.scores.get(1)?.advocacy_applies).toBe(true)
  })

  // A client with no check-in has no score row. The card must cope, and the map
  // must not invent an entry.
  it('has no score entry for a client with no check-in', async () => {
    const { result } = renderUseBoard({
      clients: [{ id: 1, name: 'Acme', status: 'active', started_on: null, ended_on: null }],
      checkins: [],
      scores: [],
    })
    await waitFor(() => expect(result.current.status).toBe('ready'))
    expect(result.current.scores.get(1)).toBe(undefined)
  })

  // The view read failing must fail the board the same way the other two do --
  // not leave a board rendering cards with no scores and no message.
  it('reports an error when the view read fails', async () => {
    const { result } = renderUseBoard({
      clients: [{ id: 1, name: 'Acme', status: 'active', started_on: null, ended_on: null }],
      checkins: [],
      scoresError: { message: 'permission denied for view checkin_scores' },
    })
    await waitFor(() => expect(result.current.status).toBe('error'))
    expect(result.current.loadError).toContain('permission denied for view checkin_scores')
  })

  // The stale-response guard: `period` was hardcoded until Slice 4 step 4, so
  // this branch could never run before now. A deferred promise per call lets
  // the test choose resolution order independently of call order: the OLDER
  // period's requests are started first but settle LAST, after the newer
  // period's full read has already landed. If the effect's cancellation flag
  // did not gate the writes below, the older read would overwrite the newer
  // one with a stale roster and a stale score.
  it('drops a stale response when period changes before the old one resolves', async () => {
    function deferred<T>() {
      let resolve!: (value: T) => void
      const promise = new Promise<T>((r) => {
        resolve = r
      })
      return { promise, resolve }
    }

    const oldClients = deferred<Result>()
    const newClients = deferred<Result>()
    const oldCheckins = deferred<Result>()
    const newCheckins = deferred<Result>()
    const oldScores = deferred<Result>()
    const newScores = deferred<Result>()

    const OLD_PERIOD = '2026-07-01'
    const NEW_PERIOD = '2026-08-01'

    // The clients query carries no period filter (see the comment on
    // BoardClient.started_on and the test above pinning that), so it cannot be
    // told apart by argument -- only by call order, which IS reliable here:
    // the old run's clients call fires on first render, the new run's on
    // rerender, strictly before either resolves.
    let clientCalls = 0
    db.clients = () => (clientCalls++ === 0 ? oldClients.promise : newClients.promise)
    // checkins and scores DO carry the period, so they are told apart by that
    // value rather than by call order -- the old run may still be awaiting
    // its clients response when the new run reaches this same call.
    db.checkins = (period) => (period === OLD_PERIOD ? oldCheckins.promise : newCheckins.promise)
    db.scores = (period) => (period === OLD_PERIOD ? oldScores.promise : newScores.promise)

    const { result, rerender } = renderHook(({ period }: { period: string }) => useBoard(period), {
      initialProps: { period: OLD_PERIOD },
    })

    // The older period's run is in flight (its clients query has fired, and
    // nothing has resolved yet). Switch to the newer period now -- this is
    // the moment the old run's effect cleanup marks its flag cancelled.
    rerender({ period: NEW_PERIOD })

    // Resolve the NEWER period's chain fully, in order.
    newClients.resolve({ data: [{ id: 1, name: 'Acme', status: 'active', started_on: null, ended_on: null }], error: null })
    await Promise.resolve()
    newCheckins.resolve({ data: [], error: null })
    await Promise.resolve()
    newScores.resolve({ data: [{ client_id: 1, overall_score: 4.5, advocacy_applies: true }], error: null })

    await waitFor(() => expect(result.current.status).toBe('ready'))
    expect(result.current.scores.get(1)?.overall_score).toBe(4.5)

    // Only now resolve the OLDER period's chain -- last, and with a different
    // roster and score. A guard that worked would have already marked this
    // run cancelled, so none of this should reach state.
    oldClients.resolve({ data: [{ id: 2, name: 'Zombie', status: 'active', started_on: null, ended_on: null }], error: null })
    await Promise.resolve()
    oldCheckins.resolve({ data: [], error: null })
    await Promise.resolve()
    oldScores.resolve({ data: [{ client_id: 2, overall_score: 1.0, advocacy_applies: false }], error: null })

    // A real macrotask delay, not just a microtask tick: enough for the old
    // run's async function to finish unwinding and, if the guard were gone,
    // for its setState calls to land -- so this proves absence, not merely
    // that we didn't wait long enough to see it.
    await new Promise((resolve) => setTimeout(resolve, 50))

    // The newer month's data must be what survives.
    expect(result.current.clients.map((client) => client.id)).toEqual([1])
    expect(result.current.scores.get(1)?.overall_score).toBe(4.5)
    expect(result.current.scores.get(2)).toBe(undefined)
  })
})

describe('the board hook, last month', () => {
  it('reads the previous period, from both tables, with one extra query each', async () => {
    await ready()
    const last = db.reads.filter(([, , period]) => period === '2026-07-01')
    expect(last).toEqual([
      ['checkins', LAST_CHECKIN_COLUMNS, '2026-07-01'],
      ['checkin_scores', LAST_SCORE_COLUMNS, '2026-07-01'],
    ])
    // And this month's reads are still there, unchanged.
    expect(db.reads.filter(([, , period]) => period === '2026-08-01')).toHaveLength(2)
  })

  it('steps back across a year boundary', async () => {
    const rendered = renderHook(() => useBoard('2026-01-01'))
    await waitFor(() => expect(rendered.result.current.status).toBe('ready'))
    expect(db.reads.filter(([, , period]) => period === '2025-12-01')).toHaveLength(2)
  })

  it('selects the six bucket score columns and the overall, keyed by client', () => {
    expect(LAST_CHECKIN_COLUMNS.split(', ').sort()).toEqual(
      ['adv_score', 'client_id', 'comm_score', 'del_score', 'fin_score', 'growth_score', 'rel_score'],
    )
    expect(LAST_SCORE_COLUMNS).toBe('client_id, overall_score')
  })

  it("hands back last month's bucket scores and overall per client", async () => {
    db.lastCheckins = async () => ({
      data: [
        { client_id: 1, comm_score: 3.33, growth_score: 4, fin_score: null, rel_score: 2, del_score: 5, adv_score: null },
        { client_id: 2, comm_score: 1, growth_score: 1, fin_score: 1, rel_score: 1, del_score: 1, adv_score: 1 },
      ],
      error: null,
    })
    db.lastScores = async () => ({
      data: [
        { client_id: 1, overall_score: 3.5 },
        { client_id: null, overall_score: 2 },
      ],
      error: null,
    })
    const { result } = await ready()
    expect(result.current.lastMonth.get(1)).toEqual({
      comm_score: 3.33,
      growth_score: 4,
      fin_score: null,
      rel_score: 2,
      del_score: 5,
      adv_score: null,
      overall_score: 3.5,
    })
    // A client with last month's check-in but no row in the view has no overall.
    expect(result.current.lastMonth.get(2)?.overall_score).toBeNull()
    expect(result.current.lastMonth.get(2)?.comm_score).toBe(1)
    // No check-in last month: no entry at all.
    expect(result.current.lastMonth.has(3)).toBe(false)
  })

  it("keeps last month's overall for a client whose view row has no check-in row", async () => {
    db.lastScores = async () => ({ data: [{ client_id: 4, overall_score: 2.25 }], error: null })
    const { result } = await ready()
    expect(result.current.lastMonth.get(4)).toEqual({
      comm_score: null,
      growth_score: null,
      fin_score: null,
      rel_score: null,
      del_score: null,
      adv_score: null,
      overall_score: 2.25,
    })
  })

  it("reports a failed read of last month's check-ins, like this month's", async () => {
    db.lastCheckins = async () => ({ data: null, error: { message: 'last month refused' } })
    const { result } = renderHook(() => useBoard('2026-08-01'))
    await waitFor(() => expect(result.current.status).toBe('error'))
    expect(result.current.loadError).toContain('last month refused')
    expect(result.current.clients).toEqual([])
  })

  it("reports a failed read of last month's scores, like this month's", async () => {
    db.lastScores = async () => ({ data: null, error: { message: 'last view refused' } })
    const { result } = renderHook(() => useBoard('2026-08-01'))
    await waitFor(() => expect(result.current.status).toBe('error'))
    expect(result.current.loadError).toContain('last view refused')
    expect(result.current.clients).toEqual([])
  })

  it("stops a cancelled run before it asks for last month's overall", async () => {
    // The period changes while last month's check-ins are in flight: the old
    // run must make no further request, not merely discard what comes back.
    let release!: (value: Result) => void
    const held = new Promise<Result>((resolve) => {
      release = resolve
    })
    db.lastCheckins = (period) => (period === '2026-07-01' ? held : Promise.resolve({ data: [], error: null }))
    const { result, rerender } = renderHook(({ period }: { period: string }) => useBoard(period), {
      initialProps: { period: '2026-08-01' },
    })
    await waitFor(() => expect(db.reads.some(([table, , period]) => table === 'checkins' && period === '2026-07-01')).toBe(true))
    rerender({ period: '2026-10-01' })
    await waitFor(() => expect(result.current.status).toBe('ready'))
    release({ data: [], error: null })
    await new Promise((resolve) => setTimeout(resolve, 50))
    expect(db.reads).not.toContainEqual(['checkin_scores', LAST_SCORE_COLUMNS, '2026-07-01'])
  })
})

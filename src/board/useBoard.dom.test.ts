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
  clients: async (): Promise<Result> => ({ data: [], error: null }),
  // Both take the `.eq('period', …)` value, ignored by every test except the
  // stale-response one below, which needs it to tell an old run's request
  // apart from a new one that arrives while the old one is still in flight --
  // call order alone cannot do that, because the old run may still be
  // awaiting an earlier query when the new run starts making the same call.
  checkins: async (_period?: string): Promise<Result> => ({ data: [], error: null }),
  scores: async (_period?: string): Promise<Result> => ({ data: [], error: null }),
}))

vi.mock('../lib/supabase', () => ({
  supabase: {
    from: (table: string) => {
      if (table === 'clients') {
        return {
          select: () => {
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
      if (table === 'checkins') {
        return { select: () => ({ eq: (_column: string, value: unknown) => db.checkins(value as string) }) }
      }
      if (table === 'checkin_scores') {
        return { select: () => ({ eq: (_column: string, value: unknown) => db.scores(value as string) }) }
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

import { useBoard } from './useBoard'

const ROSTER = [
  { id: 1, name: 'Zinc', status: 'active' },
  { id: 2, name: 'Acme', status: 'active' },
  { id: 3, name: 'Bellwether', status: 'paused' },
  { id: 4, name: 'Test Client', status: 'former' },
]

beforeEach(() => {
  db.clientFilters = []
  db.clients = async () => ({ data: ROSTER, error: null })
  db.checkins = async () => ({ data: [], error: null })
  db.scores = async () => ({ data: [], error: null })
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

  it('counts a submitted check-in for an archived client as neither submitted nor owed', async () => {
    // A former client can hold a check-in from when they were active. It must
    // not inflate either half of the progress line.
    db.checkins = async () => ({
      data: [
        { client_id: 1, total_score: 20, submitted_at: '2026-08-01T00:00:00.000Z', submitted_by: null },
        { client_id: 4, total_score: 15, submitted_at: '2026-08-01T00:00:00.000Z', submitted_by: null },
      ],
      error: null,
    })

    const { result } = await ready()
    expect(result.current.submitted).toBe(1)
    expect(result.current.activeTotal).toBe(2)
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
      clients: [{ id: 1, name: 'Acme', status: 'active', started_on: '2026-01-01' }],
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
      clients: [{ id: 1, name: 'Acme', status: 'active', started_on: null }],
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
      clients: [{ id: 1, name: 'Acme', status: 'active', started_on: null }],
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
    newClients.resolve({ data: [{ id: 1, name: 'Acme', status: 'active', started_on: null }], error: null })
    await Promise.resolve()
    newCheckins.resolve({ data: [], error: null })
    await Promise.resolve()
    newScores.resolve({ data: [{ client_id: 1, overall_score: 4.5, advocacy_applies: true }], error: null })

    await waitFor(() => expect(result.current.status).toBe('ready'))
    expect(result.current.scores.get(1)?.overall_score).toBe(4.5)

    // Only now resolve the OLDER period's chain -- last, and with a different
    // roster and score. A guard that worked would have already marked this
    // run cancelled, so none of this should reach state.
    oldClients.resolve({ data: [{ id: 2, name: 'Zombie', status: 'active', started_on: null }], error: null })
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

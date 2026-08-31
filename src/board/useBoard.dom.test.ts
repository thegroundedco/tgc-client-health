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
  checkins: async (): Promise<Result> => ({ data: [], error: null }),
  scores: async (): Promise<Result> => ({ data: [], error: null }),
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
        return { select: () => ({ eq: () => db.checkins() }) }
      }
      if (table === 'checkin_scores') {
        return { select: () => ({ eq: () => db.scores() }) }
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
})

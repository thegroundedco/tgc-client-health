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
}))

vi.mock('../lib/supabase', () => ({
  supabase: {
    from: (table: string) =>
      table === 'clients'
        ? {
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
        : {
            select: () => ({ eq: () => db.checkins() }),
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
})

// Passed by reference rather than as an arrow holding the hook call: an arrow
// trips react/rules-of-hooks, which this repo runs as an error.
async function ready() {
  const rendered = renderHook(() => useBoard('2026-08-01'))
  await waitFor(() => expect(rendered.result.current.status).toBe('ready'))
  return rendered
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
})

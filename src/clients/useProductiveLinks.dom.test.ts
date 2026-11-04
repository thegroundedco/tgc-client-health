// @vitest-environment jsdom
import { act, renderHook, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

type Result = { data?: unknown; error: unknown }

const db = vi.hoisted(() => ({
  tables: [] as string[],
  filters: [] as [string, unknown][],
  inserts: [] as unknown[],
  deletes: 0,
  read: async (): Promise<Result> => ({ data: [{ productive_project_id: '111' }], error: null }),
  write: async (): Promise<Result> => ({ error: null }),
}))

vi.mock('../lib/supabase', () => ({
  supabase: {
    from: (table: string) => {
      db.tables.push(table)
      const chain = {
        select: () => chain,
        eq: (column: string, value: unknown) => {
          db.filters.push([column, value])
          // A select chain is awaited at .eq; a delete chain continues to a second .eq.
          const p = Promise.resolve().then(() => (db.deletes > 0 ? db.write() : db.read()))
          return Object.assign(p, { eq: chain.eq })
        },
        delete: () => {
          db.deletes += 1
          return chain
        },
        insert: (row: unknown) => {
          db.inserts.push(row)
          return db.write()
        },
      }
      return chain
    },
  },
}))

import { useProductiveLinks } from './useProductiveLinks'

beforeEach(() => {
  db.tables = []
  db.filters = []
  db.inserts = []
  db.deletes = 0
  db.read = async () => ({ data: [{ productive_project_id: '111' }], error: null })
  db.write = async () => ({ error: null })
})

describe('useProductiveLinks', () => {
  it('issues no query without manage_clients', async () => {
    const { result } = renderHook(() => useProductiveLinks(7, false))
    await act(async () => {})
    expect(result.current.status).toBe('off')
    expect(result.current.projectIds).toEqual([])
    expect(db.tables).toEqual([])
  })

  it('reads the linked ids for the client', async () => {
    const { result } = renderHook(() => useProductiveLinks(7, true))
    await waitFor(() => expect(result.current.status).toBe('ready'))
    expect(result.current.projectIds).toEqual(['111'])
    expect(db.tables).toEqual(['client_productive_projects'])
    expect(db.filters).toEqual([['client_id', 7]])
  })

  it('reports a failed read as error', async () => {
    db.read = async () => ({ data: null, error: { message: 'permission denied' } })
    const { result } = renderHook(() => useProductiveLinks(7, true))
    await waitFor(() => expect(result.current.status).toBe('error'))
    expect(result.current.projectIds).toEqual([])
  })

  it.each(['abc', '12a', '1.5', '-3', '', '  ', '12 34', '１２'])('add(%j) is refused with no insert', async (bad) => {
    const { result } = renderHook(() => useProductiveLinks(7, true))
    await waitFor(() => expect(result.current.status).toBe('ready'))
    let message: string | null = null
    await act(async () => {
      message = await result.current.add(bad)
    })
    expect(message).toBe("Productive project IDs are numbers — copy it from the project's URL.")
    expect(db.inserts).toEqual([])
  })

  it('add trims and inserts a numeric id', async () => {
    const { result } = renderHook(() => useProductiveLinks(7, true))
    await waitFor(() => expect(result.current.status).toBe('ready'))
    let message: string | null = 'x'
    await act(async () => {
      message = await result.current.add(' 222 ')
    })
    expect(message).toBeNull()
    expect(db.inserts).toEqual([{ client_id: 7, productive_project_id: '222' }])
    expect(result.current.projectIds).toEqual(['111', '222'])
  })

  it('maps unique violation 23505 to the already-linked message', async () => {
    db.write = async () => ({ error: { code: '23505', message: 'duplicate key value' } })
    const { result } = renderHook(() => useProductiveLinks(7, true))
    await waitFor(() => expect(result.current.status).toBe('ready'))
    let message: string | null = null
    await act(async () => {
      message = await result.current.add('222')
    })
    expect(message).toBe('That project is already linked to another client.')
    expect(result.current.projectIds).toEqual(['111'])
  })

  it('passes another insert failure through, not as already linked', async () => {
    db.write = async () => ({ error: { code: '42501', message: 'permission denied' } })
    const { result } = renderHook(() => useProductiveLinks(7, true))
    await waitFor(() => expect(result.current.status).toBe('ready'))
    let message: string | null = null
    await act(async () => {
      message = await result.current.add('222')
    })
    expect(message).toContain('permission denied')
  })

  it('remove deletes the link and drops it from the list', async () => {
    const { result } = renderHook(() => useProductiveLinks(7, true))
    await waitFor(() => expect(result.current.status).toBe('ready'))
    db.filters = []
    let message: string | null = 'x'
    await act(async () => {
      message = await result.current.remove('111')
    })
    expect(message).toBeNull()
    expect(db.deletes).toBe(1)
    expect(db.filters).toEqual([
      ['client_id', 7],
      ['productive_project_id', '111'],
    ])
    expect(result.current.projectIds).toEqual([])
  })
})

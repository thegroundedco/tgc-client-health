// @vitest-environment jsdom

import { render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { AdminClient } from './clientForm'
import type { UseClients } from './useClients'

// TWO mocks, and the second is not optional. Mocking the hook is why useClients
// exists -- there is no other seam at which this screen can be rendered without
// a database. And `../lib/supabase` must be mocked as well: the unmocked client
// calls readSupabaseConfig at module scope and THROWS when VITE_ config is
// absent, and CI runs vitest with no VITE_ env at all. Without that line this
// file passes locally off .env.local and fails in CI. Recorded at
// src/board/Board.test.tsx:19.
vi.mock('../lib/supabase', () => ({ supabase: {} }))
vi.mock('./useClients', () => ({ useClients: vi.fn() }))

import { ClientsAdmin } from './ClientsAdmin'
import { useClients } from './useClients'

afterEach(() => {
  document.body.innerHTML = ''
  vi.clearAllMocks()
})

const AMY = '11111111-1111-1111-1111-111111111111'
const BEN = '22222222-2222-2222-2222-222222222222'

function client(overrides: Partial<AdminClient> = {}): AdminClient {
  return {
    id: 1,
    name: 'Acme',
    owner_id: null,
    status: 'active',
    ended_on: null,
    end_reason_code: null,
    end_reason_note: null,
    updated_at: '2026-08-24T15:42:00.000Z',
    ...overrides,
  }
}

// One factory for the whole file. Task 3 appends the write members here and
// nowhere else, so the two halves of this file cannot drift apart.
function hook(overrides: Partial<UseClients> = {}): UseClients {
  return {
    status: 'ready',
    loadError: null,
    clients: [],
    owners: [
      { id: AMY, label: 'Amy Account' },
      { id: BEN, label: 'ben@example.com' },
    ],
    reload: vi.fn(),
    ...overrides,
  }
}

function mount(overrides: Partial<UseClients> = {}, onBack = vi.fn()) {
  vi.mocked(useClients).mockReturnValue(hook(overrides))
  render(<ClientsAdmin onBack={onBack} />)
}

describe('the clients admin screen, reading', () => {
  it('gives a failed read the whole screen, with no list behind it', () => {
    // Parent spec §8.1 and v1's founding defect: a broken tool must never look
    // like an empty one. A list rendered under an error reads as "no clients".
    mount({ status: 'error', loadError: 'permission denied for table clients' })

    expect(screen.getByRole('alert').textContent).toContain('permission denied')
    expect(screen.queryByRole('list', { name: 'Clients' })).toBeNull()
    expect(screen.getByRole('button', { name: 'Try again' })).toBeTruthy()
  })

  it('says it is loading, and shows no list yet', () => {
    mount({ status: 'loading' })

    expect(screen.getByText('Loading…')).toBeTruthy()
    expect(screen.queryByRole('list', { name: 'Clients' })).toBeNull()
  })

  it('says the roster is empty rather than showing an empty list', () => {
    mount({ clients: [] })

    expect(screen.getByText(/No clients yet/)).toBeTruthy()
  })

  it('lists every client whatever its status', () => {
    // The point of this screen: a former client has to stay visible somewhere,
    // and the board deliberately reads only active rows.
    mount({
      clients: [
        client({ id: 1, name: 'Acme', status: 'active' }),
        client({ id: 2, name: 'Bellwether', status: 'paused' }),
        client({ id: 3, name: 'Cinder', status: 'cancelled', ended_on: '2026-07-01', end_reason_code: 'price' }),
        client({ id: 4, name: 'Test Client', status: 'former', ended_on: '2026-08-01', end_reason_code: 'other' }),
      ],
    })

    const items = screen.getByRole('list', { name: 'Clients' }).querySelectorAll('li')
    expect(items).toHaveLength(4)
    for (const name of ['Acme', 'Bellwether', 'Cinder', 'Test Client']) {
      expect(screen.getByText(name)).toBeTruthy()
    }
  })

  it('renders the order the hook hands it, without re-sorting', () => {
    // sortClients is tested in clientForm.test.ts and applied in the hook. This
    // asserts the screen does not quietly apply a second, different order.
    mount({
      clients: [client({ id: 1, name: 'Zinc' }), client({ id: 2, name: 'Acme' })],
    })

    const names = [...screen.getByRole('list', { name: 'Clients' }).querySelectorAll('li')]
      .map((item) => item.querySelector('[data-testid="client-name"]')?.textContent)
    expect(names).toEqual(['Zinc', 'Acme'])
  })

  it('names the owner, falls back to the email, and says so when there is none', () => {
    mount({
      clients: [
        client({ id: 1, name: 'Acme', owner_id: AMY }),
        client({ id: 2, name: 'Bellwether', owner_id: BEN }),
        client({ id: 3, name: 'Cinder', owner_id: null }),
      ],
    })

    expect(screen.getByText('Amy Account')).toBeTruthy()
    expect(screen.getByText('ben@example.com')).toBeTruthy()
    expect(screen.getByText('Unassigned')).toBeTruthy()
  })

  it('says so when a client has an owner nobody can name', () => {
    // An owner_id pointing at an inactive profile: the picker lists only active
    // ones, so the label lookup misses. Printing the raw UUID would be worse
    // than useless, and printing "Unassigned" would be a lie -- there IS an
    // owner.
    mount({ clients: [client({ owner_id: '99999999-9999-9999-9999-999999999999' })] })

    expect(screen.getByText('Owner is not an active account')).toBeTruthy()
  })

  it('shows the end date and the reason on a churned row', () => {
    mount({
      clients: [
        client({ id: 4, name: 'Test Client', status: 'former', ended_on: '2026-08-01', end_reason_code: 'other' }),
      ],
    })

    const row = screen.getByRole('list', { name: 'Clients' }).querySelector('li')
    expect(row?.textContent).toContain('2026-08-01')
    expect(row?.textContent).toContain('Other')
  })

  it('shows no end line at all on a live row', () => {
    mount({ clients: [client({ status: 'active' })] })

    expect(screen.queryByTestId('client-ended')).toBeNull()
  })

  it('names when each client last changed, which is what survives a reload', () => {
    // Spec §7: every write says what happened and names the time, and survives a
    // reload -- no toast. The status line beside a form is the immediate half;
    // THIS is the durable half, because it comes from updated_at.
    mount({ clients: [client({ updated_at: '2026-08-24T15:42:00.000Z' })] })

    expect(screen.getByTestId('client-updated').textContent).toMatch(/Updated .*2026/)
  })

  it('shows the status as text, not only as a shape', () => {
    // A pill's fill is not information a greyscale print or a colour-blind
    // reader can read. Spec §9's 2026-08-23 lesson, restated: an accessible
    // name and a visible label are two questions.
    mount({ clients: [client({ status: 'paused' })] })

    expect(screen.getByText('Paused')).toBeTruthy()
  })

  it('offers a way back to the board', async () => {
    const onBack = vi.fn()
    mount({}, onBack)

    screen.getByRole('button', { name: 'Board' }).click()
    expect(onBack).toHaveBeenCalledTimes(1)
  })

  it('retries the read on demand', () => {
    const reload = vi.fn()
    mount({ status: 'error', loadError: 'the connection failed', reload })

    screen.getByRole('button', { name: 'Try again' }).click()
    expect(reload).toHaveBeenCalledTimes(1)
  })
})

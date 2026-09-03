// @vitest-environment jsdom

// `waitFor` is not imported: nothing below awaits a state change that isn't
// already covered by userEvent's own act()-wrapped awaits, and this repo's
// tsconfig sets noUnusedLocals, which fails `npm run build` on an unused
// import -- the brief's test listing imported it and never called it.
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'

// Mocked for the same reason UsersAdmin.dom.test.tsx and
// ClientsAdmin.dom.test.tsx mock it: RevenueAdmin imports the real client at
// module scope (it has to -- useRevenue is mocked below and exposes no write
// path, so the save button reaches ../lib/supabase directly), and
// readSupabaseConfig THROWS when no VITE_ config is present, which is exactly
// how CI runs vitest. Without this, every test in this file fails at import
// time with "Missing VITE_SUPABASE_URL" rather than at the assertion each one
// is actually testing.
vi.mock('../lib/supabase', () => ({ supabase: {} }))
vi.mock('./useRevenue', () => ({ useRevenue: vi.fn() }))

import { RevenueAdmin } from './RevenueAdmin'
import { useRevenue } from './useRevenue'

// Three clients and one row, deliberately: with two clients and one row the
// entered count and the missing count are both 1, so an assertion on "1 of 2"
// passes whichever of the two the component actually renders. Three makes them
// 1 and 2, and only the intended number matches.
const CLIENTS = [
  { id: 1, name: 'Acme' },
  { id: 2, name: 'Delta' },
  { id: 3, name: 'East Bay' },
]
const ROW = { client_id: 1, period: '2026-09-01', retainer_cents: 400000, project_cents: 0 }

function given(over: Partial<ReturnType<typeof useRevenue>> = {}) {
  vi.mocked(useRevenue).mockReturnValue({
    status: 'ready',
    loadError: null,
    clients: CLIENTS,
    rows: [ROW],
    reload: vi.fn(),
    ...over,
  })
  return render(<RevenueAdmin onWritingChange={vi.fn()} />)
}

afterEach(() => {
  document.body.innerHTML = ''
  vi.mocked(useRevenue).mockReset()
})

describe('the revenue entry grid', () => {
  it('gives every eligible client a row, entered or not', () => {
    given()

    expect(screen.getByText('Acme')).toBeTruthy()
    // Delta has no row for the month and must still be enterable -- a grid that
    // only lists clients with existing rows can never record a first month.
    expect(screen.getByText('Delta')).toBeTruthy()
  })

  it('prefills an entered amount and leaves an unentered field empty', () => {
    given()

    // THE distinction, at the field level. Acme's zero project work shows as a
    // real zero; Delta's absent row shows as empty, not as 0 -- which would
    // make an unentered month look entered the moment somebody opened it.
    const acmeRetainer = screen.getByLabelText('Acme retainer') as HTMLInputElement
    const deltaRetainer = screen.getByLabelText('Delta retainer') as HTMLInputElement
    expect(acmeRetainer.value).toBe('4000')
    expect(deltaRetainer.value).toBe('')
  })

  it('says how many clients the month is still missing', () => {
    given()

    // MISSING of total, matching Concentration's wording -- two of the three
    // eligible clients have no row. The two screens must not disagree about
    // which number "N of M" names.
    expect(document.body.textContent).toContain('2 of 3')
  })

  it('refuses to save a field it cannot parse, and says which', async () => {
    const user = userEvent.setup()
    given()

    await user.clear(screen.getByLabelText('Acme retainer'))
    await user.type(screen.getByLabelText('Acme retainer'), 'four thousand')
    await user.click(screen.getByRole('button', { name: /save/i }))

    // Named, not a bare "invalid input". Ten rows and a generic message means
    // hunting for the field.
    expect(screen.getByRole('alert').textContent).toContain('Acme')
  })

  it('refuses an amount past what the column can hold', async () => {
    const user = userEvent.setup()
    given()

    await user.clear(screen.getByLabelText('Acme retainer'))
    await user.type(screen.getByLabelText('Acme retainer'), '99999999')
    await user.click(screen.getByRole('button', { name: /save/i }))

    expect(screen.getByRole('alert')).toBeTruthy()
  })

  it('offers a past month so six months can be backfilled', () => {
    given()

    // Spec section 6.3. The owner has six months of records and they are the
    // reason the later slices work at all; a grid that can only reach the
    // current month cannot accept them.
    const months = screen.getByLabelText(/month/i)
    expect(months).toBeTruthy()
    expect(months.querySelectorAll('option').length).toBeGreaterThanOrEqual(6)
  })

  it('shows a failed read as an error, not as an empty roster', () => {
    given({ status: 'error', loadError: 'permission denied', clients: [], rows: [] })

    expect(screen.getByRole('alert').textContent).toContain('permission denied')
  })

  it('says it is loading rather than showing an empty grid', () => {
    given({ status: 'loading', clients: [], rows: [] })

    expect(screen.getByText(/loading/i)).toBeTruthy()
  })

  it('keeps the Back button, which carries the in-flight-write guard', () => {
    given()

    expect(screen.getByRole('button', { name: /back/i })).toBeTruthy()
  })
})

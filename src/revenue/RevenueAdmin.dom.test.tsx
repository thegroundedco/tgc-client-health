// @vitest-environment jsdom

// `waitFor` IS used below, by the two save tests: everything past the
// validation loop in handleSave sits behind two awaited promises
// (auth.getUser, then upsert), so the mock's call only lands after more than
// one microtask tick -- the earlier validation-refusal tests never needed
// this because parseMoney runs synchronously, before any await.
import { render, screen, waitFor } from '@testing-library/react'
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
//
// Shaped with `auth.getUser` and `from` explicitly, not `{}`: review round 1
// caught that a mock this bare meant no test in this file had ever inspected
// a successful upsert payload, which is exactly why nine passing tests missed
// a save that zeroed every untouched client. See `givenUpsert` below.
vi.mock('../lib/supabase', () => ({
  supabase: {
    auth: { getUser: vi.fn() },
    from: vi.fn(),
  },
}))
vi.mock('./useRevenue', () => ({ useRevenue: vi.fn() }))

import { supabase } from '../lib/supabase'
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

// Wires the two calls a successful save makes in sequence: auth.getUser for
// entered_by, then one upsert carrying the whole month. Returns the upsert
// spy so a test can inspect exactly what it was called with -- the payload
// itself is the thing review round 1 found nobody had ever looked at.
function givenUpsert() {
  const upsert = vi.fn().mockResolvedValue({ error: null })
  vi.mocked(supabase.from).mockReturnValue({ upsert } as never)
  vi.mocked(supabase.auth.getUser).mockResolvedValue({
    data: { user: { id: 'user-1' } },
    error: null,
  } as never)
  return upsert
}

afterEach(() => {
  document.body.innerHTML = ''
  vi.mocked(useRevenue).mockReset()
  vi.mocked(supabase.from).mockReset()
  vi.mocked(supabase.auth.getUser).mockReset()
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

  it('writes only the client that changed, leaving an untouched client unwritten rather than zeroed', async () => {
    const user = userEvent.setup()
    const upsert = givenUpsert()
    given()

    // Acme already has a row; this is the only field touched. Delta and East
    // Bay are left exactly as the fixture rendered them -- blank, with no row
    // on file -- and review round 1's own probe showed that, before this fix,
    // saving here wrote real 0/0 rows for both of them anyway.
    await user.clear(screen.getByLabelText('Acme project work'))
    await user.type(screen.getByLabelText('Acme project work'), '100')
    await user.click(screen.getByRole('button', { name: /save/i }))

    await waitFor(() => expect(upsert).toHaveBeenCalledTimes(1))

    const rows = upsert.mock.calls[0][0] as Array<{ client_id: number }>
    expect(rows).toHaveLength(1)
    expect(rows[0].client_id).toBe(1)
  })

  it('still writes a deliberate zero, so a client billed nothing this month can say so', async () => {
    const user = userEvent.setup()
    const upsert = givenUpsert()
    given()

    // Delta has no row on file. Typing 0 -- not leaving the field blank -- is
    // how "entered; billed nothing" gets recorded, and the skip that protects
    // an untouched client must not also catch this: retainer is not blank,
    // so Delta writes even though project work is.
    await user.clear(screen.getByLabelText('Delta retainer'))
    await user.type(screen.getByLabelText('Delta retainer'), '0')
    await user.click(screen.getByRole('button', { name: /save/i }))

    await waitFor(() => expect(upsert).toHaveBeenCalledTimes(1))

    const rows = upsert.mock.calls[0][0] as Array<{
      client_id: number
      retainer_cents: number
    }>
    const delta = rows.find((row) => row.client_id === 2)
    expect(delta?.retainer_cents).toBe(0)
    // East Bay stays untouched and rowless, so it stays out of the payload --
    // the same guarantee the previous test makes, checked again here so this
    // test does not accidentally pass because the skip was removed entirely.
    expect(rows.some((row) => row.client_id === 3)).toBe(false)
  })
})

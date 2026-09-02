// @vitest-environment jsdom

import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
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
    started_on: null,
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
    addState: { kind: 'idle' },
    editState: { kind: 'idle' },
    // Null, not 1: the default hook is saving nothing, so no row owns the edit
    // write state. Every test that wants the edit form to SHOW a state has to
    // name the row that state belongs to -- which is the point of the field.
    editStateFor: null,
    addClient: vi.fn(),
    saveClient: vi.fn(),
    resetAdd: vi.fn(),
    resetEdit: vi.fn(),
    ...overrides,
  }
}

function mount(
  overrides: Partial<UseClients> = {},
  onBack = vi.fn(),
  onWritingChange = vi.fn(),
) {
  vi.mocked(useClients).mockReturnValue(hook(overrides))
  render(<ClientsAdmin onBack={onBack} onWritingChange={onWritingChange} />)
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

    // Scoped to the list: Task 3's AddClientForm renders an Owner <select> with
    // these same three strings as <option> text, always on screen, so an
    // unscoped query now matches twice. See task-3-report.md.
    const list = screen.getByRole('list', { name: 'Clients' })
    expect(within(list).getByText('Amy Account')).toBeTruthy()
    expect(within(list).getByText('ben@example.com')).toBeTruthy()
    expect(within(list).getByText('Unassigned')).toBeTruthy()
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

  // The list is where the owner checks eleven dates at a glance without
  // opening eleven forms, and "no start date" has to be visible rather than
  // blank -- a blank reads as a rendering gap, and it is the reason a whole
  // bucket is unscored.
  it('says on the row when a client has no start date', () => {
    mount({ clients: [client({ started_on: null })] })

    expect(screen.getByTestId('client-started').textContent).toContain(
      'No start date — Advocacy is not scored',
    )
  })

  it('shows the start date on the row when there is one', () => {
    mount({ clients: [client({ started_on: '2026-01-15' })] })

    expect(screen.getByTestId('client-started').textContent).toContain('Started 2026-01-15')
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

    screen.getByRole('button', { name: 'Clients' }).click()
    expect(onBack).toHaveBeenCalledTimes(1)
  })

  it('retries the read on demand', () => {
    const reload = vi.fn()
    mount({ status: 'error', loadError: 'the connection failed', reload })

    screen.getByRole('button', { name: 'Try again' }).click()
    expect(reload).toHaveBeenCalledTimes(1)
  })
})

describe('the clients admin screen, adding', () => {
  it('takes a name and an owner, and offers no status field', () => {
    // Spec §7: "the form does not offer a churned status on creation, because a
    // client who has already left is not something anybody needs to add."
    mount()

    expect(screen.getByLabelText('Name')).toBeTruthy()
    expect(screen.getByLabelText('Owner')).toBeTruthy()
    expect(screen.queryByLabelText('Status')).toBeNull()
  })

  it('sends the typed name and the chosen owner', async () => {
    const addClient = vi.fn()
    mount({ addClient })

    await userEvent.type(screen.getByLabelText('Name'), 'Polar Divide')
    await userEvent.selectOptions(screen.getByLabelText('Owner'), AMY)
    await userEvent.click(screen.getByRole('button', { name: 'Add client' }))

    expect(addClient).toHaveBeenCalledTimes(1)
    expect(addClient.mock.calls[0][0]).toMatchObject({
      name: 'Polar Divide',
      ownerId: AMY,
      status: 'active',
    })
  })

  it('offers a start date on the add form and sends it', async () => {
    const addClient = vi.fn()
    mount({ addClient })

    await userEvent.type(screen.getByLabelText('Name'), 'Acme')
    await userEvent.type(screen.getByLabelText('Start date'), '2026-01-15')
    await userEvent.click(screen.getByRole('button', { name: 'Add client' }))

    expect(addClient).toHaveBeenCalledWith(
      expect.objectContaining({ startedOn: '2026-01-15' }),
    )
  })

  it('refuses to send a nameless client, and says why', async () => {
    const addClient = vi.fn()
    mount({ addClient })

    const button = screen.getByRole('button', { name: 'Add client' })
    expect(button).toHaveProperty('disabled', true)
    expect(screen.getByTestId('add-status').textContent).toContain('A client needs a name.')

    // A disabled button does not fire a click in a real browser, and jsdom
    // agrees -- pressing it here is what makes the assertion below mean
    // something, rather than checking a handler that was never invoked.
    await userEvent.click(button)
    expect(addClient).not.toHaveBeenCalled()
  })

  it('clears the field only once the add is confirmed, and names the time', async () => {
    // The press is not the confirmation. Clearing on the press would lose the
    // typed name the instant the unique index on lower(name) refused it -- which
    // is the most likely refusal this form will ever see, and the one case where
    // the person most wants to look at what they typed.
    //
    // Two renders rather than one, because that is the only way to observe the
    // transition: the first render has the press with the state still idle, the
    // second has the confirmed state the hook would then report.
    vi.mocked(useClients).mockReturnValue(hook())
    const { rerender } = render(<ClientsAdmin onBack={vi.fn()} />)

    await userEvent.type(screen.getByLabelText('Name'), 'Acme')
    await userEvent.click(screen.getByRole('button', { name: 'Add client' }))
    expect(screen.getByLabelText('Name')).toHaveProperty('value', 'Acme')

    vi.mocked(useClients).mockReturnValue(
      hook({ addState: { kind: 'saved', at: '2026-08-24T15:42:00.000Z', what: 'Client added' } }),
    )
    rerender(<ClientsAdmin onBack={vi.fn()} />)

    expect(screen.getByLabelText('Name')).toHaveProperty('value', '')
    const line = screen.getByTestId('add-status')
    expect(line.textContent).toContain('Client added')
    expect(line.textContent).toMatch(/2026/)
  })

  it('shows the refusal in words, and says nothing was changed', () => {
    mount({
      addState: {
        kind: 'failed',
        message: 'A client called "Acme" already exists. Nothing was changed, and pressing save again costs nothing.',
      },
    })

    const line = screen.getByTestId('add-status')
    expect(line.textContent).toContain('already exists')
    expect(line.textContent).toContain('Nothing was changed')
    // No assertion that the raw constraint name is absent: this test injected
    // the message itself, so that could never fail here. It is proved where it
    // belongs, in clientForm.test.ts.
  })

  it('keeps a refused name in the field, not just the row\'s own unmodified value', async () => {
    // Same two-render technique as "clears the field only once the add is
    // confirmed": the first render presses with the state still idle, the
    // second supplies the failure the hook would then report. A failed write
    // must never lose what was typed -- it is the one moment the person most
    // wants to look at it.
    vi.mocked(useClients).mockReturnValue(hook())
    const { rerender } = render(<ClientsAdmin onBack={vi.fn()} />)

    await userEvent.type(screen.getByLabelText('Name'), 'Acme')
    await userEvent.click(screen.getByRole('button', { name: 'Add client' }))

    vi.mocked(useClients).mockReturnValue(
      hook({
        addState: {
          kind: 'failed',
          message: 'A client called "Acme" already exists. Nothing was changed, and pressing save again costs nothing.',
        },
      }),
    )
    rerender(<ClientsAdmin onBack={vi.fn()} />)

    expect(screen.getByLabelText('Name')).toHaveProperty('value', 'Acme')
  })

  it('clears a stale confirmation on the add form when the name is edited again', async () => {
    // The third named failure mode: a confirmation left standing beside a form
    // somebody has since changed is the same class of lie as no confirmation at
    // all. edit() in AddClientForm is the one place that both updates the draft
    // and calls onEdited -- this is what proves it still does the second half.
    const resetAdd = vi.fn()
    mount({
      addState: { kind: 'saved', at: '2026-08-24T15:42:00.000Z', what: 'Client added' },
      resetAdd,
    })

    await userEvent.type(screen.getByLabelText('Name'), 'B')

    expect(resetAdd).toHaveBeenCalled()
  })
})

describe('the clients admin screen, editing', () => {
  const ACME = client({ id: 1, name: 'Acme', status: 'active', owner_id: AMY })
  const GONE = client({
    id: 2,
    name: 'Test Client',
    status: 'former',
    ended_on: '2026-08-01',
    end_reason_code: 'other',
  })

  async function open(name: string, overrides: Partial<UseClients> = {}) {
    mount({ clients: [ACME, GONE], ...overrides })
    await userEvent.click(screen.getByRole('button', { name: `Edit ${name}` }))
  }

  it('opens no form until a row is edited', () => {
    mount({ clients: [ACME] })
    expect(screen.queryByLabelText('Status')).toBeNull()
  })

  it('opens one form, populated from the row', async () => {
    await open('Acme')

    expect(screen.getByLabelText('Client name')).toHaveProperty('value', 'Acme')
    expect(screen.getByLabelText('Status')).toHaveProperty('value', 'active')
    // One form, not one per row: spec §7 says a list and a form.
    expect(screen.getAllByLabelText('Status')).toHaveLength(1)
  })

  it('offers a start date on the edit form, whatever the status', async () => {
    mount({ clients: [client({ status: 'active', started_on: '2026-01-15' })] })
    await userEvent.click(screen.getByRole('button', { name: 'Edit Acme' }))

    expect(screen.getByLabelText('Client start date')).toHaveProperty('value', '2026-01-15')
  })

  it('hides the lifecycle fields while the status is live', async () => {
    await open('Acme')

    expect(screen.queryByLabelText('End date')).toBeNull()
    expect(screen.queryByLabelText('Reason they left')).toBeNull()
  })

  it('reveals the lifecycle fields when a churned status is chosen', async () => {
    // Rule 1 of spec §7.
    await open('Acme')
    await userEvent.selectOptions(screen.getByLabelText('Status'), 'cancelled')

    expect(screen.getByLabelText('End date')).toBeTruthy()
    expect(screen.getByLabelText('Reason they left')).toBeTruthy()
    expect(screen.getByLabelText('Note (optional)')).toBeTruthy()
  })

  it('says how cancelled and former differ, rather than making the reader guess', async () => {
    // Rule 3 of spec §7, and this asserts the sighted reader can see it -- the
    // 2026-08-23 lesson is that an accessible name says nothing about that.
    await open('Acme')
    await userEvent.selectOptions(screen.getByLabelText('Status'), 'cancelled')
    expect(screen.getByTestId('status-hint').textContent).toContain('under review')

    await userEvent.selectOptions(screen.getByLabelText('Status'), 'former')
    expect(screen.getByTestId('status-hint').textContent).toContain('archived')
  })

  it('blocks the save until the date and the reason are both there', async () => {
    await open('Acme')
    await userEvent.selectOptions(screen.getByLabelText('Status'), 'former')

    const save = screen.getByRole('button', { name: 'Save changes' })
    expect(save).toHaveProperty('disabled', true)
    expect(screen.getByTestId('edit-status').textContent).toContain('needs the date')

    await userEvent.type(screen.getByLabelText('End date'), '2026-08-01')
    expect(screen.getByRole('button', { name: 'Save changes' })).toHaveProperty('disabled', true)
    expect(screen.getByTestId('edit-status').textContent).toContain('needs a reason')

    await userEvent.selectOptions(screen.getByLabelText('Reason they left'), 'price')
    expect(screen.getByRole('button', { name: 'Save changes' })).toHaveProperty('disabled', false)
  })

  it('never requires the note', async () => {
    await open('Acme')
    await userEvent.selectOptions(screen.getByLabelText('Status'), 'former')
    await userEvent.type(screen.getByLabelText('End date'), '2026-08-01')
    await userEvent.selectOptions(screen.getByLabelText('Reason they left'), 'price')

    expect(screen.getByLabelText('Note (optional)')).toHaveProperty('value', '')
    expect(screen.getByRole('button', { name: 'Save changes' })).toHaveProperty('disabled', false)
  })

  it('warns before reactivating, because a recorded fact is about to go', async () => {
    // Rule 2 of spec §7: "The screen must say it is doing that."
    await open('Test Client')
    expect(screen.queryByTestId('reactivation-warning')).toBeNull()

    await userEvent.selectOptions(screen.getByLabelText('Status'), 'active')
    expect(screen.getByTestId('reactivation-warning').textContent).toContain('clear the end date')
  })

  it("sends the reactivation with the opened row's id and the live status", async () => {
    // This only proves saveClient is called with the right id and status --
    // the three-column clear happens inside updatePayload, behind the mocked
    // hook, where this test cannot see it. That fact is proved directly at
    // clientForm.test.ts:123,138,151.
    const saveClient = vi.fn()
    await open('Test Client', { saveClient })
    await userEvent.selectOptions(screen.getByLabelText('Status'), 'active')
    await userEvent.click(screen.getByRole('button', { name: 'Save changes' }))

    expect(saveClient).toHaveBeenCalledTimes(1)
    expect(saveClient.mock.calls[0][0]).toBe(GONE.id)
    expect(saveClient.mock.calls[0][1]).toMatchObject({ status: 'active' })
  })

  it('sends a rename with the id of the row that was opened', async () => {
    const saveClient = vi.fn()
    await open('Acme', { saveClient })
    await userEvent.clear(screen.getByLabelText('Client name'))
    await userEvent.type(screen.getByLabelText('Client name'), 'Acme Holdings')
    await userEvent.click(screen.getByRole('button', { name: 'Save changes' }))

    expect(saveClient.mock.calls[0][0]).toBe(ACME.id)
    expect(saveClient.mock.calls[0][1]).toMatchObject({ name: 'Acme Holdings' })
  })

  it('closes the form on cancel, without saving', async () => {
    const saveClient = vi.fn()
    await open('Acme', { saveClient })
    await userEvent.click(screen.getByRole('button', { name: 'Cancel' }))

    expect(screen.queryByLabelText('Status')).toBeNull()
    expect(saveClient).not.toHaveBeenCalled()
  })

  it('confirms a save, and names the time', async () => {
    // editStateFor names the row the confirmation is about. Without it the
    // screen deliberately renders nothing here -- see "never shows one row's
    // confirmation beside another row's fields" below.
    await open('Acme', {
      editState: { kind: 'saved', at: '2026-08-24T15:42:00.000Z', what: 'Changes saved' },
      editStateFor: ACME.id,
    })

    const line = screen.getByTestId('edit-status')
    expect(line.textContent).toContain('Changes saved')
    expect(line.textContent).toMatch(/2026/)
  })

  it('keeps the form populated after a refused save', async () => {
    await open('Acme', {
      editState: {
        kind: 'failed',
        message: 'Your account is not allowed to change clients. Ask an admin. Nothing was changed, and pressing save again costs nothing.',
      },
      editStateFor: ACME.id,
    })

    expect(screen.getByLabelText('Client name')).toHaveProperty('value', 'Acme')
    expect(screen.getByTestId('edit-status').textContent).toContain('not allowed')
  })

  it('keeps a typed rename after a refused save, not the stored name', async () => {
    // The row's own name is 'Acme' -- the test above alone could not tell a
    // refusal that resets the draft back to the stored row apart from one that
    // kept what was actually typed, because both look identical when nothing
    // was changed first. Same two-render technique as the add form's
    // equivalent test: the first render types into the open form, the second
    // supplies the failure the hook would then report.
    vi.mocked(useClients).mockReturnValue(hook({ clients: [ACME, GONE] }))
    const { rerender } = render(<ClientsAdmin onBack={vi.fn()} />)
    await userEvent.click(screen.getByRole('button', { name: 'Edit Acme' }))

    await userEvent.clear(screen.getByLabelText('Client name'))
    await userEvent.type(screen.getByLabelText('Client name'), 'Acme Holdings')

    vi.mocked(useClients).mockReturnValue(
      hook({
        clients: [ACME, GONE],
        editState: {
          kind: 'failed',
          message: 'Your account is not allowed to change clients. Ask an admin. Nothing was changed, and pressing save again costs nothing.',
        },
        editStateFor: ACME.id,
      }),
    )
    rerender(<ClientsAdmin onBack={vi.fn()} />)

    expect(screen.getByLabelText('Client name')).toHaveProperty('value', 'Acme Holdings')
  })

  it('clears a stale confirmation on the edit form when a field changes', async () => {
    // The third named failure mode: a confirmation left standing beside a form
    // somebody has since changed is the same class of lie as no confirmation at
    // all. edit() in EditClientForm is the one place that both updates the
    // draft and calls onEdited -- this proves it still does the second half.
    const resetEdit = vi.fn()
    await open('Acme', {
      editState: { kind: 'saved', at: '2026-08-24T15:42:00.000Z', what: 'Changes saved' },
      editStateFor: ACME.id,
      resetEdit,
    })
    // open() itself presses "Edit Acme", which also calls resetEdit -- cleared
    // here so the assertion below is about typing, not about opening the row.
    resetEdit.mockClear()

    await userEvent.type(screen.getByLabelText('Client name'), ' Holdings')

    expect(resetEdit).toHaveBeenCalled()
  })

  it("never shows one row's confirmation beside another row's fields", async () => {
    // The two-row test that replaces "clears a stale confirmation from the
    // previous row when another is opened". That one pressed ONE row's Edit
    // button and asserted resetEdit had been called; it never opened a second
    // row, so it passed on any code where that call existed -- including code
    // where the confirmation for row 1 then landed beside row 2's fields.
    //
    // A confirmation is a claim about a specific client. Test Client's form is
    // the one on screen; the write that finished belongs to Acme. The only
    // honest thing to render beside Test Client is nothing at all.
    const resetEdit = vi.fn()
    vi.mocked(useClients).mockReturnValue(hook({ clients: [ACME, GONE], resetEdit }))
    const { rerender } = render(<ClientsAdmin onBack={vi.fn()} />)
    await userEvent.click(screen.getByRole('button', { name: 'Edit Test Client' }))
    // The Edit press still clears the previous row's state -- the old test's
    // one real assertion, kept. It is no longer the guarantee, though: the
    // attribution below is.
    expect(resetEdit).toHaveBeenCalled()

    vi.mocked(useClients).mockReturnValue(
      hook({
        clients: [ACME, GONE],
        editState: { kind: 'saved', at: '2026-08-24T15:42:00.000Z', what: 'Changes saved' },
        editStateFor: ACME.id,
      }),
    )
    rerender(<ClientsAdmin onBack={vi.fn()} />)

    expect(screen.getByRole('heading', { name: 'Editing Test Client' })).toBeTruthy()
    const line = screen.getByTestId('edit-status')
    expect(line.textContent).not.toContain('Changes saved')
    expect(line.textContent).toContain('Ready to save.')
  })

  it("never shows a failure that names another client beside this row's fields", async () => {
    // The same misattribution with the polarity reversed: Acme's save was
    // refused, and the sentence naming Acme must not appear under Test Client's
    // fields, where it reads as a refusal of a save nobody attempted.
    vi.mocked(useClients).mockReturnValue(hook({ clients: [ACME, GONE] }))
    const { rerender } = render(<ClientsAdmin onBack={vi.fn()} />)
    await userEvent.click(screen.getByRole('button', { name: 'Edit Test Client' }))

    vi.mocked(useClients).mockReturnValue(
      hook({
        clients: [ACME, GONE],
        editState: {
          kind: 'failed',
          message: 'A client called "Acme" already exists. Nothing was changed, and pressing save again costs nothing.',
        },
        editStateFor: ACME.id,
      }),
    )
    rerender(<ClientsAdmin onBack={vi.fn()} />)

    expect(screen.getByTestId('edit-status').textContent).not.toContain('Acme')
  })

  it('will not open another row while an edit save is in flight', async () => {
    // Path A of the misattribution, closed at the source. Two ordinary clicks
    // inside one network round trip is all it took: Save on Acme, then Edit on
    // Test Client. EditClientForm already disabled its own Save and Cancel
    // while saving; the list's Edit buttons were the omission.
    vi.mocked(useClients).mockReturnValue(hook({ clients: [ACME, GONE] }))
    const { rerender } = render(<ClientsAdmin onBack={vi.fn()} />)
    await userEvent.click(screen.getByRole('button', { name: 'Edit Acme' }))

    vi.mocked(useClients).mockReturnValue(
      hook({ clients: [ACME, GONE], editState: { kind: 'saving' }, editStateFor: ACME.id }),
    )
    rerender(<ClientsAdmin onBack={vi.fn()} />)

    expect(screen.getByRole('button', { name: 'Edit Test Client' })).toHaveProperty(
      'disabled',
      true,
    )
  })

  it('never confirms a save beside a row that never sent one', async () => {
    // Path B, the serious one, as a sequence of real presses: open Acme, save,
    // and while that request is in flight press Edit on Test Client. Before the
    // fix that press swapped the form (setEditingId plus resetEdit batch into
    // one render), the hook's editInFlight ref then made Test Client's own Save
    // return without sending anything or setting any state, and Acme's write
    // resolving printed "Changes saved <time>" beside Test Client's untouched
    // fields -- a confirmation of a write that never happened.
    const saveClient = vi.fn()
    vi.mocked(useClients).mockReturnValue(hook({ clients: [ACME, GONE], saveClient }))
    const { rerender } = render(<ClientsAdmin onBack={vi.fn()} />)
    await userEvent.click(screen.getByRole('button', { name: 'Edit Acme' }))
    await userEvent.click(screen.getByRole('button', { name: 'Save changes' }))
    expect(saveClient.mock.calls[0][0]).toBe(ACME.id)

    vi.mocked(useClients).mockReturnValue(
      hook({ clients: [ACME, GONE], saveClient, editState: { kind: 'saving' }, editStateFor: ACME.id }),
    )
    rerender(<ClientsAdmin onBack={vi.fn()} />)
    await userEvent.click(screen.getByRole('button', { name: 'Edit Test Client' }))

    vi.mocked(useClients).mockReturnValue(
      hook({
        clients: [ACME, GONE],
        saveClient,
        editState: { kind: 'saved', at: '2026-08-24T15:42:00.000Z', what: 'Changes saved' },
        editStateFor: ACME.id,
      }),
    )
    rerender(<ClientsAdmin onBack={vi.fn()} />)

    // The confirmation is Acme's, so Acme's form is the only place it may
    // appear -- and Test Client's form must not have opened at all.
    expect(screen.queryByRole('heading', { name: 'Editing Test Client' })).toBeNull()
    expect(screen.getByRole('heading', { name: 'Editing Acme' })).toBeTruthy()
    expect(screen.getByTestId('edit-status').textContent).toContain('Changes saved')
    // Deliberately NOT `expect(saveClient).toHaveBeenCalledTimes(1)` under a
    // comment claiming the second Save was never offered: this test presses
    // Save exactly once, so that count could never have been anything but 1 and
    // the sentence claimed more than the assertion proved. What actually keeps a
    // second press from being offered is the disabled Edit button asserted in
    // `will not open another row while an edit save is in flight`, and the hook
    // half is `refuses a second save inside one round trip out loud, not
    // silently` in useClients.dom.test.ts. Both can fail; this could not.
  })

  it('does not offer a destroyed end date back after a reactivation is confirmed', async () => {
    // The form keeps its own draft across a confirmed save, which is right for
    // a rename. It was wrong here: reactivate a former client, and the three
    // lifecycle columns are nulled in the database while the draft still holds
    // the old end date and reason. Re-selecting `former` in the same still-open
    // form revealed them again and saving wrote them back as if they were
    // today's departure -- a false fact recorded in a database with no backups.
    vi.mocked(useClients).mockReturnValue(hook({ clients: [ACME, GONE] }))
    const { rerender } = render(<ClientsAdmin onBack={vi.fn()} />)
    await userEvent.click(screen.getByRole('button', { name: 'Edit Test Client' }))
    await userEvent.selectOptions(screen.getByLabelText('Status'), 'active')
    await userEvent.click(screen.getByRole('button', { name: 'Save changes' }))

    // What the database now holds: reactivated, all three lifecycle columns
    // null. Same id, so the form is not remounted by its key.
    const REVIVED = client({ id: GONE.id, name: 'Test Client', status: 'active' })
    vi.mocked(useClients).mockReturnValue(
      hook({
        clients: [ACME, REVIVED],
        editState: { kind: 'saved', at: '2026-08-24T15:42:00.000Z', what: 'Changes saved' },
        editStateFor: REVIVED.id,
      }),
    )
    rerender(<ClientsAdmin onBack={vi.fn()} />)

    await userEvent.selectOptions(screen.getByLabelText('Status'), 'former')

    expect(screen.getByLabelText('End date')).toHaveProperty('value', '')
    expect(screen.getByLabelText('Reason they left')).toHaveProperty('value', '')
    expect(screen.getByLabelText('Note (optional)')).toHaveProperty('value', '')
  })

  it('disables every control while a save is in flight', async () => {
    // Two renders rather than open(): the row's own Edit button is now disabled
    // while a save is in flight, so a screen mounted straight into 'saving' can
    // no longer have a form opened on it. Same assertions, same intent -- the
    // form's own controls are dead while its write is pending.
    vi.mocked(useClients).mockReturnValue(hook({ clients: [ACME, GONE] }))
    const { rerender } = render(<ClientsAdmin onBack={vi.fn()} />)
    await userEvent.click(screen.getByRole('button', { name: 'Edit Acme' }))

    vi.mocked(useClients).mockReturnValue(
      hook({ clients: [ACME, GONE], editState: { kind: 'saving' }, editStateFor: ACME.id }),
    )
    rerender(<ClientsAdmin onBack={vi.fn()} />)

    expect(screen.getByLabelText('Client name')).toHaveProperty('disabled', true)
    expect(screen.getByLabelText('Status')).toHaveProperty('disabled', true)
    expect(screen.getByRole('button', { name: 'Save changes' })).toHaveProperty('disabled', true)
  })

  it('offers no way to delete a client', async () => {
    // Spec §2 and §10 decision 5. checkins.client_id is on delete cascade and
    // this project has no backups, so a delete would destroy that client's whole
    // history. This test is the standing guard against somebody adding one.
    await open('Acme')

    expect(screen.queryByRole('button', { name: /delete/i })).toBeNull()
    expect(screen.queryByRole('button', { name: /remove/i })).toBeNull()
  })
})

describe('the clients admin screen, leaving', () => {
  const ACME = client({ id: 1, name: 'Acme' })

  it('will not leave for the board while an edit save is in flight', async () => {
    // Same root cause as the misattribution above, from the other side:
    // pressing Save and then Clients unmounts the screen while the update is
    // still pending, so the write lands and its confirmation is never seen --
    // which is exactly "a write that worked looks like one that did not".
    const onBack = vi.fn()
    mount({ clients: [ACME], editState: { kind: 'saving' }, editStateFor: ACME.id }, onBack)

    const back = screen.getByRole('button', { name: 'Clients' })
    expect(back).toHaveProperty('disabled', true)
    await userEvent.click(back)
    expect(onBack).not.toHaveBeenCalled()
  })

  it('will not leave for the board while an add is in flight', async () => {
    const onBack = vi.fn()
    mount({ clients: [ACME], addState: { kind: 'saving' } }, onBack)

    const back = screen.getByRole('button', { name: 'Clients' })
    expect(back).toHaveProperty('disabled', true)
    await userEvent.click(back)
    expect(onBack).not.toHaveBeenCalled()
  })

  // Disabling the Back button stopped being sufficient the moment the app shell
  // drew a menu bar above this screen: it is four more exits, none of which this
  // component owns. So the guard is reported outward as well as enforced here,
  // and the shell disables the bar with it. Without this the same silent write
  // failure is available again, one layer up.
  it('reports a write in flight so the shell can shut its own exits', () => {
    const onWritingChange = vi.fn()
    mount({ clients: [ACME], addState: { kind: 'saving' } }, vi.fn(), onWritingChange)

    expect(onWritingChange).toHaveBeenCalledWith(true)
  })

  it('reports itself idle again once nothing is in flight', () => {
    const onWritingChange = vi.fn()
    mount({ clients: [ACME] }, vi.fn(), onWritingChange)

    expect(onWritingChange).toHaveBeenCalledWith(false)
  })
})

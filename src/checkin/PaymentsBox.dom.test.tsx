// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { MonthRow } from '../revenue/paymentBox'
import type { UseMonthPayment } from '../revenue/useMonthPayment'
import { PaymentsBox } from './PaymentsBox'

const ROW: MonthRow = { retainer_cents: 300000, project_cents: 50000, project_notes: null, entered_by: 'p1', updated_at: '2026-11-04T12:00:00Z' }

function fake(over: Partial<UseMonthPayment> = {}): UseMonthPayment {
  return {
    status: 'ready', loadError: null, row: null, items: [], storedRetainer: 400000, enteredByName: null,
    save: vi.fn().mockResolvedValue({ ok: true }), reload: vi.fn(), ...over,
  }
}

function setup(payment: UseMonthPayment, canEdit = true) {
  const onSaved = vi.fn()
  const view = render(<PaymentsBox canEdit={canEdit} clientId={7} clientName="Acme" onSaved={onSaved} payment={payment} period="2026-10-01" />)
  return { onSaved, view }
}
const retainer = () => screen.getByLabelText('Retainer') as HTMLInputElement
const label = (n = 1) => screen.getByLabelText(`Line item ${n} label`) as HTMLInputElement
const amount = (n = 1) => screen.getByLabelText(`Line item ${n} amount`) as HTMLInputElement
const project = () => amount(1)
const total = () => screen.getByTestId('project-total').textContent
const ITEMS = [{ label: 'Photo shoot', cents: 150000 }, { label: 'Dev fees', cents: 25000 }]

describe('PaymentsBox', () => {
  afterEach(cleanup)

  it('renders nothing for someone who may not see revenue', () => {
    const { view } = setup(fake({ status: 'off' }))
    expect(view.container.textContent).toBe('')
  })

  it('shows the heading and caption', () => {
    setup(fake())
    expect(screen.getByRole('heading', { level: 4 }).textContent).toBe('October payments')
    expect(screen.getByText('Invoiced in October')).toBeTruthy()
  })

  it('shows the stored retainer as ghost text, not as a value', () => {
    setup(fake())
    expect(retainer().value).toBe('')
    expect(retainer().placeholder).toBe('$4,000')
    expect(project().placeholder).toBe('$0')
    expect(retainer().inputMode).toBe('decimal')
  })

  it('confirms the stored retainer with one click', async () => {
    const p = fake()
    const { onSaved } = setup(p)
    await userEvent.click(screen.getByRole('button', { name: 'Confirm $4,000 retainer' }))
    expect(p.save).toHaveBeenCalledWith({ retainerCents: 400000, projectCents: 0, projectNotes: null, items: [], setRetainer: false })
    expect(screen.queryByText(/from now on/)).toBeNull()
    await waitFor(() => expect(onSaved).toHaveBeenCalled())
  })

  it('a project line item alone keeps the ghost retainer and asks nothing', async () => {
    const p = fake()
    setup(p)
    await userEvent.type(label(), 'Photo shoot')
    await userEvent.type(project(), '1,500')
    await userEvent.click(screen.getByRole('button', { name: 'Save' }))
    expect(p.save).toHaveBeenCalledWith({
      retainerCents: 400000, projectCents: 150000, projectNotes: null, items: [{ label: 'Photo shoot', cents: 150000 }], setRetainer: false,
    })
    expect(screen.queryByText(/from now on/)).toBeNull()
  })

  it('a different retainer asks before writing anything', async () => {
    const p = fake()
    setup(p)
    await userEvent.type(retainer(), '3000')
    await userEvent.click(screen.getByRole('button', { name: 'Save' }))
    expect(p.save).not.toHaveBeenCalled()
    expect(screen.getByText(/Change it to \$3,000 from now on\?/)).toBeTruthy()
    await userEvent.click(screen.getByRole('button', { name: 'No, just October' }))
    expect(p.save).toHaveBeenCalledWith({ retainerCents: 300000, projectCents: 0, projectNotes: null, items: [], setRetainer: false })
  })

  it('Yes, update the retainer sets the retainer', async () => {
    const p = fake()
    setup(p)
    await userEvent.type(retainer(), '3000')
    await userEvent.click(screen.getByRole('button', { name: 'Save' }))
    await userEvent.click(screen.getByRole('button', { name: 'Yes, update the retainer' }))
    expect(p.save).toHaveBeenCalledWith({ retainerCents: 300000, projectCents: 0, projectNotes: null, items: [], setRetainer: true })
  })

  it('typing 0 offers to remove the retainer', async () => {
    const p = fake()
    setup(p)
    await userEvent.type(retainer(), '0')
    await userEvent.click(screen.getByRole('button', { name: 'Save' }))
    expect(p.save).not.toHaveBeenCalled()
    expect(screen.getByText(/Remove it from now on\?/)).toBeTruthy()
    await userEvent.click(screen.getByRole('button', { name: 'Yes, update the retainer' }))
    expect(p.save).toHaveBeenCalledWith({ retainerCents: 0, projectCents: 0, projectNotes: null, items: [], setRetainer: true })
  })

  it('a saved month shows its figures as values and editing only project asks nothing', async () => {
    const p = fake({ row: ROW, enteredByName: 'Sam' })
    setup(p)
    expect(retainer().value).toBe('3000')
    expect(label().value).toBe('Project')
    expect(project().value).toBe('500')
    expect(screen.getByText('Entered by Sam, Nov 4')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Save' })).toBeTruthy()
    await userEvent.clear(project())
    await userEvent.type(project(), '600')
    await userEvent.click(screen.getByRole('button', { name: 'Save' }))
    expect(screen.queryByText(/from now on/)).toBeNull()
    expect(p.save).toHaveBeenCalledWith({
      retainerCents: 300000, projectCents: 60000, projectNotes: null, items: [{ label: 'Project', cents: 60000 }], setRetainer: false,
    })
  })

  it('a saved month never shows the stored retainer as ghost text', async () => {
    setup(fake({ row: ROW }))
    await userEvent.clear(retainer())
    expect(retainer().placeholder).toBe('No retainer')
  })

  it('a saved row with no name says Entered <day>', () => {
    setup(fake({ row: ROW }))
    expect(screen.getByText('Entered Nov 4')).toBeTruthy()
  })

  it('a client with no retainer shows No retainer and a Save button', () => {
    setup(fake({ storedRetainer: null }))
    expect(retainer().placeholder).toBe('No retainer')
    expect(screen.getByRole('button', { name: 'Save' })).toBeTruthy()
  })

  it('an account manager sees Not entered yet and no amounts', () => {
    const { view } = setup(fake(), false)
    expect(screen.getByText('Not entered yet')).toBeTruthy()
    expect(view.container.textContent).not.toContain('$4,000')
    expect(screen.queryByRole('textbox')).toBeNull()
    expect(screen.queryByRole('button')).toBeNull()
  })

  it('an account manager sees a saved month read-only', () => {
    const { view } = setup(fake({ row: ROW }), false)
    expect(view.container.textContent).toContain('$3,000')
    expect(view.container.textContent).toContain('$500')
    expect(screen.queryByRole('textbox')).toBeNull()
    expect(screen.queryByRole('button')).toBeNull()
  })

  // Brief 2026-11-05 B3: the single Project amount and the notes textarea
  // give way to a list of line items.
  it('has no single Project amount and no notes textarea any more', () => {
    const { view } = setup(fake({ row: { ...ROW, project_notes: 'x' } }))
    expect(screen.queryByLabelText('Project')).toBeNull()
    expect(screen.queryByLabelText('Project notes')).toBeNull()
    expect(view.container.querySelector('textarea')).toBeNull()
  })

  it('shows one empty line item to start, with its placeholder, amount and Remove', () => {
    setup(fake())
    expect(screen.getByText('Project line items')).toBeTruthy()
    expect(label().value).toBe('')
    expect(label().placeholder).toBe('e.g. Photo shoot')
    // No maxLength: padding must not count. The trimmed label is what is
    // checked, at Save (see the 120-character test below).
    expect(label().hasAttribute('maxlength')).toBe(false)
    expect(amount().value).toBe('')
    expect(amount().placeholder).toBe('$0')
    expect(amount().inputMode).toBe('decimal')
    expect(screen.getByRole('button', { name: 'Remove line item 1' }).textContent).toBe('Remove')
    expect(total()).toBe('Project total: $0')
  })

  it('shows the saved items, one row each, in order, with their total', () => {
    setup(fake({ row: { ...ROW, project_cents: 175000 }, items: ITEMS }))
    expect([label(1).value, amount(1).value]).toEqual(['Photo shoot', '1500'])
    expect([label(2).value, amount(2).value]).toEqual(['Dev fees', '250'])
    expect(screen.queryByLabelText('Line item 3 label')).toBeNull()
    expect(total()).toBe('Project total: $1,750')
  })

  it('Add line item adds an empty row, and the total follows what is typed', async () => {
    setup(fake())
    await userEvent.type(label(1), 'Shoot')
    await userEvent.type(amount(1), '1,000')
    await userEvent.click(screen.getByRole('button', { name: 'Add line item' }))
    expect(label(2).value).toBe('')
    await userEvent.type(label(2), 'Dev')
    await userEvent.type(amount(2), '250.50')
    expect(total()).toBe('Project total: $1,250.50')
  })

  // Review of brief 2026-11-05 B, Important 3: real multi-item months.
  it('a saved month with two items, editing only the retainer, sends both items unchanged', async () => {
    const p = fake({ row: { ...ROW, project_cents: 175000 }, items: ITEMS })
    setup(p)
    await userEvent.clear(retainer())
    await userEvent.type(retainer(), '3000')
    await userEvent.click(screen.getByRole('button', { name: 'Save' }))
    expect(screen.queryByText(/from now on/)).toBeNull()
    expect(p.save).toHaveBeenCalledWith({
      retainerCents: 300000, projectCents: 175000, projectNotes: null, items: ITEMS, setRetainer: false,
    })
  })

  it('removing both items sends an empty list and a project of 0', async () => {
    const p = fake({ row: { ...ROW, project_cents: 175000 }, items: ITEMS })
    setup(p)
    await userEvent.click(screen.getByRole('button', { name: 'Remove line item 2' }))
    await userEvent.click(screen.getByRole('button', { name: 'Remove line item 1' }))
    expect(screen.queryByLabelText('Line item 1 label')).toBeNull()
    expect(total()).toBe('Project total: $0')
    await userEvent.click(screen.getByRole('button', { name: 'Save' }))
    expect(p.save).toHaveBeenCalledWith({
      retainerCents: 300000, projectCents: 0, projectNotes: null, items: [], setRetainer: false,
    })
  })

  it('keeps each row with its own text when an earlier row is removed (stable keys)', async () => {
    setup(fake({ row: { ...ROW, project_cents: 175000 }, items: ITEMS }))
    const second = label(2)
    await userEvent.click(screen.getByRole('button', { name: 'Remove line item 1' }))
    // The same input element now sits first, still holding its own label.
    expect(label(1)).toBe(second)
    expect(label(1).value).toBe('Dev fees')
  })

  it('counts a label\'s length after trimming: 120 characters with padding saves, 121 does not', async () => {
    const p = fake()
    setup(p)
    fireEvent.change(label(), { target: { value: `  ${'a'.repeat(120)}  ` } })
    await userEvent.type(amount(), '5')
    await userEvent.click(screen.getByRole('button', { name: 'Save' }))
    expect(p.save).toHaveBeenCalledWith(expect.objectContaining({ items: [{ label: 'a'.repeat(120), cents: 500 }] }))
    fireEvent.change(label(), { target: { value: 'a'.repeat(121) } })
    await userEvent.click(screen.getByRole('button', { name: 'Save' }))
    expect(screen.getByText('Keep the label to 120 characters.')).toBeTruthy()
    expect(p.save).toHaveBeenCalledTimes(1)
  })

  it('labels an older month\'s single row with its short note', () => {
    setup(fake({ row: { ...ROW, project_notes: 'Photo shoot' } }))
    expect(label().value).toBe('Photo shoot')
    expect(screen.getByTestId('earlier-note').textContent).toBe('Earlier note: Photo shoot')
  })

  it('Remove takes the row out, and its amount out of the total', async () => {
    const p = fake({ row: { ...ROW, project_cents: 175000 }, items: ITEMS })
    setup(p)
    await userEvent.click(screen.getByRole('button', { name: 'Remove line item 1' }))
    expect(label(1).value).toBe('Dev fees')
    expect(screen.queryByLabelText('Line item 2 label')).toBeNull()
    expect(total()).toBe('Project total: $250')
    await userEvent.click(screen.getByRole('button', { name: 'Save' }))
    expect(p.save).toHaveBeenCalledWith({
      retainerCents: 300000, projectCents: 25000, projectNotes: null, items: [{ label: 'Dev fees', cents: 25000 }], setRetainer: false,
    })
  })

  it('sends every item, trimmed, ignoring fully empty rows, and the sum as the project amount', async () => {
    const p = fake()
    setup(p)
    await userEvent.type(label(1), '  Photo shoot ')
    await userEvent.type(amount(1), '1,500')
    await userEvent.click(screen.getByRole('button', { name: 'Add line item' }))
    await userEvent.click(screen.getByRole('button', { name: 'Add line item' }))
    await userEvent.type(label(3), 'Dev')
    await userEvent.type(amount(3), '25')
    await userEvent.click(screen.getByRole('button', { name: 'Save' }))
    expect(p.save).toHaveBeenCalledWith({
      retainerCents: 400000,
      projectCents: 152500,
      projectNotes: null,
      items: [{ label: 'Photo shoot', cents: 150000 }, { label: 'Dev', cents: 2500 }],
      setRetainer: false,
    })
  })

  it('an amount with no label shows an inline error and saves nothing', async () => {
    const p = fake()
    setup(p)
    await userEvent.type(amount(), '500')
    await userEvent.click(screen.getByRole('button', { name: 'Save' }))
    expect(p.save).not.toHaveBeenCalled()
    const error = screen.getByText('Add a label for this amount.')
    expect(label().getAttribute('aria-invalid')).toBe('true')
    expect(label().getAttribute('aria-describedby')).toBe(error.id)
    expect(amount().getAttribute('aria-describedby')).toBe(error.id)
  })

  it('a label with no amount, or a zero, shows an inline error and saves nothing', async () => {
    const p = fake()
    setup(p)
    await userEvent.type(label(), 'Shoot')
    await userEvent.click(screen.getByRole('button', { name: 'Save' }))
    expect(screen.getByText('Add an amount above $0.')).toBeTruthy()
    await userEvent.type(amount(), '0')
    await userEvent.click(screen.getByRole('button', { name: 'Save' }))
    expect(screen.getByText('Add an amount above $0.')).toBeTruthy()
    expect(p.save).not.toHaveBeenCalled()
  })

  it('stays blocked until the row is fixed, then saves', async () => {
    const p = fake()
    setup(p)
    await userEvent.type(amount(), 'abc')
    await userEvent.type(label(), 'Shoot')
    await userEvent.click(screen.getByRole('button', { name: 'Save' }))
    expect(screen.getByText('Not a dollar amount up to $21,474,836.47.')).toBeTruthy()
    expect(screen.getByRole('alert').textContent).toBe('Fix the line items marked above. Nothing was saved.')
    expect(p.save).not.toHaveBeenCalled()
    await userEvent.clear(amount())
    await userEvent.type(amount(), '40')
    expect(screen.queryByText('Not a dollar amount up to $21,474,836.47.')).toBeNull()
    await userEvent.click(screen.getByRole('button', { name: 'Save' }))
    expect(p.save).toHaveBeenCalledWith({
      retainerCents: 400000, projectCents: 4000, projectNotes: null, items: [{ label: 'Shoot', cents: 4000 }], setRetainer: false,
    })
  })

  it('shows an earlier note read-only under the list, and keeps it on save', async () => {
    const p = fake({ row: { ...ROW, project_notes: '$500 dev fees' } })
    setup(p)
    expect(screen.getByTestId('earlier-note').textContent).toBe('Earlier note: $500 dev fees')
    await userEvent.click(screen.getByRole('button', { name: 'Save' }))
    expect(p.save).toHaveBeenCalledWith({
      retainerCents: 300000, projectCents: 50000, projectNotes: '$500 dev fees', items: [{ label: '$500 dev fees', cents: 50000 }], setRetainer: false,
    })
  })

  it('shows no earlier note when there is none', () => {
    setup(fake({ row: ROW }))
    expect(screen.queryByTestId('earlier-note')).toBeNull()
  })

  it('sends the items through the retainer question too', async () => {
    const p = fake()
    setup(p)
    await userEvent.type(retainer(), '3000')
    await userEvent.type(label(), 'Shoot')
    await userEvent.type(amount(), '10')
    await userEvent.click(screen.getByRole('button', { name: 'Save' }))
    await userEvent.click(screen.getByRole('button', { name: 'Yes, update the retainer' }))
    expect(p.save).toHaveBeenCalledWith({
      retainerCents: 300000, projectCents: 1000, projectNotes: null, items: [{ label: 'Shoot', cents: 1000 }], setRetainer: true,
    })
  })

  it('disables the line items while saving', async () => {
    let release: () => void = () => {}
    const p = fake({ save: vi.fn(() => new Promise((r) => { release = () => r({ ok: true }) })) as UseMonthPayment['save'] })
    setup(p)
    await userEvent.click(screen.getByRole('button', { name: 'Confirm $4,000 retainer' }))
    await waitFor(() => expect(label().disabled).toBe(true))
    expect(amount().disabled).toBe(true)
    expect((screen.getByRole('button', { name: 'Add line item' }) as HTMLButtonElement).disabled).toBe(true)
    expect((screen.getByRole('button', { name: 'Remove line item 1' }) as HTMLButtonElement).disabled).toBe(true)
    release()
    await waitFor(() => expect(label().disabled).toBe(false))
  })

  it('a viewer sees the items as text, with their total, and no inputs', () => {
    const { view } = setup(fake({ row: { ...ROW, project_cents: 175000, project_notes: 'old words' }, items: ITEMS }), false)
    const listed = screen.getAllByTestId('project-item').map((li) => li.textContent)
    expect(listed).toEqual(['Photo shoot – $1,500', 'Dev fees – $250'])
    expect(total()).toBe('Project total: $1,750')
    expect(screen.getByTestId('earlier-note').textContent).toBe('Earlier note: old words')
    expect(screen.queryByRole('textbox')).toBeNull()
    expect(screen.queryByRole('button')).toBeNull()
    expect(view.container.querySelector('textarea')).toBeNull()
  })

  it('a viewer sees an older month as one Project item', () => {
    setup(fake({ row: ROW }), false)
    expect(screen.getAllByTestId('project-item').map((li) => li.textContent)).toEqual(['Project – $500'])
  })

  it('a viewer sees no items list for a month with no project work', () => {
    setup(fake({ row: { ...ROW, project_cents: 0 } }), false)
    expect(screen.queryAllByTestId('project-item')).toEqual([])
    expect(total()).toBe('Project total: $0')
  })


  it('an invalid retainer names the Retainer field', async () => {
    const p = fake()
    setup(p)
    await userEvent.type(retainer(), '-5')
    await userEvent.click(screen.getByRole('button', { name: 'Save' }))
    expect(screen.getByRole('alert').textContent).toMatch(/^Retainer is not a dollar amount/)
    expect(p.save).not.toHaveBeenCalled()
  })

  it('a failed save keeps what was typed and says why', async () => {
    const p = fake({ save: vi.fn().mockResolvedValue({ ok: false, error: 'permission denied' }) })
    const { onSaved } = setup(p)
    await userEvent.type(label(), 'Shoot')
    await userEvent.type(project(), '250')
    await userEvent.click(screen.getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(screen.getByRole('alert').textContent).toContain('permission denied'))
    expect(project().value).toBe('250')
    expect(onSaved).not.toHaveBeenCalled()
  })

  it('shows loading and error states', () => {
    setup(fake({ status: 'loading' }))
    expect(screen.getByText('Loading payments…')).toBeTruthy()
    cleanup()
    setup(fake({ status: 'error', loadError: 'boom' }))
    expect(screen.getByRole('alert').textContent).toBe('boom')
  })

  it('resets the fields when the row is replaced after a reload', () => {
    const p = fake({ row: ROW })
    const { view } = setup(p)
    view.rerender(
      <PaymentsBox canEdit clientId={7} clientName="Acme" onSaved={vi.fn()} period="2026-10-01"
        payment={{ ...p, row: { ...ROW, project_cents: 70000 } }} />,
    )
    expect(project().value).toBe('700')
  })

  it('resets the line items when the items are replaced after a reload', () => {
    const p = fake({ row: ROW })
    const { view } = setup(p)
    view.rerender(
      <PaymentsBox canEdit clientId={7} clientName="Acme" onSaved={vi.fn()} period="2026-10-01"
        payment={{ ...p, row: { ...ROW, project_cents: 175000 }, items: ITEMS }} />,
    )
    expect(label(2).value).toBe('Dev fees')
  })

  it('clearing Retainer on a saved month asks, and never stores the ghost', async () => {
    const p = fake({ row: ROW })
    setup(p)
    await userEvent.clear(retainer())
    await userEvent.click(screen.getByRole('button', { name: 'Save' }))
    expect(p.save).not.toHaveBeenCalled()
    expect(screen.getByText(/Remove it from now on\?/)).toBeTruthy()
    await userEvent.click(screen.getByRole('button', { name: 'No, just October' }))
    expect(p.save).toHaveBeenCalledWith({
      retainerCents: 0, projectCents: 50000, projectNotes: null, items: [{ label: 'Project', cents: 50000 }], setRetainer: false,
    })
  })

  it('a new month with no row clears typed fields and an open question', async () => {
    const p = fake()
    const { view } = setup(p)
    await userEvent.type(retainer(), '3000')
    await userEvent.click(screen.getByRole('button', { name: 'Save' }))
    expect(screen.getByText(/from now on/)).toBeTruthy()
    view.rerender(
      <PaymentsBox canEdit clientId={7} clientName="Acme" onSaved={vi.fn()} payment={p} period="2026-09-01" />,
    )
    expect(retainer().value).toBe('')
    expect(screen.queryByText(/from now on/)).toBeNull()
  })

  it('a different client with no row clears typed fields and an open question', async () => {
    const p = fake()
    const { view } = setup(p)
    await userEvent.type(project(), '900')
    await userEvent.type(retainer(), '3000')
    await userEvent.click(screen.getByRole('button', { name: 'Save' }))
    view.rerender(
      <PaymentsBox canEdit clientId={8} clientName="Delta" onSaved={vi.fn()} payment={p} period="2026-10-01" />,
    )
    expect(project().value).toBe('')
    expect(screen.queryByText(/from now on/)).toBeNull()
  })

  it('Cancel closes the question and writes nothing', async () => {
    const p = fake()
    setup(p)
    await userEvent.type(retainer(), '3000')
    await userEvent.click(screen.getByRole('button', { name: 'Save' }))
    await userEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(screen.queryByText(/from now on/)).toBeNull()
    expect(p.save).not.toHaveBeenCalled()
    expect(retainer().value).toBe('3000')
  })

  it('disables the inputs while saving and a double click saves once', async () => {
    let finish: (r: { ok: true }) => void = () => {}
    const p = fake({ save: vi.fn(() => new Promise<{ ok: true }>((r) => { finish = r })) })
    setup(p)
    await userEvent.type(retainer(), '3000')
    await userEvent.click(screen.getByRole('button', { name: 'Save' }))
    const yes = screen.getByRole('button', { name: 'Yes, update the retainer' })
    await userEvent.click(yes)
    await userEvent.click(yes)
    expect(p.save).toHaveBeenCalledTimes(1)
    expect(retainer().disabled).toBe(true)
    expect(project().disabled).toBe(true)
    finish({ ok: true })
    await waitFor(() => expect(retainer().disabled).toBe(false))
  })
})

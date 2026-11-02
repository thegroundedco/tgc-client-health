// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { MonthRow } from '../revenue/paymentBox'
import type { UseMonthPayment } from '../revenue/useMonthPayment'
import { PaymentsBox } from './PaymentsBox'

const ROW: MonthRow = { retainer_cents: 300000, project_cents: 50000, entered_by: 'p1', updated_at: '2026-11-04T12:00:00Z' }

function fake(over: Partial<UseMonthPayment> = {}): UseMonthPayment {
  return {
    status: 'ready', loadError: null, row: null, storedRetainer: 400000, enteredByName: null,
    save: vi.fn().mockResolvedValue({ ok: true }), reload: vi.fn(), ...over,
  }
}

function setup(payment: UseMonthPayment, canEdit = true) {
  const onSaved = vi.fn()
  const view = render(<PaymentsBox canEdit={canEdit} clientName="Acme" onSaved={onSaved} payment={payment} period="2026-10-01" />)
  return { onSaved, view }
}
const retainer = () => screen.getByLabelText('Retainer') as HTMLInputElement
const project = () => screen.getByLabelText('Project') as HTMLInputElement

describe('PaymentsBox', () => {
  afterEach(cleanup)

  it('renders nothing for someone who may not see revenue', () => {
    const { view } = setup(fake({ status: 'off' }))
    expect(view.container.textContent).toBe('')
  })

  it('shows the heading and caption', () => {
    setup(fake())
    expect(screen.getByRole('heading', { level: 3 }).textContent).toBe('October payments')
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
    expect(p.save).toHaveBeenCalledWith({ retainerCents: 400000, projectCents: 0, setRetainer: false })
    expect(screen.queryByText(/from now on/)).toBeNull()
    await waitFor(() => expect(onSaved).toHaveBeenCalled())
  })

  it('a project amount alone keeps the ghost retainer and asks nothing', async () => {
    const p = fake()
    setup(p)
    await userEvent.type(project(), '1,500')
    await userEvent.click(screen.getByRole('button', { name: 'Save' }))
    expect(p.save).toHaveBeenCalledWith({ retainerCents: 400000, projectCents: 150000, setRetainer: false })
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
    expect(p.save).toHaveBeenCalledWith({ retainerCents: 300000, projectCents: 0, setRetainer: false })
  })

  it('Yes, update the retainer sets the retainer', async () => {
    const p = fake()
    setup(p)
    await userEvent.type(retainer(), '3000')
    await userEvent.click(screen.getByRole('button', { name: 'Save' }))
    await userEvent.click(screen.getByRole('button', { name: 'Yes, update the retainer' }))
    expect(p.save).toHaveBeenCalledWith({ retainerCents: 300000, projectCents: 0, setRetainer: true })
  })

  it('typing 0 offers to remove the retainer', async () => {
    const p = fake()
    setup(p)
    await userEvent.type(retainer(), '0')
    await userEvent.click(screen.getByRole('button', { name: 'Save' }))
    expect(p.save).not.toHaveBeenCalled()
    expect(screen.getByText(/Remove it from now on\?/)).toBeTruthy()
    await userEvent.click(screen.getByRole('button', { name: 'Yes, update the retainer' }))
    expect(p.save).toHaveBeenCalledWith({ retainerCents: 0, projectCents: 0, setRetainer: true })
  })

  it('a saved month shows its figures as values and editing only project asks nothing', async () => {
    const p = fake({ row: ROW, enteredByName: 'Sam' })
    setup(p)
    expect(retainer().value).toBe('3000')
    expect(project().value).toBe('500')
    expect(screen.getByText('Entered by Sam, Nov 4')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Save' })).toBeTruthy()
    await userEvent.clear(project())
    await userEvent.type(project(), '600')
    await userEvent.click(screen.getByRole('button', { name: 'Save' }))
    expect(screen.queryByText(/from now on/)).toBeNull()
    expect(p.save).toHaveBeenCalledWith({ retainerCents: 300000, projectCents: 60000, setRetainer: false })
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

  it('an invalid amount is refused and nothing is saved', async () => {
    const p = fake()
    setup(p)
    await userEvent.type(project(), 'abc')
    await userEvent.click(screen.getByRole('button', { name: 'Save' }))
    expect(p.save).not.toHaveBeenCalled()
    expect(screen.getByRole('alert').textContent).toBe(
      'Project is not a dollar amount up to $21,474,836.47. Nothing was saved.',
    )
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
      <PaymentsBox canEdit clientName="Acme" onSaved={vi.fn()} period="2026-10-01"
        payment={{ ...p, row: { ...ROW, project_cents: 70000 } }} />,
    )
    expect(project().value).toBe('700')
  })
})

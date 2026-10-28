// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const hook = vi.hoisted(() => ({
  apply: vi.fn(async () => true),
  state: { kind: 'idle' } as { kind: string; message?: string },
}))
vi.mock('../clients/useStatusChange', () => ({
  useStatusChange: () => ({ state: hook.state, apply: hook.apply }),
}))

import { EndClientPanel } from './EndClientPanel'

const ACTIVE = { id: 7, name: 'Acme', status: 'active', started_on: '2026-09-16' }

function renderPanel(overrides: Partial<Parameters<typeof EndClientPanel>[0]> = {}) {
  const onPaused = vi.fn()
  render(<EndClientPanel client={ACTIVE} hasCheckin={false} onPaused={onPaused} period="2026-09-01" {...overrides} />)
  return { onPaused }
}

describe('EndClientPanel', () => {
  afterEach(cleanup)
  beforeEach(() => { hook.apply.mockReset(); hook.apply.mockResolvedValue(true); hook.state = { kind: 'idle' } })

  it('offers both actions for an active client', () => {
    renderPanel()
    expect(screen.getByRole('button', { name: 'Paused this month' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Cancelled this month' })).toBeTruthy()
  })

  it('offers only cancel for a paused client', () => {
    renderPanel({ client: { ...ACTIVE, status: 'paused' } })
    expect(screen.queryByRole('button', { name: 'Paused this month' })).toBeNull()
    expect(screen.getByRole('button', { name: 'Cancelled this month' })).toBeTruthy()
  })

  it.each(['cancelled', 'former'])('offers nothing for a %s client, whose end must not be overwritten', (status) => {
    const { container } = render(
      <EndClientPanel client={{ ...ACTIVE, status }} hasCheckin onPaused={vi.fn()} period="2026-09-01" />,
    )
    expect(container.textContent).toBe('')
  })

  it('pauses only after confirming, then leaves the screen', async () => {
    const { onPaused } = renderPanel()
    await userEvent.click(screen.getByRole('button', { name: 'Paused this month' }))
    expect(hook.apply).not.toHaveBeenCalled()
    await userEvent.click(screen.getByRole('button', { name: 'Pause Acme' }))
    expect(hook.apply).toHaveBeenCalledWith({ kind: 'pause' })
    expect(onPaused).toHaveBeenCalledTimes(1)
  })

  it('says a client with a check-in stays on this month', async () => {
    renderPanel({ hasCheckin: true })
    await userEvent.click(screen.getByRole('button', { name: 'Paused this month' }))
    expect(screen.getByText(/stay on September 2026’s board because they already have a check-in/)).toBeTruthy()
  })

  it('does not leave the screen when the pause fails', async () => {
    hook.apply.mockResolvedValue(false)
    const { onPaused } = renderPanel()
    await userEvent.click(screen.getByRole('button', { name: 'Paused this month' }))
    await userEvent.click(screen.getByRole('button', { name: 'Pause Acme' }))
    expect(onPaused).not.toHaveBeenCalled()
  })

  it('bounds the end date to the month, from the start date, defaulting to the last day', async () => {
    renderPanel()
    await userEvent.click(screen.getByRole('button', { name: 'Cancelled this month' }))
    const date = screen.getByLabelText('End date') as HTMLInputElement
    expect([date.min, date.max, date.value]).toEqual(['2026-09-16', '2026-09-30', '2026-09-30'])
  })

  it('refuses a cancellation with no reason before sending anything', async () => {
    renderPanel()
    await userEvent.click(screen.getByRole('button', { name: 'Cancelled this month' }))
    await userEvent.click(screen.getByRole('button', { name: 'Mark cancelled' }))
    expect(hook.apply).not.toHaveBeenCalled()
    expect(screen.getByText('A cancelled or former client needs a reason from the list.')).toBeTruthy()
  })

  it('cancels and stays, saying the check-in can still be finished', async () => {
    const { onPaused } = renderPanel()
    await userEvent.click(screen.getByRole('button', { name: 'Cancelled this month' }))
    await userEvent.selectOptions(screen.getByLabelText('Reason they left'), 'price')
    await userEvent.click(screen.getByRole('button', { name: 'Mark cancelled' }))
    expect(hook.apply).toHaveBeenCalledWith({ kind: 'cancel', endedOn: '2026-09-30', endReasonCode: 'price', endReasonNote: '' })
    expect(onPaused).not.toHaveBeenCalled()
    expect(screen.getByText('Acme is cancelled as of September 30, 2026. You can still finish this check-in. To undo it, use Edit client.')).toBeTruthy()
  })

  it('does not claim a cancellation the hook refused, and keeps the form', async () => {
    hook.apply.mockResolvedValue(false)
    renderPanel()
    await userEvent.click(screen.getByRole('button', { name: 'Cancelled this month' }))
    await userEvent.selectOptions(screen.getByLabelText('Reason they left'), 'price')
    await userEvent.click(screen.getByRole('button', { name: 'Mark cancelled' }))
    expect(hook.apply).toHaveBeenCalledTimes(1)
    expect(screen.queryByText(/is cancelled as of/)).toBeNull()
    expect(screen.getByRole('button', { name: 'Mark cancelled' })).toBeTruthy()
  })

  // A check-in can admit a client to a month they started after (the board
  // keeps anyone with a check-in). Then the end date's bounds invert and no date
  // satisfies them, so the form would be impossible to submit: do not offer it.
  it('offers no cancel when the client started after the month being scored', () => {
    renderPanel({ client: { ...ACTIVE, started_on: '2026-10-07' }, hasCheckin: true })
    expect(screen.queryByRole('button', { name: 'Cancelled this month' })).toBeNull()
    expect(screen.getByRole('button', { name: 'Paused this month' })).toBeTruthy()
  })

  it('renders nothing for a paused client who started after the month being scored', () => {
    const { container } = render(
      <EndClientPanel client={{ ...ACTIVE, status: 'paused', started_on: '2026-10-07' }} hasCheckin onPaused={vi.fn()} period="2026-09-01" />,
    )
    expect(container.textContent).toBe('')
  })

  it('shows the failure the hook reports', () => {
    hook.state = { kind: 'failed', message: 'Nope. Nothing was changed.' }
    renderPanel()
    expect(screen.getByRole('alert').textContent).toBe('Nope. Nothing was changed.')
  })
  it('refuses an end date outside the month before sending anything, and says the bounds', async () => {
    renderPanel()
    await userEvent.click(screen.getByRole('button', { name: 'Cancelled this month' }))
    fireEvent.change(screen.getByLabelText('End date'), { target: { value: '2026-09-15' } })
    await userEvent.selectOptions(screen.getByLabelText('Reason they left'), 'price')
    await userEvent.click(screen.getByRole('button', { name: 'Mark cancelled' }))
    expect(hook.apply).not.toHaveBeenCalled()
    expect(screen.getByText('The end date has to fall between September 16, 2026 and September 30, 2026.')).toBeTruthy()
  })
})

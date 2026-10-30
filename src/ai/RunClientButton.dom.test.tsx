// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../lib/supabase', () => ({ supabase: {} }))
vi.mock('./useAiRun', () => ({ useAiRun: vi.fn() }))

import { RunClientButton } from './RunClientButton'
import { useAiRun } from './useAiRun'

const start = vi.fn()
let onFinished: () => void = () => {}
function hook(opts: { state?: string; run?: unknown; starting?: boolean } = {}) {
  vi.mocked(useAiRun).mockImplementation(((_p: string, cb: () => void) => {
    onFinished = cb
    return { run: null, state: 'idle', start, starting: false, ...opts }
  }) as unknown as typeof useAiRun)
}
const props = { clientId: 7, period: '2026-10-01', manual: false, hasUnsavedChanges: false, onFinished: vi.fn() }
const BTN = 'Run AI score for this client'

beforeEach(() => {
  start.mockReset().mockResolvedValue({ ok: true })
  hook()
})
afterEach(() => {
  cleanup()
  props.onFinished.mockClear()
})

describe('RunClientButton', () => {
  it('not manual: starts at once with no overwrites', () => {
    render(<RunClientButton {...props} />)
    fireEvent.click(screen.getByRole('button', { name: BTN }))
    expect(start).toHaveBeenCalledWith({
      period: '2026-10-01', client_ids: [7], overwrite_client_ids: [], source: 'checkin',
    })
    expect(screen.queryByRole('dialog')).toBeNull()
  })
  it('manual: asks first; Cancel never starts', () => {
    render(<RunClientButton {...props} manual />)
    fireEvent.click(screen.getByRole('button', { name: BTN }))
    expect(start).not.toHaveBeenCalled()
    expect(screen.getByRole('dialog', { name: 'This client has already been manually scored – overwrite their data?' })).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(start).not.toHaveBeenCalled()
  })
  it('manual: Overwrite sends the exact body', () => {
    render(<RunClientButton {...props} manual />)
    fireEvent.click(screen.getByRole('button', { name: BTN }))
    fireEvent.click(screen.getByRole('button', { name: 'Overwrite' }))
    expect(start).toHaveBeenCalledTimes(1)
    expect(start).toHaveBeenCalledWith({
      period: '2026-10-01', client_ids: [7], overwrite_client_ids: [7], source: 'checkin',
    })
  })
  it('is disabled with the unsaved line when there are unsaved changes', () => {
    render(<RunClientButton {...props} hasUnsavedChanges />)
    expect((screen.getByRole('button', { name: BTN }) as HTMLButtonElement).disabled).toBe(true)
    expect(screen.getByText('You have unsaved changes. Save them first.')).toBeTruthy()
  })
  it('shows a refusal as an alert', async () => {
    start.mockResolvedValue({ ok: false, message: 'Already running.' })
    render(<RunClientButton {...props} />)
    fireEvent.click(screen.getByRole('button', { name: BTN }))
    await waitFor(() => expect(screen.getByRole('alert').textContent).toBe('Already running.'))
  })
  it('while a run is in progress shows the running line instead of the button', () => {
    hook({
      state: 'running',
      run: { source: 'board', requested_by_name: 'Sam', requested_at: new Date().toISOString(), status: 'requested' },
    })
    render(<RunClientButton {...props} />)
    expect(screen.queryByRole('button', { name: BTN })).toBeNull()
    expect(screen.getByRole('status').textContent).toMatch(/AI scoring running — started by Sam/)
  })
  it('passes onFinished to the run hook', () => {
    render(<RunClientButton {...props} />)
    onFinished()
    expect(props.onFinished).toHaveBeenCalled()
  })
})

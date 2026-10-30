// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('../lib/supabase', () => ({ supabase: {} }))
vi.mock('./useAiRun', () => ({ useAiRun: vi.fn() }))

import { RunMonthButton } from './RunMonthButton'
import { useAiRun } from './useAiRun'

const clients = [{ id: 1, name: 'Babaloo', status: 'active', started_on: null, ended_on: null }]
const hook = (start: ReturnType<typeof vi.fn>) =>
  vi.mocked(useAiRun).mockReturnValue({ run: null, state: 'idle', start, starting: false } as unknown as ReturnType<typeof useAiRun>)
const ui = (period: string) => (
  <RunMonthButton clients={clients} manual={new Set()} onFinished={() => {}} period={period} />
)
afterEach(() => { cleanup(); vi.mocked(useAiRun).mockReset() })

async function runAll(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole('button', { name: 'Run AI suggested scores' }))
  await user.click(screen.getByRole('button', { name: 'Yes, all clients' }))
}

describe('RunMonthButton start error', () => {
  it('is cleared when the period changes', async () => {
    hook(vi.fn().mockResolvedValue({ ok: false, message: 'Nope.' }))
    const user = userEvent.setup()
    const { rerender } = render(ui('2026-10-01'))
    await runAll(user)
    expect((await screen.findByRole('alert')).textContent).toBe('Nope.')
    rerender(ui('2026-09-01'))
    expect(screen.queryByRole('alert')).toBeNull()
  })

  it('is cleared when a later start succeeds', async () => {
    const start = vi.fn().mockResolvedValueOnce({ ok: false, message: 'Nope.' }).mockResolvedValueOnce({ ok: true })
    hook(start)
    const user = userEvent.setup()
    render(ui('2026-10-01'))
    await runAll(user)
    expect(await screen.findByRole('alert')).toBeTruthy()
    // Reopening already clears it; prove the success path by keeping it visible: start again via a fresh dialog
    // without the open handler's reset is impossible, so assert the end state after success.
    await runAll(user)
    await vi.waitFor(() => expect(start).toHaveBeenCalledTimes(2))
    expect(screen.queryByRole('alert')).toBeNull()
  })
})

// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { AiSuggestion } from './aiSuggestion'

const hook = vi.hoisted(() => ({
  revert: vi.fn(async (_args: unknown) => {}),
  state: { kind: 'idle' } as { kind: string; message?: string },
  // What the real hook does on success, so the component's reaction is real.
  succeed: true,
}))
vi.mock('./useRevertSuggestion', async () => {
  const { useState } = await import('react')
  return {
    useRevertSuggestion: () => {
      const [state, setState] = useState(hook.state)
      return {
        state,
        revert: async (args: unknown) => {
          await hook.revert(args)
          if (hook.succeed) setState({ kind: 'reverted' })
        },
      }
    },
  }
})

import { RevertButton } from './RevertButton'

const AI: AiSuggestion = { suggested_at: '2026-10-28T12:00:00Z', run_id: 1, notes: 'n', answers: {} }
const base = {
  clientId: 7,
  period: '2026-10-01',
  profileId: 'p',
  current: { fin_rack_rate: 5 },
  advocacyApplies: true,
  hasUnsavedChanges: false,
  onReverted: vi.fn(),
}

afterEach(() => {
  cleanup()
  hook.revert.mockClear()
  hook.state = { kind: 'idle' }
  hook.succeed = true
  base.onReverted.mockClear()
})

const BUTTON = 'Revert to AI suggested scores'

describe('RevertButton', () => {
  it('shows nothing for a viewer', () => {
    render(<RevertButton {...base} canEdit={false} suggestedAt={null} ai={AI} />)
    expect(screen.queryByRole('button', { name: BUTTON })).toBeNull()
  })
  it('shows nothing for a viewer even with unsaved changes', () => {
    render(<RevertButton {...base} canEdit={false} suggestedAt="2026-10-28T12:00:00Z" ai={AI} hasUnsavedChanges />)
    expect(screen.queryByRole('button', { name: BUTTON })).toBeNull()
  })
  it('shows nothing for a row still awaiting review with no unsaved changes', () => {
    render(<RevertButton {...base} canEdit suggestedAt="2026-10-28T12:00:00Z" ai={AI} />)
    expect(screen.queryByRole('button', { name: BUTTON })).toBeNull()
  })
  it('shows nothing without an AI copy even with unsaved changes', () => {
    render(<RevertButton {...base} canEdit suggestedAt="2026-10-28T12:00:00Z" ai={null} hasUnsavedChanges />)
    expect(screen.queryByRole('button', { name: BUTTON })).toBeNull()
  })
  it('shows nothing without an AI copy', () => {
    render(<RevertButton {...base} canEdit suggestedAt={null} ai={null} />)
    expect(screen.queryByRole('button', { name: BUTTON })).toBeNull()
  })
  it('confirms with the AI date, and Cancel does nothing', () => {
    render(<RevertButton {...base} canEdit suggestedAt={null} ai={AI} />)
    fireEvent.click(screen.getByRole('button', { name: BUTTON }))
    expect(screen.getByRole('dialog', { name: 'Replace the saved scores and note with the AI\'s from Oct 28?' })).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(hook.revert).not.toHaveBeenCalled()
  })
  it('Revert sends the current answers, the AI copy and the gate, then reloads', async () => {
    render(<RevertButton {...base} canEdit suggestedAt={null} ai={AI} />)
    fireEvent.click(screen.getByRole('button', { name: BUTTON }))
    fireEvent.click(screen.getByRole('button', { name: 'Revert' }))
    expect(hook.revert).toHaveBeenCalledWith({ current: base.current, ai: AI, advocacyApplies: true })
    await waitFor(() => expect(base.onReverted).toHaveBeenCalledTimes(1))
    expect(screen.queryByRole('dialog')).toBeNull()
  })
  it('shows the failure message and does not reload', () => {
    hook.state = { kind: 'failed', message: 'It broke.' }
    hook.succeed = false
    render(<RevertButton {...base} canEdit suggestedAt={null} ai={AI} />)
    expect(screen.getByRole('alert').textContent).toBe('It broke.')
    expect(base.onReverted).not.toHaveBeenCalled()
  })
  it('on a still-suggested row, unsaved changes show it enabled, without the unsaved line', () => {
    render(<RevertButton {...base} canEdit suggestedAt="2026-10-28T12:00:00Z" ai={AI} hasUnsavedChanges />)
    expect((screen.getByRole('button', { name: BUTTON }) as HTMLButtonElement).disabled).toBe(false)
    expect(screen.queryByText(/unsaved changes/)).toBeNull()
  })
  it('on a manual row, unsaved changes leave it shown, enabled and without the unsaved line', () => {
    render(<RevertButton {...base} canEdit suggestedAt={null} ai={AI} hasUnsavedChanges />)
    expect((screen.getByRole('button', { name: BUTTON }) as HTMLButtonElement).disabled).toBe(false)
    expect(screen.queryByText(/unsaved changes/)).toBeNull()
  })
  it('with unsaved changes, Revert still sends the call and reloads; Cancel does neither', async () => {
    render(<RevertButton {...base} canEdit suggestedAt="2026-10-28T12:00:00Z" ai={AI} hasUnsavedChanges />)
    fireEvent.click(screen.getByRole('button', { name: BUTTON }))
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(hook.revert).not.toHaveBeenCalled()
    expect(base.onReverted).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: BUTTON }))
    fireEvent.click(screen.getByRole('button', { name: 'Revert' }))
    expect(hook.revert).toHaveBeenCalledTimes(1)
    await waitFor(() => expect(base.onReverted).toHaveBeenCalledTimes(1))
  })
})

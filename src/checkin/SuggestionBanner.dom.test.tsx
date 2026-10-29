// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { formatSavedAt } from '../lib/month'
import type { ConfirmState } from './useConfirmSuggestion'

const hook = vi.hoisted(() => ({
  confirm: vi.fn(async () => true),
  state: { kind: 'idle' } as ConfirmState,
}))
vi.mock('./useConfirmSuggestion', () => ({
  useConfirmSuggestion: () => ({ state: hook.state, confirm: hook.confirm }),
}))

import { SuggestionBanner } from './SuggestionBanner'

const LINE = 'Suggested by AI on Oct 29. Check the answers, then Confirm — or change anything and save.'

function ui(canConfirm = true, hasUnsavedChanges = false) {
  return <SuggestionBanner canConfirm={canConfirm} hasUnsavedChanges={hasUnsavedChanges} clientId={7} period="2026-10-01" suggestedAt="2026-10-29T12:00:00Z" />
}

describe('SuggestionBanner', () => {
  afterEach(cleanup)
  beforeEach(() => { hook.confirm.mockReset(); hook.confirm.mockResolvedValue(true); hook.state = { kind: 'idle' } })

  it('says when the suggestion was made and how to review it', () => {
    render(ui())
    expect(screen.getByText(LINE)).toBeTruthy()
  })

  it('offers Confirm only to someone who may score', () => {
    render(ui(false))
    expect(screen.queryByRole('button', { name: 'Confirm' })).toBeNull()
    expect(screen.getByText('Suggested by AI on Oct 29; not yet reviewed.')).toBeTruthy()
    expect(screen.queryByText(LINE)).toBeNull()
  })

  it('confirms, then replaces the line with the confirmation', () => {
    const at = '2026-10-29T16:00:00Z'
    const { rerender } = render(ui())
    // The live region is in the DOM, empty, before anything is confirmed, so a
    // screen reader is already watching it when the text arrives.
    const region = screen.getByRole('status')
    expect(region.textContent).toBe('')
    fireEvent.click(screen.getByRole('button', { name: 'Confirm' }))
    expect(hook.confirm).toHaveBeenCalledTimes(1)
    hook.state = { kind: 'confirmed', at }
    rerender(ui())
    expect(screen.queryByText(/Suggested by AI/)).toBeNull()
    expect(screen.queryByRole('button', { name: 'Confirm' })).toBeNull()
    expect(screen.getByRole('status')).toBe(region)
    expect(region.textContent).toBe(`Confirmed ${formatSavedAt(at)}.`)
  })

  it('disables Confirm and says why while the form has unsaved changes', () => {
    render(ui(true, true))
    const button = screen.getByRole('button', { name: 'Confirm' }) as HTMLButtonElement
    expect(button.disabled).toBe(true)
    expect(screen.getByText('You have unsaved changes. Save them instead — saving also clears the suggestion.')).toBeTruthy()
    fireEvent.click(button)
    expect(hook.confirm).not.toHaveBeenCalled()
  })

  it('does not show the unsaved-changes sentence when the form is clean', () => {
    render(ui(true, false))
    expect((screen.getByRole('button', { name: 'Confirm' }) as HTMLButtonElement).disabled).toBe(false)
    expect(screen.queryByText(/You have unsaved changes/)).toBeNull()
  })

  it('shows the failure and keeps the line when Confirm fails', () => {
    hook.state = { kind: 'failed', message: 'Nope. Nothing was changed.' }
    render(ui())
    expect(screen.getByRole('alert').textContent).toBe('Nope. Nothing was changed.')
    expect(screen.getByText(LINE)).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Confirm' })).toBeTruthy()
  })
})

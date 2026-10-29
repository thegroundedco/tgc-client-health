// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
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

function ui(canConfirm = true) {
  return <SuggestionBanner canConfirm={canConfirm} clientId={7} period="2026-10-01" suggestedAt="2026-10-29T15:00:00Z" />
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
    expect(screen.getByText(LINE)).toBeTruthy()
  })

  it('confirms, then replaces the line with the confirmation', () => {
    const { rerender } = render(ui())
    fireEvent.click(screen.getByRole('button', { name: 'Confirm' }))
    expect(hook.confirm).toHaveBeenCalledTimes(1)
    hook.state = { kind: 'confirmed', at: '2026-10-29T16:00:00Z' }
    rerender(ui())
    expect(screen.queryByText(/Suggested by AI/)).toBeNull()
    expect(screen.getByRole('status').textContent?.startsWith('Confirmed ')).toBe(true)
  })

  it('shows the failure and keeps the line when Confirm fails', () => {
    hook.state = { kind: 'failed', message: 'Nope. Nothing was changed.' }
    render(ui())
    expect(screen.getByRole('alert').textContent).toBe('Nope. Nothing was changed.')
    expect(screen.getByText(LINE)).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Confirm' })).toBeTruthy()
  })
})

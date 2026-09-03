// @vitest-environment jsdom

import { render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { Overview } from './Overview'

afterEach(() => {
  document.body.innerHTML = ''
})

// Spec §6. Both pages are short and honest rather than spinners or the words
// "coming soon". A page that admits what it does not have yet is better than one
// that looks broken -- the position this codebase already takes with the boot
// fallback and the startup-error screen.
describe('Overview', () => {
  it('names itself and says its contents are still being designed', () => {
    render(<Overview />)
    expect(screen.getByRole('heading', { name: 'Overview' })).toBeTruthy()
    expect(document.body.textContent).toContain('snapshot')
  })

  // Spec §6.1. Six stat lines were invented for this page once, the owner did
  // not recognise them, and they were retired as never-sourced. This test is a
  // tripwire against a second guess: if a future change fills this page, it
  // should be because the owner said what goes on it, and whoever does that
  // will have to delete this assertion deliberately.
  it('does not invent any contents', () => {
    render(<Overview />)
    expect(document.body.textContent).not.toMatch(/\d+%/)
  })
})

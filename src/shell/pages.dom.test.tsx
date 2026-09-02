// @vitest-environment jsdom

import { render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { Overview } from './Overview'
import { Revenue } from './Revenue'

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

describe('Revenue', () => {
  it('names itself and says what it will hold', () => {
    render(<Revenue />)
    expect(screen.getByRole('heading', { name: 'Revenue' })).toBeTruthy()
    expect(document.body.textContent).toContain('churn')
  })

  // Spec §6.2. The blocker is the point of the sentence, not an apology: revenue
  // retention needs a history of monthly amounts, and one editable retainer
  // field cannot produce one. The owner will want that reminder in front of him.
  it('says plainly that revenue retention is waiting on a data model', () => {
    render(<Revenue />)
    expect(document.body.textContent).toContain('data model')
  })
})

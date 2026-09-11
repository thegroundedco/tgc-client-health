// @vitest-environment jsdom

import { render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { Overview } from './Overview'

afterEach(() => {
  document.body.innerHTML = ''
})

// Spec §6. This page was empty on purpose until 2026-09-11: six stat lines were
// invented for it once, the owner did not recognise them, and they were retired
// as never-sourced. A tripwire lived here asserting the page invented nothing,
// with a note that whoever filled it "will have to delete this assertion
// deliberately".
//
// THAT IS WHAT HAPPENED, and the replacement below is the point. The contents
// came from the owner describing this screen to his boss on the 2026-09-11
// call -- clients over 20% of revenue, and clients scoring at risk -- so the
// tripwire is replaced by a test that the page shows THOSE THINGS and not
// something else. Its behaviour lives in Overview.dom.test.tsx; what is pinned
// here is the provenance, and it lives in tests/overviewProvenance.test.ts
// because it reads the source and src/ has no Node types.
describe('Overview', () => {
  it('names itself', () => {
    render(<Overview />)
    expect(screen.getByRole('heading', { name: 'Overview' })).toBeTruthy()
  })

})

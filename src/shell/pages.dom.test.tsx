// @vitest-environment jsdom

import { render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
// Both of Overview's reads are mocked, and this is load-bearing rather than
// tidy. src/lib/supabase.ts calls readSupabaseConfig at MODULE SCOPE and throws
// when VITE_ config is absent, and CI runs vitest with no VITE_ env at all --
// the hazard clientForm.ts documents in its own header.
//
// This file was safe for as long as Overview was a static page importing
// nothing. Filling it on 2026-09-12 gave it two hooks, and the import chain
// Overview -> useBoard -> supabase took the whole suite down in CI while
// passing locally, because a developer machine has .env.local and CI does not.
vi.mock('../revenue/useRetention', () => ({ useRetention: vi.fn() }))
vi.mock('../board/useBoard', () => ({ useBoard: vi.fn() }))

import { Overview } from './Overview'
import { useRetention } from '../revenue/useRetention'
import { useBoard } from '../board/useBoard'

beforeEach(() => {
  vi.mocked(useRetention).mockReturnValue({
    status: 'ready',
    loadError: null,
    clients: [],
    rows: [],
    reload: vi.fn(),
  } as ReturnType<typeof useRetention>)
  vi.mocked(useBoard).mockReturnValue({
    status: 'ready',
    loadError: null,
    clients: [],
    checkins: new Map(),
    scores: new Map(),
    submitted: 0,
    activeTotal: 0,
    reload: vi.fn(),
  } as ReturnType<typeof useBoard>)
})

afterEach(() => {
  document.body.innerHTML = ''
  vi.mocked(useRetention).mockReset()
  vi.mocked(useBoard).mockReset()
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

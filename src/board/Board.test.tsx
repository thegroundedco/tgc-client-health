import { describe, expect, it, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import type { Profile } from '../auth/useProfile'

// WHAT THIS FILE CAN AND CANNOT PROVE.
//
// Board.tsx loads its data with a plain `useState` + `useEffect` pair inside
// the component body -- unlike CheckIn.tsx, which puts the equivalent read
// behind an injectable `useCheckin` hook. `renderToStaticMarkup` (the only
// renderer available under this project's vitest `environment: 'node'`,
// which has no DOM) performs one synchronous server-render pass and never
// invokes an effect callback -- confirmed empirically against this repo's
// installed React (19.2.8), including when the render is wrapped in
// `React.act()`. Because `load()` is only ever called from inside that
// effect, `clients` stays `null` for the entire life of any render produced
// here, and the branch that maps over `clients` -- which is where the client
// name, the per-card button, `Score all 3s` and the `role="list"` element
// all live -- can never be reached this way.
//
// That branch is exactly what the four checks below would need to inspect.
// Faking reachability (e.g. by reordering `useState` calls behind a mock, or
// by hand-duplicating the card JSX in this file so it renders "on its own")
// would test a stand-in, not the real component, which is the kind of false
// assurance this project's history warns against. They are left as
// documented `it.skip`s -- visible in the run, not silently dropped -- and
// belong on the owner's manual visual checklist instead.
describe.skip('the loaded client grid (not reachable without a DOM -- see file header)', () => {
  it.skip('the client name renders inside a <button>, not as bare text')
  it.skip('there is exactly one such button per client card')
  it.skip('Score all 3s still renders and is a separate button')
  it.skip('the board renders its role="list"')
})

// What IS reachable, and worth pinning down: with `../lib/supabase` mocked,
// Board can be imported and rendered in this environment without a real
// Supabase URL/key (the unmocked module throws on missing config -- see
// src/lib/env.ts), and its data-loading effect -- confirmed above to never
// run under this renderer -- never reaches the mocked client either. Losing
// either fact would be a real regression: the first would break every test
// in this file the moment `.env.local` is absent, and the second would mean
// some future change made Board fetch synchronously during render, which is
// its own bug.
const supabaseCalls = vi.hoisted(() => ({ fromTables: [] as string[] }))

vi.mock('../lib/supabase', () => {
  type Result = { data: unknown[]; error: null }
  const result: Result = { data: [], error: null }
  const terminal = {
    order: () => Promise.resolve(result),
    then: (resolve: (value: Result) => void) => resolve(result),
  }
  const builder = {
    select: () => ({ eq: () => terminal }),
    upsert: () => Promise.resolve({ error: null }),
  }
  return {
    supabase: {
      from: (name: string) => {
        supabaseCalls.fromTables.push(name)
        return builder
      },
    },
  }
})

const { Board } = await import('./Board')

const PROFILE: Profile = {
  id: 'profile-1',
  email: 'amy@example.com',
  full_name: 'Amy Account',
  is_active: true,
  role: 'account_manager',
  created_at: '2026-01-01T00:00:00.000Z',
  updated_at: '2026-01-01T00:00:00.000Z',
}

describe('Board', () => {
  it('renders the pre-load state without touching the mocked client', () => {
    const markup = renderToStaticMarkup(<Board profile={PROFILE} />)
    expect(markup).toContain('Loading')
    // The effect that would call supabase.from(...) never runs under this
    // renderer (see file header), so the mocked client's `from` is never
    // reached from this render either -- confirmed, not merely assumed.
    expect(supabaseCalls.fromTables).toEqual([])
  })
})

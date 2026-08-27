import { describe, expect, it, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import type { Profile } from '../auth/useProfile'
import type { SaveState } from './saveState'
import type { CheckinRow, UseCheckin } from './useCheckin'
import { PILLARS } from '../lib/score'

// Fix round 2, Important 1: nothing in this file tree tested CheckIn.tsx's
// *use* of saveStatus() -- if the `.map()` over its result were replaced
// tomorrow with a JSX condition chain that happened to compile, all of
// saveState.test.ts would still pass, because that file only calls
// saveStatus() directly and never renders CheckIn. This file renders CheckIn
// itself (with useCheckin mocked, so no Supabase client and no DOM are
// needed) and reads the save-status region out of the markup by id, the same
// way a reviewer opening the deployed page would read it by eye.
//
// vi.mock's factory runs before every import in this file, including
// CheckIn.tsx's own `import { useCheckin } from './useCheckin'` -- vi.hoisted
// gives the factory a variable it is allowed to close over despite that
// hoist, since a plain module-scope `let` declared below the vi.mock call
// would not exist yet when the factory itself runs.
const hookState = vi.hoisted(() => ({ current: null as UseCheckin | null }))

vi.mock('./useCheckin', () => ({
  useCheckin: () => hookState.current,
}))

// Imported dynamically, after the mock above is registered, rather than with
// a static `import` at the top of the file: CheckIn.tsx's own import of
// useCheckin has to resolve against the mock, and a dynamic import here makes
// that ordering explicit rather than relying on the test runner's hoisting of
// vi.mock to get it right.
const { CheckIn } = await import('./CheckIn')

const PROFILE: Profile = {
  id: 'profile-1',
  email: 'amy@example.com',
  full_name: 'Amy Account',
  is_active: true,
  role: 'account_manager',
  created_at: '2026-01-01T00:00:00.000Z',
  updated_at: '2026-01-01T00:00:00.000Z',
}

const CLIENT = { id: 1, name: 'Acme' }
const PERIOD = '2026-08-01'

function storedRow(overrides: Partial<CheckinRow> = {}): CheckinRow {
  return {
    id: 1,
    client_id: CLIENT.id,
    period: PERIOD,
    relationship: 3,
    delivery: 3,
    financial: 3,
    sentiment: 3,
    growth: 3,
    total_score: 15,
    notes: null,
    submitted_at: null,
    submitted_by: null,
    created_at: '2026-08-01T00:00:00.000Z',
    updated_at: '2026-08-21T15:42:00.000Z',
    // The 22 answer columns and 6 generated bucket scores added by the
    // six-bucket migration (20260827192720_six_bucket_scoring.sql). Verified
    // on staging: the sole existing checkins row has null in every one of
    // these columns (production was not queried), so null is the true value
    // here, not a placeholder.
    comm_constructive: null,
    comm_timely: null,
    comm_consistent: null,
    growth_goals_defined: null,
    growth_progress_trackable: null,
    growth_hitting_goals: null,
    fin_rack_rate: null,
    fin_pays_on_time: null,
    fin_rate_increased: null,
    fin_on_terms: null,
    rel_collaborative: null,
    rel_respectful: null,
    rel_fun: null,
    rel_multi_threaded: null,
    del_on_time: null,
    del_quantity: null,
    del_client_likes: null,
    del_we_are_proud: null,
    adv_left_review: null,
    adv_case_study: null,
    adv_would_refer: null,
    adv_reference_check: null,
    comm_score: null,
    growth_score: null,
    fin_score: null,
    rel_score: null,
    del_score: null,
    adv_score: null,
    ...overrides,
  }
}

// The five SaveState kinds, with `saved` split into its two `complete`
// values, per the brief for this test.
const SAVE_STATES: readonly { label: string; state: SaveState }[] = [
  { label: 'clean', state: { kind: 'clean' } },
  { label: 'dirty', state: { kind: 'dirty' } },
  { label: 'saving', state: { kind: 'saving' } },
  {
    label: 'saved (submitted)',
    state: { kind: 'saved', at: '2026-08-21T15:42:00.000Z', by: 'you', complete: true },
  },
  {
    label: 'saved (draft)',
    state: { kind: 'saved', at: '2026-08-21T15:42:00.000Z', by: 'you', complete: false },
  },
  { label: 'failed', state: { kind: 'failed', error: 'network refused' } },
]

// The three internally-consistent stored-row shapes. `storedSubmitted: true`
// with no stored row, or with a stored row that has no `submitted_at`, is not
// a shape the real hook can ever produce -- see useCheckin.ts, where
// `storedSubmitted` is derived as `stored?.submitted_at != null` -- and
// testing it anyway would be testing a bug that cannot occur, exactly the
// mistake fix round 1's review flagged in itself and asked not to repeat here.
const STORED_SHAPES: readonly {
  label: string
  stored: CheckinRow | null
  storedSubmitted: boolean
}[] = [
  { label: 'no stored row', stored: null, storedSubmitted: false },
  {
    label: 'stored, unsubmitted draft',
    stored: storedRow({ submitted_at: null, submitted_by: null }),
    storedSubmitted: false,
  },
  {
    label: 'stored, submitted',
    stored: storedRow({ submitted_at: '2026-08-15T09:00:00.000Z', submitted_by: PROFILE.id }),
    storedSubmitted: true,
  },
]

function mockCheckin(options: {
  readFailed: boolean
  state: SaveState
  hasContent: boolean
  stored: CheckinRow | null
  storedSubmitted: boolean
}): UseCheckin {
  const { readFailed, state, hasContent, stored, storedSubmitted } = options
  return {
    status: readFailed ? 'error' : 'ready',
    loadError: readFailed ? 'network refused' : null,
    stored,
    lastMonth: null,
    lastPeriod: '2026-07-01',
    draft: {
      pillars: hasContent ? { relationship: 3, delivery: 3, financial: 3 } : {},
      notes: '',
    },
    saveState: state,
    scored: hasContent ? 3 : 0,
    localTotal: hasContent ? 9 : null,
    hasContent,
    storedSubmitted,
    storedByYou: storedSubmitted && stored?.submitted_by === PROFILE.id,
    draftPersisted: true,
    unsavedFromEarlierVisit: false,
    setPillar: () => {},
    setNotes: () => {},
    reload: () => {},
    submit: () => {},
  }
}

function render(options: Parameters<typeof mockCheckin>[0]) {
  hookState.current = mockCheckin(options)
  return renderToStaticMarkup(
    <CheckIn client={CLIENT} period={PERIOD} profile={PROFILE} onBack={() => {}} />,
  )
}

function extractSaveStatusText(markup: string): string | null {
  const match = markup.match(/<p[^>]*\bid="checkin-save-status"[^>]*>([\s\S]*?)<\/p>/)
  if (!match) return null
  return match[1].replace(/<[^>]+>/g, '').trim()
}

describe('CheckIn', () => {
  describe('when the read has failed', () => {
    // Spec §8.1: never write after a failed read. This is correct behaviour,
    // not an exemption from the sweep below -- the form (and the
    // save-status region inside it) must not render at all, regardless of
    // what state, content or stored-row shape the hook would otherwise
    // report, because none of it describes what is actually in the database.
    for (const { label, state } of SAVE_STATES) {
      for (const hasContent of [true, false]) {
        it(`replaces the form with the error screen (state: ${label}, hasContent: ${hasContent})`, () => {
          const markup = render({
            readFailed: true,
            state,
            hasContent,
            stored: null,
            storedSubmitted: false,
          })
          expect(markup).toContain('role="alert"')
          expect(markup).toContain('Cannot reach the database')
          expect(markup).not.toContain('id="checkin-save-status"')
        })
      }
    }
  })

  describe('the save-status region', () => {
    // The cross product this file exists to sweep: every SaveState kind
    // (saved counted twice, for each `complete` value) x hasContent x the
    // three internally-consistent stored-row shapes. Every case asserts the
    // save-status markup is present and non-empty -- the property fix round
    // 1 proved for saveStatus() as a value, proved again here for what
    // CheckIn.tsx actually renders from it.
    for (const { label: stateLabel, state } of SAVE_STATES) {
      for (const hasContent of [true, false]) {
        for (const { label: storedLabel, stored, storedSubmitted } of STORED_SHAPES) {
          it(`is present and non-empty (state: ${stateLabel}, hasContent: ${hasContent}, stored: ${storedLabel})`, () => {
            const markup = render({
              readFailed: false,
              state,
              hasContent,
              stored,
              storedSubmitted,
            })
            const text = extractSaveStatusText(markup)
            expect(text).not.toBeNull()
            expect(text?.length).toBeGreaterThan(0)
          })
        }
      }
    }
  })

  it('Critical 1: a clean, unblocked draft says it was saved', () => {
    const markup = render({
      readFailed: false,
      state: { kind: 'clean' },
      hasContent: true,
      stored: storedRow({ submitted_at: null, submitted_by: null }),
      storedSubmitted: false,
    })
    const text = extractSaveStatusText(markup)
    expect(text).toMatch(/draft saved/i)
    expect(text).toContain(`3 of ${PILLARS.length} pillars scored`)
  })

  it('Critical 2: a blocked dirty press still says why', () => {
    const markup = render({
      readFailed: false,
      state: { kind: 'dirty' },
      hasContent: false,
      stored: null,
      storedSubmitted: false,
    })
    const text = extractSaveStatusText(markup)
    expect(text).toContain('Unsaved changes.')
    expect(text).toMatch(/at least one pillar/i)
  })
})

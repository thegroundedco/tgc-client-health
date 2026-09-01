import { describe, expect, it, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import type { Profile } from '../auth/useProfile'
import type { SaveState } from './saveState'
import type { CheckinRow, UseCheckin } from './useCheckin'
import { BUCKETS } from '../lib/buckets'

// Fix round 2, Important 1: nothing in this file tree tested CheckIn.tsx's
// *use* of saveStatus() -- if the `.map()` over its result were replaced
// tomorrow with a JSX condition chain that happened to compile, all of
// saveState.test.ts would still pass, because that file only calls
// saveStatus() directly and never renders CheckIn. This file renders CheckIn
// itself (with useCheckin mocked, so no Supabase client and no DOM are
// needed) and reads markup out of the string react-dom/server produces, the
// same way a reviewer opening the deployed page would read it by eye.
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

const PERIOD = '2026-08-01'
// Well clear of the gate for PERIOD, so the default fixture's client and its
// mocked advocacyApplies (below) agree -- the gate is a separate computation
// (advocacyGate, driven by this date) from the hook's own advocacyApplies
// field, and a test not about the gate itself should not have the two
// disagree by accident.
const CLIENT = { id: 1, name: 'Acme', started_on: '2020-01-01' }

function storedRow(overrides: Partial<CheckinRow> = {}): CheckinRow {
  return {
    id: 1,
    client_id: CLIENT.id,
    period: PERIOD,
    legacy_relationship: null,
    legacy_delivery: null,
    legacy_financial: null,
    legacy_sentiment: null,
    legacy_growth: null,
    legacy_total_score: null,
    notes: null,
    submitted_at: null,
    submitted_by: null,
    created_at: '2026-08-01T00:00:00.000Z',
    updated_at: '2026-08-21T15:42:00.000Z',
    comm_constructive: null,
    comm_timely: null,
    comm_consistent: null,
    growth_goals_defined: null,
    growth_progress_trackable: null,
    growth_hitting_goals: null,
    fin_rack_rate: null,
    fin_pays_on_time: null,
    fin_rate_increased: null,
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

// The full hook shape, defaulted to a settled, ungated, empty screen. Every
// test overrides only the handful of fields its own scenario cares about, in
// the same spirit as mockCheckin below.
function defaultHook(): UseCheckin {
  return {
    status: 'ready',
    loadError: null,
    stored: null,
    lastMonth: null,
    lastPeriod: '2026-07-01',
    draft: { answers: {}, notes: '' },
    saveState: { kind: 'clean' },
    advocacyApplies: true,
    required: 21,
    scored: 0,
    localOverall: null,
    storedOverall: null,
    lastOverall: null,
    hasContent: false,
    storedSubmitted: false,
    storedByYou: false,
    draftPersisted: true,
    unsavedFromEarlierVisit: false,
    setAnswer: () => {},
    setNotes: () => {},
    reload: () => {},
    submit: () => {},
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

type ScreenOverrides = Partial<UseCheckin> & {
  // Not hook fields: the gate the screen shows is derived from the client's
  // start date via advocacyGate(client.started_on, period), never from a hook
  // field -- so these drive the gate through the same props the real screen
  // reads, and `advocacyApplies` above is the only piece of gate-adjacent
  // state that genuinely does come from the hook.
  startedOn?: string | null
  period?: string
}

function render(overrides: ScreenOverrides = {}): string {
  const { startedOn, period, ...hookOverrides } = overrides
  hookState.current = { ...defaultHook(), ...hookOverrides }
  // `startedOn` can legitimately be `null` (no start date), so its presence
  // is checked with `in` rather than `??` -- `null ?? fallback` would read
  // "not provided" and silently discard a test's explicit null.
  const startedOnValue = 'startedOn' in overrides ? startedOn : CLIENT.started_on
  const client = { ...CLIENT, started_on: startedOnValue ?? null }
  return renderToStaticMarkup(
    <CheckIn client={client} period={period ?? PERIOD} profile={PROFILE} onBack={() => {}} />,
  )
}

function extractSaveStatusText(markup: string): string | null {
  const match = markup.match(/<p[^>]*\bid="checkin-save-status"[^>]*>([\s\S]*?)<\/p>/)
  if (!match) return null
  return match[1].replace(/<[^>]+>/g, '').trim()
}

// A generic reader for the flat, non-self-nesting elements this screen marks
// with data-testid -- headings, spans, a <p> and a <dl> with no element of
// its own tag nested inside. Returns every match, in document order, so the
// six-heading test can assert on order and not only membership.
function extractAllByTestId(markup: string, tag: string, testid: string): string[] {
  const re = new RegExp(`<${tag}[^>]*\\bdata-testid="${testid}"[^>]*>([\\s\\S]*?)<\\/${tag}>`, 'g')
  const out: string[] = []
  let match: RegExpExecArray | null
  while ((match = re.exec(markup))) {
    out.push(match[1].replace(/<[^>]+>/g, '').trim())
  }
  return out
}

function extractByTestId(markup: string, tag: string, testid: string): string | null {
  return extractAllByTestId(markup, tag, testid)[0] ?? null
}

// The markup of each bucket section, keyed by bucket, in document order.
// Cannot go through extractAllByTestId: a bucket section CONTAINS <section>
// elements (every QuestionRow renders one), so a non-greedy match on <section>
// would stop at the first inner closing tag and return a fragment. Bucket
// sections are siblings, so slicing between their markers is exact.
//
// Built from BUCKETS rather than from a loose [a-z]+ pattern, which would also
// match data-testid="bucket-heading" and invent a seventh bucket called
// "heading".
function bucketSegments(markup: string): Map<string, string> {
  const re = new RegExp(`data-testid="bucket-(${BUCKETS.join('|')})"`, 'g')
  const marks: { bucket: string; at: number }[] = []
  let match: RegExpExecArray | null
  while ((match = re.exec(markup))) marks.push({ bucket: match[1], at: match.index })
  return new Map(
    marks.map(({ bucket, at }, index) => [bucket, markup.slice(at, marks[index + 1]?.at)]),
  )
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
            status: 'error',
            loadError: 'network refused',
            saveState: state,
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

  describe('when it is still loading', () => {
    it('shows a loading message and nothing else', () => {
      const markup = render({ status: 'loading' })
      expect(markup).toContain('Loading…')
      expect(markup).not.toContain('id="checkin-save-status"')
      expect(markup).not.toContain('data-testid="scale-legend"')
    })
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
              saveState: state,
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
      saveState: { kind: 'clean' },
      hasContent: true,
      scored: 3,
      required: 21,
      stored: storedRow({ submitted_at: null, submitted_by: null }),
      storedSubmitted: false,
    })
    const text = extractSaveStatusText(markup)
    expect(text).toMatch(/draft saved/i)
    expect(text).toContain('3 of 21 questions scored')
  })

  it('Critical 2: a blocked dirty press still says why', () => {
    const markup = render({
      saveState: { kind: 'dirty' },
      hasContent: false,
      stored: null,
      storedSubmitted: false,
    })
    const text = extractSaveStatusText(markup)
    expect(text).toContain('Unsaved changes.')
    expect(text).toMatch(/at least one question/i)
  })

  // Carried from the pillar-era screen: an unsaved draft from an earlier
  // visit is announced near the top, with the label of the control that
  // keeps it.
  it('names the earlier-visit draft and how to keep it', () => {
    const markup = render({ unsavedFromEarlierVisit: true, hasContent: true, scored: 1 })
    expect(markup).toContain('These scores are from an earlier visit on this device')
    expect(markup).toContain('Press Save draft to keep them.')
  })

  it('says nothing about an earlier visit when there was not one', () => {
    const markup = render({ unsavedFromEarlierVisit: false })
    expect(markup).not.toContain('earlier visit')
  })

  // Carried from the pillar-era screen: a browser that cannot persist a
  // local copy is told so, since that changes what pressing away from the
  // screen risks.
  it('warns when this browser is not keeping a local copy', () => {
    const markup = render({ draftPersisted: false })
    expect(markup).toContain('This browser is not keeping a local copy')
  })

  it('says nothing about local storage when it is working', () => {
    const markup = render({ draftPersisted: true })
    expect(markup).not.toContain('not keeping a local copy')
  })

  // Carried from the pillar-era screen: the last submission is named outside
  // the save-status region, since it describes what is stored rather than
  // what just happened.
  it('names who last submitted, and when', () => {
    const markup = render({
      stored: storedRow({ submitted_at: '2026-08-15T09:00:00.000Z', submitted_by: 'someone-else' }),
      storedSubmitted: true,
      storedByYou: false,
    })
    expect(markup).toContain('Last submitted')
    expect(markup).toContain('another account manager')
  })

  it('names "you" when the viewer submitted it themselves', () => {
    const markup = render({
      stored: storedRow({ submitted_at: '2026-08-15T09:00:00.000Z', submitted_by: PROFILE.id }),
      storedSubmitted: true,
      storedByYou: true,
    })
    expect(markup).toContain('Last submitted')
    expect(markup).toMatch(/by\s*you/)
  })

  it("renders all six buckets as headings, in the boss's order", () => {
    const markup = render()
    expect(extractAllByTestId(markup, 'h3', 'bucket-heading')).toEqual([
      'Communication',
      'Growth',
      'Finances',
      'Relationship',
      'Delivery',
      'Advocacy',
    ])
  })

  // §7: nothing collapses. A collapsed section hides unanswered work, and
  // §3.3's whole point is that unanswered work is impossible to miss.
  it('renders every one of the 21 questions at once', () => {
    const markup = render()
    expect(markup.match(/role="radiogroup"/g)).toHaveLength(21)
  })

  // §7, amended 2026-09-01: one legend per bucket that HAS a scale -- not one
  // for the screen (it read as chrome and the eye skipped it, pinned or not),
  // and still not 51 per-question anchors.
  it('states the scale in each bucket that has one, and nowhere else', () => {
    const markup = render()
    const carrying = [...bucketSegments(markup)]
      .filter(([, html]) => html.includes('data-testid="scale-legend"'))
      .map(([bucket]) => bucket)

    // Named, not counted. A length assertion passes just as happily if the
    // legend appears above Finances and disappears from Delivery -- which is
    // the specific way this can go wrong, since those are the two kinds of row
    // and a legend over No/Unsure/Yes explains a scale that is not there.
    expect(carrying).toEqual(['communication', 'growth', 'relationship', 'delivery'])

    const legends = extractAllByTestId(markup, 'dl', 'scale-legend')
    expect(legends).toHaveLength(4)
    for (const legend of legends) {
      expect(legend).toContain('strongly disagree')
      expect(legend).toContain('strongly agree')
    }
  })

  describe('when the gate is shut', () => {
    // The reason is NOT a hook field -- the screen derives it from the
    // client's start date via advocacyGate(). So these drive it through
    // `startedOn` on the client prop, and only `advocacyApplies` comes from
    // the mocked hook. A test that passed a `gateReason` would be asserting
    // against a prop that does not exist and would pass whatever the screen
    // rendered.
    it('still renders the Advocacy section, and names the missing start date', () => {
      const markup = render({ advocacyApplies: false, required: 17, startedOn: null })
      expect(markup).toContain('data-testid="bucket-advocacy"')
      const reason = extractByTestId(markup, 'p', 'advocacy-gate')
      expect(reason).toContain('no start date')
    })

    it('names the month the gate opens for a client inside their first 90 days', () => {
      const markup = render({
        advocacyApplies: false,
        required: 17,
        startedOn: '2026-01-15',
        period: '2026-03-01',
      })
      const reason = extractByTestId(markup, 'p', 'advocacy-gate')
      expect(reason).toContain('May 2026')
    })

    it('says nothing about the gate when it is open', () => {
      const markup = render({ advocacyApplies: true })
      expect(markup).not.toContain('data-testid="advocacy-gate"')
    })
  })

  describe('the overall', () => {
    // §3.3: an incomplete check-in shows an em dash, never a number. The words
    // beside it are what a screen reader gets, since an em dash announces as
    // nothing on its own.
    it('shows an em dash and the count when there is no overall', () => {
      const markup = render({ storedOverall: null, localOverall: null, scored: 7, required: 17 })
      expect(extractByTestId(markup, 'span', 'overall-value')).toBe('—')
      expect(extractByTestId(markup, 'span', 'overall-caption')).toBe('not scored · 7 of 17 answered')
    })

    it('shows two decimals out of 5 when there is one', () => {
      const markup = render({
        storedOverall: 3.6,
        localOverall: 3.6,
        saveState: { kind: 'clean' },
      })
      expect(extractByTestId(markup, 'span', 'overall-value')).toBe('3.60')
      expect(extractByTestId(markup, 'span', 'overall-caption')).toContain('of 5')
    })

    it('bands on the new thresholds', () => {
      const markup = render({ storedOverall: 3.6, saveState: { kind: 'clean' } })
      expect(extractByTestId(markup, 'span', 'overall-band')).toBe('Healthy')
    })
  })
})

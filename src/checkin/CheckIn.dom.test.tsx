// @vitest-environment jsdom

import { render, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Profile } from '../auth/useProfile'
import type { UseCheckin } from './useCheckin'

// The defect this file exists to catch, stated as the scenario the owner hit:
// a viewer opened a check-in, changed every score, pressed submit, and only
// then met checkins_insert_edit_scores refusing the write. The database was
// never wrong -- nothing was written -- but the screen offered controls that
// could not work. src/checkin/CheckIn.test.tsx (renderToStaticMarkup) already
// proves the save-status region and the gate's copy read correctly for every
// state; it does not touch component internals like `disabled` at all. This
// file renders the real component tree in jsdom (no mocked QuestionRow) with
// useCheckin mocked -- same seam CheckIn.test.tsx uses -- and reads the
// rendered DOM the way a reviewer opening the deployed page would: disabled
// attributes and visible text, never internal props or state.
const hookState = vi.hoisted(() => ({ current: null as UseCheckin | null }))

vi.mock('./useCheckin', () => ({
  useCheckin: () => hookState.current,
}))

const { CheckIn } = await import('./CheckIn')

afterEach(() => {
  document.body.innerHTML = ''
})

const PERIOD = '2026-08-01'
// Long clear of the gate, so a test not about the gate itself gets every
// question enabled or disabled purely by role, with no Advocacy-shaped
// surprise mixed in.
const CLIENT = { id: 1, name: 'Acme', started_on: '2020-01-01' }

function profile(role: Profile['role']): Profile {
  return {
    id: 'profile-1',
    email: 'sam@example.com',
    full_name: 'Sam Someone',
    is_active: true,
    role,
    created_at: '2026-01-01T00:00:00.000Z',
    updated_at: '2026-01-01T00:00:00.000Z',
  }
}

// One question already scored and a note already typed, so this is exactly
// the shape the owner hit: a form with real content on screen, not an empty
// one where "nothing to save" would be doing the blocking instead of
// canEdit.
function mockCheckin(overrides: Partial<UseCheckin> = {}): UseCheckin {
  return {
    status: 'ready',
    loadError: null,
    stored: null,
    lastMonth: null,
    lastPeriod: '2026-07-01',
    draft: { answers: { comm_constructive: 4 }, notes: 'Renewal conversation went well.' },
    saveState: { kind: 'dirty' },
    advocacyApplies: true,
    required: 21,
    scored: 1,
    localOverall: null,
    storedOverall: null,
    lastOverall: null,
    hasContent: true,
    storedSubmitted: false,
    storedByYou: false,
    draftPersisted: true,
    unsavedFromEarlierVisit: false,
    setAnswer: vi.fn(),
    setNotes: vi.fn(),
    reload: vi.fn(),
    submit: vi.fn(),
    ...overrides,
  }
}

function renderAs(role: Profile['role'], overrides: Partial<UseCheckin> = {}) {
  hookState.current = mockCheckin(overrides)
  return render(
    <CheckIn client={CLIENT} period={PERIOD} profile={profile(role)} onBack={() => {}} />,
  )
}

describe('CheckIn, a viewer (no edit_scores)', () => {
  it('renders every question radio disabled', () => {
    renderAs('viewer')
    const radios = screen.getAllByRole('radio')
    expect(radios.length).toBeGreaterThan(0)
    for (const radio of radios) {
      expect((radio as HTMLInputElement).disabled).toBe(true)
    }
  })

  it('renders the Clear button disabled, for the one question already scored', () => {
    renderAs('viewer')
    expect((screen.getByRole('button', { name: 'Clear' }) as HTMLButtonElement).disabled).toBe(
      true,
    )
  })

  it('renders the notes textarea disabled', () => {
    renderAs('viewer')
    expect((screen.getByLabelText('Notes') as HTMLTextAreaElement).disabled).toBe(true)
  })

  it('renders the submit control disabled', () => {
    renderAs('viewer')
    // saveState is 'dirty' with content, so submitLabel is 'Save draft' --
    // asserted by name to prove the reason for the disabled state is canEdit,
    // not some other case (SAVING renders no accessible button at all, and an
    // empty form would also block, but this fixture has content).
    expect(
      (screen.getByRole('button', { name: 'Save draft' }) as HTMLButtonElement).disabled,
    ).toBe(true)
  })

  it('states the reason on screen, near the disabled controls', () => {
    renderAs('viewer')
    const notice = screen.getByText(/you can view this client.s scores, but you can.t score/i)
    expect(notice).toBeTruthy()
    expect(notice.textContent).toMatch(/admin can change/i)
    // Written for a non-technical reader: the internal name of the thing a
    // viewer lacks never appears on screen.
    expect(document.body.textContent).not.toMatch(/capability/i)
  })
})

describe('CheckIn, an account_manager (holds edit_scores)', () => {
  it('leaves every question radio enabled', () => {
    renderAs('account_manager')
    for (const radio of screen.getAllByRole('radio')) {
      expect((radio as HTMLInputElement).disabled).toBe(false)
    }
  })

  it('leaves the notes textarea enabled', () => {
    renderAs('account_manager')
    expect((screen.getByLabelText('Notes') as HTMLTextAreaElement).disabled).toBe(false)
  })

  it('does not render the read-only notice', () => {
    renderAs('account_manager')
    expect(screen.queryByText(/you can view this client.s scores, but/i)).toBeNull()
  })
})

describe('CheckIn, when the Advocacy gate is shut', () => {
  // The reason is NOT a hook field -- the screen derives it from the
  // client's start date via advocacyGate(). Rendering the real component
  // tree (rather than the string-based CheckIn.test.tsx) is what lets this
  // count radios by section rather than by text.
  it('disables every Advocacy radio and leaves the other 17 enabled', () => {
    hookState.current = mockCheckin({ advocacyApplies: false, required: 17, scored: 0, draft: { answers: {}, notes: '' }, hasContent: false, saveState: { kind: 'clean' } })
    render(
      <CheckIn
        client={{ ...CLIENT, started_on: null }}
        period={PERIOD}
        profile={profile('account_manager')}
        onBack={() => {}}
      />,
    )

    const advocacy = within(screen.getByTestId('bucket-advocacy')).getAllByRole('radio')
    // 4 yes/no questions x 2 options, now that Advocacy renders YesNoRow
    // rather than QuestionRow's five-option scale.
    expect(advocacy).toHaveLength(8)
    for (const radio of advocacy) expect((radio as HTMLInputElement).disabled).toBe(true)

    const communication = within(screen.getByTestId('bucket-communication')).getAllByRole('radio')
    for (const radio of communication) expect((radio as HTMLInputElement).disabled).toBe(false)
  })
})

// Fix round 1, Cosmetic 3: this test sets `advocacyApplies: true` against
// CLIENT (started_on 2020-01-01, long clear of the gate) -- it was never
// about the gate being shut, and had been left inside that describe by
// mistake. Its own block, so a reader of either describe's name is told the
// truth about what its tests cover.
describe('CheckIn, the question controls per kind', () => {
  it('renders Yes/No controls for Advocacy and 1-5 for the rest', () => {
    hookState.current = mockCheckin({ advocacyApplies: true })
    render(
      <CheckIn
        client={CLIENT}
        period={PERIOD}
        profile={profile('account_manager')}
        onBack={() => {}}
      />,
    )

    const advocacy = within(screen.getByTestId('bucket-advocacy'))
    expect(advocacy.getAllByRole('radio')).toHaveLength(8) // 4 questions x Yes/No
    const communication = within(screen.getByTestId('bucket-communication'))
    expect(communication.getAllByRole('radio')).toHaveLength(15) // 3 x 1-5
  })
})

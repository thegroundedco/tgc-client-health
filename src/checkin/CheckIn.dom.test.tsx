// @vitest-environment jsdom

import { render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Profile } from '../auth/useProfile'
import type { UseCheckin } from './useCheckin'

// The defect this file exists to catch, stated as the scenario the owner hit:
// a viewer opened a check-in, changed every pillar score, pressed submit, and
// only then met checkins_insert_edit_scores refusing the write. The database
// was never wrong -- nothing was written -- but the screen offered controls
// that could not work. src/checkin/CheckIn.test.tsx (renderToStaticMarkup)
// already proves the save-status region reads correctly for every SaveState;
// it does not touch component internals like `disabled` at all, and
// PillarRow.dom.test.tsx never renders CheckIn, so nothing before this file
// could have caught a viewer reaching a live, clickable radio. This file
// renders the real component tree in jsdom (no mocked PillarRow) with
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

const CLIENT = { id: 1, name: 'Acme' }
const PERIOD = '2026-08-01'

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

// One pillar already scored and a note already typed, so this is exactly the
// shape the owner hit: a form with real content on screen, not an empty one
// where "nothing to save" would be doing the blocking instead of canEdit.
function mockCheckin(): UseCheckin {
  return {
    status: 'ready',
    loadError: null,
    stored: null,
    lastMonth: null,
    lastPeriod: '2026-07-01',
    draft: { pillars: { relationship: 4 }, notes: 'Renewal conversation went well.' },
    saveState: { kind: 'dirty' },
    scored: 1,
    localTotal: 4,
    hasContent: true,
    storedSubmitted: false,
    storedByYou: false,
    draftPersisted: true,
    unsavedFromEarlierVisit: false,
    setPillar: vi.fn(),
    setNotes: vi.fn(),
    reload: vi.fn(),
    submit: vi.fn(),
  }
}

function renderAs(role: Profile['role']) {
  hookState.current = mockCheckin()
  return render(
    <CheckIn client={CLIENT} period={PERIOD} profile={profile(role)} onBack={() => {}} />,
  )
}

describe('CheckIn, a viewer (no edit_scores)', () => {
  it('renders every pillar radio disabled', () => {
    renderAs('viewer')
    const radios = screen.getAllByRole('radio')
    expect(radios.length).toBeGreaterThan(0)
    for (const radio of radios) {
      expect(radio).toHaveProperty('disabled', true)
    }
  })

  it('renders the Clear button disabled, for the one pillar already scored', () => {
    renderAs('viewer')
    expect(screen.getByRole('button', { name: 'Clear' })).toHaveProperty('disabled', true)
  })

  it('renders the notes textarea disabled', () => {
    renderAs('viewer')
    expect(screen.getByLabelText('Notes')).toHaveProperty('disabled', true)
  })

  it('renders the submit control disabled', () => {
    renderAs('viewer')
    // saveState is 'dirty' with content, so submitLabel is 'Save draft' --
    // asserted by name to prove the reason for the disabled state is canEdit,
    // not some other case (SAVING renders no accessible button at all, and an
    // empty form would also block, but this fixture has content).
    expect(screen.getByRole('button', { name: 'Save draft' })).toHaveProperty('disabled', true)
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
  it('leaves every pillar radio enabled', () => {
    renderAs('account_manager')
    for (const radio of screen.getAllByRole('radio')) {
      expect(radio).toHaveProperty('disabled', false)
    }
  })

  it('leaves the notes textarea enabled', () => {
    renderAs('account_manager')
    expect(screen.getByLabelText('Notes')).toHaveProperty('disabled', false)
  })

  it('does not render the read-only notice', () => {
    renderAs('account_manager')
    expect(screen.queryByText(/you can view this client.s scores, but/i)).toBeNull()
  })
})

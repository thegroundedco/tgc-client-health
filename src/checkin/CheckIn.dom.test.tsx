// @vitest-environment jsdom

import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Profile } from '../auth/useProfile'
import type { UseCheckin } from './useCheckin'
import { readDraft, writeDraft } from './draftCache'

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
const hookState = vi.hoisted(() => ({ current: null as UseCheckin | null, real: false }))
// Every call's arguments, so a test can see what the screen hands the hook.
const checkinArgs = vi.hoisted(() => ({ calls: [] as unknown[][] }))

// `real` switches to the actual hook, against the Supabase fake below, for the
// tests that need the form's own state (spec 2026-11-02 §5: a payment save must
// change the finance answers and nothing else, which a stub cannot show).
vi.mock('./useCheckin', async () => {
  const actual = await vi.importActual<typeof import('./useCheckin')>('./useCheckin')
  return {
    useCheckin: (...args: Parameters<typeof actual.useCheckin>) => {
      checkinArgs.calls.push(args)
      return hookState.real ? actual.useCheckin(...args) : hookState.current
    },
  }
})

// Only the real useCheckin reaches this: the two reads its load() makes.
const checkinRows = vi.hoisted(() => ({ current: [] as unknown[] }))
// And the save: each upsert's row is kept, and the row comes back as stored.
const upserts = vi.hoisted(() => ({ rows: [] as Record<string, unknown>[] }))
vi.mock('../lib/supabase', () => ({
  supabase: {
    from: (table: string) => ({
      select: () => ({
        eq: () => ({
          in: async () => ({ data: table === 'checkins' ? checkinRows.current : [], error: null }),
        }),
      }),
      upsert: (row: Record<string, unknown>) => {
        upserts.rows.push(row)
        return {
          select: () => ({
            single: async () => ({ data: { ...row, updated_at: '2026-08-31T12:00:00.000Z' }, error: null }),
          }),
        }
      },
    }),
  },
}))

// The payments box (spec 2026-11-02 §3) reads through useMonthPayment. Stubbed
// as a seam, honouring canRead the way the real hook does ('off', no query).
const payments = vi.hoisted(() => ({
  calls: [] as [number, string, boolean][],
  save: null as null | ((p: unknown) => Promise<{ ok: true } | { ok: false; error: string }>),
}))
vi.mock('../revenue/useMonthPayment', () => ({
  useMonthPayment: (clientId: number, period: string, canRead: boolean) => {
    payments.calls.push([clientId, period, canRead])
    return {
      status: canRead ? 'ready' : 'off',
      loadError: null,
      row: null,
      storedRetainer: 400000,
      enteredByName: null,
      save: async (p: unknown) => (payments.save ? payments.save(p) : { ok: true }),
      reload: () => {},
    }
  },
}))

// The end-client panel mounted in CheckIn pulls in useStatusChange and, through
// it, lib/supabase, which throws at module scope with no VITE_ env. This file
// is about the check-in screen, not the panel, so the hook is stubbed idle.
const statusChange = vi.hoisted(() => ({
  apply: vi.fn(async (_change: unknown) => true),
  state: { kind: 'idle' } as { kind: string; message?: string },
}))
vi.mock('../clients/useStatusChange', () => ({
  useStatusChange: () => ({ state: statusChange.state, apply: statusChange.apply }),
}))

// The suggestion banner mounted in CheckIn pulls in useConfirmSuggestion and,
// through it, lib/supabase, which throws at module scope with no VITE_ env.
vi.mock('./useConfirmSuggestion', () => ({
  useConfirmSuggestion: () => ({ state: { kind: 'idle' }, confirm: async () => true }),
}))

// The run and revert controls mounted in CheckIn pull in lib/supabase through
// useAiRun and useRevertSuggestion; stubbed idle here, tested in their own files.
const runs = vi.hoisted(() => ({ onFinished: (() => {}) as () => void }))
vi.mock('../ai/useAiRun', () => ({
  useAiRun: (_period: string, onFinished: () => void) => {
    runs.onFinished = onFinished
    return { run: null, state: 'idle', start: async () => ({ ok: true }), starting: false }
  },
}))
const reverts = vi.hoisted(() => ({
  revert: vi.fn(async (_args: unknown) => {}),
  onSuccess: null as null | (() => void),
}))
vi.mock('./useRevertSuggestion', async () => {
  const { useState } = await import('react')
  return {
    useRevertSuggestion: () => {
      const [state, setState] = useState<{ kind: string }>({ kind: 'idle' })
      return {
        state,
        revert: async (args: unknown) => {
          await reverts.revert(args)
          setState({ kind: 'reverted' })
        },
      }
    },
  }
})

// Finance suggestion reads Supabase; stubbed, controllable per test. `after`
// is what the read returns once a payment save has bumped the version.
const finance = vi.hoisted(() => ({ current: null as unknown, after: null as unknown, versions: [] as number[] }))
vi.mock('./useFinanceSuggestion', () => ({
  useFinanceSuggestion: (_c: number, _p: string, _r: boolean, _k: boolean, version = 0) => {
    finance.versions.push(version)
    return version > 0 ? finance.after : finance.current
  },
}))

// Productive hours (spec 2026-11-04 §7). Stubbed as a seam, honouring canRead
// the way the real hook does (null, no request). `byVersion` is what a Try
// again (a bumped version) returns; `current` is the first read.
const hours = vi.hoisted(() => ({
  current: null as unknown,
  byVersion: {} as Record<number, unknown>,
  calls: [] as [number, string, boolean, number][],
}))
vi.mock('./useMonthHours', () => ({
  useMonthHours: (clientId: number, period: string, canRead: boolean, version = 0) => {
    hours.calls.push([clientId, period, canRead, version])
    if (!canRead) return null
    return version in hours.byVersion ? hours.byVersion[version] : hours.current
  },
}))

// A capability can be withheld per test, for the role no preset has today: one
// that may edit scores but not see revenue (Review Focus 5). Everything else
// answers exactly as the real presets do.
const caps = vi.hoisted(() => ({ withheld: [] as string[] }))
vi.mock('../lib/capabilities', async () => {
  const actual = await vi.importActual<typeof import('../lib/capabilities')>('../lib/capabilities')
  return {
    ...actual,
    can: (role: string, capability: Parameters<typeof actual.can>[1]) =>
      caps.withheld.includes(capability) ? false : actual.can(role, capability),
  }
})

const { CheckIn } = await import('./CheckIn')

afterEach(() => {
  finance.current = null
  hours.current = null
  hours.byVersion = {}
  hours.calls.length = 0
  checkinArgs.calls.length = 0
  caps.withheld = []
  document.body.innerHTML = ''
  statusChange.apply.mockReset()
  statusChange.apply.mockResolvedValue(true)
  statusChange.state = { kind: 'idle' }
})

const PERIOD = '2026-08-01'
// Long clear of the gate, so a test not about the gate itself gets every
// question enabled or disabled purely by role, with no Advocacy-shaped
// surprise mixed in.
const CLIENT = { id: 1, name: 'Acme', status: 'active', started_on: '2020-01-01' }

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
  const merged = mockCheckinBase(overrides)
  // The scoring answers follow the draft unless a test sets them: the real
  // hook adds only the database's hours score to the draft's answers.
  return { ...merged, answers: overrides.answers ?? merged.draft.answers }
}

function mockCheckinBase(overrides: Partial<UseCheckin>): UseCheckin {
  return {
    status: 'ready',
    loadError: null,
    stored: null,
    lastMonth: null,
    lastPeriod: '2026-07-01',
    lastMonthBucketNotes: {},
    lastMonthFocus: null,
    draft: { answers: { comm_constructive: 4 }, notes: 'Renewal conversation went well.', bucketNotes: {}, focus: '' },
    saveState: { kind: 'dirty' },
    advocacyApplies: true,
    hoursApplies: false,
    answers: {},
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
    setAnswers: vi.fn(),
    setNotes: vi.fn(),
    setBucketNote: vi.fn(),
    setFocus: vi.fn(),
    reload: vi.fn(),
    submit: vi.fn(),
    ...overrides,
  }
}

// The third parameter carries CheckIn's own props (currently just
// onEditClient) rather than widening `overrides`, which is UseCheckin's shape
// and has nothing to do with what CheckIn itself accepts. Defaulted to `{}` so
// every call site above this line, written before onEditClient existed, keeps
// working untouched -- and the no-op default below is what supplies the prop
// for them, now that CheckIn requires it. A test that cares what the press does
// passes its own spy and overrides this.
function renderAs(
  role: Profile['role'],
  overrides: Partial<UseCheckin> = {},
  props: Partial<{ onEditClient: () => void }> = {},
) {
  hookState.current = mockCheckin(overrides)
  return render(
    <CheckIn
      client={CLIENT}
      period={PERIOD}
      profile={profile(role)}
      onBack={() => {}}
      onEditClient={() => {}}
      {...props}
    />,
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

// The owner: "when I click into a card, I'd love for there to be an option to
// hit edit client and it takes you into the client roster's edit panel." Same
// capability the board checks before offering Add client -- reused rather than
// a second rule about who may edit.
describe('CheckIn, the Edit client button', () => {
  it('offers Edit client to someone who can manage clients', () => {
    const onEditClient = vi.fn()
    renderAs('account_manager', {}, { onEditClient })

    fireEvent.click(screen.getByRole('button', { name: /edit client/i }))
    expect(onEditClient).toHaveBeenCalled()
  })

  // FINAL-REVIEW FINDING 6: onEditClient was optional. Board is the only caller
  // and always passes it, so the optionality bought nothing and cost this: a
  // future caller who forgot it would get a check-in screen with no Edit client
  // button for any admin, with a clean build and a green suite.
  //
  // A TYPE-LEVEL assertion, so it fails `npm run build` rather than this run:
  // the expect-error directive below IS the assertion. Make the prop optional
  // again and that directive becomes unused, and tsc fails on it.
  it('requires onEditClient of every caller, so a forgotten one cannot compile', () => {
    const omitted = (
      // @ts-expect-error -- onEditClient is required; leaving it out is the error.
      <CheckIn client={CLIENT} period={PERIOD} profile={profile('viewer')} onBack={() => {}} />
    )
    expect(omitted.type).toBe(CheckIn)
  })

  it('offers it to nobody else', () => {
    // Capability, never a role string: `can` is the only check in this app.
    renderAs('viewer', {}, { onEditClient: vi.fn() })

    expect(screen.queryByRole('button', { name: /edit client/i })).toBeNull()
  })
})

describe('CheckIn, when the Advocacy gate is shut', () => {
  // The reason is NOT a hook field -- the screen derives it from the
  // client's start date via advocacyGate(). Rendering the real component
  // tree (rather than the string-based CheckIn.test.tsx) is what lets this
  // count radios by section rather than by text.
  it('disables every Advocacy radio and leaves the other 17 enabled', () => {
    hookState.current = mockCheckin({ advocacyApplies: false, required: 17, scored: 0, draft: { answers: {}, notes: '', bucketNotes: {}, focus: '' }, hasContent: false, saveState: { kind: 'clean' } })
    render(
      <CheckIn
        client={{ ...CLIENT, started_on: null }}
        period={PERIOD}
        profile={profile('account_manager')}
        onBack={() => {}}
        onEditClient={() => {}}
      />,
    )

    const advocacy = within(screen.getByTestId('bucket-advocacy')).getAllByRole('radio')
    // 4 choice questions x 3 options, now that Advocacy renders ChoiceRow
    // rather than QuestionRow's five-option scale.
    expect(advocacy).toHaveLength(12)
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
  it('renders choice controls for Advocacy and 1-5 for the rest', () => {
    hookState.current = mockCheckin({ advocacyApplies: true })
    render(
      <CheckIn
        client={CLIENT}
        period={PERIOD}
        profile={profile('account_manager')}
        onBack={() => {}}
        onEditClient={() => {}}
      />,
    )

    const advocacy = within(screen.getByTestId('bucket-advocacy'))
    expect(advocacy.getAllByRole('radio')).toHaveLength(12) // 4 questions x No/Unsure/Yes
    const communication = within(screen.getByTestId('bucket-communication'))
    expect(communication.getAllByRole('radio')).toHaveLength(15) // 3 x 1-5
  })

  it('draws the choice control for Finances as well as Advocacy', () => {
    hookState.current = mockCheckin({ advocacyApplies: true })
    render(
      <CheckIn
        client={CLIENT}
        period={PERIOD}
        profile={profile('account_manager')}
        onBack={() => {}}
        onEditClient={() => {}}
      />,
    )

    const rackRate = screen.getByRole('radiogroup', { name: /Paying rack rate/ })
    expect(within(rackRate).getAllByRole('radio')).toHaveLength(3)
  })

  // The owner asked for anchored ends on 2026-08-31 and they were already
  // there -- he had not seen them, because they scrolled away above question
  // fourteen. Pinning them fixed the scrolling and not the seeing: on
  // 2026-09-01 he confirmed the sticky line worked and asked for the legend
  // inside each bucket instead, under the heading and above the first prompt.
  //
  // Placement itself is still untestable here -- CSS Modules are stubbed under
  // jsdom, so getComputedStyle reports nothing and an assertion on `position`
  // would pass or fail for reasons unrelated to the stylesheet. What IS
  // testable is that the copy survives, which is what a careless change to the
  // legend would break, and that there is now one per scale bucket.
  it('still states both anchors, once per bucket that has a scale', () => {
    hookState.current = mockCheckin({ advocacyApplies: true })
    render(
      <CheckIn
        client={CLIENT}
        period={PERIOD}
        profile={profile('account_manager')}
        onBack={() => {}}
        onEditClient={() => {}}
      />,
    )

    const legends = screen.getAllByTestId('scale-legend')
    expect(legends).toHaveLength(4)
    for (const legend of legends) {
      expect(legend.textContent).toContain('strongly disagree')
      expect(legend.textContent).toContain('strongly agree')
    }
  })
})

// Spec §3: the pause/cancel panel is a manage_clients control on the READY
// screen only. useStatusChange is a mock here (tests/supabaseModuleScope.test.ts
// forbids reaching lib/supabase unmocked), so this proves the mount and the two
// props CheckIn hands the panel -- hasCheckin and onPaused -- not the panel's
// own behaviour, which is EndClientPanel.dom.test.tsx's.
describe('CheckIn, the end-client panel', () => {
  it('offers it to someone who can manage clients', () => {
    renderAs('account_manager')
    expect(screen.getByRole('button', { name: 'Cancelled this month' })).toBeTruthy()
  })

  it('does not offer it to a viewer', () => {
    renderAs('viewer')
    expect(screen.queryByRole('button', { name: 'Cancelled this month' })).toBeNull()
  })

  it('does not offer it while the check-in is still loading', () => {
    renderAs('account_manager', { status: 'loading' })
    expect(screen.queryByRole('button', { name: 'Cancelled this month' })).toBeNull()
  })

  it('goes back to the board once a pause has been written', async () => {
    const onBack = vi.fn()
    hookState.current = mockCheckin()
    render(
      <CheckIn client={CLIENT} period={PERIOD} profile={profile('account_manager')} onBack={onBack} onEditClient={() => {}} />,
    )
    fireEvent.click(screen.getByRole('button', { name: 'Paused this month' }))
    fireEvent.click(screen.getByRole('button', { name: 'Pause Acme' }))
    await waitFor(() => expect(onBack).toHaveBeenCalledTimes(1))
    expect(statusChange.apply).toHaveBeenCalledWith({ kind: 'pause' })
  })

  it('warns that a month with a stored check-in keeps the client on its board', () => {
    renderAs('account_manager', { stored: { id: 'c1' } as unknown as UseCheckin['stored'] })
    fireEvent.click(screen.getByRole('button', { name: 'Paused this month' }))
    expect(screen.getByText(/already have a check-in/)).toBeTruthy()
  })

  it('does not make that claim when the month has no stored check-in', () => {
    renderAs('account_manager', { stored: null })
    fireEvent.click(screen.getByRole('button', { name: 'Paused this month' }))
    expect(screen.queryByText(/already have a check-in/)).toBeNull()
  })
})

describe('CheckIn, the suggestion banner', () => {
  const flagged = { id: 'c1', suggested_at: '2026-10-29T12:00:00Z' } as unknown as UseCheckin['stored']

  it('offers an enabled Confirm to someone who may score, when the form matches the stored row', () => {
    renderAs('account_manager', { stored: flagged, saveState: { kind: 'clean' } })
    expect(screen.getByText(/Suggested by AI on Oct 29/)).toBeTruthy()
    expect((screen.getByRole('button', { name: 'Confirm' }) as HTMLButtonElement).disabled).toBe(false)
  })

  it('disables Confirm once an answer has been changed', () => {
    renderAs('account_manager', { stored: flagged, saveState: { kind: 'dirty' } })
    expect((screen.getByRole('button', { name: 'Confirm' }) as HTMLButtonElement).disabled).toBe(true)
    expect(screen.getByText(/Save them instead/)).toBeTruthy()
  })

  it('disables Confirm when the form opened with an unsaved draft from an earlier visit', () => {
    renderAs('account_manager', { stored: flagged, saveState: { kind: 'clean' }, unsavedFromEarlierVisit: true })
    expect((screen.getByRole('button', { name: 'Confirm' }) as HTMLButtonElement).disabled).toBe(true)
  })

  it('shows the line but no Confirm to a viewer', () => {
    renderAs('viewer', { stored: flagged })
    expect(screen.getByText(/Suggested by AI on Oct 29/)).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Confirm' })).toBeNull()
  })
})

describe('CheckIn, finance answers from revenue', () => {
  const SUGGESTION = {
    fin_rack_rate: { value: 1, reason: 'R1' },
    fin_rate_increased: { value: 3, reason: 'R2' },
  }
  const blank = { answers: {}, notes: '', bucketNotes: {}, focus: '' }

  function props(role: Profile['role'] = 'account_manager') {
    return { client: CLIENT, period: PERIOD, profile: profile(role), onBack: () => {}, onEditClient: () => {} }
  }

  it('fills both blank answers in ONE setAnswers call and shows both reasons', () => {
    finance.current = SUGGESTION
    renderAs('account_manager', { draft: blank })
    const h = hookState.current as UseCheckin
    expect(h.setAnswers).toHaveBeenCalledTimes(1)
    expect(h.setAnswers).toHaveBeenCalledWith({ fin_rack_rate: 1, fin_rate_increased: 3 })
    expect(h.setAnswer).not.toHaveBeenCalled()
    const hints = screen.getAllByTestId('answer-hint')
    expect(hints.map((n) => n.textContent)).toEqual(['R1', 'R2'])
    expect(within(screen.getByText('Paying rack rate.').closest('section') as HTMLElement).getByText('R1')).toBeTruthy()
  })

  it('skips an answer the database already holds', () => {
    finance.current = SUGGESTION
    renderAs('account_manager', {
      draft: blank,
      stored: { fin_rack_rate: 5 } as unknown as UseCheckin['stored'],
    })
    expect((hookState.current as UseCheckin).setAnswers).toHaveBeenCalledTimes(1)
    expect((hookState.current as UseCheckin).setAnswers).toHaveBeenCalledWith({ fin_rate_increased: 3 })
  })

  it('skips an answer the form already holds', () => {
    finance.current = SUGGESTION
    renderAs('account_manager', { draft: { answers: { fin_rack_rate: 3 }, notes: '', bucketNotes: {}, focus: '' } })
    expect((hookState.current as UseCheckin).setAnswers).toHaveBeenCalledWith({ fin_rate_increased: 3 })
  })

  it('does not refill after the person clears; a new period or client fills again', () => {
    finance.current = SUGGESTION
    hookState.current = mockCheckin({ draft: blank })
    const first = hookState.current
    const { rerender } = render(<CheckIn {...props()} />)
    expect(first.setAnswers).toHaveBeenCalledTimes(1)

    // Same visit, draft still blank (as if cleared), same finance object.
    const cleared = mockCheckin({ draft: { answers: {}, notes: '', bucketNotes: {}, focus: '' } })
    hookState.current = cleared
    rerender(<CheckIn {...props()} />)
    expect(cleared.setAnswers).not.toHaveBeenCalled()
    expect(first.setAnswers).toHaveBeenCalledTimes(1)

    const nextPeriod = mockCheckin({ draft: blank })
    hookState.current = nextPeriod
    rerender(<CheckIn {...props()} period="2026-09-01" />)
    expect(nextPeriod.setAnswers).toHaveBeenCalledTimes(1)

    const otherClient = mockCheckin({ draft: blank })
    hookState.current = otherClient
    rerender(<CheckIn {...props()} client={{ ...CLIENT, id: 2 }} period="2026-09-01" />)
    expect(otherClient.setAnswers).toHaveBeenCalledTimes(1)
  })

  it('does not fill for a viewer, who cannot edit, though the hint may show', () => {
    finance.current = SUGGESTION
    renderAs('viewer', { draft: blank })
    expect((hookState.current as UseCheckin).setAnswers).not.toHaveBeenCalled()
  })

  it('does nothing without a suggestion', () => {
    renderAs('account_manager', { draft: blank })
    expect((hookState.current as UseCheckin).setAnswers).not.toHaveBeenCalled()
    expect(screen.queryAllByTestId('answer-hint')).toHaveLength(0)
  })

  it('does nothing while loading', () => {
    finance.current = SUGGESTION
    renderAs('account_manager', { status: 'loading', draft: blank })
    expect((hookState.current as UseCheckin).setAnswers).not.toHaveBeenCalled()
  })

  it('puts a hint on no other question', () => {
    finance.current = SUGGESTION
    renderAs('account_manager', { draft: blank })
    expect(screen.getAllByTestId('answer-hint')).toHaveLength(2)
  })

  // The seam with suggested check-ins: Confirm is only offered while the form
  // matches the stored row, so a fill over a stored answer would disable it.
  it('does not fill, and leaves Confirm enabled, on a suggested row that already holds both answers', () => {
    finance.current = SUGGESTION
    renderAs('account_manager', {
      stored: { id: 'c1', suggested_at: '2026-10-29T12:00:00Z', fin_rack_rate: 5, fin_rate_increased: 1 } as unknown as UseCheckin['stored'],
      // Draft deliberately lacks the keys: the draft guard alone would not
      // catch this, so the test isolates the stored-row guard.
      draft: blank,
      saveState: { kind: 'clean' },
    })
    expect((hookState.current as UseCheckin).setAnswers).not.toHaveBeenCalled()
    expect((screen.getByRole('button', { name: 'Confirm' }) as HTMLButtonElement).disabled).toBe(false)
  })

  it('fills both keys once on a suggested row whose finance answers are null', () => {
    finance.current = SUGGESTION
    renderAs('account_manager', {
      stored: { id: 'c1', suggested_at: '2026-10-29T12:00:00Z', fin_rack_rate: null, fin_rate_increased: null } as unknown as UseCheckin['stored'],
      draft: blank,
      saveState: { kind: 'clean' },
    })
    const h = hookState.current as UseCheckin
    expect(h.setAnswers).toHaveBeenCalledTimes(1)
    expect(h.setAnswers).toHaveBeenCalledWith({ fin_rack_rate: 1, fin_rate_increased: 3 })
  })
})

describe('CheckIn, run and revert controls', () => {
  const ai = { suggested_at: '2026-10-28T12:00:00Z', run_id: 1, notes: 'n', answers: {} }
  const manualRow = { id: 'c1', suggested_at: null, ai_suggestion: ai } as unknown as UseCheckin['stored']

  it('offers both to someone who may score a reviewed row with an AI copy', () => {
    renderAs('account_manager', { stored: manualRow, saveState: { kind: 'clean' } })
    expect((screen.getByRole('button', { name: 'Run AI score for this client' }) as HTMLButtonElement).disabled).toBe(false)
    expect((screen.getByRole('button', { name: 'Revert to AI suggested scores' }) as HTMLButtonElement).disabled).toBe(false)
  })

  it('a manual row asks before overwriting', () => {
    renderAs('account_manager', { stored: manualRow, saveState: { kind: 'clean' } })
    fireEvent.click(screen.getByRole('button', { name: 'Run AI score for this client' }))
    expect(screen.getByRole('button', { name: 'Overwrite' })).toBeTruthy()
  })

  it('offers neither to a viewer', () => {
    renderAs('viewer', { stored: manualRow })
    expect(screen.queryByRole('button', { name: 'Run AI score for this client' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Revert to AI suggested scores' })).toBeNull()
  })

  it('with unsaved changes, disables Run (with its caption) but leaves revert enabled and captionless', () => {
    renderAs('account_manager', { stored: manualRow, saveState: { kind: 'dirty' } })
    expect((screen.getByRole('button', { name: 'Run AI score for this client' }) as HTMLButtonElement).disabled).toBe(true)
    expect((screen.getByRole('button', { name: 'Revert to AI suggested scores' }) as HTMLButtonElement).disabled).toBe(false)
    expect(screen.getAllByText('You have unsaved changes. Save them first.')).toHaveLength(1)
  })

  it('manual row: revert shown and enabled with or without unsaved changes', () => {
    for (const saveState of [{ kind: 'clean' }, { kind: 'dirty' }] as const) {
      cleanup()
      renderAs('account_manager', { stored: manualRow, saveState })
      expect((screen.getByRole('button', { name: 'Revert to AI suggested scores' }) as HTMLButtonElement).disabled).toBe(false)
    }
  })

  it('still-suggested row: revert hidden when clean, shown and enabled when dirty', () => {
    const flagged = { id: 'c1', suggested_at: '2026-10-29T12:00:00Z', ai_suggestion: ai } as unknown as UseCheckin['stored']
    renderAs('account_manager', { stored: flagged, saveState: { kind: 'clean' } })
    expect(screen.queryByRole('button', { name: 'Revert to AI suggested scores' })).toBeNull()
    cleanup()
    renderAs('account_manager', { stored: flagged, saveState: { kind: 'dirty' } })
    expect((screen.getByRole('button', { name: 'Revert to AI suggested scores' }) as HTMLButtonElement).disabled).toBe(false)
  })

  it('no parseable ai_suggestion: revert hidden even with unsaved changes', () => {
    const noAi = { id: 'c1', suggested_at: null, ai_suggestion: null } as unknown as UseCheckin['stored']
    renderAs('account_manager', { stored: noAi, saveState: { kind: 'dirty' } })
    expect(screen.queryByRole('button', { name: 'Revert to AI suggested scores' })).toBeNull()
  })

  it('viewer with unsaved changes on a still-suggested row: revert hidden', () => {
    const flagged = { id: 'c1', suggested_at: '2026-10-29T12:00:00Z', ai_suggestion: ai } as unknown as UseCheckin['stored']
    renderAs('viewer', { stored: flagged, saveState: { kind: 'dirty' } })
    expect(screen.queryByRole('button', { name: 'Revert to AI suggested scores' })).toBeNull()
  })

  it('still-suggested row with unsaved changes: Revert gets the stored row, then draft cleared and reloaded', async () => {
    writeDraft(CLIENT.id, PERIOD, { answers: { comm_constructive: 2 }, notes: 'edit', bucketNotes: {}, focus: '' })
    reverts.revert.mockClear()
    const stored = { id: 'c1', suggested_at: '2026-10-29T12:00:00Z', ai_suggestion: ai } as unknown as UseCheckin['stored']
    let seen: unknown = 'unset'
    const reload = vi.fn(() => {
      seen = readDraft(CLIENT.id, PERIOD)
    })
    renderAs('account_manager', { stored, saveState: { kind: 'dirty' }, reload })
    fireEvent.click(screen.getByRole('button', { name: 'Revert to AI suggested scores' }))
    fireEvent.click(screen.getByRole('button', { name: 'Revert' }))
    await waitFor(() => expect(reload).toHaveBeenCalledTimes(1))
    expect((reverts.revert.mock.calls[0][0] as { current: unknown }).current).toBe(stored)
    expect(seen).toBeNull()
    window.localStorage.clear()
  })

  it('Cancel with unsaved changes: no revert call, no reload, draft kept', () => {
    writeDraft(CLIENT.id, PERIOD, { answers: { comm_constructive: 2 }, notes: 'edit', bucketNotes: {}, focus: '' })
    reverts.revert.mockClear()
    const reload = vi.fn()
    const stored = { id: 'c1', suggested_at: null, ai_suggestion: ai } as unknown as UseCheckin['stored']
    renderAs('account_manager', { stored, saveState: { kind: 'dirty' }, reload })
    fireEvent.click(screen.getByRole('button', { name: 'Revert to AI suggested scores' }))
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(reverts.revert).not.toHaveBeenCalled()
    expect(reload).not.toHaveBeenCalled()
    expect(readDraft(CLIENT.id, PERIOD)).not.toBeNull()
    window.localStorage.clear()
  })

  it('hides revert on a row awaiting review', () => {
    const flagged = { id: 'c1', suggested_at: '2026-10-29T12:00:00Z', ai_suggestion: ai } as unknown as UseCheckin['stored']
    renderAs('account_manager', { stored: flagged, saveState: { kind: 'clean' } })
    expect(screen.queryByRole('button', { name: 'Revert to AI suggested scores' })).toBeNull()
  })

  it('revert receives the STORED row answers as current, not the draft', async () => {
    const stored = { id: 'c1', suggested_at: null, ai_suggestion: ai, fin_rack_rate: 5 } as unknown as UseCheckin['stored']
    renderAs('account_manager', {
      stored,
      saveState: { kind: 'clean' },
      draft: { answers: { fin_rack_rate: 1 }, notes: '', bucketNotes: {}, focus: '' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Revert to AI suggested scores' }))
    fireEvent.click(screen.getByRole('button', { name: 'Revert' }))
    await waitFor(() => expect(reverts.revert).toHaveBeenCalledTimes(1))
    expect((reverts.revert.mock.calls[0][0] as { current: unknown }).current).toBe(stored)
  })

  describe('reloading after the stored row is rewritten', () => {
    const seedDraft = () => {
      // A draft that matches the old row: edited, then edited back, never saved.
      writeDraft(CLIENT.id, PERIOD, { answers: { comm_constructive: 2 }, notes: 'old', bucketNotes: {}, focus: '' })
      expect(readDraft(CLIENT.id, PERIOD)).not.toBeNull()
    }
    const reloadSeesDraft = (overrides: Partial<UseCheckin>) => {
      let seen: unknown = 'unset'
      const reload = vi.fn(() => {
        seen = readDraft(CLIENT.id, PERIOD)
      })
      renderAs('account_manager', { ...overrides, reload })
      return { reload, seen: () => seen }
    }
    afterEach(() => {
      window.localStorage.clear()
    })

    it('a successful revert clears the local draft before reloading', async () => {
      seedDraft()
      const stored = { id: 'c1', suggested_at: null, ai_suggestion: ai } as unknown as UseCheckin['stored']
      const r = reloadSeesDraft({ stored, saveState: { kind: 'clean' } })
      fireEvent.click(screen.getByRole('button', { name: 'Revert to AI suggested scores' }))
      fireEvent.click(screen.getByRole('button', { name: 'Revert' }))
      await waitFor(() => expect(r.reload).toHaveBeenCalledTimes(1))
      expect(r.seen()).toBeNull()
    })

    it('a finished run clears the local draft before reloading', () => {
      seedDraft()
      const stored = { id: 'c1', suggested_at: null } as unknown as UseCheckin['stored']
      const r = reloadSeesDraft({ stored, saveState: { kind: 'clean' } })
      act(() => runs.onFinished())
      expect(r.reload).toHaveBeenCalledTimes(1)
      expect(r.seen()).toBeNull()
    })

    it('a run that finishes over unsaved edits neither reloads nor clears the draft', () => {
      seedDraft()
      const stored = { id: 'c1', suggested_at: null } as unknown as UseCheckin['stored']
      const r = reloadSeesDraft({ stored, saveState: { kind: 'dirty' } })
      act(() => runs.onFinished())
      expect(r.reload).not.toHaveBeenCalled()
      expect(readDraft(CLIENT.id, PERIOD)).not.toBeNull()
    })
  })
})

describe('CheckIn, the payments box', () => {
  afterEach(() => {
    payments.calls.length = 0
  })

  // The owner moved the box into Finances on 2026-11-02: inside that section,
  // under its heading and above its first question, and in no other section.
  it('shows the payments box inside Finances, above its questions, for someone who may see revenue', () => {
    renderAs('account_manager')
    expect(payments.calls.at(-1)).toEqual([CLIENT.id, PERIOD, true])
    const heading = screen.getByRole('heading', { name: 'August payments' })
    const finances = screen.getByTestId('bucket-finances')
    expect(finances.contains(heading)).toBe(true)
    const financesHeading = within(finances).getByTestId('bucket-heading')
    const firstQuestion = within(finances).getAllByRole('radiogroup')[0]
    expect(financesHeading.compareDocumentPosition(heading) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(heading.compareDocumentPosition(firstQuestion) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(screen.getAllByRole('heading', { name: /payments/ })).toHaveLength(1)
  })

  it('a viewer gets no payments box and no revenue query', () => {
    renderAs('viewer')
    expect(payments.calls.length).toBeGreaterThan(0)
    expect(payments.calls.every(([, , canRead]) => canRead === false)).toBe(true)
    expect(screen.queryByRole('heading', { name: /payments/ })).toBeNull()
    expect(screen.queryByRole('button', { name: /retainer/ })).toBeNull()
  })
})

// Spec 2026-11-02 §5, through the REAL useCheckin: the form's own state is what
// is under test, so a stubbed hook would prove nothing.
describe('CheckIn, finance answers after a payment save', () => {
  const radio = (key: string, value: number) =>
    document.querySelector(`input[name="question-${key}"][value="${value}"]`) as HTMLInputElement

  async function openAsAdmin() {
    hookState.real = true
    window.localStorage.clear()
    render(
      <CheckIn client={CLIENT} period={PERIOD} profile={profile('admin')} onBack={() => {}} onEditClient={() => {}} />,
    )
    await screen.findByRole('heading', { name: 'August payments' })
  }

  // Leave and come back, keeping localStorage: what a reload restores.
  async function reopenAsAdmin() {
    cleanup()
    render(
      <CheckIn client={CLIENT} period={PERIOD} profile={profile('admin')} onBack={() => {}} onEditClient={() => {}} />,
    )
    await screen.findByRole('heading', { name: 'August payments' })
  }

  async function confirmPayment() {
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /Confirm .* retainer/ }))
    })
  }

  afterEach(() => {
    hookState.real = false
    checkinRows.current = []
    finance.after = null
    finance.versions.length = 0
    payments.save = null
    window.localStorage.clear()
  })

  it('after a payment save the finance answers take the new values over the stored placeholder', async () => {
    // The AI's "finance pending revenue" placeholders, stored. Before the save
    // the data gives no answer; after it, only the rate change is answered.
    checkinRows.current = [
      { client_id: CLIENT.id, period: PERIOD, fin_rate_increased: 3, fin_rack_rate: 3, comm_timely: 4, notes: null },
    ]
    finance.after = { fin_rate_increased: { value: 5, reason: 'Up on last month.' } }
    await openAsAdmin()
    expect(radio('fin_rate_increased', 3).checked).toBe(true)
    expect(document.getElementById('checkin-save-status')?.textContent).not.toMatch(/Unsaved/)

    await confirmPayment()
    await waitFor(() => expect(radio('fin_rate_increased', 5).checked).toBe(true))
    // The data still gives no rack-rate answer: left alone.
    expect(radio('fin_rack_rate', 3).checked).toBe(true)
    expect(document.getElementById('checkin-save-status')?.textContent).toMatch(/Unsaved changes/)
  })

  it('a payment save keeps unsaved score edits', async () => {
    checkinRows.current = [
      { client_id: CLIENT.id, period: PERIOD, fin_rate_increased: 3, comm_timely: 4, notes: null },
    ]
    finance.after = { fin_rate_increased: { value: 5, reason: 'Up on last month.' } }
    await openAsAdmin()
    fireEvent.click(radio('comm_timely', 2))
    expect(radio('comm_timely', 2).checked).toBe(true)

    await confirmPayment()
    await waitFor(() => expect(radio('fin_rate_increased', 5).checked).toBe(true))
    expect(radio('comm_timely', 2).checked).toBe(true)
  })

  // Fix round 1: the overwrite is persisted, so leaving after a payment save
  // cannot bring the stored placeholder back as an "earlier visit" draft that
  // Save would then write over revenue that now exists.
  it('after a score edit and a payment save, a reload keeps the new finance value', async () => {
    checkinRows.current = [
      { client_id: CLIENT.id, period: PERIOD, fin_rate_increased: 3, comm_timely: 4, notes: null },
    ]
    finance.after = { fin_rate_increased: { value: 5, reason: 'Up on last month.' } }
    await openAsAdmin()
    fireEvent.click(radio('comm_timely', 2))
    await confirmPayment()
    await waitFor(() => expect(radio('fin_rate_increased', 5).checked).toBe(true))

    await reopenAsAdmin()
    await waitFor(() => expect(radio('comm_timely', 2).checked).toBe(true))
    expect(radio('fin_rate_increased', 5).checked).toBe(true)
  })

  it('after a payment save with no typed edit, a reload restores the new value as unsaved', async () => {
    checkinRows.current = [
      { client_id: CLIENT.id, period: PERIOD, fin_rate_increased: 3, comm_timely: 4, notes: null },
    ]
    finance.after = { fin_rate_increased: { value: 5, reason: 'Up on last month.' } }
    await openAsAdmin()
    await confirmPayment()
    await waitFor(() => expect(radio('fin_rate_increased', 5).checked).toBe(true))

    await reopenAsAdmin()
    await waitFor(() => expect(radio('fin_rate_increased', 5).checked).toBe(true))
    expect(screen.getByText(/from an earlier visit on this device and have not been saved/)).toBeTruthy()
  })

  // Spec §5: the payment save changes a finance answer on a row the AI
  // suggested, so the form no longer matches the stored suggestion. Confirm
  // would confirm answers that are not on screen; Save is what remains, and it
  // must stay enabled so the person can still finish.
  it('a payment save that changes a finance answer on a suggested row disables Confirm but not Save', async () => {
    checkinRows.current = [
      {
        id: 'c1',
        client_id: CLIENT.id,
        period: PERIOD,
        suggested_at: '2026-10-29T12:00:00Z',
        fin_rate_increased: 3,
        comm_timely: 4,
        notes: null,
      },
    ]
    finance.after = { fin_rate_increased: { value: 5, reason: 'Up on last month.' } }
    await openAsAdmin()
    const confirm = () => screen.getByRole('button', { name: 'Confirm' }) as HTMLButtonElement
    expect(confirm().disabled).toBe(false)

    await confirmPayment()
    await waitFor(() => expect(radio('fin_rate_increased', 5).checked).toBe(true))
    expect(confirm().disabled).toBe(true)
    expect(screen.getByText(/Save them instead/)).toBeTruthy()
    expect((screen.getByRole('button', { name: 'Save draft' }) as HTMLButtonElement).disabled).toBe(false)
  })

  it('a failed payment save changes no answer', async () => {
    checkinRows.current = [{ client_id: CLIENT.id, period: PERIOD, fin_rate_increased: 3, notes: null }]
    finance.after = { fin_rate_increased: { value: 5, reason: 'Up on last month.' } }
    payments.save = async () => ({ ok: false, error: 'Nope.' })
    await openAsAdmin()
    await confirmPayment()
    await screen.findByText('Nope.')
    expect(radio('fin_rate_increased', 3).checked).toBe(true)
    expect(finance.versions.every((v) => v === 0)).toBe(true)
  })
})

// Brief 2026-11-05 A: Productive hours in Finances and Hours, read-only. The
// database scores the hours question; nobody picks it, and nothing fills it.
describe('CheckIn, hours from Productive', () => {
  const OCT = '2026-10-01'
  const blank = { answers: {}, notes: '', bucketNotes: {}, focus: '' }
  const LINE = {
    dealId: 'd1', name: 'Budget A', budgetedHours: 20, workedHours: 27.5,
    budgetedMinutes: 1200, workedMinutes: 1650, diffHours: 7.5, flagged: true,
  }
  const SCORED = {
    applies: true,
    lines: [LINE],
    answer: { value: 2, reason: 'From Productive: 27.5h worked vs 20h budgeted (+7.5h).' },
    message: null,
  }
  const UNREACHABLE = { applies: false, reason: 'unreachable', message: "Couldn't reach Productive", lines: [], answer: null }
  const NO_BUDGET = { applies: false, reason: 'no_budget', message: 'No fixed monthly budget', lines: [], answer: null }
  const NOT_FINISHED = {
    applies: false, reason: 'not_finished', message: 'Month not finished – hours so far', lines: [LINE], answer: null,
  }
  const hoursGroup = () => screen.queryByRole('radiogroup', { name: /Hours within budget/ })
  const hoursInputs = () => document.querySelectorAll('input[name="question-fin_hours_in_budget"]')

  function props(role: Profile['role'] = 'account_manager') {
    return { client: CLIENT, period: OCT, profile: profile(role), onBack: () => {}, onEditClient: () => {} }
  }
  function renderHours(role: Profile['role'], overrides: Partial<UseCheckin> = {}) {
    hookState.current = mockCheckin({ hoursApplies: true, ...overrides })
    return render(<CheckIn {...props(role)} />)
  }

  it('draws no hours options at all, for any role, scored or not', () => {
    for (const result of [SCORED, UNREACHABLE, NO_BUDGET, NOT_FINISHED]) {
      for (const role of ['account_manager', 'admin', 'viewer'] as const) {
        hours.current = result
        renderHours(role, { hoursApplies: result.applies })
        expect(hoursGroup()).toBeNull()
        expect(hoursInputs()).toHaveLength(0)
        cleanup()
      }
    }
  })

  it('never fills the hours answer, even when the hours are scored and the form is blank', () => {
    hours.current = SCORED
    renderHours('account_manager', { draft: blank })
    const h = hookState.current as UseCheckin
    for (const call of (h.setAnswers as ReturnType<typeof vi.fn>).mock.calls) {
      expect(call[0]).not.toHaveProperty('fin_hours_in_budget')
    }
    expect(h.setAnswer).not.toHaveBeenCalled()
  })

  it('still fills the finance answers, without hours, in one call', () => {
    finance.current = { fin_rack_rate: { value: 1, reason: 'Below.' } }
    hours.current = SCORED
    renderHours('account_manager', { draft: blank })
    const h = hookState.current as UseCheckin
    expect(h.setAnswers).toHaveBeenCalledTimes(1)
    expect(h.setAnswers).toHaveBeenCalledWith({ fin_rack_rate: 1 })
  })

  it('shows the box last in Finances and Hours, with the score and its band label', () => {
    hours.current = SCORED
    renderHours('account_manager')
    const finances = screen.getByTestId('bucket-finances')
    const box = within(finances).getByTestId('hours-box')
    expect(within(box).getByTestId('hours-score').textContent).toBe('Hours within budget: 2 – 8–10h under or 6–8h over')
    expect(within(box).getByTestId('hours-clock').textContent).toBe('27:30 h/20:00 h')
    expect(within(box).getByRole('img', { name: '27:30 of 20:00 budgeted hours' })).toBeTruthy()
    const rate = screen.getByRole('radiogroup', { name: /Rate vs last month/ })
    expect(rate.compareDocumentPosition(box) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(hours.calls.at(-1)).toEqual([CLIENT.id, OCT, true, 0])
  })

  it('shows the reason, and the hours so far, when it does not apply', () => {
    hours.current = NOT_FINISHED
    renderHours('account_manager', { hoursApplies: false })
    const finances = screen.getByTestId('bucket-finances')
    expect(within(finances).getByTestId('hours-reason').textContent).toBe('Month not finished – hours so far')
    expect(within(finances).getAllByTestId('hours-line')).toHaveLength(1)
    expect(within(finances).queryByTestId('hours-score')).toBeNull()
  })

  it('Try again reads the hours again', () => {
    hours.current = UNREACHABLE
    hours.byVersion = { 1: SCORED }
    renderHours('account_manager', { hoursApplies: false, draft: blank })
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }))
    expect(hours.calls.at(-1)?.[3]).toBe(1)
    expect(screen.getByTestId('hours-score').textContent).toBe('Hours within budget: 2 – 8–10h under or 6–8h over')
  })

  it('hands the hours result and its score to useCheckin', () => {
    hours.current = SCORED
    renderHours('account_manager')
    const last = checkinArgs.calls.at(-1)
    expect(last?.[3]).toBe(true)
    expect(last?.[4]).toBe(2)
  })

  it('hands no score to useCheckin when it does not apply, and null when unread', () => {
    hours.current = NOT_FINISHED
    renderHours('account_manager', { hoursApplies: false })
    expect(checkinArgs.calls.at(-1)?.slice(3)).toEqual([false, null])
    cleanup()
    caps.withheld = ['view_revenue']
    renderHours('account_manager')
    expect(checkinArgs.calls.at(-1)?.slice(3)).toEqual([null, null])
  })

  it('without the hours result, shows the stored score when the database says it applies', () => {
    caps.withheld = ['view_revenue']
    renderHours('account_manager', { hoursApplies: true, answers: { fin_hours_in_budget: 5 } })
    const finances = screen.getByTestId('bucket-finances')
    expect(within(finances).getByTestId('hours-score').textContent).toBe('Hours within budget: 5 – Within 6h')
    expect(screen.queryByTestId('hours-box')).toBeNull()
    expect(hoursInputs()).toHaveLength(0)
  })

  it('without the hours result, shows nothing when it does not apply', () => {
    caps.withheld = ['view_revenue']
    renderHours('account_manager', { hoursApplies: false, answers: {} })
    expect(screen.queryByTestId('hours-score')).toBeNull()
    expect(screen.queryByTestId('hours-box')).toBeNull()
  })

  it('scores the Finances bucket from the scoring answers, hours included', () => {
    hours.current = SCORED
    renderHours('account_manager', {
      draft: { answers: { fin_rack_rate: 5, fin_pays_on_time: 5, fin_rate_increased: 5 }, notes: '', bucketNotes: {}, focus: '' },
      answers: { fin_rack_rate: 5, fin_pays_on_time: 5, fin_rate_increased: 5, fin_hours_in_budget: 1 },
    })
    // (5 + 5 + 5 + 1) / 4, from `answers`, not the draft.
    expect(screen.getByTestId('bucket-score-finances').textContent).toContain('4.00')
  })

  it('labels the section "Finances and Hours"', () => {
    renderHours('account_manager')
    const finances = screen.getByTestId('bucket-finances')
    expect(within(finances).getByTestId('bucket-heading').textContent).toBe('Finances and Hours')
  })

  it('a payment save re-reads finance only: hours are neither touched nor re-fetched', async () => {
    hours.current = SCORED
    finance.after = { fin_rate_increased: { value: 5, reason: 'Up.' } }
    renderHours('admin', {
      stored: { fin_hours_in_budget: 2, fin_hours_applies: true } as unknown as UseCheckin['stored'],
    })
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /Confirm .* retainer/ }))
    })
    const h = hookState.current as UseCheckin
    await waitFor(() => expect(h.setAnswers).toHaveBeenCalledWith({ fin_rate_increased: 5 }, { overwrite: true }))
    for (const [values] of (h.setAnswers as ReturnType<typeof vi.fn>).mock.calls) {
      expect(values).not.toHaveProperty('fin_hours_in_budget')
    }
    expect(hours.calls.every(([, , , v]) => v === 0)).toBe(true)
    finance.after = null
  })
})

// Through the REAL useCheckin, because which questions are counted and what the
// count is against are the hook's to decide; a stub would hand back whatever
// the test told it to.
describe('CheckIn, whether the hours question is counted', () => {
  const OCT = '2026-10-01'
  const NO_BUDGET = { applies: false, reason: 'no_budget', message: 'No fixed monthly budget', lines: [], answer: null }
  const UNREACHABLE = { applies: false, reason: 'unreachable', message: "Couldn't reach Productive", lines: [], answer: null }
  const SCORED = {
    applies: true,
    lines: [],
    answer: { value: 3, reason: 'From Productive: 13h worked vs 20h budgeted (−7h).' },
    message: null,
  }
  const hoursInputs = () => document.querySelectorAll('input[name="question-fin_hours_in_budget"]')
  const caption = () => screen.getByTestId('overall-caption').textContent

  async function open(client: typeof CLIENT | { id: number; name: string; status: string; started_on: string | null }, role: Profile['role'] = 'account_manager') {
    hookState.real = true
    window.localStorage.clear()
    render(<CheckIn client={client} period={OCT} profile={profile(role)} onBack={() => {}} onEditClient={() => {}} />)
    await screen.findByTestId('overall-caption')
  }

  afterEach(() => {
    hookState.real = false
    checkinRows.current = []
    window.localStorage.clear()
  })

  it('counts 0 of 21 (17 without Advocacy) when hours do not apply', async () => {
    hours.current = NO_BUDGET
    await open(CLIENT)
    expect(caption()).toBe('not scored · 0 of 21 answered')
    cleanup()
    await open({ ...CLIENT, started_on: null })
    expect(caption()).toBe('not scored · 0 of 17 answered')
  })

  it('an unreachable Productive is unscored and does not apply: 0 of 21', async () => {
    hours.current = UNREACHABLE
    await open(CLIENT)
    expect(caption()).toBe('not scored · 0 of 21 answered')
    expect(screen.getByRole('button', { name: 'Try again' })).toBeTruthy()
  })

  it('counts the database\'s hours score as answered: 1 of 22 (1 of 18) when it applies', async () => {
    hours.current = SCORED
    await open(CLIENT)
    expect(caption()).toBe('not scored · 1 of 22 answered')
    expect(hoursInputs()).toHaveLength(0)
    cleanup()
    await open({ ...CLIENT, started_on: null })
    expect(caption()).toBe('not scored · 1 of 18 answered')
  })

  it('the hours result wins over the stored flag once it is read', async () => {
    hours.current = NO_BUDGET
    checkinRows.current = [{ client_id: CLIENT.id, period: OCT, fin_hours_applies: true, fin_hours_in_budget: 5, notes: null }]
    await open(CLIENT)
    expect(caption()).toBe('not scored · 0 of 21 answered')
  })

  it('for an editor without view_revenue, counts and shows the stored score, with no options', async () => {
    caps.withheld = ['view_revenue']
    checkinRows.current = [{ client_id: CLIENT.id, period: OCT, fin_hours_applies: true, fin_hours_in_budget: 3, notes: null }]
    await open(CLIENT)
    expect(hours.calls.length).toBeGreaterThan(0)
    expect(hours.calls.every(([, , canRead]) => canRead === false)).toBe(true)
    expect(screen.queryByTestId('hours-box')).toBeNull()
    expect(screen.getByTestId('hours-score').textContent).toBe('Hours within budget: 3 – 6–8h under')
    expect(caption()).toBe('not scored · 1 of 22 answered')
    expect(hoursInputs()).toHaveLength(0)
  })

  it('for that editor, counts nothing for hours when the row says it does not apply', async () => {
    caps.withheld = ['view_revenue']
    checkinRows.current = [{ client_id: CLIENT.id, period: OCT, fin_hours_applies: false, notes: null }]
    await open(CLIENT)
    expect(caption()).toBe('not scored · 0 of 21 answered')
  })
})

// Spec 2026-11-04 §2: a notes panel beside each bucket, and the month's focus
// above the first one.
describe('CheckIn, bucket notes and the focus box', () => {
  const OPEN_BUCKETS = ['communication', 'growth', 'finances', 'relationship', 'delivery', 'advocacy']
  const panel = (bucket: string) => within(screen.getByTestId(`bucket-${bucket}`)).queryByRole('group', { name: /notes$/ })
  const whyIn = (bucket: string) =>
    within(screen.getByTestId(`bucket-${bucket}`)).getByLabelText('Why this score') as HTMLTextAreaElement
  const actionsIn = (bucket: string) =>
    within(screen.getByTestId(`bucket-${bucket}`)).getByLabelText('Action items') as HTMLTextAreaElement
  const focusBox = () => screen.getByLabelText("This month's focus") as HTMLTextAreaElement

  it('draws a panel in every open bucket, Advocacy included', () => {
    renderAs('account_manager')
    for (const bucket of OPEN_BUCKETS) {
      expect(panel(bucket)).not.toBeNull()
      expect(whyIn(bucket)).toBeTruthy()
      expect(actionsIn(bucket)).toBeTruthy()
    }
    expect(document.querySelectorAll('textarea[id^="bucket-notes-"]')).toHaveLength(12)
  })

  it('a shut Advocacy bucket draws no panel; the other five still do (Review Focus 5)', () => {
    hookState.current = mockCheckin({
      advocacyApplies: false,
      required: 17,
      // Stored advocacy notes are in the draft, and still no panel is drawn.
      draft: { answers: {}, notes: '', bucketNotes: { advocacy: { why: 'Kept' } }, focus: '' },
    })
    render(
      <CheckIn
        client={{ ...CLIENT, started_on: null }}
        period={PERIOD}
        profile={profile('account_manager')}
        onBack={() => {}}
        onEditClient={() => {}}
      />,
    )
    expect(panel('advocacy')).toBeNull()
    expect(within(screen.getByTestId('bucket-advocacy')).queryByRole('textbox')).toBeNull()
    expect(screen.queryByDisplayValue('Kept')).toBeNull()
    for (const bucket of OPEN_BUCKETS.filter((b) => b !== 'advocacy')) expect(panel(bucket)).not.toBeNull()
  })

  it('a viewer without edit_scores gets read-only panels and focus, still showing the text', () => {
    renderAs('viewer', {
      draft: { answers: {}, notes: '', bucketNotes: { growth: { why: 'Grew' } }, focus: 'Renewal' },
    })
    for (const bucket of OPEN_BUCKETS) {
      expect(whyIn(bucket).disabled).toBe(true)
      expect(actionsIn(bucket).disabled).toBe(true)
    }
    expect(focusBox().disabled).toBe(true)
    expect(whyIn('growth').value).toBe('Grew')
    expect(focusBox().value).toBe('Renewal')
  })

  it("each panel shows its own bucket's notes, and none of another's", () => {
    renderAs('account_manager', {
      draft: {
        answers: {},
        notes: '',
        bucketNotes: { communication: { why: 'Slow replies' }, delivery: { actions: 'New timeline' } },
        focus: '',
      },
    })
    expect(whyIn('communication').value).toBe('Slow replies')
    expect(actionsIn('communication').value).toBe('')
    expect(actionsIn('delivery').value).toBe('New timeline')
    expect(whyIn('delivery').value).toBe('')
    for (const bucket of ['growth', 'finances', 'relationship', 'advocacy']) {
      expect(whyIn(bucket).value).toBe('')
      expect(actionsIn(bucket).value).toBe('')
    }
  })

  it('someone who may score gets editable panels and focus', () => {
    renderAs('account_manager')
    for (const bucket of OPEN_BUCKETS) {
      expect(whyIn(bucket).disabled).toBe(false)
      expect(actionsIn(bucket).disabled).toBe(false)
    }
    expect(focusBox().disabled).toBe(false)
  })

  it('everything is read-only while saving', () => {
    renderAs('account_manager', { saveState: { kind: 'saving' } })
    for (const bucket of OPEN_BUCKETS) {
      expect(whyIn(bucket).disabled).toBe(true)
      expect(actionsIn(bucket).disabled).toBe(true)
    }
    expect(focusBox().disabled).toBe(true)
  })

  it('typing routes to setBucketNote and setFocus with the right bucket and field', () => {
    const setBucketNote = vi.fn()
    const setFocus = vi.fn()
    renderAs('account_manager', { setBucketNote, setFocus })
    fireEvent.change(whyIn('delivery'), { target: { value: 'Late twice' } })
    expect(setBucketNote).toHaveBeenLastCalledWith('delivery', 'why', 'Late twice')
    fireEvent.change(actionsIn('communication'), { target: { value: 'Weekly call' } })
    expect(setBucketNote).toHaveBeenLastCalledWith('communication', 'actions', 'Weekly call')
    fireEvent.change(focusBox(), { target: { value: 'Close the renewal' } })
    expect(setFocus).toHaveBeenLastCalledWith('Close the renewal')
  })

  it("shows last month's actions in their own bucket, and last month's focus", () => {
    renderAs('account_manager', {
      lastMonthBucketNotes: { growth: { why: 'Not shown', actions: 'Pitch the retainer' } },
      lastMonthFocus: 'Fix the timeline',
    })
    expect(
      within(screen.getByTestId('bucket-growth')).getByText("Last month's actions: Pitch the retainer"),
    ).toBeTruthy()
    expect(screen.getAllByText(/Last month's actions:/)).toHaveLength(1)
    // Last month's WHY is not shown -- only the actions, so the meeting can
    // ask whether they happened.
    expect(screen.queryByText(/Not shown/)).toBeNull()
    expect(screen.getByText('Last month: Fix the timeline')).toBeTruthy()
  })

  it('the focus box sits above the first bucket', () => {
    renderAs('account_manager')
    const first = screen.getByTestId('bucket-communication')
    const position = focusBox().compareDocumentPosition(first)
    expect(position & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    // Inside the bucket list, a sibling of the sections, so it shares the
    // list's wider measure and container (CheckIn.module.css).
    expect(focusBox().closest('[data-testid="focus-box"]')?.parentElement).toBe(first.parentElement)
  })
})

// Review Focus 4 and 5, with the real hook: what a keystroke does to the
// save state, and what the save sends.
describe('CheckIn, bucket notes through the real hook', () => {
  const ADVOCACY_CLIENT = { ...CLIENT, started_on: null }
  const status = () => document.getElementById('checkin-save-status')?.textContent ?? ''

  async function open(client: { id: number; name: string; status: string; started_on: string | null } = CLIENT) {
    hookState.real = true
    window.localStorage.clear()
    render(
      <CheckIn client={client} period={PERIOD} profile={profile('admin')} onBack={() => {}} onEditClient={() => {}} />,
    )
    await screen.findByRole('heading', { name: "This month's focus" })
  }

  afterEach(() => {
    hookState.real = false
    checkinRows.current = []
    upserts.rows.length = 0
    window.localStorage.clear()
  })

  it('a note typed into an empty check-in is unsaved content, and saving sends it and clears that', async () => {
    await open()
    const save = () => screen.getByRole('button', { name: 'Save draft' }) as HTMLButtonElement
    expect(status()).not.toMatch(/Unsaved/)

    fireEvent.change(within(screen.getByTestId('bucket-growth')).getByLabelText('Why this score'), {
      target: { value: 'Two new briefs' },
    })
    expect(status()).toMatch(/Unsaved changes/)
    // Notes alone, no answers: something to save, not "nothing to save".
    expect(save().disabled).toBe(false)

    await act(async () => {
      fireEvent.click(save())
    })
    await waitFor(() => expect(status()).not.toMatch(/Unsaved/))
    expect(upserts.rows).toHaveLength(1)
    expect(upserts.rows[0].bucket_notes).toEqual({ growth: { why: 'Two new briefs' } })
  })

  it('typing in the focus box marks the check-in unsaved', async () => {
    await open()
    fireEvent.change(screen.getByLabelText("This month's focus"), { target: { value: 'Renewal' } })
    expect(status()).toMatch(/Unsaved changes/)
  })

  it('stored Advocacy notes survive a save while the bucket is shut and draws no panel', async () => {
    checkinRows.current = [
      {
        client_id: CLIENT.id,
        period: PERIOD,
        notes: null,
        bucket_notes: { advocacy: { why: 'Referred a friend', actions: 'Ask for a quote' } },
        focus: null,
      },
    ]
    await open(ADVOCACY_CLIENT)
    expect(within(screen.getByTestId('bucket-advocacy')).queryByRole('textbox')).toBeNull()

    fireEvent.change(within(screen.getByTestId('bucket-growth')).getByLabelText('Action items'), {
      target: { value: 'Send the proposal' },
    })
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Save draft' }))
    })
    await waitFor(() => expect(upserts.rows).toHaveLength(1))
    expect(upserts.rows[0].bucket_notes).toEqual({
      advocacy: { why: 'Referred a friend', actions: 'Ask for a quote' },
      growth: { actions: 'Send the proposal' },
    })
  })
})

// Brief 2026-11-04 part B: the month-over-month change beside each bucket
// heading and under the overall. The hook's lastPeriod is 2026-07-01, so the
// comparison month reads "Jul". Fixtures carry only the columns read.
describe('CheckIn, month-over-month change', () => {
  const COMM_COMPLETE = { comm_constructive: 4, comm_timely: 4, comm_consistent: 3 } // 3.67
  const ADV_COMPLETE = { adv_left_review: 5, adv_case_study: 5, adv_would_refer: 5, adv_reference_check: 5 }
  const last = (row: Record<string, unknown>) => row as unknown as UseCheckin['lastMonth']
  const draftWith = (answers: Record<string, number>) => ({ answers, notes: '', bucketNotes: {}, focus: '' })
  const text = (element: Element | null) => element?.textContent?.replace(/\s+/g, ' ').trim()

  it('shows the bucket score and an up arrow against last month', () => {
    renderAs('account_manager', { draft: draftWith(COMM_COMPLETE), lastMonth: last({ comm_score: 3.34 }) })
    const score = screen.getByTestId('bucket-score-communication')
    expect(text(score)).toBe('3.67 ▲ +0.33 vs Jul')
    expect(within(score).getByTestId('score-change').dataset.direction).toBe('up')
  })

  it('sits beside the heading, inside the bucket it scores', () => {
    renderAs('account_manager', { draft: draftWith(COMM_COMPLETE), lastMonth: last({ comm_score: 3.33 }) })
    const bucket = screen.getByTestId('bucket-communication')
    const score = within(bucket).getByTestId('bucket-score-communication')
    const heading = within(bucket).getByTestId('bucket-heading')
    expect(score.parentElement).toBe(heading.parentElement)
    // The heading's own text is untouched.
    expect(heading.textContent).toBe('Communication')
  })

  it('shows a down arrow with a true minus', () => {
    renderAs('account_manager', { draft: draftWith(COMM_COMPLETE), lastMonth: last({ comm_score: 4.17 }) })
    const score = screen.getByTestId('bucket-score-communication')
    expect(text(score)).toBe('3.67 ▼ −0.50 vs Jul')
    expect(within(score).getByTestId('score-change').dataset.direction).toBe('down')
  })

  it('says no change in words when the scores match', () => {
    renderAs('account_manager', { draft: draftWith(COMM_COMPLETE), lastMonth: last({ comm_score: 3.67 }) })
    expect(text(screen.getByTestId('bucket-score-communication'))).toBe('3.67 no change vs Jul')
  })

  it('shows the score alone when last month has no score for the bucket', () => {
    renderAs('account_manager', { draft: draftWith(COMM_COMPLETE), lastMonth: last({ comm_score: null }) })
    const score = screen.getByTestId('bucket-score-communication')
    expect(text(score)).toBe('3.67')
    expect(within(score).queryByTestId('score-change')).toBeNull()
  })

  it('shows the score alone when there is no check-in last month at all', () => {
    renderAs('account_manager', { draft: draftWith(COMM_COMPLETE), lastMonth: null })
    expect(text(screen.getByTestId('bucket-score-communication'))).toBe('3.67')
  })

  it('shows nothing for a bucket this month has not finished', () => {
    renderAs('account_manager', {
      draft: draftWith({ comm_constructive: 4, comm_timely: 4 }),
      lastMonth: last({ comm_score: 3.33 }),
    })
    expect(screen.queryByTestId('bucket-score-communication')).toBeNull()
  })

  it('reads each bucket against its own column', () => {
    renderAs('account_manager', {
      draft: draftWith({ ...COMM_COMPLETE, del_on_time: 2, del_quantity: 2, del_client_likes: 2, del_we_are_proud: 2 }),
      lastMonth: last({ comm_score: 3.67, del_score: 3 }),
    })
    expect(text(screen.getByTestId('bucket-score-communication'))).toBe('3.67 no change vs Jul')
    expect(text(screen.getByTestId('bucket-score-delivery'))).toBe('2.00 ▼ −1.00 vs Jul')
  })

  it('shows an open Advocacy bucket like any other', () => {
    renderAs('account_manager', { draft: draftWith(ADV_COMPLETE), lastMonth: last({ adv_score: 3 }) })
    expect(text(screen.getByTestId('bucket-score-advocacy'))).toBe('5.00 ▲ +2.00 vs Jul')
  })

  it('shows no score and no change for Advocacy while its gate is shut', () => {
    hookState.current = mockCheckin({
      advocacyApplies: false,
      draft: draftWith(ADV_COMPLETE),
      lastMonth: last({ adv_score: 3 }),
    })
    render(
      <CheckIn
        client={{ ...CLIENT, started_on: null }}
        period={PERIOD}
        profile={profile('account_manager')}
        onBack={() => {}}
        onEditClient={() => {}}
      />,
    )
    expect(screen.queryByTestId('bucket-score-advocacy')).toBeNull()
    expect(within(screen.getByTestId('bucket-advocacy')).queryByTestId('score-change')).toBeNull()
  })

  it('gives the overall the same change line, this month against last', () => {
    renderAs('account_manager', { localOverall: 3.5, lastOverall: 3 })
    const change = screen.getByTestId('overall-change')
    expect(text(change)).toBe('▲ +0.50 vs Jul')
    expect(within(change).getByTestId('score-change').dataset.direction).toBe('up')
  })

  // Brief 2026-11-05 B2: the owner circled the change under the HEALTHY band
  // and drew it to the right of the big numbers. It is the next item after
  // last month's block, in the same row, and not inside this month's column.
  it('puts the overall change after both score blocks, outside this month', () => {
    renderAs('account_manager', { localOverall: 3.5, lastOverall: 3 })
    const change = screen.getByTestId('overall-change')
    const thisMonth = screen.getByTestId('total-this-month')
    const lastMonth = screen.getByTestId('total-last-month')
    expect(thisMonth.contains(change)).toBe(false)
    expect(lastMonth.contains(change)).toBe(false)
    expect(thisMonth.compareDocumentPosition(lastMonth) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(lastMonth.compareDocumentPosition(change) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    // Same row: a sibling of the two blocks, and the very next one.
    expect(change.parentElement).toBe(lastMonth.parentElement)
    expect(lastMonth.nextElementSibling).toBe(change)
    // Not under the band any more.
    expect(thisMonth.contains(screen.getByTestId('overall-band'))).toBe(true)
    expect(thisMonth.querySelector('[data-testid="score-change"]')).toBeNull()
  })

  it('draws no overall change when this month has no overall', () => {
    renderAs('account_manager', { localOverall: null, lastOverall: 3 })
    expect(screen.queryByTestId('overall-change')).toBeNull()
  })

  it('draws no overall change when last month has no overall', () => {
    renderAs('account_manager', { localOverall: 3.5, lastOverall: null })
    expect(screen.queryByTestId('overall-change')).toBeNull()
  })

  it('compares the overall the summary shows: the stored one while the form is clean', () => {
    renderAs('account_manager', { saveState: { kind: 'clean' }, storedOverall: 4, localOverall: 3.5, lastOverall: 3 })
    expect(text(screen.getByTestId('overall-value'))).toBe('4.00')
    expect(text(screen.getByTestId('overall-change'))).toBe('▲ +1.00 vs Jul')
  })

  it("compares the draft's overall while the form differs", () => {
    renderAs('account_manager', { saveState: { kind: 'dirty' }, storedOverall: 4, localOverall: 3.5, lastOverall: 3 })
    expect(text(screen.getByTestId('overall-value'))).toBe('3.50')
    expect(text(screen.getByTestId('overall-change'))).toBe('▲ +0.50 vs Jul')
  })

  it("draws no Advocacy change against a month whose own gate was shut", () => {
    // Started 2026-05-01: day 90 is 2026-07-30, so August is gated in and
    // July was not. July's stored adv_score is not a score to compare with.
    hookState.current = mockCheckin({ draft: draftWith(ADV_COMPLETE), lastMonth: last({ adv_score: 3, comm_score: 3.34 }) })
    render(
      <CheckIn
        client={{ ...CLIENT, started_on: '2026-05-01' }}
        period={PERIOD}
        profile={profile('account_manager')}
        onBack={() => {}}
        onEditClient={() => {}}
      />,
    )
    const score = screen.getByTestId('bucket-score-advocacy')
    expect(text(score)).toBe('5.00')
    expect(within(score).queryByTestId('score-change')).toBeNull()
  })

  it('names each chip in words for a screen reader, and hides the short suffix', () => {
    renderAs('account_manager', {
      draft: draftWith(COMM_COMPLETE),
      lastMonth: last({ comm_score: 3.34 }),
      localOverall: 3.5,
      lastOverall: 3,
    })
    const bucket = screen.getByTestId('bucket-score-communication')
    within(bucket).getByRole('img', { name: 'Communication up 0.33 from July' })
    const suffix = within(bucket).getByText('vs Jul')
    expect(suffix.getAttribute('aria-hidden')).toBe('true')

    const overall = screen.getByTestId('overall-change')
    within(overall).getByRole('img', { name: 'Overall up 0.50 from July' })
    expect(within(overall).getByText('vs Jul').getAttribute('aria-hidden')).toBe('true')
  })
})

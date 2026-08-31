// @vitest-environment jsdom

import { act, renderHook, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Profile } from '../auth/useProfile'
import { ALL_QUESTIONS, OVERALL_QUESTIONS } from '../lib/buckets'
import { requiredQuestions } from '../lib/scoreV2'

// A fake of the Supabase chained builder, in the same style as
// src/board/useBoard.dom.test.ts: two tables are read on load
// (`checkins` and `checkin_scores`), and `checkins` also takes the upsert
// that submit() sends. Kept as two independently swappable async functions
// per table, plus the upsert spy, so a test can make either read fail or
// inspect exactly what was written without caring about the others.
type Result<T> = { data: T; error: unknown }

const db = vi.hoisted(() => ({
  checkins: async (): Promise<Result<unknown[]>> => ({ data: [], error: null }),
  scores: async (): Promise<Result<unknown[]>> => ({ data: [], error: null }),
  upsertResult: async (row: Record<string, unknown>): Promise<Result<unknown>> => ({
    data: { ...row, id: 1, created_at: '2026-08-01T00:00:00.000Z', updated_at: '2026-08-15T00:00:00.000Z' },
    error: null,
  }),
  upsert: vi.fn(),
}))

vi.mock('../lib/supabase', () => ({
  supabase: {
    from: (table: string) => {
      if (table === 'checkins') {
        return {
          select: () => ({
            eq: () => ({
              in: () => db.checkins(),
            }),
          }),
          upsert: (row: Record<string, unknown>) => {
            db.upsert(row)
            return {
              select: () => ({
                single: () => db.upsertResult(row),
              }),
            }
          },
        }
      }
      if (table === 'checkin_scores') {
        return {
          select: () => ({
            eq: () => ({
              in: () => db.scores(),
            }),
          }),
        }
      }
      throw new Error(`unexpected table: ${table}`)
    },
  },
}))

import { useCheckin } from './useCheckin'

const PROFILE: Profile = {
  id: 'profile-1',
  email: 'amy@example.com',
  full_name: 'Amy Account',
  is_active: true,
  role: 'account_manager',
  created_at: '2026-01-01T00:00:00.000Z',
  updated_at: '2026-01-01T00:00:00.000Z',
}

beforeEach(() => {
  db.checkins = async () => ({ data: [], error: null })
  db.scores = async () => ({ data: [], error: null })
  db.upsert.mockClear()
  db.upsertResult = async (row) => ({
    data: { ...row, id: 1, created_at: '2026-08-01T00:00:00.000Z', updated_at: '2026-08-15T00:00:00.000Z' },
    error: null,
  })
  // Each test's own localStorage, not the jsdom default across tests: a draft
  // written by one test must never be read back by the next one, the same
  // isolation draftCache.test.ts gives itself.
  window.localStorage.clear()
})

// Renders the hook with a client shape and period, and hands back the upsert
// spy alongside the result -- the shape the brief's tests are written against.
// An arrow around renderHook, not a bare reference, for the same
// react/rules-of-hooks reason useBoard.dom.test.ts's `ready()` gives.
function renderCheckin(opts: {
  client: { id: number; name: string; started_on: string | null }
  period?: string
}) {
  const period = opts.period ?? '2026-08-01'
  const rendered = renderHook(() => useCheckin(opts.client, period, PROFILE))
  return { ...rendered, upsert: db.upsert }
}

describe('useCheckin: the gate, through the hook', () => {
  // The gate, through the hook. The screen's whole shape depends on this boolean
  // and it is the one value here that is computed rather than fetched.
  it('is gated out for a client with no start date, and requires 17', async () => {
    const { result } = renderCheckin({ client: { id: 1, name: 'Acme', started_on: null } })
    await waitFor(() => expect(result.current.status).toBe('ready'))
    expect(result.current.advocacyApplies).toBe(false)
    expect(result.current.required).toBe(17)
  })

  it('is gated in past 90 days, and requires 21', async () => {
    const { result } = renderCheckin({
      client: { id: 1, name: 'Acme', started_on: '2026-01-01' },
      period: '2026-04-01',
    })
    await waitFor(() => expect(result.current.status).toBe('ready'))
    expect(result.current.advocacyApplies).toBe(true)
    expect(result.current.required).toBe(21)
  })
})

describe('useCheckin: the local overall', () => {
  // §3.3: a missing answer must never read as a low score. 16 of 17 is null, not
  // a mean of the 16.
  it('has no local overall until every required question is answered', async () => {
    const { result } = renderCheckin({ client: { id: 1, name: 'Acme', started_on: null } })
    await waitFor(() => expect(result.current.status).toBe('ready'))

    const required = requiredQuestions(false)
    for (const key of required.slice(0, required.length - 1)) {
      act(() => result.current.setAnswer(key, 4))
    }
    expect(result.current.localOverall).toBeNull()

    act(() => result.current.setAnswer(required[required.length - 1], 4))
    expect(result.current.localOverall).toBe(4)
  })

  // The four gated-out Advocacy answers must not hold the overall hostage.
  it('ignores unanswered Advocacy questions when the gate is shut', async () => {
    const { result } = renderCheckin({ client: { id: 1, name: 'Acme', started_on: null } })
    await waitFor(() => expect(result.current.status).toBe('ready'))
    for (const key of requiredQuestions(false)) act(() => result.current.setAnswer(key, 3))
    expect(result.current.localOverall).toBe(3)
    expect(result.current.scored).toBe(17)
  })

  // Spec §3.2 amended, through the hook. `required` (completeness) and the
  // overall's divisor (always the 17) are different numbers now -- this proves
  // both at once, with the gate open: the overall reads only the 17 while
  // `required` still asks for 21 and `scored` still stops at 17 with every
  // Advocacy answer blank.
  it('has an overall from the 17 even with every Advocacy answer blank', async () => {
    const { result } = renderCheckin({
      client: { id: 1, name: 'Acme', started_on: '2026-01-01' },
      period: '2026-08-01',
    })
    await waitFor(() => expect(result.current.status).toBe('ready'))
    expect(result.current.advocacyApplies).toBe(true)
    for (const key of OVERALL_QUESTIONS) act(() => result.current.setAnswer(key, 4))
    expect(result.current.localOverall).toBe(4)
    // ...and still 21 required, so it is not yet complete.
    expect(result.current.required).toBe(21)
    expect(result.current.scored).toBe(17)
  })
})

describe('useCheckin: restoring stored answers', () => {
  // The bug this task originally existed to fix, one type later: draftFromRow
  // must filter stored values by `typeof value === 'number'` -- a truthiness
  // check would drop nothing here, because every valid answer (1-5) is
  // truthy, but the filter itself is what is under test. Seeds a stored row
  // with Advocacy answers including a No (1, the smallest valid value), and
  // proves they arrive in the draft.
  it('restores stored Advocacy answers from a row, including a No', async () => {
    db.checkins = async () => ({
      data: [
        {
          client_id: 1,
          period: '2026-08-01',
          notes: null,
          adv_left_review: 1,
          adv_case_study: 5,
          adv_would_refer: null,
          adv_reference_check: null,
        },
      ],
      error: null,
    })
    const { result } = renderCheckin({
      client: { id: 1, name: 'Acme', started_on: null },
      period: '2026-08-01',
    })
    await waitFor(() => expect(result.current.status).toBe('ready'))
    expect(result.current.draft.answers.adv_left_review).toBe(1)
    expect(result.current.draft.answers.adv_case_study).toBe(5)
    // Unanswered means absent, not a stored null carried through as a key.
    expect(result.current.draft.answers).not.toHaveProperty('adv_would_refer')
    expect(result.current.draft.answers).not.toHaveProperty('adv_reference_check')
  })

  // The mirror image of the bug above, now that the columns are number.
  // Production has not run this migration yet, so a boolean can still turn up
  // in an adv_* column today. That boolean must be dropped, not admitted as a
  // number-ish value -- admitting it would let it reach the choice control's
  // `checked={value === option.value}`, which is false for every option, so
  // the question would render blank while answeredCount kept counting it as
  // answered.
  it('drops a boolean stored in an answer column, rather than admitting it', async () => {
    db.checkins = async () => ({
      data: [
        {
          client_id: 1,
          period: '2026-08-01',
          notes: null,
          // The pre-migration shape, still live on production today: a
          // boolean sitting in a column that is now smallint.
          adv_left_review: true,
        },
      ],
      error: null,
    })
    const { result } = renderCheckin({
      client: { id: 1, name: 'Acme', started_on: null },
      period: '2026-08-01',
    })
    await waitFor(() => expect(result.current.status).toBe('ready'))
    expect(result.current.draft.answers).not.toHaveProperty('adv_left_review')
  })

  // Fix round 1, Minor 2: pins the scoping the file comment relies on. The
  // reviewer mutated `for (const key of ALL_QUESTIONS)` to
  // `for (const key of Object.keys(row))` and the rest of the suite still
  // passed -- letting `id`, `client_id` and other non-rubric columns leak
  // into draft.answers. Seeds a row carrying a retired legacy column and a
  // non-empty `notes` string alongside two real answers, and asserts the
  // draft's answer keys are exactly the two seeded answers -- nothing else,
  // which the `Object.keys(row)` version would fail.
  it('keeps only the rubric\'s own keys, never a legacy column or notes', async () => {
    db.checkins = async () => ({
      data: [
        {
          client_id: 1,
          period: '2026-08-01',
          notes: 'Renewal conversation went well.',
          // A retired pillar column this row still carries (public.checkins
          // has not dropped it yet). Not a real question, and must never
          // surface as one.
          relationship: 3,
          comm_timely: 4,
          adv_left_review: 5,
        },
      ],
      error: null,
    })
    const { result } = renderCheckin({
      client: { id: 1, name: 'Acme', started_on: null },
      period: '2026-08-01',
    })
    await waitFor(() => expect(result.current.status).toBe('ready'))
    expect(Object.keys(result.current.draft.answers).sort()).toEqual(
      ['adv_left_review', 'comm_timely'].sort(),
    )
  })
})

describe('useCheckin: submit', () => {
  // Every answer column is sent, including the unanswered ones as null. Sending
  // only the answered ones would leave a cleared answer at its old value in the
  // database, and the bucket columns are generated from those columns -- so the
  // bar on the board would be the one nobody chose.
  it('sends all 21 answer columns on save, unanswered ones as null', async () => {
    const { result, upsert } = renderCheckin({ client: { id: 1, name: 'Acme', started_on: null } })
    await waitFor(() => expect(result.current.status).toBe('ready'))
    act(() => result.current.setAnswer('comm_timely', 5))
    act(() => result.current.submit())
    await waitFor(() => expect(upsert).toHaveBeenCalled())

    const payload = upsert.mock.calls[0][0]
    for (const key of ALL_QUESTIONS) expect(payload).toHaveProperty(key)
    expect(payload.comm_timely).toBe(5)
    expect(payload.adv_left_review).toBeNull()
  })

  // The smallest valid value is the one most at risk of being coerced away.
  // `1 ?? null` and `1 || null` happen to agree, but a stray `if (value)`
  // guard anywhere upstream of the payload would not: it would treat this No
  // as unset and silently turn an answered Advocacy question into an
  // unanswered one.
  it('sends a No to the database as 1, not as null', async () => {
    const { result, upsert } = renderCheckin({
      client: { id: 1, name: 'Acme', started_on: '2026-01-01' },
      period: '2026-08-01',
    })
    await waitFor(() => expect(result.current.status).toBe('ready'))
    act(() => result.current.setAnswer('adv_left_review', 1))
    act(() => result.current.submit())
    await waitFor(() => expect(upsert).toHaveBeenCalled())
    expect(upsert.mock.calls[0][0].adv_left_review).toBe(1)
  })

  // The submitted marker tracks the REQUIRED count, so a gated-out check-in can
  // be submitted at 17. Marking it only at 21 would make a complete check-in
  // permanently unsubmittable for every client inside their first 90 days.
  it('marks a gated-out check-in submitted at 17 answers', async () => {
    const { result, upsert } = renderCheckin({ client: { id: 1, name: 'Acme', started_on: null } })
    await waitFor(() => expect(result.current.status).toBe('ready'))
    for (const key of requiredQuestions(false)) act(() => result.current.setAnswer(key, 3))
    act(() => result.current.submit())
    await waitFor(() => expect(upsert).toHaveBeenCalled())
    expect(upsert.mock.calls[0][0].submitted_at).not.toBeNull()
  })

  // The confirmation survives the score refresh. An earlier draft of this hook
  // called load() here, which dispatches 'loaded' and resets the reducer to
  // `clean` -- erasing the sentence that says the save happened, which is the
  // exact defect this whole screen was rewritten to fix.
  it('still says the check-in was saved after refreshing the overall', async () => {
    const { result } = renderCheckin({ client: { id: 1, name: 'Acme', started_on: null } })
    await waitFor(() => expect(result.current.status).toBe('ready'))
    act(() => result.current.setAnswer('comm_timely', 4))
    act(() => result.current.submit())
    await waitFor(() => expect(result.current.saveState.kind).toBe('saved'))
    expect(result.current.saveState.kind).toBe('saved')
  })

  // The ordering the brief calls out as the single most important thing in
  // this task: the score refresh is awaited BEFORE 'succeeded' is dispatched,
  // so storedOverall is never stale at the exact moment the confirmation
  // appears. A version that fired the refresh and dispatched immediately
  // would pass the previous test (saveState still reaches 'saved') while
  // failing this one -- so this test is not redundant with it, it pins the
  // ordering the previous test cannot see.
  it('has the refreshed stored overall by the time the save is confirmed', async () => {
    let scoresRead = 0
    db.scores = async () => {
      scoresRead += 1
      // The second read is the post-save refresh triggered from submit();
      // that is the one the confirmation must already reflect.
      if (scoresRead >= 2) {
        return {
          data: [{ client_id: 1, period: '2026-08-01', overall_score: 4, advocacy_applies: false }],
          error: null,
        }
      }
      return { data: [], error: null }
    }

    const { result } = renderCheckin({ client: { id: 1, name: 'Acme', started_on: null } })
    await waitFor(() => expect(result.current.status).toBe('ready'))
    act(() => result.current.setAnswer('comm_timely', 4))
    act(() => result.current.submit())
    await waitFor(() => expect(result.current.saveState.kind).toBe('saved'))
    expect(result.current.storedOverall).toBe(4)
  })

  // The `if (!refreshed.error)` branch in submit(): a failed post-save refresh
  // is not a failed save. The upsert above it already succeeded, so the person
  // must still be told so -- reporting a save failure here would be the more
  // harmful of the two lies this comment weighs. Rigs the SECOND
  // `checkin_scores` read (the post-save refresh; the first is the initial
  // load) to fail, the same counting trick the ordering test above uses for
  // the opposite case.
  it('still reports the save as succeeded when the post-save score refresh fails', async () => {
    let scoresRead = 0
    db.scores = async () => {
      scoresRead += 1
      if (scoresRead >= 2) {
        return { data: [], error: 'refresh failed' }
      }
      return { data: [], error: null }
    }

    const { result } = renderCheckin({ client: { id: 1, name: 'Acme', started_on: null } })
    await waitFor(() => expect(result.current.status).toBe('ready'))
    act(() => result.current.setAnswer('comm_timely', 4))
    act(() => result.current.submit())
    await waitFor(() => expect(result.current.saveState.kind).toBe('saved'))
    expect(result.current.saveState.kind).toBe('saved')
  })
})

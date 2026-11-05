import { useCallback, useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { describeError } from '../lib/errorText'
import { BUCKET_SCORE_KEY, CHECKIN_COLUMNS } from './cardSummary'
import type { BucketScoreKey, CardCheckin } from './cardSummary'
import { boardMembers } from './boardScope'
import { previousPeriod } from '../lib/month'
import { BUCKETS } from '../lib/buckets'

// `status` joins the row in Slice 2 step 5, because the board now reads every
// client and decides in the browser which ones to draw. It is `string`, not a
// union, for the same reason AdminClient's is: that is what the column holds --
// text with a check constraint -- and narrowing it here would be a claim this
// file cannot verify.
export type BoardClient = {
  id: number
  name: string
  status: string
  // Selected here rather than queried by the check-in screen, which is the only
  // thing that reads it today: this query already runs, and the check-in screen
  // opening would otherwise cost a round trip to fetch one date. Step 3's card
  // needs it too, for the gated-out client's five-bars-and-a-note.
  started_on: string | null
  // Read for the month rule, spec §2.
  ended_on: string | null
}

// The view's answer to two questions the checkins row cannot answer: what the
// headline number is, and whether Advocacy is being asked. Both belong to the
// view because the overall cannot be a generated column (spec §6) and the gate
// reads clients.started_on, which a generation expression may not touch.
export type BoardScore = {
  client_id: number
  overall_score: number | null
  advocacy_applies: boolean
}

export const SCORE_COLUMNS = 'client_id, overall_score, advocacy_applies'

// Brief 2026-11-04 B: last month's six bucket scores and its overall, for the
// card's month-over-month arrows. Only what the arrows read. A null is a
// bucket or a month with no score, and draws no arrow.
export type LastMonthScores = Record<BucketScoreKey, number | null> & { overall_score: number | null }

// Built from BUCKET_SCORE_KEY so the six columns cannot drift from the ones
// the card draws this month. useBoard.dom.test.ts pins the list.
export const LAST_CHECKIN_COLUMNS = ['client_id', ...BUCKETS.map((bucket) => BUCKET_SCORE_KEY[bucket])].join(', ')
export const LAST_SCORE_COLUMNS = 'client_id, overall_score'

const NO_LAST_SCORES: LastMonthScores = {
  comm_score: null,
  growth_score: null,
  fin_score: null,
  rel_score: null,
  del_score: null,
  adv_score: null,
  overall_score: null,
}

export type UseBoard = {
  status: 'loading' | 'ready' | 'error'
  loadError: string | null
  clients: BoardClient[]
  checkins: Map<number, CardCheckin>
  scores: Map<number, BoardScore>
  // Last month's bucket scores and overall, keyed by client. No entry for a
  // client with nothing scored last month.
  lastMonth: Map<number, LastMonthScores>
  // Members of the month who have submitted: the N of the progress line.
  submitted: number
  // Members of the month whose check-in is an unreviewed AI suggestion; counted
  // over the same set as submitted, so the two numbers on one line agree.
  toReview: number
  // The denominator of the progress line, and deliberately NOT clients.length:
  // it is the count of the month's members. See the count below.
  activeTotal: number
  // The clients on the board for this period (spec §2). Every board consumer
  // reads this rather than a status.
  members: Set<number>
  reload: () => void
}

export function useBoard(period: string): UseBoard {
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading')
  const [loadError, setLoadError] = useState<string | null>(null)
  const [clients, setClients] = useState<BoardClient[]>([])
  const [checkins, setCheckins] = useState<Map<number, CardCheckin>>(new Map())
  const [scores, setScores] = useState<Map<number, BoardScore>>(new Map())
  const [lastMonth, setLastMonth] = useState<Map<number, LastMonthScores>>(new Map())

  // `isCancelled` is a parameter, and the flag it closes over belongs to the
  // effect below -- the same shape as useCheckin and useProfile. It cannot be a
  // `let` inside this function: an async function returns a promise, so a
  // cleanup returned from here would never be called and the flag could never
  // become true. That mistake produces a guard that reads as protection and
  // provides none, which is exactly what `scripts/db-which.mjs` did before
  // d8552ea.
  const load = useCallback(
    async (isCancelled: () => boolean = () => false) => {
      setStatus('loading')

      // postgrest-js resolves most failures into `error` rather than rejecting,
      // so the catch is defensive. It is here because the failure it guards is
      // invisible: an unobserved rejection leaves status on 'loading' for good,
      // and the person sees a spinner with no message and no retry.
      try {
        const clientResult = await supabase
          .from('clients')
          // No status filter, as of Slice 2 step 5. The board used to read only
          // active clients; it now reads every row and the show-archived toggle
          // decides what is drawn. `status` is selected because that decision
          // needs it.
          .select('id, name, status, started_on, ended_on')
          .order('name')

        if (isCancelled()) return

        if (clientResult.error) {
          // describeError, not .error.message: an empty message is falsy, and
          // the `loadError &&` guard on the screen would miss it and render an
          // empty board over a failed read. See src/lib/errorText.ts.
          setLoadError(describeError(clientResult.error))
          setStatus('error')
          return
        }

        const checkinResult = await supabase
          .from('checkins')
          .select(CHECKIN_COLUMNS)
          .eq('period', period)

        if (isCancelled()) return

        if (checkinResult.error) {
          setLoadError(describeError(checkinResult.error))
          setStatus('error')
          return
        }

        // CHECKIN_COLUMNS is built with .join(', ') in cardSummary.ts on
        // purpose (see the comment there), so its type is `string` rather than
        // a literal -- and postgrest-js can only parse a literal into a row
        // shape. Left alone, `checkinResult.data` types as a parser error, not
        // as CardCheckin. `.returns()` would fix that the same way but calls a
        // method the hand-rolled fake in useBoard.dom.test.ts does not carry;
        // this is the same correction with no such runtime dependency.
        const checkinRows = checkinResult.data as unknown as CardCheckin[]

        const byClient = new Map<number, CardCheckin>()
        for (const row of checkinRows) {
          byClient.set(row.client_id, row)
        }

        const scoreResult = await supabase
          .from('checkin_scores')
          .select(SCORE_COLUMNS)
          .eq('period', period)

        if (isCancelled()) return

        if (scoreResult.error) {
          setLoadError(describeError(scoreResult.error))
          setStatus('error')
          return
        }

        const scoreByClient = new Map<number, BoardScore>()
        for (const row of scoreResult.data) {
          // The view's client_id is nullable in the generated types -- a view
          // carries no NOT NULL constraint of its own -- but every real row
          // joins from checkins.client_id, which is. A null here is a row with
          // nothing to key the map by, so it is skipped rather than crashing
          // the whole board's read over one unattributable score.
          if (row.client_id === null) continue
          // advocacy_applies is nullable for the same reason: no NOT NULL
          // survives a view. A null gate defaults shut, the same side ClientCard
          // already falls back to when score itself is null -- asking nobody is
          // the safe failure, not asking everybody.
          scoreByClient.set(row.client_id, {
            ...row,
            client_id: row.client_id,
            advocacy_applies: row.advocacy_applies ?? false,
          })
        }

        // Brief 2026-11-04 B: last month, for the arrows. One extra query per
        // table, the same shape and the same failure handling as this
        // month's: a failed read is a failed board, never a board whose
        // arrows silently vanish.
        const lastPeriod = previousPeriod(period)
        const lastCheckinResult = await supabase
          .from('checkins')
          .select(LAST_CHECKIN_COLUMNS)
          .eq('period', lastPeriod)

        if (isCancelled()) return

        if (lastCheckinResult.error) {
          setLoadError(describeError(lastCheckinResult.error))
          setStatus('error')
          return
        }

        const lastScoreResult = await supabase
          .from('checkin_scores')
          .select(LAST_SCORE_COLUMNS)
          .eq('period', lastPeriod)

        if (isCancelled()) return

        if (lastScoreResult.error) {
          setLoadError(describeError(lastScoreResult.error))
          setStatus('error')
          return
        }

        // A string column list, so the row type is asserted here, as
        // checkinRows is above.
        const lastCheckinRows = lastCheckinResult.data as unknown as (Partial<LastMonthScores> & {
          client_id: number
        })[]
        const lastByClient = new Map<number, LastMonthScores>()
        for (const row of lastCheckinRows) {
          const { client_id: clientId, ...columns } = row
          lastByClient.set(clientId, { ...NO_LAST_SCORES, ...columns, overall_score: null })
        }
        for (const row of lastScoreResult.data) {
          // Nullable in the view's types, as above; nothing to key by.
          if (row.client_id === null) continue
          lastByClient.set(row.client_id, {
            ...(lastByClient.get(row.client_id) ?? NO_LAST_SCORES),
            overall_score: row.overall_score,
          })
        }

        // Never write after a failed read: everything below runs only because
        // all five queries succeeded.
        setLoadError(null)
        setClients(clientResult.data)
        setCheckins(byClient)
        setScores(scoreByClient)
        setLastMonth(lastByClient)
        setStatus('ready')
      } catch (thrown) {
        if (isCancelled()) return
        setLoadError(describeError(thrown))
        setStatus('error')
      }
    },
    [period],
  )

  useEffect(() => {
    // A fresh flag per run: if `load`'s identity changes because `period`
    // changed while this effect is still mounted, the cleanup marks the old
    // run's flag cancelled before the new run's body executes, and the same
    // flag is marked cancelled on unmount. Without it a slow response for the
    // previous period, resolving after a newer request had started, would
    // silently replace the board with another month's totals and nothing on
    // screen would say so.
    let cancelled = false
    void load(() => cancelled)
    return () => {
      cancelled = true
    }
  }, [load])

  // Spec §2: the month's members, computed once. Both numbers count them and
  // nothing else -- M is the check-ins owed this month, N the ones submitted.
  const members = boardMembers(clients, period, checkins)
  let submitted = 0
  let toReview = 0
  for (const client of clients) {
    if (!members.has(client.id)) continue
    const checkin = checkins.get(client.id)
    if (checkin?.submitted_at != null) submitted += 1
    if (checkin?.suggested_at != null) toReview += 1
  }
  const activeTotal = members.size

  // A manual reload has nothing to be cancelled by, so it uses the default.
  return { status, loadError, clients, checkins, scores, lastMonth, submitted, toReview, activeTotal, members, reload: () => void load() }
}

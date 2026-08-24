import { useCallback, useEffect, useRef, useState } from 'react'
import { supabase } from '../lib/supabase'
import { describeError } from '../lib/errorText'
import {
  CLIENT_COLUMNS,
  CONCURRENT_SAVE_TEXT,
  UPDATE_MATCHED_NOTHING_TEXT,
  insertPayload,
  ownerLabel,
  sortClients,
  updatePayload,
  writeFailureText,
} from './clientForm'
import type { AdminClient, ClientDraft, WriteState } from './clientForm'

// The one place this screen talks to the database, so the screen itself can be
// rendered in a test with this module mocked. Same seam, and the same reason, as
// src/board/useBoard.ts -- four tests in Board.test.tsx were permanently skipped
// until the board's read moved behind a hook.

export type OwnerOption = { id: string; label: string }

export type UseClients = {
  status: 'loading' | 'ready' | 'error'
  loadError: string | null
  clients: AdminClient[]
  owners: OwnerOption[]
  // Two independent write states, because the two forms are on screen at the
  // same time and a confirmation for one must never appear beside the other.
  addState: WriteState
  editState: WriteState
  // Which client editState is ABOUT. The edit form is per-row and this state is
  // one per screen, so without the id a confirmation for one client could render
  // beside another one's fields -- and did. addState needs no equivalent: there
  // is only ever one add form.
  editStateFor: number | null
  reload: () => void
  addClient: (draft: ClientDraft) => void
  saveClient: (id: number, draft: ClientDraft) => void
  resetAdd: () => void
  resetEdit: () => void
}

export function useClients(): UseClients {
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading')
  const [loadError, setLoadError] = useState<string | null>(null)
  const [clients, setClients] = useState<AdminClient[]>([])
  const [owners, setOwners] = useState<OwnerOption[]>([])
  const [addState, setAddState] = useState<WriteState>({ kind: 'idle' })
  const [editState, setEditState] = useState<WriteState>({ kind: 'idle' })
  const [editStateFor, setEditStateFor] = useState<number | null>(null)

  // Read at the top of each write to refuse a second concurrent one. A state
  // update is not visible until the next render, so two presses in the same tick
  // would both see 'idle' and both send a request. The buttons are disabled
  // during a save, which stops the ordinary case; these stop its edges. Same
  // shape as useCheckin's inFlight ref.
  const addInFlight = useRef(false)
  const editInFlight = useRef(false)

  // `isCancelled` is a parameter, and the flag it closes over belongs to the
  // effect below -- the same shape as useBoard, useCheckin and useProfile. It
  // cannot be a `let` inside this function: an async function returns a promise,
  // so a cleanup returned from here would never be called and the flag could
  // never become true. That mistake produces a guard that reads as protection
  // and provides none.
  const load = useCallback(async (isCancelled: () => boolean = () => false) => {
    setStatus('loading')

    // postgrest-js resolves most failures into `error` rather than rejecting, so
    // the catch is defensive. It is here because the failure it guards is
    // invisible: an unobserved rejection leaves status on 'loading' for good,
    // and the person sees a spinner with no message and no retry.
    try {
      // No status filter, deliberately, and this is the one query in the app
      // that reads every row. The board reads only active clients; this screen
      // is where a former one has to stay visible. clients_select_view_scores
      // has no status predicate, so the policy permits it.
      const clientResult = await supabase
        .from('clients')
        .select(CLIENT_COLUMNS)
        .order('name')

      if (isCancelled()) return

      if (clientResult.error) {
        // describeError, not .error.message: an empty message is falsy, and a
        // truthiness guard on the screen would miss it and render an empty list
        // over a failed read. See src/lib/errorText.ts.
        setLoadError(describeError(clientResult.error))
        setStatus('error')
        return
      }

      // The owner picker. Readable at all only because Slice 2 step 3 added
      // profiles_select_active_users -- under profiles_select_own this returns
      // exactly one row, the reader's own, and the picker cannot work. Spec §8.
      //
      // Active profiles only, per spec §7. A client already assigned to an
      // account that was since deactivated therefore has an owner_id this list
      // cannot name, and the screen says that rather than printing a UUID or
      // claiming the client is unassigned.
      const ownerResult = await supabase
        .from('profiles')
        .select('id, full_name, email')
        .eq('is_active', true)

      if (isCancelled()) return

      if (ownerResult.error) {
        setLoadError(describeError(ownerResult.error))
        setStatus('error')
        return
      }

      // Never write after a failed read: everything below runs only because both
      // queries succeeded.
      setLoadError(null)
      setClients(sortClients(clientResult.data))
      setOwners(
        ownerResult.data
          .map((profile) => ({ id: profile.id, label: ownerLabel(profile) }))
          .sort((a, b) => a.label.localeCompare(b.label)),
      )
      setStatus('ready')
    } catch (thrown) {
      if (isCancelled()) return
      setLoadError(describeError(thrown))
      setStatus('error')
    }
  }, [])

  useEffect(() => {
    // A fresh flag per run. `load` has an empty dependency array so its identity
    // never changes today; the flag is what marks the run cancelled on unmount,
    // and what would guard a re-run if this hook ever gained an argument.
    let cancelled = false
    void load(() => cancelled)
    return () => {
      cancelled = true
    }
  }, [load])

  const addClient = useCallback((draft: ClientDraft) => {
    if (addInFlight.current) return
    addInFlight.current = true
    setAddState({ kind: 'saving' })

    void (async () => {
      try {
        const { data, error } = await supabase
          .from('clients')
          .insert(insertPayload(draft))
          // .select().single() rather than a second read: the row that comes
          // back carries the database's own updated_at, which is the time the
          // confirmation names and the time the new list row shows. One round
          // trip, and no window in which the screen shows a time the database
          // does not hold.
          .select(CLIENT_COLUMNS)
          .single()

        if (error) {
          // writeFailureText, not describeError alone: the unique index on
          // lower(name) answers a duplicate in Postgres's own words, and
          // "duplicate key value violates unique constraint" is not a sentence
          // to put in front of an account manager. describeError still runs
          // first, because an empty message is falsy and would render as nothing.
          setAddState({ kind: 'failed', message: writeFailureText(describeError(error), draft.name.trim()) })
          return
        }

        setClients((current) => sortClients([...current, data]))
        setAddState({ kind: 'saved', at: data.updated_at, what: 'Client added' })
      } catch (thrown) {
        setAddState({ kind: 'failed', message: writeFailureText(describeError(thrown), draft.name.trim()) })
      } finally {
        // finally, not a line after the await: if this ever rejects past the
        // catch, a latched ref would refuse every future press for the life of
        // the screen and nothing would say why.
        addInFlight.current = false
      }
    })()
  }, [])

  const saveClient = useCallback((id: number, draft: ClientDraft) => {
    // Every report of this write names the client it is about, in one place, so
    // no branch below can set a state without attributing it. A confirmation is
    // a claim about a specific client, and a claim rendered beside a different
    // one is false: setting the state without the id is how "Changes saved"
    // ended up under a row whose fields nobody had touched.
    const report = (next: WriteState) => {
      setEditStateFor(id)
      setEditState(next)
    }

    if (editInFlight.current) {
      // Speaks rather than vanishing. This used to be a bare `return`: no
      // request, no message, and -- because the other row's Edit press had
      // already reset the state to idle -- the button was enabled and the press
      // looked accepted. The first write's confirmation then landed here, which
      // is the screen confirming a write that never happened.
      report({ kind: 'failed', message: CONCURRENT_SAVE_TEXT })
      return
    }
    editInFlight.current = true
    report({ kind: 'saving' })

    void (async () => {
      try {
        const { data, error } = await supabase
          .from('clients')
          // All six columns, every time -- see updatePayload's comment. The
          // lifecycle constraint is bidirectional, so moving a client off
          // `former` without nulling the three lifecycle columns in the SAME
          // statement is refused by Postgres.
          .update(updatePayload(draft))
          .eq('id', id)
          .select(CLIENT_COLUMNS)
          // .maybeSingle(), not .single(), and this is not a style choice.
          // clients_update_manage_clients is `using (...) with check (...)`: a
          // caller without manage_clients has the row filtered out by USING, so
          // zero rows are updated and NOTHING is raised. .single() turns that
          // into PostgREST's PGRST116 -- "JSON object requested, multiple (or
          // no) rows returned" -- which no branch of writeFailureText matches,
          // so it reached the person verbatim with an invitation to try again.
          .maybeSingle()

        if (error) {
          report({ kind: 'failed', message: writeFailureText(describeError(error), draft.name.trim()) })
          return
        }

        // No error and no row: the update matched nothing. Its own outcome, and
        // deliberately not treated as a success -- the list must keep saying
        // what the database holds, not what the form was hoping for.
        if (data === null) {
          report({ kind: 'failed', message: UPDATE_MATCHED_NOTHING_TEXT })
          return
        }

        setClients((current) =>
          sortClients(current.map((client) => (client.id === id ? data : client))),
        )
        report({ kind: 'saved', at: data.updated_at, what: 'Changes saved' })
      } catch (thrown) {
        report({ kind: 'failed', message: writeFailureText(describeError(thrown), draft.name.trim()) })
      } finally {
        editInFlight.current = false
      }
    })()
  }, [])

  const resetAdd = useCallback(() => setAddState({ kind: 'idle' }), [])
  const resetEdit = useCallback(() => setEditState({ kind: 'idle' }), [])

  // A manual reload has nothing to be cancelled by, so it uses the default.
  return {
    status,
    loadError,
    clients,
    owners,
    addState,
    editState,
    editStateFor,
    reload: () => void load(),
    addClient,
    saveClient,
    resetAdd,
    resetEdit,
  }
}

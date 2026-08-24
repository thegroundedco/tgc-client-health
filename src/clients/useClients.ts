import { useCallback, useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { describeError } from '../lib/errorText'
import { CLIENT_COLUMNS, ownerLabel, sortClients } from './clientForm'
import type { AdminClient } from './clientForm'

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
  reload: () => void
}

export function useClients(): UseClients {
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading')
  const [loadError, setLoadError] = useState<string | null>(null)
  const [clients, setClients] = useState<AdminClient[]>([])
  const [owners, setOwners] = useState<OwnerOption[]>([])

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

  // A manual reload has nothing to be cancelled by, so it uses the default.
  return { status, loadError, clients, owners, reload: () => void load() }
}

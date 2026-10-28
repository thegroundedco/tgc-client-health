import { useCallback, useRef, useState } from 'react'
import { supabase } from '../lib/supabase'
import { describeError } from '../lib/errorText'
import {
  CLIENT_COLUMNS,
  UPDATE_MATCHED_NOTHING_TEXT,
  draftFromRow,
  formProblems,
  updatePayload,
  writeFailureText,
} from './clientForm'
import type { AdminClient, WriteState } from './clientForm'
import { draftWithChange } from './statusChange'
import type { StatusChange } from './statusChange'

const READ_FAILED_TEXT = 'This client could not be read, so nothing was changed. Try again in a moment.'

// Pause or cancel one client from the check-in screen (spec §3). Reads the row
// first because updatePayload sends EVERY column: writing from the check-in's
// partial client object would blank the owner, note and type. The read and the
// write both filter on id; the write ends in .maybeSingle() for the reason
// useClients documents -- a refused caller matches zero rows and raises nothing.
export function useStatusChange(clientId: number) {
  const [state, setState] = useState<WriteState>({ kind: 'idle' })
  const inFlight = useRef(false)

  const apply = useCallback(
    async (change: StatusChange): Promise<boolean> => {
      if (inFlight.current) return false
      inFlight.current = true
      setState({ kind: 'saving' })
      try {
        const read = await supabase.from('clients').select(CLIENT_COLUMNS).eq('id', clientId).maybeSingle()
        if (read.error || read.data === null) {
          setState({ kind: 'failed', message: READ_FAILED_TEXT })
          return false
        }
        const draft = draftWithChange(draftFromRow(read.data as AdminClient), change)
        const problems = formProblems(draft)
        if (problems.length > 0) {
          setState({ kind: 'failed', message: problems.map((problem) => problem.text).join(' ') })
          return false
        }
        const { data, error } = await supabase
          .from('clients')
          .update(updatePayload(draft))
          .eq('id', clientId)
          .select(CLIENT_COLUMNS)
          .maybeSingle()
        if (error) {
          setState({ kind: 'failed', message: writeFailureText(describeError(error), draft.name.trim()) })
          return false
        }
        if (data === null) {
          setState({ kind: 'failed', message: UPDATE_MATCHED_NOTHING_TEXT })
          return false
        }
        setState({ kind: 'saved', at: data.updated_at, what: change.kind === 'pause' ? 'Paused' : 'Cancelled' })
        return true
      } catch (thrown) {
        setState({ kind: 'failed', message: writeFailureText(describeError(thrown), '') })
        return false
      } finally {
        inFlight.current = false
      }
    },
    [clientId],
  )

  return { state, apply }
}

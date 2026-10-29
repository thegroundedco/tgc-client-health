import { useCallback, useRef, useState } from 'react'
import { supabase } from '../lib/supabase'
import { describeError } from '../lib/errorText'
import { UPDATE_MATCHED_NOTHING_TEXT } from '../clients/clientForm'

export type ConfirmState =
  | { kind: 'idle' }
  | { kind: 'saving' }
  | { kind: 'confirmed'; at: string }
  | { kind: 'failed'; message: string }

// Confirm an AI suggestion as it stands (spec 2026-10-29). Clears suggested_at
// and nothing else -- the answers are the suggestion the person just read and
// accepted. Filters on client AND month: a dropped period filter would confirm
// every month of this client's suggestions at once. .maybeSingle(), and a null
// result is a failure, for the reason useClients documents: RLS filters a
// refused update to zero rows without raising.
export function useConfirmSuggestion(clientId: number, period: string) {
  const [state, setState] = useState<ConfirmState>({ kind: 'idle' })
  const inFlight = useRef(false)

  const confirm = useCallback(async (): Promise<boolean> => {
    if (inFlight.current) return false
    inFlight.current = true
    setState({ kind: 'saving' })
    try {
      const { data, error } = await supabase
        .from('checkins')
        .update({ suggested_at: null })
        .eq('client_id', clientId)
        .eq('period', period)
        .select('updated_at')
        .maybeSingle()
      if (error) {
        setState({ kind: 'failed', message: `${describeError(error)} Nothing was changed.` })
        return false
      }
      if (data === null) {
        setState({ kind: 'failed', message: UPDATE_MATCHED_NOTHING_TEXT })
        return false
      }
      setState({ kind: 'confirmed', at: data.updated_at })
      return true
    } catch (thrown) {
      setState({ kind: 'failed', message: `${describeError(thrown)} Nothing was changed.` })
      return false
    } finally {
      inFlight.current = false
    }
  }, [clientId, period])

  return { state, confirm }
}

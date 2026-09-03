import { useCallback, useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { describeError } from '../lib/errorText'
import type { LifecycleClient } from './tenure'

// One read of every client's lifecycle columns. A seam, in the same shape as
// useBoard: the screen's fetch has to be mockable, which is the whole reason
// that hook exists rather than an inline useEffect.
//
// NOT useClients, though it already selects these columns. That hook carries
// add, edit, invite and reset machinery for a screen that writes; a read-only
// report inheriting all of it would be coupled to every future change made for
// the admin screen's benefit. Spec §8.
//
// Its own column list rather than clients.ts's CLIENT_COLUMNS, for the same
// reason: that constant is shaped by what the admin screen needs, and this
// report should not silently start fetching a column because that screen did.
const TENURE_COLUMNS =
  'id, name, status, started_on, ended_on, end_reason_code, end_reason_note'

export type UseTenure = {
  status: 'loading' | 'ready' | 'error'
  loadError: string | null
  clients: LifecycleClient[]
  reload: () => void
}

export function useTenure(): UseTenure {
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading')
  const [loadError, setLoadError] = useState<string | null>(null)
  const [clients, setClients] = useState<LifecycleClient[]>([])

  const load = useCallback(async (isCancelled: () => boolean) => {
    try {
      const { data, error } = await supabase
        .from('clients')
        .select(TENURE_COLUMNS)
        .order('name')

      if (isCancelled()) return

      if (error) {
        // Reported as an error and the list left alone, never fallen through to
        // an empty array: a failed read that renders as "no clients" is v1's
        // "a broken tool looks like an empty one", which is the defect this
        // whole project keeps guarding against.
        setLoadError(describeError(error))
        setStatus('error')
        return
      }

      setClients((data ?? []) as LifecycleClient[])
      setLoadError(null)
      setStatus('ready')
    } catch (thrown: unknown) {
      if (isCancelled()) return
      setLoadError(describeError(thrown))
      setStatus('error')
    }
  }, [])

  useEffect(() => {
    // A fresh flag per run, marked cancelled on unmount, so a slow response
    // cannot resolve into a torn-down tree. useBoard explains the same guard.
    let cancelled = false
    void load(() => cancelled)
    return () => {
      cancelled = true
    }
  }, [load])

  return {
    status,
    loadError,
    clients,
    reload: () => void load(() => false),
  }
}

import { useCallback, useEffect, useState } from 'react'
import { describeError } from '../lib/errorText'
import { supabase } from '../lib/supabase'
import { PACKAGE_COLUMNS } from './clientPackages'
import type { PackageStint } from './clientPackages'

// Every client's package history, for a screen that only reads it.
//
// NOT useClients, though that hook already selects these columns. It carries
// add, edit and two write paths for a screen that writes; a read-only section
// inheriting all of it would be coupled to every future change made for the
// admin screen's benefit. useTenure gives the same reason about itself.
//
// GATED AT THE READ, NOT THE RENDER. client_packages is select-gated on
// manage_clients in RLS, and `enabled` is false for anyone without it, so no
// query is issued at all -- hiding rows that were already fetched is not a
// permission check. The same arrangement useClientRates has.

export type UsePackages = {
  status: 'loading' | 'ready' | 'error'
  loadError: string | null
  byClient: Map<number, PackageStint[]>
}

export function usePackages(enabled: boolean): UsePackages {
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>(
    enabled ? 'loading' : 'ready',
  )
  const [loadError, setLoadError] = useState<string | null>(null)
  const [byClient, setByClient] = useState<Map<number, PackageStint[]>>(new Map())

  const load = useCallback(
    async (isCancelled: () => boolean) => {
      if (!enabled) return
      setStatus('loading')

      // A REJECTED promise -- a genuine network failure rather than a resolved
      // { data, error } -- must not escape this effect as an unhandled
      // rejection, leaving the hook in 'loading' forever. useClientRates
      // shipped without this guard and it had to be added back.
      try {
        // THE ORDER IS LOAD-BEARING, NOT REDUNDANT, even though sortStints
        // re-sorts every one of these rows before this module's own functions
        // ever look at them. This exists for the CAP: PostgREST returns at
        // most db-max-rows and, past that, simply stops -- and without an
        // ORDER BY, WHICH rows survive is unspecified, so one client's most
        // recent stint could be the row dropped while an older one for the
        // same client comes through. Ascending by started_on at least makes
        // the truncation deterministic and its direction knowable, which
        // useClientRates.ts argues at length is worth having even where a
        // redundant sort looks unnecessary -- an arbitrary truncation is worse
        // than a predictable one.
        const { data, error } = await supabase
          .from('client_packages')
          .select(PACKAGE_COLUMNS)
          .order('started_on')

        if (isCancelled()) return

        if (error) {
          // Reported, never fallen through to an empty map: a failed read that
          // renders as "no packages recorded" is this project's oldest defect,
          // a broken tool looking like an empty one.
          setLoadError(describeError(error))
          setStatus('error')
          return
        }

        const grouped = new Map<number, PackageStint[]>()
        for (const stint of (data ?? []) as PackageStint[]) {
          const found = grouped.get(stint.client_id) ?? []
          found.push(stint)
          grouped.set(stint.client_id, found)
        }

        setByClient(grouped)
        setLoadError(null)
        setStatus('ready')
      } catch (thrown: unknown) {
        if (isCancelled()) return
        setLoadError(describeError(thrown))
        setStatus('error')
      }
    },
    [enabled],
  )

  useEffect(() => {
    // A fresh flag per run, marked cancelled on unmount, so a slow response
    // cannot resolve into a torn-down tree. useBoard explains the same guard.
    let cancelled = false
    void load(() => cancelled)
    return () => {
      cancelled = true
    }
  }, [load])

  return { status, loadError, byClient }
}

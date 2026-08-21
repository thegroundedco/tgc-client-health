import { useEffect, useState } from 'react'
import type { Session } from '@supabase/supabase-js'
import { supabase } from '../lib/supabase'
import { describeError } from '../lib/errorText'
import type { Database } from '../types/database'

export type Profile = Database['public']['Tables']['profiles']['Row']

export function useProfile(session: Session | null) {
  const [profile, setProfile] = useState<Profile | null>(null)
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading')
  const [error, setError] = useState<string | null>(null)

  // Depend on the user id, not the session object. supabase-js hands out a new
  // session object on every onAuthStateChange event, including the periodic
  // TOKEN_REFRESHED that fires roughly hourly while a tab sits open — depending
  // on `session` itself would refetch and flash back to "loading" on every one
  // of those, even though nothing the user can see has changed.
  //
  // This does not risk a stale access token: the query below goes through the
  // shared `supabase` client, which looks up the current session's access
  // token itself at request time (SupabaseClient#_getSessionToken calls
  // `this.auth.getSession()` fresh for every request) rather than one closed
  // over here. The id is only used to decide *whether* and *what* to fetch.
  const userId = session?.user.id

  useEffect(() => {
    if (!userId) {
      setProfile(null)
      setStatus('ready')
      return
    }

    let cancelled = false
    setStatus('loading')

    supabase
      .from('profiles')
      .select('*')
      .eq('id', userId)
      .maybeSingle()
      .then(
        ({ data, error: queryError }) => {
          if (cancelled) return
          if (queryError) {
            // Distinguish "cannot reach the database" from "no data". Conflating
            // the two is what made v1 impossible to diagnose.
            setError(describeError(queryError))
            setStatus('error')
            return
          }
          setProfile(data)
          setStatus('ready')
        },
        // The rejection handler is not optional here, and it is not symmetry
        // with Board.tsx for its own sake. postgrest-js normally resolves a
        // failed request into `error` rather than rejecting, but "normally" is
        // not "always": a thrown fetch, a rejected auth token refresh inside
        // the client, or an abort all reject. With no handler the promise
        // rejects unobserved, `status` stays 'loading' forever, and
        // deriveAppState renders 'loading' forever — a permanent spinner with
        // no message, no error and no retry, on the app's front door.
        (thrown: unknown) => {
          if (cancelled) return
          setError(describeError(thrown))
          setStatus('error')
        },
      )

    return () => {
      cancelled = true
    }
  }, [userId])

  return { profile, status, error }
}

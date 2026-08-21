import { useEffect, useState } from 'react'
import type { Session } from '@supabase/supabase-js'
import { supabase } from '../lib/supabase'
import { describeError } from '../lib/errorText'

export function useSession() {
  const [session, setSession] = useState<Session | null>(null)
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading')
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false

    supabase.auth.getSession().then(
      ({ data }) => {
        if (cancelled) return
        setSession(data.session)
        setStatus('ready')
      },
      // Without this handler a rejected getSession() leaves `status` at
      // 'loading' forever, and deriveAppState renders 'loading' forever: a
      // permanent spinner on the very first screen, with nothing on it to read
      // and nothing to click. Board.tsx already guards its reads this way;
      // this is the front door and needs the same guard.
      //
      // Note the deliberate asymmetry. A *returned* error from getSession()
      // (`data.session === null`, `error` set) is left to fall through to the
      // signed-out branch on purpose: that is the corrupt-stored-session case,
      // and the action the user needs is the sign-in form, not a dead end
      // saying the database is unreachable. A *rejection* is different — it
      // means the call did not complete at all, there is nothing actionable to
      // offer, and saying so is better than a spinner.
      (thrown: unknown) => {
        if (cancelled) return
        setError(describeError(thrown))
        setStatus('error')
      },
    )

    const { data: subscription } = supabase.auth.onAuthStateChange((_event, next) => {
      setSession(next)
      setStatus('ready')
      // A later successful event clears an earlier failure: the app is no
      // longer in the state the message describes.
      setError(null)
    })

    return () => {
      cancelled = true
      subscription.subscription.unsubscribe()
    }
  }, [])

  return { session, status, error }
}

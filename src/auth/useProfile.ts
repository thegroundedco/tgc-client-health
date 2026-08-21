import { useEffect, useState } from 'react'
import type { Session } from '@supabase/supabase-js'
import { supabase } from '../lib/supabase'
import type { Database } from '../types/database'

export type Profile = Database['public']['Tables']['profiles']['Row']

export function useProfile(session: Session | null) {
  const [profile, setProfile] = useState<Profile | null>(null)
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading')
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!session) {
      setProfile(null)
      setStatus('ready')
      return
    }

    let cancelled = false
    setStatus('loading')

    supabase
      .from('profiles')
      .select('*')
      .eq('id', session.user.id)
      .maybeSingle()
      .then(({ data, error: queryError }) => {
        if (cancelled) return
        if (queryError) {
          // Distinguish "cannot reach the database" from "no data". Conflating
          // the two is what made v1 impossible to diagnose.
          setError(queryError.message)
          setStatus('error')
          return
        }
        setProfile(data)
        setStatus('ready')
      })

    return () => {
      cancelled = true
    }
  }, [session])

  return { profile, status, error }
}

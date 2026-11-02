import { useCallback, useEffect, useState } from 'react'
import { describeError } from '../lib/errorText'
import { supabase } from '../lib/supabase'

// One client's standing monthly retainer (public.client_retainers), and the save.
//
// GATED AT THE READ, NOT THE RENDER, as usePackages documents: with canRead
// false no query is issued and status is 'off'. RLS gates the select on
// view_revenue and the writes on edit_revenue; this is only the courtesy.
//
// No row means no retainer. Zero is never stored: save(0) deletes the row, and
// the table's own check (monthly_cents > 0) would refuse it anyway.
// A failed read is 'error', never "no retainer".

export type UseRetainer = {
  status: 'loading' | 'ready' | 'error' | 'off'
  loadError: string | null
  monthlyCents: number | null
  save: (cents: number) => Promise<{ ok: true } | { ok: false; error: string }>
}

export function useRetainer(clientId: number, canRead: boolean): UseRetainer {
  const [status, setStatus] = useState<UseRetainer['status']>(canRead ? 'loading' : 'off')
  const [loadError, setLoadError] = useState<string | null>(null)
  const [monthlyCents, setMonthlyCents] = useState<number | null>(null)

  useEffect(() => {
    let cancelled = false
    setMonthlyCents(null)
    setLoadError(null)
    if (!canRead) {
      setStatus('off')
      return
    }
    setStatus('loading')
    void (async () => {
      try {
        const { data, error } = await supabase
          .from('client_retainers')
          .select('monthly_cents')
          .eq('client_id', clientId)
          .maybeSingle()
        if (cancelled) return
        if (error) {
          setLoadError(describeError(error))
          setStatus('error')
          return
        }
        setMonthlyCents(data?.monthly_cents ?? null)
        setStatus('ready')
      } catch (thrown: unknown) {
        if (cancelled) return
        setLoadError(describeError(thrown))
        setStatus('error')
      }
    })()
    return () => {
      cancelled = true
    }
  }, [clientId, canRead])

  const save = useCallback<UseRetainer['save']>(
    async (cents) => {
      try {
        if (cents === 0) {
          const { error } = await supabase.from('client_retainers').delete().eq('client_id', clientId)
          if (error) return { ok: false, error: describeError(error) }
          setMonthlyCents(null)
          return { ok: true }
        }
        const { data: userData } = await supabase.auth.getUser()
        const { error } = await supabase
          .from('client_retainers')
          .upsert(
            { client_id: clientId, monthly_cents: cents, updated_by: userData.user?.id ?? null },
            { onConflict: 'client_id' },
          )
        if (error) return { ok: false, error: describeError(error) }
        setMonthlyCents(cents)
        return { ok: true }
      } catch (thrown: unknown) {
        return { ok: false, error: describeError(thrown) }
      }
    },
    [clientId],
  )

  return { status, loadError, monthlyCents, save }
}

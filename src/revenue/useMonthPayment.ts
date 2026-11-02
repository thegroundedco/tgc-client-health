import { useCallback, useEffect, useState } from 'react'
import { describeError } from '../lib/errorText'
import { supabase } from '../lib/supabase'
import type { MonthRow } from './paymentBox'

// One client's payment for one month, plus the retainer on file, and the save.
//
// GATED AT THE READ, NOT THE RENDER, as usePackages documents. client_month_revenue
// and client_retainers are select-gated in RLS; with canRead false no query is
// issued at all and status is 'off'. RLS is the enforcement, this is the courtesy.
//
// A failed read is 'error', never an empty month: a broken tool must not look
// like nothing entered. Only the entering person's NAME is optional -- a failed
// profile read leaves enteredByName null and the rest intact.

export type UseMonthPayment = {
  status: 'loading' | 'ready' | 'error' | 'off'
  loadError: string | null
  row: MonthRow | null
  storedRetainer: number | null
  enteredByName: string | null
  save: (p: { retainerCents: number; projectCents: number; setRetainer: boolean }) => Promise<{ ok: true } | { ok: false; error: string }>
  reload: () => void
}

export function useMonthPayment(clientId: number, period: string, canRead: boolean): UseMonthPayment {
  const [status, setStatus] = useState<UseMonthPayment['status']>(canRead ? 'loading' : 'off')
  const [loadError, setLoadError] = useState<string | null>(null)
  const [row, setRow] = useState<MonthRow | null>(null)
  const [storedRetainer, setStoredRetainer] = useState<number | null>(null)
  const [enteredByName, setEnteredByName] = useState<string | null>(null)
  const [nonce, setNonce] = useState(0)

  useEffect(() => {
    let cancelled = false
    const isCancelled = () => cancelled
    setRow(null)
    setStoredRetainer(null)
    setEnteredByName(null)
    setLoadError(null)
    if (!canRead) {
      setStatus('off')
      return
    }
    setStatus('loading')

    void (async () => {
      try {
        const month = await supabase
          .from('client_month_revenue')
          .select('retainer_cents, project_cents, entered_by, updated_at')
          .eq('client_id', clientId)
          .eq('period', period)
          .maybeSingle()
        if (isCancelled()) return
        if (month.error) {
          setLoadError(describeError(month.error))
          setStatus('error')
          return
        }

        const retainer = await supabase
          .from('client_retainers')
          .select('monthly_cents')
          .eq('client_id', clientId)
          .maybeSingle()
        if (isCancelled()) return
        if (retainer.error) {
          setLoadError(describeError(retainer.error))
          setStatus('error')
          return
        }

        const monthRow = (month.data ?? null) as MonthRow | null
        let name: string | null = null
        if (monthRow?.entered_by) {
          try {
            const profile = await supabase
              .from('profiles')
              .select('full_name, email')
              .eq('id', monthRow.entered_by)
              .maybeSingle()
            if (isCancelled()) return
            if (!profile.error && profile.data) name = profile.data.full_name ?? profile.data.email
          } catch {
            // The name is a nicety: carry on without it.
          }
        }
        if (isCancelled()) return

        setRow(monthRow)
        setStoredRetainer(retainer.data?.monthly_cents ?? null)
        setEnteredByName(name)
        setStatus('ready')
      } catch (thrown: unknown) {
        if (isCancelled()) return
        setLoadError(describeError(thrown))
        setStatus('error')
      }
    })()

    return () => {
      cancelled = true
    }
  }, [clientId, period, canRead, nonce])

  const reload = useCallback(() => setNonce((n) => n + 1), [])

  const save = useCallback<UseMonthPayment['save']>(
    async ({ retainerCents, projectCents, setRetainer }) => {
      try {
        const { error } = await supabase.rpc('save_month_payment', {
          p_client_id: clientId,
          p_period: period,
          p_retainer_cents: retainerCents,
          p_project_cents: projectCents,
          p_set_retainer: setRetainer,
        })
        if (error) return { ok: false, error: describeError(error) }
        reload()
        return { ok: true }
      } catch (thrown: unknown) {
        return { ok: false, error: describeError(thrown) }
      }
    },
    [clientId, period, reload],
  )

  return { status, loadError, row, storedRetainer, enteredByName, save, reload }
}

import { useCallback, useEffect, useRef, useState } from 'react'
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
  // Bumped by every refresh and by cleanup: a response belonging to an older
  // run sees a different number and is dropped (the cancelled flag, shared).
  const generation = useRef(0)

  // fresh = the inputs changed (or first run): blank the old month and show
  // 'loading'. Not fresh = a refresh after a save: keep the current data and
  // 'ready' on screen, and overwrite when the new read lands, so a just-saved
  // month never flashes ghost text or loses the box's state. A failed refresh
  // does set 'error': showing stale figures as if confirmed is the worse lie.
  const refresh = useCallback(
    async (fresh: boolean) => {
      const mine = ++generation.current
      const isCancelled = () => generation.current !== mine
      if (fresh) {
        setRow(null)
        setStoredRetainer(null)
        setEnteredByName(null)
        setLoadError(null)
      }
      if (!canRead) {
        setStatus('off')
        return
      }
      if (fresh) setStatus('loading')

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
        setLoadError(null)
        setStatus('ready')
      } catch (thrown: unknown) {
        if (isCancelled()) return
        setLoadError(describeError(thrown))
        setStatus('error')
      }
    },
    [clientId, period, canRead],
  )

  // The refresh belonging to the key now on screen. A save started under an
  // older key must not refresh: its run would bump the generation, cancel the
  // new key's read, and write the OLD month into the new view.
  const current = useRef(refresh)

  useEffect(() => {
    current.current = refresh
    void refresh(true)
    return () => {
      generation.current += 1
    }
  }, [refresh])

  const reload = useCallback(() => void refresh(false), [refresh])

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
        // Resolve only once the refreshed read has landed (or failed), so a
        // caller acting on success sees fresh data.
        // The save itself succeeded either way; only the refresh is skipped
        // when the person has moved to another client or month meanwhile.
        if (current.current === refresh) await refresh(false)
        return { ok: true }
      } catch (thrown: unknown) {
        return { ok: false, error: describeError(thrown) }
      }
    },
    [clientId, period, refresh],
  )

  return { status, loadError, row, storedRetainer, enteredByName, save, reload }
}

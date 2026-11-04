import { useCallback, useEffect, useState } from 'react'
import { describeError } from '../lib/errorText'
import { supabase } from '../lib/supabase'

// One client's links to Productive projects (public.client_productive_projects).
//
// GATED AT THE READ, as useRetainer documents: with canManage false no query is
// issued and status is 'off'. RLS is the real gate (select needs view_revenue
// or manage_clients, writes need manage_clients).
//
// IDs are validated as digits only BEFORE any insert, because the edge function
// puts them into a Productive URL. add/remove return an error message or null.

export type UseProductiveLinks = {
  status: 'off' | 'loading' | 'ready' | 'error'
  projectIds: string[]
  add: (id: string) => Promise<string | null>
  remove: (id: string) => Promise<string | null>
}

export const NOT_A_NUMBER = "Productive project IDs are numbers — copy it from the project's URL."
export const ALREADY_LINKED = 'That project is already linked to another client.'

export function useProductiveLinks(clientId: number, canManage: boolean): UseProductiveLinks {
  const [status, setStatus] = useState<UseProductiveLinks['status']>(canManage ? 'loading' : 'off')
  const [projectIds, setProjectIds] = useState<string[]>([])

  useEffect(() => {
    let cancelled = false
    setProjectIds([])
    if (!canManage) {
      setStatus('off')
      return
    }
    setStatus('loading')
    void (async () => {
      try {
        const { data, error } = await supabase
          .from('client_productive_projects')
          .select('productive_project_id')
          .eq('client_id', clientId)
        if (cancelled) return
        if (error) {
          setStatus('error')
          return
        }
        setProjectIds((data ?? []).map((row) => row.productive_project_id))
        setStatus('ready')
      } catch {
        if (!cancelled) setStatus('error')
      }
    })()
    return () => {
      cancelled = true
    }
  }, [clientId, canManage])

  const add = useCallback(
    async (raw: string): Promise<string | null> => {
      const id = raw.trim()
      if (!/^\d+$/.test(id)) return NOT_A_NUMBER
      if (projectIds.includes(id)) return null
      try {
        const { error } = await supabase
          .from('client_productive_projects')
          .insert({ client_id: clientId, productive_project_id: id })
        if (error) return error.code === '23505' ? ALREADY_LINKED : describeError(error)
        setProjectIds((current) => [...current, id])
        return null
      } catch (thrown: unknown) {
        return describeError(thrown)
      }
    },
    [clientId, projectIds],
  )

  const remove = useCallback(
    async (id: string): Promise<string | null> => {
      try {
        const { error } = await supabase
          .from('client_productive_projects')
          .delete()
          .eq('client_id', clientId)
          .eq('productive_project_id', id)
        if (error) return describeError(error)
        setProjectIds((current) => current.filter((existing) => existing !== id))
        return null
      } catch (thrown: unknown) {
        return describeError(thrown)
      }
    },
    [clientId],
  )

  return { status, projectIds, add, remove }
}

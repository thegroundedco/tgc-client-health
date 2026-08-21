import { useCallback, useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { BAND_LABELS, PILLARS, bandFor } from '../lib/score'
import type { Pillar } from '../lib/score'
import { currentPeriod, formatPeriod } from '../lib/month'
import type { Profile } from '../auth/useProfile'

type ClientRow = { id: number; name: string }
type CheckinRow = { client_id: number; total_score: number | null }

type Props = { profile: Profile }

export function Board({ profile }: Props) {
  const [clients, setClients] = useState<ClientRow[] | null>(null)
  const [checkins, setCheckins] = useState<CheckinRow[]>([])
  // Two error states, not one. A failed read means the board has nothing to
  // show; a failed write means the board is fine and one action did not land.
  // Reporting the second as "cannot reach the database" is the exact kind of
  // lie that made v1 impossible to diagnose.
  const [loadError, setLoadError] = useState<string | null>(null)
  const [saveError, setSaveError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const period = currentPeriod()

  const load = useCallback(async () => {
    // postgrest-js resolves fetch failures into `error` rather than rejecting,
    // so the catch below is defensive. It is here because the failure it guards
    // is invisible: an unhandled rejection leaves `clients` null forever and the
    // user staring at "Loading…" with nothing to act on. Surfacing it turns a
    // dead screen into an error with a Try again button.
    try {
      const clientResult = await supabase
        .from('clients')
        .select('id, name')
        .eq('status', 'active')
        .order('name')

      if (clientResult.error) {
        setLoadError(clientResult.error.message)
        return
      }

      const checkinResult = await supabase
        .from('checkins')
        .select('client_id, total_score')
        .eq('period', period)

      if (checkinResult.error) {
        setLoadError(checkinResult.error.message)
        return
      }

      // Never write after a failed read. Both succeeded, so this is safe.
      setLoadError(null)
      setClients(clientResult.data)
      setCheckins(checkinResult.data)
    } catch (thrown) {
      setLoadError(thrown instanceof Error ? thrown.message : String(thrown))
    }
    // useCallback, not a plain function: the effect below depends on it, and an
    // identity that changed every render would refetch on every render. `period`
    // is a plain string, so the dependency is stable across renders.
  }, [period])

  useEffect(() => {
    void load()
  }, [load])

  async function scoreAllThrees(clientId: number) {
    setSaving(true)
    setSaveError(null)
    // Built from PILLARS rather than written out, so adding a pillar to the
    // spec cannot leave this half-updated. The assertion is what gives the
    // result a precise type; Object.fromEntries only knows it has string keys.
    const pillars = Object.fromEntries(
      PILLARS.map((pillar) => [pillar, 3]),
    ) as Record<Pillar, number>

    // finally, not a plain call after the await: if the upsert ever rejects,
    // `saving` would latch true, every button would stay disabled for good, and
    // nothing on screen would say why. Defensive for the same reason as load().
    try {
      const { error } = await supabase.from('checkins').upsert(
        {
          client_id: clientId,
          period,
          ...pillars,
          submitted_by: profile.id,
          submitted_at: new Date().toISOString(),
        },
        { onConflict: 'client_id,period' },
      )

      if (error) {
        setSaveError(`Could not save: ${error.message}`)
        return
      }
      await load()
    } catch (thrown) {
      setSaveError(
        `Could not save: ${thrown instanceof Error ? thrown.message : String(thrown)}`,
      )
    } finally {
      setSaving(false)
    }
  }

  if (loadError) {
    return (
      <section>
        <h2>Cannot reach the database</h2>
        <p role="alert">{loadError}</p>
        <button type="button" onClick={() => void load()}>
          Try again
        </button>
      </section>
    )
  }

  if (clients === null) return <p>Loading…</p>

  if (clients.length === 0) {
    return (
      <section>
        <h2>No active clients yet</h2>
        <p>Add one in the Supabase dashboard to see it here.</p>
      </section>
    )
  }

  return (
    <section>
      <h2>{formatPeriod(period)}</h2>
      {saveError && <p role="alert">{saveError}</p>}
      <ul>
        {clients.map((client) => {
          const checkin = checkins.find((row) => row.client_id === client.id)
          const total = checkin?.total_score ?? null
          const band = bandFor(total)
          return (
            <li key={client.id}>
              <strong>{client.name}</strong>{' '}
              <span>
                {/* The band always carries its text label. Colour arrives with
                    the real check-in screen in Phase 1, and must never be the
                    only signal. */}
                {total === null ? '—' : `${total}/25`} · {BAND_LABELS[band]}
              </span>{' '}
              <button
                type="button"
                disabled={saving}
                onClick={() => void scoreAllThrees(client.id)}
              >
                Score all 3s
              </button>
            </li>
          )
        })}
      </ul>
    </section>
  )
}

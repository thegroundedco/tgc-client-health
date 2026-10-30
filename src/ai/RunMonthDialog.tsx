import { useEffect, useId, useRef, useState } from 'react'
import { formatPeriod } from '../lib/month'
import type { BoardClient } from '../board/useBoard'
import type { StartBody } from './useAiRun'
import styles from './RunMonthDialog.module.css'

type Props = {
  period: string
  /** Members of the month only. */
  clients: BoardClient[]
  /** Members whose check-in was scored by hand. */
  manual: Set<number>
  onRun: (body: StartBody) => void
  onCancel: () => void
}

type Step = 'scope' | 'choose' | 'overwrite'

function toggled(set: Set<number>, id: number): Set<number> {
  const next = new Set(set)
  if (next.has(id)) next.delete(id)
  else next.add(id)
  return next
}

// A modal overlay, not <dialog>: role, aria-modal and the label are explicit,
// focus lands on the first button of every step, and Escape is Cancel.
export function RunMonthDialog({ period, clients, manual, onRun, onCancel }: Props) {
  const headingId = useId()
  const ref = useRef<HTMLDivElement>(null)
  const [step, setStep] = useState<Step>('scope')
  // null = "all clients" (sent as client_ids: null); a set = the chosen ones.
  const [chosen, setChosen] = useState<Set<number>>(() => new Set(clients.map((c) => c.id)))
  const [allClients, setAllClients] = useState(true)
  const [overwriting, setOverwriting] = useState<Set<number>>(() => new Set())

  // Document-level, so Escape and Tab behave the same wherever focus is -- a
  // click on the heading or padding must not strand the keyboard on <body>.
  const cancelRef = useRef(onCancel)
  useEffect(() => {
    cancelRef.current = onCancel
  })
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        cancelRef.current()
        return
      }
      if (event.key !== 'Tab') return
      const dialog = ref.current
      if (!dialog) return
      const items = [...dialog.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled)')]
      if (items.length === 0) return
      const first = items[0]
      const last = items[items.length - 1]
      const active = document.activeElement
      if (!dialog.contains(active) || (active === dialog && event.shiftKey)) {
        event.preventDefault()
        ;(event.shiftKey ? last : first).focus()
      } else if (event.shiftKey && (active === first || active === dialog)) {
        event.preventDefault()
        last.focus()
      } else if (!event.shiftKey && active === last) {
        event.preventDefault()
        first.focus()
      }
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [])

  useEffect(() => {
    ref.current?.querySelector<HTMLButtonElement>('button:not(:disabled)')?.focus()
  }, [step])

  const finish = (ids: Set<number>, all: boolean, overwrite: number[]) =>
    onRun({
      period,
      client_ids: all ? null : clients.filter((c) => ids.has(c.id)).map((c) => c.id),
      overwrite_client_ids: overwrite,
      source: 'board',
    })

  // After scope is settled: ask about overwrites only if a chosen client is manual.
  const proceed = (ids: Set<number>, all: boolean) => {
    const hit = clients.filter((c) => ids.has(c.id) && manual.has(c.id))
    if (hit.length === 0) return finish(ids, all, [])
    setChosen(ids)
    setAllClients(all)
    setOverwriting(new Set())
    setStep('overwrite')
  }

  const manualChosen = clients.filter((c) => chosen.has(c.id) && manual.has(c.id))

  return (
    <div className={styles.overlay}>
      <div
        aria-labelledby={headingId}
        aria-modal="true"
        className={styles.dialog}
        ref={ref}
        tabIndex={-1}
        role="dialog"
      >
        {step === 'scope' && (
          <>
            <h2 className="t-header" id={headingId}>
              {`Run AI suggested scores for all ${clients.length} clients in ${formatPeriod(period)}?`}
            </h2>
            <div className={styles.actions}>
              <button
                className="button"
                onClick={() => proceed(new Set(clients.map((c) => c.id)), true)}
                type="button"
              >
                Yes, all clients
              </button>
              <button
                className="button button--quiet"
                onClick={() => {
                  setChosen(new Set(clients.map((c) => c.id)))
                  setStep('choose')
                }}
                type="button"
              >
                No, let me choose
              </button>
              <button className="button button--quiet" onClick={onCancel} type="button">
                Cancel
              </button>
            </div>
          </>
        )}
        {step === 'choose' && (
          <>
            <h2 className="t-header" id={headingId}>
              Which clients?
            </h2>
            <ul className={styles.list} role="list">
              {clients.map((c) => (
                <li key={c.id}>
                  <label className="t-body">
                    <input
                      checked={chosen.has(c.id)}
                      onChange={() => setChosen(toggled(chosen, c.id))}
                      type="checkbox"
                    />{' '}
                    {c.name}
                  </label>
                </li>
              ))}
            </ul>
            <div className={styles.actions}>
              <button
                className="button"
                disabled={chosen.size === 0}
                onClick={() => proceed(chosen, false)}
                type="button"
              >
                Continue
              </button>
              <button className="button button--quiet" onClick={onCancel} type="button">
                Cancel
              </button>
            </div>
          </>
        )}
        {step === 'overwrite' && (
          <>
            <h2 className="t-header" id={headingId}>
              These clients have already been manually scored – overwrite their data?
            </h2>
            <ul className={styles.list} role="list">
              {manualChosen.map((c) => (
                <li key={c.id}>
                  <label className="t-body">
                    <input
                      checked={overwriting.has(c.id)}
                      onChange={() => setOverwriting(toggled(overwriting, c.id))}
                      type="checkbox"
                    />{' '}
                    {c.name}
                  </label>
                </li>
              ))}
            </ul>
            <div className={styles.actions}>
              <button
                className="button"
                onClick={() =>
                  finish(
                    chosen,
                    allClients,
                    manualChosen.filter((c) => overwriting.has(c.id)).map((c) => c.id),
                  )
                }
                type="button"
              >
                Run
              </button>
              <button className="button button--quiet" onClick={onCancel} type="button">
                Cancel
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  )
}

import { useState } from 'react'
import type { BoardClient } from '../board/useBoard'
import { runLine } from './runLine'
import { RunMonthDialog } from './RunMonthDialog'
import { useAiRun } from './useAiRun'
import styles from './RunMonthDialog.module.css'

type Props = {
  period: string
  /** Members of the month only. */
  clients: BoardClient[]
  manual: Set<number>
  onFinished: () => void
}

// The board's "Run AI suggested scores" control. While a run is in flight the
// button gives way to the running line; the line stays for a failed run and for
// the latest finished run's summary.
export function RunMonthButton({ period, clients, manual, onFinished }: Props) {
  const { run, state, start, starting } = useAiRun(period, onFinished)
  const [open, setOpen] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const line = run ? runLine(run, new Date()) : null

  return (
    <div className={styles.runBox}>
      {state !== 'running' && (
        <button
          className="button"
          disabled={starting || clients.length === 0}
          onClick={() => {
            setError(null)
            setOpen(true)
          }}
          type="button"
        >
          Run AI suggested scores
        </button>
      )}
      {error && (
        <p className="alert t-caption" role="alert">
          {error}
        </p>
      )}
      {line && (
        <p className="t-caption" role="status">
          {line}
        </p>
      )}
      {open && (
        <RunMonthDialog
          clients={clients}
          manual={manual}
          onCancel={() => setOpen(false)}
          onRun={(body) => {
            setOpen(false)
            void start(body).then((result) => {
              if (!result.ok) setError(result.message)
            })
          }}
          period={period}
        />
      )}
    </div>
  )
}

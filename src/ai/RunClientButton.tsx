import { useId, useState } from 'react'
import { DialogShell } from './DialogShell'
import { runLine } from './runLine'
import { useAiRun } from './useAiRun'
import styles from './RunMonthDialog.module.css'

type Props = {
  clientId: number
  period: string
  /** The stored check-in was scored by hand. */
  manual: boolean
  hasUnsavedChanges: boolean
  onFinished: () => void
}

// The check-in's "Run AI score for this client". A hand-scored check-in is
// only overwritten after an explicit Overwrite.
export function RunClientButton({ clientId, period, manual, hasUnsavedChanges, onFinished }: Props) {
  const headingId = useId()
  const { run, state, start, starting } = useAiRun(period, onFinished)
  const [open, setOpen] = useState(false)
  const [failure, setFailure] = useState<{ period: string; message: string } | null>(null)
  const error = failure && failure.period === period ? failure.message : null

  const go = (overwrite: number[]) => {
    setOpen(false)
    void start({ period, client_ids: [clientId], overwrite_client_ids: overwrite, source: 'checkin' }).then(
      (result) => setFailure(result.ok ? null : { period, message: result.message }),
    )
  }

  const line = state === 'running' && run ? runLine(run, new Date()) : null

  return (
    <div className="prose">
      {state !== 'running' && (
        <button
          className="button button--quiet"
          disabled={starting || hasUnsavedChanges}
          onClick={() => (manual ? setOpen(true) : go([]))}
          type="button"
        >
          Run AI score for this client
        </button>
      )}
      {state !== 'running' && hasUnsavedChanges && (
        <p className="t-caption">You have unsaved changes. Save them first.</p>
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
        <DialogShell headingId={headingId} onCancel={() => setOpen(false)}>
          <h2 className="t-header" id={headingId}>
            This client has already been manually scored – overwrite their data?
          </h2>
          <div className={styles.actions}>
            <button className="button" onClick={() => go([clientId])} type="button">
              Overwrite
            </button>
            <button className="button button--quiet" onClick={() => setOpen(false)} type="button">
              Cancel
            </button>
          </div>
        </DialogShell>
      )}
    </div>
  )
}

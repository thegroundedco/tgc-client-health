import { useState } from 'react'
import { END_REASON_CODES, END_REASON_LABELS } from '../clients/clientForm'
import { cancelDateBounds, cancelProblems } from '../clients/statusChange'
import { useStatusChange } from '../clients/useStatusChange'
import { formatDay, formatPeriod } from '../lib/month'
import styles from './EndClientPanel.module.css'

type Props = {
  client: { id: number; name: string; status: string; started_on: string | null }
  period: string
  hasCheckin: boolean
  // Called only after a pause has been written. The board re-reads on the way
  // back, so the card it returns to is the paused one.
  onPaused: () => void
}

// Spec §3. Pause or cancel the client for the month being scored, without a
// trip to the roster. Offered only where it cannot overwrite a recorded end:
// an active client can be paused or cancelled, a paused one cancelled, and a
// cancelled or former one neither -- pausing them would clear an end date and a
// reason, and that belongs on the roster where the warning for it lives.
export function EndClientPanel({ client, period, hasCheckin, onPaused }: Props) {
  const { state, apply } = useStatusChange(client.id)
  const bounds = cancelDateBounds(period, client.started_on)
  const [open, setOpen] = useState<'none' | 'pause' | 'cancel'>('none')
  const [endedOn, setEndedOn] = useState(bounds.max)
  const [reason, setReason] = useState('')
  const [note, setNote] = useState('')
  const [attempted, setAttempted] = useState(false)
  const [cancelledOn, setCancelledOn] = useState<string | null>(null)

  const canPause = client.status === 'active'
  // A client who started after the month (admitted by a check-in) has inverted
  // bounds: no end date can satisfy them, so the form would never submit.
  const canCancelInMonth = bounds.min <= bounds.max
  const canCancel = (client.status === 'active' || client.status === 'paused') && canCancelInMonth
  if (!canPause && !canCancel) return null

  const saving = state.kind === 'saving'
  const change = { kind: 'cancel' as const, endedOn, endReasonCode: reason, endReasonNote: note }
  const problems = cancelProblems(change, bounds)

  if (cancelledOn !== null) {
    return (
      <p className="t-body prose" role="status">
        {client.name} is cancelled as of {formatDay(cancelledOn)}. You can still finish this check-in. To undo
        it, use Edit client.
      </p>
    )
  }

  return (
    <div className={styles.panel}>
      {open === 'none' && (
        <div className={styles.actions}>
          {canPause && (
            <button className="button button--quiet" onClick={() => setOpen('pause')} type="button">
              Paused this month
            </button>
          )}
          {canCancel && (
            <button className="button button--quiet" onClick={() => setOpen('cancel')} type="button">
              Cancelled this month
            </button>
          )}
        </div>
      )}

      {open === 'pause' && (
        <div className={styles.confirm}>
          <p className="t-body prose">
            Pause {client.name}? They come off the board until you set them active again.
            {hasCheckin &&
              ` They will still stay on ${formatPeriod(period)}’s board because they already have a check-in.`}
          </p>
          <div className={styles.actions}>
            <button
              className="button"
              disabled={saving}
              onClick={async () => {
                if (await apply({ kind: 'pause' })) onPaused()
              }}
              type="button"
            >
              Pause {client.name}
            </button>
            <button className="button button--quiet" onClick={() => setOpen('none')} type="button">
              Keep active
            </button>
          </div>
        </div>
      )}

      {open === 'cancel' && (
        <form
          className={styles.confirm}
          // The date input's min/max would otherwise make the browser refuse
          // the submit with its own tooltip before onSubmit runs; cancelProblems
          // is the one rule and says it in the page's own words.
          noValidate
          onSubmit={async (event) => {
            event.preventDefault()
            setAttempted(true)
            if (problems.length > 0) return
            if (await apply(change)) setCancelledOn(endedOn)
          }}
        >
          <label className="t-label" htmlFor="end-client-date">End date</label>
          <input
            id="end-client-date"
            max={bounds.max}
            min={bounds.min}
            onChange={(event) => setEndedOn(event.target.value)}
            type="date"
            value={endedOn}
          />
          <label className="t-label" htmlFor="end-client-reason">Reason they left</label>
          <select id="end-client-reason" onChange={(event) => setReason(event.target.value)} value={reason}>
            <option value="">Choose a reason</option>
            {END_REASON_CODES.map((code) => (
              <option key={code} value={code}>{END_REASON_LABELS[code]}</option>
            ))}
          </select>
          <label className="t-label" htmlFor="end-client-note">Note (optional)</label>
          <textarea id="end-client-note" onChange={(event) => setNote(event.target.value)} value={note} />
          {attempted && problems.length > 0 && <p className="t-caption prose">{problems.join(' ')}</p>}
          <div className={styles.actions}>
            <button className="button" disabled={saving} type="submit">Mark cancelled</button>
            <button className="button button--quiet" onClick={() => setOpen('none')} type="button">Never mind</button>
          </div>
        </form>
      )}

      {state.kind === 'failed' && (
        <p className="alert prose" role="alert">{state.message}</p>
      )}
    </div>
  )
}

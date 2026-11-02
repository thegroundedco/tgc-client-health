import { useEffect, useState } from 'react'
import { shortDay } from '../lib/month'
import { formatMoney, MAX_CENTS, parseMoney } from '../revenue/money'
import {
  boxMode, effectiveRetainer, ghostRetainer, initialFields, monthName, paymentCaption, retainerQuestion, shouldAskRetainer,
} from '../revenue/paymentBox'
import type { UseMonthPayment } from '../revenue/useMonthPayment'
import styles from './PaymentsBox.module.css'

type Props = {
  // Identifies the client: with period and the row it keys the reset, so a
  // question left open for one client can never be answered for another.
  clientId: number
  clientName: string
  period: string
  canEdit: boolean
  payment: UseMonthPayment
  // Called after a save has landed, so the screen can re-read what it shows.
  onSaved: () => void
}

type Ask = { retainerCents: number; projectCents: number }

// Spec 2026-11-02 §3-4. Draws what paymentBox.ts decided; no rule lives here.
export function PaymentsBox({ clientId, clientName, period, canEdit, payment, onSaved }: Props) {
  const { status, row, storedRetainer } = payment
  const [fields, setFields] = useState(() => initialFields(row))
  const [problem, setProblem] = useState<string | null>(null)
  const [ask, setAsk] = useState<Ask | null>(null)
  const [saving, setSaving] = useState(false)

  // Reset when the row is replaced (a reload after save, or another month),
  // not on every render: typing must survive a re-render.
  useEffect(() => {
    setFields(initialFields(row))
    setProblem(null)
    setAsk(null)
  }, [clientId, period, row])

  if (status === 'off') return null

  const month = monthName(period)
  const heading = (
    <>
      <h3 className="t-label">{month} payments</h3>
      <p className="t-caption">{paymentCaption(period)}</p>
    </>
  )

  if (status === 'loading') {
    return <div className={styles.box}>{heading}<p className="t-body">Loading payments…</p></div>
  }
  if (status === 'error') {
    return <div className={styles.box}>{heading}<p className="alert prose" role="alert">{payment.loadError}</p></div>
  }

  const mode = boxMode({ canEdit, row, storedRetainer, fields })

  if (mode === 'readonly') {
    return (
      <div className={styles.box}>
        {heading}
        {row ? (
          <dl className={styles.figures}>
            <div className={styles.figure}><dt className="t-label">Retainer</dt><dd className="numeric">{formatMoney(row.retainer_cents)}</dd></div>
            <div className={styles.figure}><dt className="t-label">Project</dt><dd className="numeric">{formatMoney(row.project_cents)}</dd></div>
          </dl>
        ) : (
          <p className="t-body">Not entered yet</p>
        )}
        {row && <p className="t-caption">{enteredLine(payment)}</p>}
      </div>
    )
  }

  async function write(retainerCents: number, projectCents: number, setRetainer: boolean) {
    setSaving(true)
    setProblem(null)
    const result = await payment.save({ retainerCents, projectCents, setRetainer })
    setSaving(false)
    setAsk(null)
    if (result.ok) onSaved()
    else setProblem(result.error)
  }

  function submit() {
    const retainerCents = effectiveRetainer(fields.retainer, ghostRetainer(row, storedRetainer))
    const projectCents = parseMoney(fields.project)
    const bad = retainerCents === null ? 'Retainer' : projectCents === null ? 'Project' : null
    if (bad || retainerCents === null || projectCents === null) {
      setAsk(null)
      setProblem(`${bad} is not a dollar amount up to ${formatMoney(MAX_CENTS)}. Nothing was saved.`)
      return
    }
    const retainerEdited = fields.retainer !== initialFields(row).retainer
    if (shouldAskRetainer({ retainerEdited, retainerCents, storedRetainer })) {
      setProblem(null)
      setAsk({ retainerCents, projectCents })
      return
    }
    void write(retainerCents, projectCents, false)
  }

  const question = ask ? retainerQuestion(clientName, period, storedRetainer, ask.retainerCents) : null
  const ghost = ghostRetainer(row, storedRetainer)
  const retainerPlaceholder = ghost !== null ? formatMoney(ghost) : 'No retainer'

  return (
    <div className={styles.box}>
      {heading}
      <div className={styles.fields}>
        <label className={styles.field}>
          <span className="t-label">Retainer</span>
          <input
            className="field numeric"
            inputMode="decimal"
            onChange={(e) => { setFields({ ...fields, retainer: e.target.value }); setAsk(null) }}
            disabled={saving}
            placeholder={retainerPlaceholder}
            value={fields.retainer}
          />
        </label>
        <label className={styles.field}>
          <span className="t-label">Project</span>
          <input
            className="field numeric"
            inputMode="decimal"
            onChange={(e) => { setFields({ ...fields, project: e.target.value }); setAsk(null) }}
            disabled={saving}
            placeholder="$0"
            value={fields.project}
          />
        </label>
      </div>
      {row && <p className="t-caption">{enteredLine(payment)}</p>}
      {problem && <p className="alert prose" role="alert">{problem}</p>}
      {ask && question ? (
        <div className={styles.ask}>
          <p className="t-body prose">{question.text}</p>
          <div className={styles.actions}>
            <button className="button" disabled={saving} onClick={() => void write(ask.retainerCents, ask.projectCents, true)} type="button">
              {question.yes}
            </button>
            <button className="button button--quiet" disabled={saving} onClick={() => void write(ask.retainerCents, ask.projectCents, false)} type="button">
              {question.no}
            </button>
            <button className="button button--quiet" disabled={saving} onClick={() => setAsk(null)} type="button">
              Cancel
            </button>
          </div>
        </div>
      ) : (
        <div className={styles.actions}>
          <button className="button" disabled={saving} onClick={submit} type="button">
            {mode === 'confirm' && storedRetainer !== null ? `Confirm ${formatMoney(storedRetainer)} retainer` : 'Save'}
          </button>
        </div>
      )}
    </div>
  )
}

function enteredLine(payment: UseMonthPayment): string {
  const day = payment.row ? shortDay(payment.row.updated_at) : ''
  return payment.enteredByName ? `Entered by ${payment.enteredByName}, ${day}` : `Entered ${day}`
}

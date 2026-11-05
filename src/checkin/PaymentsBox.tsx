import { useEffect, useId, useState } from 'react'
import { shortDay } from '../lib/month'
import { formatMoney, MAX_CENTS } from '../revenue/money'
import {
  boxMode, checkItems, displayItems, effectiveRetainer, ghostRetainer, initialFields, LABEL_MAX, monthName, paymentCaption,
  projectTotal, retainerQuestion, shouldAskRetainer,
} from '../revenue/paymentBox'
import type { Fields, ItemField, ProjectItem } from '../revenue/paymentBox'
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

type Ask = { retainerCents: number; projectCents: number; items: ProjectItem[] }

const EMPTY_ITEM: ItemField = { label: '', amount: '' }

// Spec 2026-11-02 §3-4. Draws what paymentBox.ts decided; no rule lives here.
export function PaymentsBox({ clientId, clientName, period, canEdit, payment, onSaved }: Props) {
  const { status, row, items, storedRetainer } = payment
  const [fields, setFields] = useState<Fields>(() => initialFields(row, items))
  // One per line item, null where the row is fine. Set by a refused save and
  // cleared row by row as the person edits.
  const [itemErrors, setItemErrors] = useState<(string | null)[]>([])
  const [problem, setProblem] = useState<string | null>(null)
  const [ask, setAsk] = useState<Ask | null>(null)
  const [saving, setSaving] = useState(false)
  const errorIdBase = useId()

  // Reset when the row or its items are replaced (a reload after save, or
  // another month), not on every render: typing must survive a re-render.
  useEffect(() => {
    setFields(initialFields(row, items))
    setItemErrors([])
    setProblem(null)
    setAsk(null)
  }, [clientId, period, row, items])

  if (status === 'off') return null

  const month = monthName(period)
  const heading = (
    <>
      <h4 className="t-label">{month} payments</h4>
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

  const earlierNote = row?.project_notes ? (
    <p className={`t-caption ${styles.notesText}`} data-testid="earlier-note">
      Earlier note: {row.project_notes}
    </p>
  ) : null

  if (mode === 'readonly') {
    const shown = displayItems(row, items)
    return (
      <div className={styles.box}>
        {heading}
        {row ? (
          <>
            <dl className={styles.figures}>
              <div className={styles.figure}><dt className="t-label">Retainer</dt><dd className="numeric">{formatMoney(row.retainer_cents)}</dd></div>
            </dl>
            <div className={styles.items}>
              <p className="t-label">Project line items</p>
              {shown.length > 0 && (
                <ul className={styles.itemList}>
                  {shown.map((item, index) => (
                    <li data-testid="project-item" key={index}>
                      {item.label} – <span className="numeric">{formatMoney(item.cents)}</span>
                    </li>
                  ))}
                </ul>
              )}
              <p className="t-body numeric" data-testid="project-total">Project total: {formatMoney(row.project_cents)}</p>
              {earlierNote}
            </div>
          </>
        ) : (
          <p className="t-body">Not entered yet</p>
        )}
        {row && <p className="t-caption">{enteredLine(payment)}</p>}
      </div>
    )
  }

  // The earlier note goes back unchanged, so a save never erases it: there
  // are no new notes, only the line items.
  async function write(next: Ask, setRetainer: boolean) {
    setSaving(true)
    setProblem(null)
    const result = await payment.save({
      retainerCents: next.retainerCents,
      projectCents: next.projectCents,
      projectNotes: row?.project_notes ?? null,
      items: next.items,
      setRetainer,
    })
    setSaving(false)
    setAsk(null)
    if (result.ok) onSaved()
    else setProblem(result.error)
  }

  function submit() {
    const retainerCents = effectiveRetainer(fields.retainer, ghostRetainer(row, storedRetainer))
    if (retainerCents === null) {
      setAsk(null)
      setProblem(`Retainer is not a dollar amount up to ${formatMoney(MAX_CENTS)}. Nothing was saved.`)
      return
    }
    const checked = checkItems(fields.items)
    if (!checked.ok) {
      setAsk(null)
      setItemErrors(checked.errors)
      setProblem(checked.problem ?? 'Fix the line items marked above. Nothing was saved.')
      return
    }
    setItemErrors([])
    const next: Ask = { retainerCents, projectCents: checked.totalCents, items: checked.items }
    const retainerEdited = fields.retainer !== initialFields(row, items).retainer
    if (shouldAskRetainer({ retainerEdited, retainerCents, storedRetainer })) {
      setProblem(null)
      setAsk(next)
      return
    }
    void write(next, false)
  }

  function editItem(index: number, change: Partial<ItemField>) {
    setFields({ ...fields, items: fields.items.map((item, i) => (i === index ? { ...item, ...change } : item)) })
    setItemErrors(itemErrors.map((error, i) => (i === index ? null : error)))
    setAsk(null)
  }

  function addItem() {
    setFields({ ...fields, items: [...fields.items, EMPTY_ITEM] })
    setAsk(null)
  }

  function removeItem(index: number) {
    setFields({ ...fields, items: fields.items.filter((_, i) => i !== index) })
    setItemErrors(itemErrors.filter((_, i) => i !== index))
    setAsk(null)
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
      </div>
      <fieldset className={styles.items}>
        <legend className="t-label">Project line items</legend>
        {fields.items.map((item, index) => {
          const n = index + 1
          const error = itemErrors[index] ?? null
          const errorId = `${errorIdBase}-item-${index}`
          const described = error ? { 'aria-describedby': errorId, 'aria-invalid': true as const } : {}
          return (
            <div className={styles.itemRow} key={index}>
              <input
                aria-label={`Line item ${n} label`}
                className={`field ${styles.itemLabel}`}
                disabled={saving}
                maxLength={LABEL_MAX}
                onChange={(e) => editItem(index, { label: e.target.value })}
                placeholder="e.g. Photo shoot"
                value={item.label}
                {...described}
              />
              <input
                aria-label={`Line item ${n} amount`}
                className={`field numeric ${styles.itemAmount}`}
                disabled={saving}
                inputMode="decimal"
                onChange={(e) => editItem(index, { amount: e.target.value })}
                placeholder="$0"
                value={item.amount}
                {...described}
              />
              <button
                aria-label={`Remove line item ${n}`}
                className="button button--quiet"
                disabled={saving}
                onClick={() => removeItem(index)}
                type="button"
              >
                Remove
              </button>
              {error && <p className={`alert ${styles.itemError}`} id={errorId}>{error}</p>}
            </div>
          )
        })}
        <div className={styles.actions}>
          <button className="button button--quiet" disabled={saving} onClick={addItem} type="button">
            Add line item
          </button>
        </div>
        <p className="t-body numeric" data-testid="project-total">Project total: {formatMoney(projectTotal(fields.items))}</p>
        {earlierNote}
      </fieldset>
      {row && <p className="t-caption">{enteredLine(payment)}</p>}
      {problem && <p className="alert prose" role="alert">{problem}</p>}
      {ask && question ? (
        <div className={styles.ask}>
          <p className="t-body prose">{question.text}</p>
          <div className={styles.actions}>
            <button className="button" disabled={saving} onClick={() => void write(ask, true)} type="button">
              {question.yes}
            </button>
            <button className="button button--quiet" disabled={saving} onClick={() => void write(ask, false)} type="button">
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

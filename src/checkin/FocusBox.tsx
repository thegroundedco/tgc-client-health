import { FOCUS_MAX } from './bucketNotes'
import styles from './FocusBox.module.css'

type Props = {
  value: string
  // Last month's focus, cleaned (useCheckin's lastMonthFocus). Null or empty
  // draws no line.
  lastFocus: string | null
  disabled: boolean
  onChange: (text: string) => void
}

const ID = 'checkin-focus'
const HINT_ID = 'checkin-focus-hint'
const LAST_ID = 'checkin-focus-last'

// Spec 2026-11-04 §2: the one or two things for this client this month, above
// the first bucket. The heading IS the label -- a <label> inside the <h3> -- so
// it is both a landmark to jump to and the textarea's accessible name, and
// clicking it focuses the box. The copy is the spec's, straight apostrophes
// and all, written as string literals so JSX entity rules do not reshape it.
export function FocusBox({ value, lastFocus, disabled, onChange }: Props) {
  const hasLast = lastFocus !== null && lastFocus !== ''
  const describedBy = hasLast ? `${HINT_ID} ${LAST_ID}` : HINT_ID

  return (
    <section className={styles.box} data-testid="focus-box">
      <h3 className="t-subhead">
        <label htmlFor={ID}>{"This month's focus"}</label>
      </h3>
      <p className="t-caption prose" id={HINT_ID}>
        {"The one or two things we'll work on with this client this month."}
      </p>
      <textarea
        aria-describedby={describedBy}
        className={`field ${styles.text}`}
        disabled={disabled}
        id={ID}
        maxLength={FOCUS_MAX}
        onChange={(event) => onChange(event.target.value)}
        rows={2}
        value={value}
      />
      {hasLast && (
        <p className={`t-caption prose ${styles.last}`} id={LAST_ID}>
          {`Last month: ${lastFocus}`}
        </p>
      )}
    </section>
  )
}

import { clockHours, hoursScoreText, signedHours } from './hoursFromBudgets'
import type { HoursLine, HoursResult } from './hoursFromBudgets'
import { HoursRing } from './HoursRing'
import styles from './HoursBox.module.css'

type Props = {
  result: HoursResult
  // Asks Productive again. Offered only when it could not be reached.
  onRetry: () => void
}

// Brief 2026-11-05 A. Read-only: the hours, a ring per budget, and the score
// the database will store -- or why there is none. Nobody picks this answer.
// Draws what hoursFromBudgets decided; no rule lives here. Nothing at all for a
// month before hours were tracked.
export function HoursBox({ result, onRetry }: Props) {
  if (!result.applies && result.reason === 'before_start') return null

  return (
    <div className={styles.box} data-testid="hours-box">
      <h4 className="t-label">Productive hours</h4>
      {result.lines.length > 0 && (
        <ul className={styles.lines}>
          {result.lines.map((line) => (
            <Line key={line.dealId} line={line} />
          ))}
        </ul>
      )}
      {result.applies ? (
        <p className="t-body" data-testid="hours-score">
          {hoursScoreText(result.answer.value)}
        </p>
      ) : (
        <p className="t-body" data-testid="hours-reason">
          {result.message}
        </p>
      )}
      {!result.applies && result.reason === 'unreachable' && (
        <div>
          <button className="button button--quiet" onClick={onRetry} type="button">
            Try again
          </button>
        </div>
      )}
    </div>
  )
}

// A flagged line says so in words, not only in its border: one of the owners
// is colourblind (global constraint, "not by colour alone"). The same goes for
// the ring's over colour: the worked/budgeted text sits beside it.
function Line({ line }: { line: HoursLine }) {
  return (
    <li className={line.flagged ? `${styles.line} ${styles.flagged}` : styles.line} data-testid="hours-line">
      <span className={styles.name}>{line.name}</span>
      <HoursRing budgetedMinutes={line.budgetedMinutes} workedMinutes={line.workedMinutes} />
      <span className="numeric" data-testid="hours-clock">
        {`${clockHours(line.workedMinutes)}/${clockHours(line.budgetedMinutes)}`}
      </span>
      <span className="numeric">{signedHours(line.diffHours)}</span>
      {line.flagged && <strong className={styles.flag}>Outside ±6h</strong>}
    </li>
  )
}

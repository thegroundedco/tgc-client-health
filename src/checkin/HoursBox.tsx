import { signedHours } from './hoursFromBudgets'
import type { HoursLine, HoursResult } from './hoursFromBudgets'
import styles from './HoursBox.module.css'

type Props = {
  result: HoursResult
  // Asks Productive again. Offered only when it could not be reached.
  onRetry: () => void
}

// The one note that a second try can change. Compared as text because the
// rule emits it as text; HoursBox.dom.test.tsx builds its results through the
// real rule, so the two cannot drift apart unnoticed.
const UNREACHABLE = "Couldn't reach Productive – answer by hand or try again"

// Hours as the rule rounded them: 1 decimal place, and 25 rather than 25.0.
const fmt = (hours: number): string => String(hours)


// Spec 2026-11-04 §7. Draws what hoursFromBudgets decided; no rule lives here.
// Nothing at all for a month before hours were tracked: there is nothing to say.
export function HoursBox({ result, onRetry }: Props) {
  if (!result.applies && result.reason === 'before_start') return null

  return (
    <div className={styles.box} data-testid="hours-box">
      <h4 className="t-label">Productive hours</h4>
      {result.applies ? (
        <>
          {result.lines.length > 0 && (
            <ul className={styles.lines}>
              {result.lines.map((line) => (
                <Line key={line.dealId} line={line} />
              ))}
            </ul>
          )}
          {result.note && <p className="t-caption prose">{result.note}</p>}
          {result.note === UNREACHABLE && (
            <div>
              <button className="button button--quiet" onClick={onRetry} type="button">
                Try again
              </button>
            </div>
          )}
        </>
      ) : (
        <p className="t-body">{result.message}</p>
      )}
    </div>
  )
}

// A flagged line says so in words, not only in its border: one of the owners
// is colourblind (global constraint, "not by colour alone").
function Line({ line }: { line: HoursLine }) {
  return (
    <li className={line.flagged ? `${styles.line} ${styles.flagged}` : styles.line} data-testid="hours-line">
      <span className={styles.name}>{line.name}</span>
      <span className="numeric">{`${fmt(line.budgetedHours)}h budgeted`}</span>
      <span className="numeric">{`${fmt(line.workedHours)}h worked`}</span>
      <span className="numeric">{signedHours(line.diffHours)}</span>
      {line.flagged && <strong className={styles.flag}>Outside ±6h</strong>}
    </li>
  )
}

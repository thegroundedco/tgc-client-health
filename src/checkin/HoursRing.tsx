import { clockHours, ringPercent } from './hoursFromBudgets'
import styles from './HoursRing.module.css'

type Props = { workedMinutes: number; budgetedMinutes: number }

// Brief 2026-11-05 A. Inline SVG: a hairline track and an arc filled by
// worked / budgeted, starting at twelve o'clock, in the risk colour once worked
// passes budgeted. pathLength 100 makes the dash pattern the percentage itself.
// role="img" with a spoken label, since the ring alone carries no words.
export function HoursRing({ workedMinutes, budgetedMinutes }: Props) {
  const percent = ringPercent(workedMinutes, budgetedMinutes)
  const over = workedMinutes > budgetedMinutes
  const spoken = (minutes: number) => clockHours(minutes).replace(/ h$/, '')
  return (
    <svg
      aria-label={`${spoken(workedMinutes)} of ${spoken(budgetedMinutes)} budgeted hours`}
      className={styles.ring}
      data-over={over ? 'true' : 'false'}
      role="img"
      viewBox="0 0 40 40"
    >
      <circle className={styles.track} cx="20" cy="20" pathLength={100} r="16" />
      {percent > 0 && (
      <circle
        className={over ? `${styles.fill} ${styles.over}` : styles.fill}
        cx="20"
        cy="20"
        data-testid="hours-ring-fill"
        pathLength={100}
        r="16"
        strokeDasharray={`${percent} 100`}
        transform="rotate(-90 20 20)"
      />
      )}
    </svg>
  )
}

import { describeChange, formatChange } from '../lib/scoreChange'
import type { ScoreChange } from '../lib/scoreChange'
import styles from './ChangeMark.module.css'

const DIRECTION_CLASS: Record<ScoreChange['direction'], string> = {
  up: styles.up,
  down: styles.down,
  same: styles.same,
}

// The glyph alone, for the board card's bucket letters, where six "▲ +0.33"
// marks would not fit under six bars. "=" for no change, so a flat bucket
// still says so rather than drawing nothing.
const GLYPH: Record<ScoreChange['direction'], string> = {
  up: '▲',
  down: '▼',
  same: '=',
}

// "▲ +0.33" as visible text, for the check-in screen and the card's overall.
// Without a label the words are the content, read as they stand. With one
// ("Overall up 0.33 from September") the mark is an image named by it, for a
// screen reader, and the same sentence is its hover title.
export function ChangeText({ change, label }: { change: ScoreChange; label?: string }) {
  return (
    <span
      aria-label={label}
      className={`${styles.change} ${DIRECTION_CLASS[change.direction]} numeric`}
      data-direction={change.direction}
      data-testid="score-change"
      role={label === undefined ? undefined : 'img'}
      title={label}
    >
      {formatChange(change)}
    </span>
  )
}

// The glyph alone, with the whole sentence in aria-label and title: "Communication
// up 0.33 from September". `since` is the previous month's long name.
export function ChangeArrow({ change, label, since }: { change: ScoreChange; label: string; since: string }) {
  const description = describeChange(label, change, since)
  return (
    <span
      aria-label={description}
      className={`${styles.change} ${DIRECTION_CLASS[change.direction]}`}
      data-direction={change.direction}
      data-testid="change-arrow"
      role="img"
      title={description}
    >
      {GLYPH[change.direction]}
    </span>
  )
}

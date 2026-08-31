import { useRef } from 'react'
import { flushSync } from 'react-dom'
import { SCORE_VALUES } from '../lib/scoreMath'
import type { Question } from '../lib/buckets'
import styles from './QuestionRow.module.css'

type Props = {
  question: Question
  value: number | undefined
  lastValue: number | null
  disabled: boolean
  onChange: (value: number) => void
  onClear: () => void
}

// One question. Lighter than the PillarRow it replaces: no hint (buckets.ts's
// Question carries a prompt and nothing else) and no per-question anchors (§7 --
// one legend for the screen, because 17 questions times three anchors is 51
// pieces of copy nobody has written, and the questions are already specific
// statements). The bucket section is the bordered card; this is a plain row
// inside it, because 17 bordered cards is a scroll rather than a screen.
export function QuestionRow({ question, value, lastValue, disabled, onChange, onClear }: Props) {
  // Derived from the question key so they are unique on a page rendering 17 of
  // these, and stable across renders.
  const labelId = `question-${question.key}-label`

  // Clear's button unmounts the instant it fires (it only renders while
  // value !== undefined), taking focus with it. An element detached while
  // focused hands focus to <body>, so without somewhere to send it the very
  // next Tab would restart at the top of the document instead of continuing in
  // this row. The first radio is never unmounted, so it is always a valid
  // target, and it is where the person is likely headed next: they just cleared
  // a score and the next move is to pick a different one.
  const firstRadio = useRef<HTMLInputElement>(null)

  function handleClear() {
    // flushSync, because the ORDER matters and the default order is wrong.
    // onClear() only queues the parent's state update, so without this the
    // focus() below runs while the cleared score is still checked in the DOM.
    // Browsers anchor a radio group's tab order to its checked radio, so the
    // group ends up anchored to a radio that is about to be unchecked, and the
    // next Tab stops on the score that was just cleared before leaving the row
    // -- reported by the owner, and confirmed by a test that reads which radios
    // are checked at the instant focus arrives.
    flushSync(() => {
      onClear()
    })
    firstRadio.current?.focus()
  }

  return (
    // A plain section with role="radiogroup", not a fieldset. A fieldset would
    // give the disabled cascade for free, but <legend> ignores parts of normal
    // layout and the workarounds are exactly the kind of thing that looks fine
    // in review and wrong on the deployed page. The inputs share a `name`, so
    // arrow-key navigation and the "3 of 5" announcement come from the native
    // radios either way.
    <section className={styles.row}>
      {/* The prompt is the group's accessible name. On a screen with 17 of
          these, a group named anything less specific is unnavigable. */}
      <p className="t-body" id={labelId}>
        {question.prompt}
      </p>

      <div className={styles.scale} role="radiogroup" aria-labelledby={labelId}>
        <div className={styles.options}>
          {SCORE_VALUES.map((score) => (
            <label className={styles.option} key={score}>
              <input
                ref={score === SCORE_VALUES[0] ? firstRadio : undefined}
                className={styles.input}
                type="radio"
                // Scoped to the question key. Two questions sharing a name would
                // be one radio group of ten across the screen, and scoring one
                // would silently unscore the other.
                name={`question-${question.key}`}
                value={score}
                checked={value === score}
                disabled={disabled}
                onChange={() => onChange(score)}
              />
              <span className={`${styles.face} numeric`}>{score}</span>
            </label>
          ))}
        </div>

        {/* A radio group cannot be unset by clicking, so without this a
            mis-click permanently turns an incomplete check-in into a complete
            one -- and the draft-versus-submitted distinction the board counts on
            is exactly what that would falsify. Rendered only when there is
            something to clear, so it is never a control that does nothing. */}
        {value !== undefined && (
          <button
            className={`button button--quiet ${styles.clear}`}
            type="button"
            disabled={disabled}
            onClick={handleClear}
          >
            Clear
          </button>
        )}

        {/* Last month, per question. §5.2: a score compared is a judgment and a
            score alone is a guess. Absent rather than zero when there was no
            check-in last month -- printing a 0 would invent a bad month. On the
            same line as the scale rather than below it, because 17 rows each
            carrying their own trailing line is a third of the screen's height
            spent on a value that is context, not the task. */}
        <p className={`t-caption ${styles.last}`}>
          {lastValue === null ? (
            'No score last month'
          ) : (
            <>
              Last month: <span className="numeric">{lastValue}</span>
            </>
          )}
        </p>
      </div>
    </section>
  )
}

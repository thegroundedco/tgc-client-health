import { useRef } from 'react'
import { flushSync } from 'react-dom'
import type { Question } from '../lib/buckets'
import styles from './YesNoRow.module.css'

type Props = {
  question: Question
  value: boolean | undefined
  lastValue: boolean | null
  disabled: boolean
  onChange: (value: boolean) => void
  onClear: () => void
}

const OPTIONS = [
  { label: 'Yes', value: true },
  { label: 'No', value: false },
] as const

// QuestionRow's two-option sibling, for Advocacy's four yes/no questions.
// A checkbox would be the obvious control for a yes/no answer, but this
// question has THREE states -- Yes, No, and unanswered -- and a checkbox has
// only two. A radio group is the smallest control that can leave both
// options unchecked, which is exactly the third state this needs.
export function YesNoRow({ question, value, lastValue, disabled, onChange, onClear }: Props) {
  // Derived from the question key so they are unique on a page rendering
  // several of these, and stable across renders.
  const labelId = `question-${question.key}-label`

  // Clear's button unmounts the instant it fires (it only renders while
  // value !== undefined), taking focus with it. An element detached while
  // focused hands focus to <body>, so without somewhere to send it the very
  // next Tab would restart at the top of the document instead of continuing in
  // this row. The first radio (Yes) is never unmounted, so it is always a
  // valid target, and it is where the person is likely headed next: they just
  // cleared an answer and the next move is to pick one.
  const firstRadio = useRef<HTMLInputElement>(null)

  function handleClear() {
    // flushSync, because the ORDER matters and the default order is wrong.
    // onClear() only queues the parent's state update, so without this the
    // focus() below runs while the cleared value is still checked in the DOM.
    // Browsers anchor a radio group's tab order to its checked radio, so the
    // group ends up anchored to a radio that is about to be unchecked, and the
    // next Tab stops on the value that was just cleared before leaving the row
    // -- reported by the owner (against QuestionRow's five-option group), and
    // confirmed here by a test that reads which radios are checked at the
    // instant focus arrives.
    flushSync(() => {
      onClear()
    })
    firstRadio.current?.focus()
  }

  return (
    // A plain section with role="radiogroup", not a fieldset, for the same
    // reason as QuestionRow: <legend> ignores parts of normal layout, and the
    // inputs share a `name`, so the native radios already give the group
    // semantics and arrow-key navigation for free.
    <section className={styles.row}>
      {/* The prompt is the group's accessible name. */}
      <p className="t-body" id={labelId}>
        {question.prompt}
      </p>

      <div className={styles.scale} role="radiogroup" aria-labelledby={labelId}>
        <div className={styles.options}>
          {OPTIONS.map((option) => (
            <label className={styles.option} key={String(option.value)}>
              <input
                ref={option.value ? firstRadio : undefined}
                className={styles.input}
                type="radio"
                // Scoped to the question key, as in QuestionRow: two questions
                // sharing a name would merge into a single radio group, and
                // answering one would silently unanswer the other.
                name={`question-${question.key}`}
                value={option.label.toLowerCase()}
                // === true / === false, not a truthiness check: value can be
                // false, and false is an answer, not an absence of one. A
                // truthy check here would leave "No" unchecked and read as
                // unanswered.
                checked={value === option.value}
                disabled={disabled}
                onChange={() => onChange(option.value)}
              />
              <span className={styles.face}>{option.label}</span>
            </label>
          ))}
        </div>

        {/* Rendered whenever there is an answer to clear -- including when
            that answer is false. `value ? … : …` or `if (value)` would hide
            Clear from anyone who answered No, stranding them with no way to
            get back to unanswered. */}
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

        {/* Last month, per question, as in QuestionRow. Absent rather than a
            rendered "No" when there was no check-in last month -- printing an
            answer would invent one for a month that never happened. */}
        <p className={`t-caption ${styles.last}`}>
          {lastValue === null ? (
            'No answer last month'
          ) : (
            <>
              Last month: <span>{lastValue ? 'Yes' : 'No'}</span>
            </>
          )}
        </p>
      </div>
    </section>
  )
}

import { useRef } from 'react'
import { ANCHOR_VALUES, PILLAR_DEFINITIONS } from '../lib/pillars'
import { SCORE_VALUES } from '../lib/score'
import type { Pillar } from '../lib/score'
import styles from './PillarRow.module.css'

type Props = {
  pillar: Pillar
  value: number | undefined
  lastValue: number | null
  disabled: boolean
  onChange: (value: number) => void
  onClear: () => void
}

export function PillarRow({ pillar, value, lastValue, disabled, onChange, onClear }: Props) {
  const definition = PILLAR_DEFINITIONS[pillar]
  // Ids are derived from the pillar key so they are unique on a page that
  // renders five of these, and stable across renders.
  const labelId = `pillar-${pillar}-label`
  const hintId = `pillar-${pillar}-hint`

  // Clear's button unmounts the instant it fires (it only renders while
  // value !== undefined), taking focus with it. An element detached while
  // focused hands focus to <body>, so without somewhere to send it the very
  // next Tab would restart at the top of the document instead of continuing
  // in this row. The first radio is never unmounted, so it is always a valid
  // target, and it is where the person is likely headed next: they just
  // cleared a score and the next move is to pick a different one.
  const firstRadio = useRef<HTMLInputElement>(null)

  function handleClear() {
    onClear()
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
      <div className={styles.heading}>
        <h3 className="t-body" id={labelId}>
          {definition.label}
        </h3>
        <p className="t-caption" id={hintId}>
          {definition.hint}
        </p>
      </div>

      <div
        className={styles.scale}
        role="radiogroup"
        aria-labelledby={labelId}
        aria-describedby={hintId}
      >
        {/* The five radios live in their own flex container so the gap between
            them can be tighter than the gap between this group and Clear -- see
            .options and .scale in the module: the group gap is what makes Clear
            read as a separate action rather than a sixth score, with no margin
            anywhere in this file. */}
        <div className={styles.options}>
          {SCORE_VALUES.map((score) => (
            <label className={styles.option} key={score}>
              <input
                ref={score === SCORE_VALUES[0] ? firstRadio : undefined}
                className={styles.input}
                type="radio"
                name={`pillar-${pillar}`}
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
            one -- and the draft-versus-submitted distinction the board counts
            on is exactly what that would falsify. Rendered only when there is
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
      </div>

      {/* The anchors, as a definition list because that is what they are: three
          scores and what each one means. Only 1, 3 and 5 are written; 2 and 4
          read as "between these two". */}
      <dl className={styles.anchors}>
        {ANCHOR_VALUES.map((anchor) => (
          <div className={styles.anchor} key={anchor}>
            <dt className={`t-label ${styles.anchorTerm} numeric`}>{anchor}</dt>
            <dd className="t-caption">{definition.anchors[anchor]}</dd>
          </div>
        ))}
      </dl>

      {/* Last month, per pillar. §5.2: a score compared is a judgment and a
          score alone is a guess. Absent rather than zero when there was no
          check-in last month -- printing a 0 would invent a bad month. */}
      <p className="t-caption">
        {lastValue === null ? (
          'No score last month'
        ) : (
          <>
            Last month: <span className="numeric">{lastValue}</span>
          </>
        )}
      </p>
    </section>
  )
}

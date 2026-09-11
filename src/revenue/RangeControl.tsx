import { formatPeriod } from '../lib/month'
import { availablePresets } from './rangeMath'
import type { Extent, RangePreset } from './rangeMath'
import styles from './Revenue.module.css'

// The page's date range, as a control. Slice 6h.
//
// It lives at PAGE level rather than inside Billing because it governs
// Concentration too, and a control that silently changes a section three
// screens further down reads as a bug the first time somebody notices it. The
// caption names what it covers for the same reason.
//
// A native <select> rather than a row of buttons, and that is capacity rather
// than taste: the Retention window control is four buttons and reads well;
// thirteen presets in a row would wrap into a wall. The board's month picker
// made the same call, and a native select is keyboard- and screen-reader
// correct without any work.
export function RangeControl({
  custom,
  extent,
  months,
  onCustom,
  onPreset,
  preset,
}: {
  custom: { from: string; to: string }
  extent: Extent
  /** Only the months that hold entries: a picker offering an empty month can blank the chart. */
  months: readonly string[]
  onCustom: (range: { from: string; to: string }) => void
  onPreset: (preset: RangePreset) => void
  preset: RangePreset
}) {
  const presets = availablePresets(extent)

  return (
    <div className={styles.controls} data-testid="range-control">
      <label className="t-caption">
        Range{' '}
        <select
          className={styles.rangeSelect}
          onChange={(event) => onPreset(event.target.value as RangePreset)}
          value={preset}
        >
          {presets.map((option) => (
            <option key={option.id} value={option.id}>
              {option.label}
            </option>
          ))}
        </select>
      </label>

      {preset === 'custom' && (
        <>
          <label className="t-caption">
            From{' '}
            <select
              className={styles.rangeSelect}
              onChange={(event) => onCustom({ ...custom, from: event.target.value })}
              value={custom.from}
            >
              {months.map((month) => (
                <option key={month} value={month}>
                  {formatPeriod(month)}
                </option>
              ))}
            </select>
          </label>
          <label className="t-caption">
            To{' '}
            <select
              className={styles.rangeSelect}
              onChange={(event) => onCustom({ ...custom, to: event.target.value })}
              value={custom.to}
            >
              {months.map((month) => (
                <option key={month} value={month}>
                  {formatPeriod(month)}
                </option>
              ))}
            </select>
          </label>
        </>
      )}

      {/* Named, because the range does NOT govern the whole page. Retention
          keeps its own windows and Tenure and Churn are not month-scoped at
          all; a reader who assumes otherwise would read three sections as
          answers to a question they never asked. */}
      <span className={`t-caption ${styles.controlScope}`}>
        Applies to Billing and Concentration
      </span>
    </div>
  )
}

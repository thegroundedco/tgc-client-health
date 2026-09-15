import styles from './Revenue.module.css'
import type { RetentionClient, RetentionRow } from './retentionMath'
import {
  AXIS_STEP,
  anchorAxis,
  axisMax,
  pointAnchors,
  retentionSeries,
  seriesGeometry,
  seriesSegments,
} from './retentionSeries'

// Retention at every anchor, as two lines.
//
// The section's headline reports ONE anchor. That figure moves sharply on a
// single client's invoice timing -- the caption beneath it says so -- and a
// reader has no way to tell an outlier from the pattern. This is that context.
//
// BOTH RATES ARE ALWAYS DRAWN, whatever the headline toggle says: the gap
// between net and gross IS the expansion story, and hiding one line to match a
// toggle would remove the comparison the chart exists to make.
//
// THE TWO LINES DIFFER BY STROKE STYLE AND CARRY THEIR OWN LABELS. The primary
// reader of this page is colourblind. A colour key would make the chart
// unreadable for him, which is the same reason the loss segments below share a
// colour and differ by texture.

const WIDTH = 640
const HEIGHT = 200
// The rate scale sits OUTSIDE the plot on the left and the series labels
// OUTSIDE it on the right. They shared the right margin once, and the tick
// nearest a line's end printed on top of that line's name -- which for a
// colourblind reader is the only thing saying which line is which.
const PAD_LEFT = 36
const PAD_RIGHT = 44 // room for the end labels
const PAD_TOP = 8
const TICK_GAP = 8
const LABEL_GAP = 4
// NRR and GRR are equal whenever nothing expanded, which is common rather than
// exotic -- two months of the real data do it. Equal rates put both labels on
// the same baseline, and the pair reads as one smudge.
const LABEL_MIN_SEPARATION = 14

export function RetentionChart({
  clients,
  months,
  rows,
}: {
  clients: readonly RetentionClient[]
  months: number
  rows: readonly RetentionRow[]
}) {
  // Two lists, one pass each. `anchors` is where a point MAY exist; `axis` is
  // every calendar month between the first and the last, so a month nobody
  // entered keeps its width and the line breaks across it.
  const anchors = pointAnchors(rows, months)
  const axis = anchorAxis(anchors)
  const points = retentionSeries(clients, rows, anchors, months)
  if (points.length === 0) return null

  const max = axisMax(points)
  const plotWidth = WIDTH - PAD_LEFT - PAD_RIGHT
  const plotHeight = HEIGHT - PAD_TOP
  const segments = seriesSegments(points, axis)
  const geometry = seriesGeometry(segments, axis, max, plotWidth, plotHeight)

  // Ticks as NUMBERS, rendered through interpolation below. A literal "25%"
  // typed into this markup is exactly what tests/revenueLiterals.test.ts
  // forbids: a percentage that looks computed and is not.
  const ticks: number[] = []
  for (let value = 0; value <= max; value += AXIS_STEP) ticks.push(value)

  const last = points[points.length - 1]
  const y = (rate: number) => PAD_TOP + plotHeight - (rate * 100 / max) * plotHeight

  // GRR can never exceed NRR -- it is the same sum with growth capped away --
  // so NRR is the upper label whenever the two must be prised apart.
  let nrrLabelY = y(last.nrr)
  let grrLabelY = y(last.grr)
  if (grrLabelY - nrrLabelY < LABEL_MIN_SEPARATION) {
    const middle = (nrrLabelY + grrLabelY) / 2
    nrrLabelY = middle - LABEL_MIN_SEPARATION / 2
    grrLabelY = middle + LABEL_MIN_SEPARATION / 2
  }

  return (
    <figure className={styles.retentionChart}>
      <svg
        aria-label="Retention over time"
        role="img"
        viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
      >
        {ticks.map((tick) => (
          <g key={tick}>
            <line
              className={tick === 100 ? styles.retentionKeptAll : styles.retentionGrid}
              x1={PAD_LEFT}
              x2={PAD_LEFT + plotWidth}
              y1={PAD_TOP + plotHeight - (tick / max) * plotHeight}
              y2={PAD_TOP + plotHeight - (tick / max) * plotHeight}
            />
            <text
              className={styles.retentionTick}
              x={PAD_LEFT - TICK_GAP}
              y={PAD_TOP + plotHeight - (tick / max) * plotHeight}
            >
              {tick}%
            </text>
          </g>
        ))}

        {geometry.grr.map((points_, index) => (
          <polyline
            className={styles.retentionGrr}
            data-testid="retention-series-grr"
            key={`grr-${index}`}
            points={points_}
            transform={`translate(${PAD_LEFT} ${PAD_TOP})`}
          />
        ))}
        {geometry.nrr.map((points_, index) => (
          <polyline
            className={styles.retentionNrr}
            data-testid="retention-series-nrr"
            key={`nrr-${index}`}
            points={points_}
            transform={`translate(${PAD_LEFT} ${PAD_TOP})`}
          />
        ))}

        <text
          className={styles.retentionEndLabel}
          x={PAD_LEFT + plotWidth + LABEL_GAP}
          y={nrrLabelY}
        >
          NRR
        </text>
        <text
          className={styles.retentionEndLabel}
          x={PAD_LEFT + plotWidth + LABEL_GAP}
          y={grrLabelY}
        >
          GRR
        </text>
      </svg>
      <figcaption className="t-caption">
        Each point is a different set of clients, not one group followed over time. Read the band,
        not the line.
      </figcaption>
    </figure>
  )
}

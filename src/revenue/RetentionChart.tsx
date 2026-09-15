import styles from './Revenue.module.css'
import type { RetentionClient, RetentionRow } from './retentionMath'
import {
  AXIS_STEP,
  axisMax,
  candidateAnchors,
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
const PAD_RIGHT = 44 // room for the end labels
const PAD_TOP = 8

export function RetentionChart({
  clients,
  months,
  rows,
}: {
  clients: readonly RetentionClient[]
  months: number
  rows: readonly RetentionRow[]
}) {
  const anchors = candidateAnchors(rows, months)
  const points = retentionSeries(clients, rows, months)
  if (points.length === 0) return null

  const max = axisMax(points)
  const plotWidth = WIDTH - PAD_RIGHT
  const plotHeight = HEIGHT - PAD_TOP
  const segments = seriesSegments(points, anchors)
  const geometry = seriesGeometry(segments, anchors, max, plotWidth, plotHeight)

  // Ticks as NUMBERS, rendered through interpolation below. A literal "25%"
  // typed into this markup is exactly what tests/revenueLiterals.test.ts
  // forbids: a percentage that looks computed and is not.
  const ticks: number[] = []
  for (let value = 0; value <= max; value += AXIS_STEP) ticks.push(value)

  const last = points[points.length - 1]
  const y = (rate: number) => PAD_TOP + plotHeight - (rate * 100 / max) * plotHeight

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
              x1={0}
              x2={plotWidth}
              y1={PAD_TOP + plotHeight - (tick / max) * plotHeight}
              y2={PAD_TOP + plotHeight - (tick / max) * plotHeight}
            />
            <text
              className={styles.retentionTick}
              x={plotWidth + 4}
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
            transform={`translate(0 ${PAD_TOP})`}
          />
        ))}
        {geometry.nrr.map((points_, index) => (
          <polyline
            className={styles.retentionNrr}
            data-testid="retention-series-nrr"
            key={`nrr-${index}`}
            points={points_}
            transform={`translate(0 ${PAD_TOP})`}
          />
        ))}

        <text className={styles.retentionEndLabel} x={plotWidth + 4} y={y(last.nrr)}>
          NRR
        </text>
        <text className={styles.retentionEndLabel} x={plotWidth + 4} y={y(last.grr)}>
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

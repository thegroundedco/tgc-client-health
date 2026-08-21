import type { Pillar } from './score'

// The rubric, as code rather than as a table. Slice 1 spec §9 records the
// reason `pillar_definitions` is deferred: the wording has changed zero times
// since v1 and the five pillars are settled, so a table would buy a
// deploy-free edit nobody has needed yet.
//
// Anchors are written for 1, 3 and 5 only. That is v1's rubric unchanged: 2 and
// 4 read as "between these two", which is how a five-point scale with three
// written anchors is meant to work.

export type AnchorValue = 1 | 3 | 5

export type PillarDefinition = {
  label: string
  hint: string
  anchors: Record<AnchorValue, string>
}

export const ANCHOR_VALUES: readonly AnchorValue[] = [1, 3, 5]

export const PILLAR_DEFINITIONS: Record<Pillar, PillarDefinition> = {
  relationship: {
    label: 'Relationship',
    hint: 'Reply speed, meeting attendance, engagement in reviews',
    anchors: {
      1: 'Slow or no replies; skips meetings without notice; disengaged in reviews.',
      3: 'Responds within a normal window; attends most meetings; engages when prompted.',
      5: 'Fast, proactive replies; full engagement; actively drives reviews and planning.',
    },
  },
  delivery: {
    label: 'Delivery',
    hint: 'Revision cycles, approval turnaround, on-time rate',
    anchors: {
      1: 'Excessive revision cycles; slow approvals; frequently late.',
      3: 'Normal number of revisions; approvals move at the expected pace; mostly on time.',
      5: 'Minimal revisions needed; fast approvals; consistently on time or early.',
    },
  },
  financial: {
    label: 'Financial',
    hint: 'Payment timeliness, scope-to-budget balance',
    anchors: {
      1: 'Late or overdue payments; scope regularly exceeds budget without resolution.',
      3: 'Payments generally on time; scope mostly tracks to budget.',
      5: 'Payments always on time; scope and budget well-aligned or growing profitably.',
    },
  },
  sentiment: {
    label: 'Sentiment',
    hint: 'Tone in calls/email, unprompted feedback, advocacy',
    anchors: {
      1: 'Frustrated or critical tone; complaints; no positive feedback.',
      3: 'Neutral, professional tone; no strong signal either way.',
      5: 'Warm tone; unprompted praise; refers business or advocates for TGC.',
    },
  },
  growth: {
    label: 'Growth',
    hint: 'Are we achieving their goals? Scope/spend trend',
    anchors: {
      1: 'Goals not being met; scope or spend shrinking or at risk.',
      3: 'Goals partially met; scope and spend roughly flat.',
      5: 'Goals clearly being met; scope and spend expanding.',
    },
  },
}

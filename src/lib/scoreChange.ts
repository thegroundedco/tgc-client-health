// Month-over-month change in a score: the owner's "Shopify little green and red
// arrows" (brief 2026-11-04, part B). Pure, so the check-in screen and the
// board card draw the same arrow from the same arithmetic.
//
// Colour is never the only signal (Nick is colourblind): every string here
// carries an arrow glyph and a sign, or says it in words.

export type ScoreChange = { direction: 'up' | 'down' | 'same'; delta: number }

// Null when either month has no score: a missing month is not a zero, and an
// arrow against it would invent a rise or a fall that never happened.
export function scoreChange(now: number | null, last: number | null): ScoreChange | null {
  if (now === null || last === null) return null
  const difference = now - last
  // Rounded on the magnitude, so +0.005 and -0.005 round the same way, and the
  // + 0 turns a rounded -0 into a plain 0. Scores are stored to two places, so
  // a difference that rounds to zero is no change at all.
  const delta = (Math.sign(difference) * Math.round(Math.abs(difference) * 100)) / 100 + 0
  if (delta === 0) return { direction: 'same', delta: 0 }
  return { direction: delta > 0 ? 'up' : 'down', delta }
}

const UP = '▲'
const DOWN = '▼'
// A true minus sign, not a hyphen: same width as the plus, so a column of
// changes lines up, and a screen reader says "minus".
const MINUS = '−'

// "▲ +0.33", "▼ −0.50", "no change".
export function formatChange(change: ScoreChange): string {
  if (change.direction === 'same') return 'no change'
  const size = Math.abs(change.delta).toFixed(2)
  return change.direction === 'up' ? `${UP} +${size}` : `${DOWN} ${MINUS}${size}`
}

// The spoken form, for an aria-label or a title: "Communication up 0.33 from
// September". `since` is the previous period's month name.
export function describeChange(label: string, change: ScoreChange, since: string): string {
  if (change.direction === 'same') return `${label} unchanged from ${since}`
  return `${label} ${change.direction} ${Math.abs(change.delta).toFixed(2)} from ${since}`
}

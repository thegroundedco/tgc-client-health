// Money, in cents, everywhere. A number of dollars never exists as a variable
// in this codebase -- it exists as a string a person typed and as a string a
// person reads, and both conversions happen here.
//
// Its own module rather than a helper inside the grid, for the same reason
// tenureMath is not inside Tenure.tsx: the traps here are invisible until a
// value is unusual, and a component is not where anybody looks for them.

// The ceiling of a Postgres `integer` column, in cents: $21,474,836.47. A value
// past it is accepted by the browser, sent, and rejected by the database as an
// int4 overflow -- surfacing as an error about numeric range on a screen about
// a retainer. Refused here instead, where the field can say so.
export const MAX_CENTS = 2147483647

export function formatMoney(cents: number): string {
  const dollars = cents / 100
  // Whole dollars lose the .00 tail. Retainers here are round numbers, and a
  // column where every figure ends in .00 spends two characters per row saying
  // nothing. A figure WITH cents keeps both digits, because dropping them there
  // would round a real amount on screen.
  const hasCents = cents % 100 !== 0
  return dollars.toLocaleString('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: hasCents ? 2 : 0,
    maximumFractionDigits: hasCents ? 2 : 0,
  })
}

// Null means "this is not a number I will accept", and the caller shows the
// person their field. It never means zero: an empty field IS zero, deliberately,
// so that saving a month does not require typing 0 into every row with no
// project work.
export function parseMoney(input: string): number | null {
  const trimmed = input.trim()
  if (trimmed === '') return 0

  // Strip what people type around a number, not inside it. Commas and a leading
  // dollar sign are formatting; anything else left over is a refusal below.
  const stripped = trimmed.replace(/^\$/, '').replace(/,/g, '')

  // Anchored, and no sign accepted: the column is `>= 0`, so a negative is
  // refused here rather than at the database. Up to two decimal places, because
  // a third is a fraction of a cent -- rounding it would turn a typo into a
  // number the person never entered.
  if (!/^\d+(\.\d{1,2})?$/.test(stripped)) return null

  // Rounded, not truncated, and via a string-free path: 19.99 * 100 is
  // 1998.9999999999998 in IEEE 754, which truncation would turn into $19.98.
  const cents = Math.round(Number(stripped) * 100)
  if (!Number.isFinite(cents) || cents > MAX_CENTS) return null
  return cents
}

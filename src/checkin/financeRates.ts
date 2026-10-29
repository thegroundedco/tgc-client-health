// Finance rates the check-in uses to work out "Rack rate" and "Rate vs last month"
// from revenue. Owner: Josh (account management), confirmed 2026-10-29.
// - Foundation: $10,000 total over the stint; often paid in monthly instalments.
// - Grow: $5,000 per month.
// - Scale: $2,500 minimum project payments; not modelled, because nothing in the
//   data marks a Scale project.

export const FOUNDATION_RATE_CENTS = 1_000_000 // total over the Foundation stint
export const GROW_RATE_CENTS = 500_000 // per month
export const RATE_TOLERANCE = 0.05 // inclusive

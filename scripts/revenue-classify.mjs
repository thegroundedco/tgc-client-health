// Decides whether a ledger line is retainer or project work, by reading runs of
// consecutive billing months across the WHOLE span it is given.
//
// WHY THIS EXISTS. Until slice 6i this rule lived in the owner's head and in a
// hand-built map of names. That is workable for one year and wrong for two: a
// client billing November, December, January, February is two short project runs
// when each year is classified alone, and one four-month retainer when the years
// are read together. Only the second reading is true, and no map keyed by name
// can express it.
//
// Separated from the script that reads files for the same reason
// revenue-import-plan.mjs is: this decision moves real money between two columns
// of a table with no delete policy, and an untested contract is not a contract.

// The month after this one. String arithmetic on the year and month numbers,
// never a parsed Date: `new Date('2025-03-01')` is UTC midnight, which in any
// western zone is the last day of February.
function nextMonth(period) {
  const year = Number(period.slice(0, 4))
  const month = Number(period.slice(5, 7))
  const total = year * 12 + month // already the 0-based index of the NEXT month
  return `${Math.floor(total / 12)}-${String((total % 12) + 1).padStart(2, '0')}-01`
}

/**
 * @param {{ lines: { period: string, name: string, cents: number }[],
 *           anchor: string,
 *           overrides?: Record<string, 'retainer'|'project'|'exclude'>,
 *           minRun?: number }} input
 */
export function classifyRuns({ lines, anchor, overrides = {}, minRun = 3 }) {
  // A BILLING month is one with money in it. A line of exactly zero is a real
  // thing in this ledger -- the owner's rule writes "billed nothing" as an
  // explicit 0 -- and it is not a month of work, so it breaks a run rather than
  // continuing one. Counting it would turn a client who left in March into a
  // retainer on the strength of months they were not billed for.
  const monthsByName = new Map()
  for (const { name, period, cents } of lines) {
    if (cents <= 0) continue
    if (!monthsByName.has(name)) monthsByName.set(name, new Set())
    monthsByName.get(name).add(period)
  }

  const kinds = {}
  const runs = {}
  const decisions = []

  for (const [name, monthSet] of monthsByName) {
    const months = [...monthSet].sort()
    let best = { from: months[0], to: months[0], length: 1 }
    let start = months[0]
    let length = 1
    for (let i = 1; i < months.length; i++) {
      if (months[i] === nextMonth(months[i - 1])) length += 1
      else {
        start = months[i]
        length = 1
      }
      if (length > best.length) best = { from: start, to: months[i], length }
    }
    runs[name] = best

    // "Still running at the anchor" is a SEPARATE test from the run length, and
    // it has to be: a client who signed two months ago and is still billing is a
    // retainer nobody would call project work, and the length rule alone cannot
    // see them until their third invoice.
    const openAtAnchor = monthSet.has(anchor)
    const override = overrides[name]
    const kind = override ?? (best.length >= minRun ? 'retainer' : openAtAnchor ? 'retainer' : 'project')
    const why = override ? 'override' : best.length >= minRun ? 'run' : openAtAnchor ? 'anchor' : 'short'

    kinds[name] = kind
    decisions.push({ name, kind, why })
  }

  // Names the owner excluded or classified that never appear in the lines: kept,
  // so an exclusion survives a re-import rather than quietly lapsing when a name
  // drops out of the sheet.
  for (const [name, kind] of Object.entries(overrides)) {
    if (kinds[name] !== undefined) continue
    kinds[name] = kind
    decisions.push({ name, kind, why: 'override' })
  }

  decisions.sort((left, right) => left.name.localeCompare(right.name))
  return { kinds, runs, decisions }
}

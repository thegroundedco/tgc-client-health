// A period is always the first day of a month, formatted YYYY-MM-01, which is
// what the checkins.period date column stores.
export function periodFor(date: Date): string {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  return `${year}-${month}-01`
}

export function currentPeriod(): string {
  return periodFor(new Date())
}

export function addMonths(period: string, delta: number): string {
  const [year, month] = period.split('-').map(Number)
  // Constructing from parts lets Date normalise the year rollover for us.
  return periodFor(new Date(year, month - 1 + delta, 1))
}

export function formatPeriod(period: string): string {
  const [year, month] = period.split('-').map(Number)
  return new Date(year, month - 1, 1).toLocaleDateString('en-US', {
    month: 'long',
    year: 'numeric',
  })
}

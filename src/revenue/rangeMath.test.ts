import { describe, expect, it } from 'vitest'
import { RANGE_PRESETS, availablePresets, resolveRange } from './rangeMath'

// Anchor is the latest month holding an entry, earliest the first -- the same
// two facts the chart already derives from the rows. Every preset resolves
// against THOSE, never against today's calendar: on the 2nd of a month almost
// nothing is entered, and a calendar-anchored "last 3 months" would quietly
// include a month nobody has typed.
const DATA = { anchor: '2026-09-01', earliest: '2026-01-01' }

describe('resolveRange — rolling windows', () => {
  it('counts back inclusively from the anchor', () => {
    expect(resolveRange('last3', DATA)).toEqual({ from: '2026-07-01', to: '2026-09-01' })
    expect(resolveRange('last6', DATA)).toEqual({ from: '2026-04-01', to: '2026-09-01' })
  })

  it('crosses a year boundary without losing a month', () => {
    // The case the owner raised: "later months that span across a new year".
    expect(resolveRange('last6', { anchor: '2027-02-01', earliest: '2025-01-01' })).toEqual({
      from: '2026-09-01',
      to: '2027-02-01',
    })
  })

  it('stops at the earliest month with data rather than inventing history', () => {
    // Twelve months back from September 2026 is October 2025, which predates
    // the records. Padding it would draw empty columns for months the agency
    // has no data for, which reads as "we billed nothing then".
    expect(resolveRange('last12', DATA)).toEqual({ from: '2026-01-01', to: '2026-09-01' })
  })
})

describe('resolveRange — calendar shapes', () => {
  it('reads quarters off the anchor’s year', () => {
    expect(resolveRange('q1', DATA)).toEqual({ from: '2026-01-01', to: '2026-03-01' })
    expect(resolveRange('q2', DATA)).toEqual({ from: '2026-04-01', to: '2026-06-01' })
  })

  it('clamps a half or a quarter that runs past the data', () => {
    // Q3 is July to September and the anchor IS September, so it happens to
    // fit. H2 runs to December, which has not happened -- showing October to
    // December as "not entered" would be a claim about months that are still
    // in the future.
    expect(resolveRange('q3', DATA)).toEqual({ from: '2026-07-01', to: '2026-09-01' })
    expect(resolveRange('h2', DATA)).toEqual({ from: '2026-07-01', to: '2026-09-01' })
    expect(resolveRange('year', DATA)).toEqual({ from: '2026-01-01', to: '2026-09-01' })
  })

  it('clamps the start of a shape that begins before the records', () => {
    expect(resolveRange('h1', { anchor: '2026-09-01', earliest: '2026-03-01' })).toEqual({
      from: '2026-03-01',
      to: '2026-06-01',
    })
  })

  it('is year to date, not year to today', () => {
    expect(resolveRange('ytd', DATA)).toEqual({ from: '2026-01-01', to: '2026-09-01' })
  })
})

describe('resolveRange — everything', () => {
  it('spans exactly what has been entered', () => {
    expect(resolveRange('all', DATA)).toEqual({ from: '2026-01-01', to: '2026-09-01' })
  })
})

describe('resolveRange — what it refuses', () => {
  // A preset whose months lie entirely outside the data is not a narrow view,
  // it is an empty one. Returning null lets the control leave it out rather
  // than offer a choice that blanks the chart.
  it('returns null for a quarter the data does not reach', () => {
    expect(resolveRange('q4', DATA)).toBeNull()
    expect(resolveRange('q1', { anchor: '2026-09-01', earliest: '2026-07-01' })).toBeNull()
  })

  it('returns null when there is no data at all', () => {
    expect(resolveRange('all', { anchor: null, earliest: null })).toBeNull()
    expect(resolveRange('last3', { anchor: null, earliest: null })).toBeNull()
  })

  it('returns null for custom, which the caller supplies itself', () => {
    expect(resolveRange('custom', DATA)).toBeNull()
  })
})

describe('availablePresets', () => {
  it('offers only the presets that resolve to something', () => {
    const ids = availablePresets(DATA).map((preset) => preset.id)

    expect(ids).toContain('all')
    expect(ids).toContain('q1')
    // Q4 2026 has not happened.
    expect(ids).not.toContain('q4')
    // Custom is always offered: it is the escape hatch from the presets.
    expect(ids).toContain('custom')
  })

  it('offers custom and nothing else when there is no data', () => {
    expect(availablePresets({ anchor: null, earliest: null }).map((p) => p.id)).toEqual([
      'custom',
    ])
  })

  it('keeps the presets in the declared order, so the control does not reshuffle', () => {
    const ids = availablePresets(DATA).map((preset) => preset.id)
    const declared = RANGE_PRESETS.map((preset) => preset.id).filter((id) => ids.includes(id))

    expect(ids).toEqual(declared)
  })

  it('dates the calendar shapes, which say nothing without a year', () => {
    // "Q1" in a list does not say WHICH Q1, and will say less the moment there
    // is more than one year of data. The rolling windows need no year: they
    // are relative by definition.
    const labels = new Map(availablePresets(DATA).map((p) => [p.id, p.label]))

    expect(labels.get('q1')).toBe('Q1 2026')
    expect(labels.get('h1')).toBe('First half 2026')
    expect(labels.get('ytd')).toBe('Year to date 2026')
    expect(labels.get('last3')).toBe('Last 3 months')
    expect(labels.get('all')).toBe('All time')
  })

  it('gives every preset a label that is not its own id', () => {
    for (const preset of RANGE_PRESETS) {
      expect(preset.label).not.toBe(preset.id)
      expect(preset.label.length).toBeGreaterThan(1)
    }
  })
})

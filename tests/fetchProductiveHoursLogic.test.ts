import { describe, expect, it } from 'vitest'
import {
  budgetsFromDeals,
  dealsUrl,
  isFixedMonthly,
  isPeriod,
  lastDayOf,
  redact,
  safeEqual,
} from '../supabase/functions/fetch-productive-hours/logic.ts'

const P = '2026-10-01'
const attrs = (budgeted_time: number | null, date: string, end_date: string | null) => ({
  budgeted_time,
  date,
  end_date,
})

describe('isFixedMonthly', () => {
  it.each([
    [attrs(1800, '2026-10-01', '2026-10-31'), true],
    [attrs(null, '2026-10-01', '2026-10-31'), false],
    [attrs(0, '2026-10-01', '2026-10-31'), false],
    [attrs(1800, '2026-10-01', null), false],
    [attrs(1800, '2026-09-21', '2026-10-31'), false],
    [attrs(1800, '2026-10-13', '2026-10-31'), true],
    [attrs(5400, '2026-10-01', '2026-12-31'), false],
    [attrs(1800, '2026-10-01', '2026-11-30'), false],
    [attrs(1800, '2026-11-01', '2026-11-30'), false],
  ])('%j -> %s', (a, expected) => {
    expect(isFixedMonthly(a, P)).toBe(expected)
  })
})

function deal(id: string, name: string, a: Record<string, unknown>, project = '900') {
  return { id, type: 'deals', attributes: { name, ...a }, relationships: { project: { data: { type: 'projects', id: project } } } }
}

describe('budgetsFromDeals', () => {
  const page = {
    data: [
      deal('1', 'Budget A', { date: '2026-10-01', end_date: '2026-10-31', budgeted_time: 1800, worked_time: 1500 }),
      deal('2', 'Budget B', { date: '2026-10-01', end_date: '2026-10-31', budgeted_time: 600, worked_time: null }, '901'),
      deal('3', 'Budget C', { date: '2026-10-01', end_date: null, budgeted_time: 2400, worked_time: 10 }),
      deal('4', 'Budget D', { date: '2026-10-01', end_date: '2026-12-31', budgeted_time: 5400, worked_time: 10 }),
    ],
    meta: { total_pages: 1 },
  }

  it('keeps only fixed monthly deals, copying minutes and the project id', () => {
    expect(budgetsFromDeals(page, P)).toEqual([
      {
        productive_deal_id: '1',
        productive_project_id: '900',
        name: 'Budget A',
        starts_on: '2026-10-01',
        ends_on: '2026-10-31',
        budgeted_minutes: 1800,
        worked_minutes: 1500,
      },
      {
        productive_deal_id: '2',
        productive_project_id: '901',
        name: 'Budget B',
        starts_on: '2026-10-01',
        ends_on: '2026-10-31',
        budgeted_minutes: 600,
        worked_minutes: 0,
      },
    ])
  })

  it('throws on a response that is not a deals page', () => {
    expect(() => budgetsFromDeals({ nope: 1 }, P)).toThrow()
    expect(() => budgetsFromDeals(null, P)).toThrow()
  })

  it('throws on a fixed deal with no project', () => {
    const bad = { data: [{ id: '9', attributes: { name: 'Budget Z', date: '2026-10-01', end_date: '2026-10-31', budgeted_time: 60, worked_time: 0 } }] }
    expect(() => budgetsFromDeals(bad, P)).toThrow()
  })
})

describe('dealsUrl', () => {
  it('builds the exact query', () => {
    expect(dealsUrl(['1', '2'], P, 1)).toBe(
      'https://api.productive.io/api/v2/deals?filter[type]=2&filter[project_id]=1,2' +
        '&filter[date][gt_eq]=2026-10-01&filter[date][lt_eq]=2026-10-31&include=project&page[size]=200&page[number]=1',
    )
  })
})

describe('lastDayOf', () => {
  it.each([
    ['2026-10-01', '2026-10-31'],
    ['2026-11-01', '2026-11-30'],
    ['2026-02-01', '2026-02-28'],
    ['2028-02-01', '2028-02-29'],
    ['2026-12-01', '2026-12-31'],
  ])('%s -> %s', (p, last) => {
    expect(lastDayOf(p)).toBe(last)
  })
})

describe('isPeriod', () => {
  it('accepts first-of-month dates only', () => {
    expect(isPeriod('2026-10-01')).toBe(true)
    expect(isPeriod('2026-10-02')).toBe(false)
    expect(isPeriod('2026-13-01')).toBe(false)
    expect(isPeriod(20261001)).toBe(false)
  })
})

describe('redact', () => {
  it('replaces every occurrence of every secret', () => {
    expect(redact('tok-abc failed for org-1; tok-abc again', ['tok-abc', 'org-1'])).toBe(
      '[redacted] failed for [redacted]; [redacted] again',
    )
  })
  it('ignores empty secrets', () => {
    expect(redact('hello', [''])).toBe('hello')
  })
})

describe('safeEqual', () => {
  it('compares whole strings', () => {
    expect(safeEqual('abc', 'abc')).toBe(true)
    expect(safeEqual('abc', 'abd')).toBe(false)
    expect(safeEqual('abc', 'abcd')).toBe(false)
    expect(safeEqual('', 'a')).toBe(false)
  })
})

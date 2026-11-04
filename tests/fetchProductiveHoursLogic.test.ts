import { readFileSync } from 'node:fs'
import { describe, expect, it, vi } from 'vitest'
import {
  RECORD_RPC,
  authorize,
  budgetsFromDeals,
  ProductiveError,
  dealsUrl,
  fetchAllBudgets,
  recordEach,
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

  // M1: a changed API is a failed fetch, never "no budget".
  it('throws ProductiveError on a deal with no date, or a date that is not a string', () => {
    const noDate = { data: [deal('5', 'Budget E', { end_date: '2026-10-31', budgeted_time: 1800, worked_time: 0 })] }
    const numDate = { data: [deal('5', 'Budget E', { date: 20261001, end_date: '2026-10-31', budgeted_time: 1800, worked_time: 0 })] }
    expect(() => budgetsFromDeals(noDate, P)).toThrow(ProductiveError)
    expect(() => budgetsFromDeals(numDate, P)).toThrow(ProductiveError)
  })

  it('throws ProductiveError when the budgeted_time key is missing or not a number', () => {
    const noKey = { data: [deal('6', 'Budget F', { date: '2026-10-01', end_date: '2026-10-31', worked_time: 0 })] }
    const text = { data: [deal('6', 'Budget F', { date: '2026-10-01', end_date: '2026-10-31', budgeted_time: '1800', worked_time: 0 })] }
    expect(() => budgetsFromDeals(noKey, P)).toThrow(ProductiveError)
    expect(() => budgetsFromDeals(text, P)).toThrow(ProductiveError)
  })

  it('still reads an explicit null budgeted_time as an open-hour deal, not an error', () => {
    const open = { data: [deal('7', 'Budget G', { date: '2026-10-01', end_date: '2026-10-31', budgeted_time: null, worked_time: 30 })] }
    expect(budgetsFromDeals(open, P)).toEqual([])
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

const okPage = (data: unknown[], total_pages?: number) => ({
  ok: true,
  status: 200,
  json: async () => (total_pages === undefined ? { data } : { data, meta: { total_pages } }),
})
const fixed = (id: string, project: string) =>
  deal(id, `Budget ${id}`, { date: '2026-10-01', end_date: '2026-10-31', budgeted_time: 60, worked_time: 1 }, project)

describe('fetchAllBudgets', () => {
  it('pages to meta.total_pages', async () => {
    const urls: string[] = []
    const pages = [okPage([fixed('1', '900')], 3), okPage([fixed('2', '900')], 3), okPage([fixed('3', '900')], 3)]
    const rows = await fetchAllBudgets(async (u) => pages[urls.push(u) - 1], ['900'], P)
    expect(urls).toHaveLength(3)
    expect(urls[2]).toContain('page[number]=3')
    expect(rows.map((r) => r.productive_deal_id)).toEqual(['1', '2', '3'])
  })
  it('stops after page 1 when there is no meta', async () => {
    let calls = 0
    const rows = await fetchAllBudgets(async () => (calls++, okPage([fixed('1', '900')])), ['900'], P)
    expect(calls).toBe(1)
    expect(rows).toHaveLength(1)
  })
  it('throws ProductiveError on a non-OK page', async () => {
    const bad = { ok: false, status: 503, json: async () => ({}) }
    await expect(fetchAllBudgets(async () => bad, ['900'], P)).rejects.toBeInstanceOf(ProductiveError)
  })
  it('throws on an unexpected body', async () => {
    const bad = { ok: true, status: 200, json: async () => ({ nope: 1 }) }
    await expect(fetchAllBudgets(async () => bad, ['900'], P)).rejects.toBeInstanceOf(ProductiveError)
  })
  it('throws on a deal from a project that was not requested, even on a later page', async () => {
    const pages = [okPage([fixed('1', '900')], 2), okPage([fixed('2', '777')], 2)]
    let i = 0
    await expect(fetchAllBudgets(async () => pages[i++], ['900'], P)).rejects.toThrow(/not requested/)
  })
})

describe('recordEach', () => {
  it('never records a client whose fetch throws, and carries on', async () => {
    const recorded: number[] = []
    const result = await recordEach(
      [[1, ['a']], [2, ['b']], [3, ['c']]],
      async (id) => {
        if (id === 2) throw new ProductiveError('boom')
        return []
      },
      async (id) => void recorded.push(id),
    )
    expect(recorded).toEqual([1, 3])
    expect(result).toEqual({ fetched: 2, failed: [2] })
  })
  it('counts a failed record as failed', async () => {
    const result = await recordEach(
      [[1, ['a']], [2, ['b']]],
      async () => [],
      async (id) => {
        if (id === 1) throw new Error('db')
      },
    )
    expect(result).toEqual({ fetched: 1, failed: [1] })
  })
})

// I5: the auth gate, as a pure decision. Every branch, and the deps it must
// not call on the way.
describe('authorize', () => {
  const SECRET = 'cron-secret-for-tests'
  function deps(over: { user?: string | null; canView?: boolean | Error } = {}) {
    return {
      cronSecret: SECRET,
      getUser: vi.fn(async (_jwt: string) => ('user' in over ? over.user! : 'user-1') as string | null),
      canViewRevenue: vi.fn(async () => ('canView' in over ? over.canView! : true)),
    }
  }
  const user = (authorization: string | null) => ({ authorization, cronHeader: null })

  it('lets a signed-in user who can see revenue through, passing the bare JWT', async () => {
    const d = deps()
    expect(await authorize(user('Bearer jwt-abc'), d)).toEqual({ mode: 'user', userId: 'user-1' })
    expect(d.getUser).toHaveBeenCalledWith('jwt-abc')
  })

  it.each([[null], [''], ['Bearer '], ['jwt-without-scheme'], ['Basic abc']])(
    'is 401 with no usable bearer token (%j), and never asks the auth server',
    async (authorization) => {
      const d = deps()
      expect(await authorize(user(authorization), d)).toEqual({ status: 401, error: 'Sign in to fetch hours.' })
      expect(d.getUser).not.toHaveBeenCalled()
      expect(d.canViewRevenue).not.toHaveBeenCalled()
    },
  )

  it('is 401 when the auth server does not accept the JWT', async () => {
    const d = deps({ user: null })
    expect(await authorize(user('Bearer expired'), d)).toEqual({ status: 401, error: 'Sign in to fetch hours.' })
    expect(d.canViewRevenue).not.toHaveBeenCalled()
  })

  it('is 403 when the user cannot see revenue', async () => {
    expect(await authorize(user('Bearer jwt'), deps({ canView: false }))).toEqual({
      status: 403,
      error: 'You cannot see hours.',
    })
  })

  it('is 500, not a refusal, when can_view_revenue fails', async () => {
    expect(await authorize(user('Bearer jwt'), deps({ canView: new Error('rpc broke') }))).toEqual({
      status: 500,
      error: 'rpc broke',
    })
  })

  it('is schedule mode with the exact cron secret, and asks nothing of the auth server', async () => {
    const d = deps()
    expect(await authorize({ authorization: null, cronHeader: SECRET }, d)).toEqual({ mode: 'schedule' })
    expect(d.getUser).not.toHaveBeenCalled()
  })

  it.each([[''], ['wrong'], [SECRET + 'x'], [SECRET.slice(1)]])(
    'is 401 for a wrong cron secret (%j), even alongside a valid user JWT',
    async (cronHeader) => {
      const d = deps()
      expect(await authorize({ authorization: 'Bearer jwt', cronHeader }, d)).toEqual({
        status: 401,
        error: 'Not allowed.',
      })
      expect(d.getUser).not.toHaveBeenCalled()
    },
  )

  it('is 401 for every cron header when the cron secret is unset', async () => {
    expect(await authorize({ authorization: null, cronHeader: '' }, { ...deps(), cronSecret: '' })).toEqual({
      status: 401,
      error: 'Not allowed.',
    })
  })
})

// I5: the rpc name the function calls is the function the migration creates.
describe('RECORD_RPC', () => {
  const FN = 'supabase/functions/fetch-productive-hours'
  const strip = (src: string) => src.replaceAll(/--[^\n]*/g, '')

  it('is the name of the migration function that takes (bigint, date, jsonb)', () => {
    const sql = strip(readFileSync('supabase/migrations/20261104120000_productive_hours.sql', 'utf8')).toLowerCase()
    const made = [...sql.matchAll(/create function public\.([a-z_]+)\s*\(\s*p_client_id bigint,\s*p_period date,\s*p_budgets jsonb\s*\)/g)]
    expect(made.map((m) => m[1])).toEqual([RECORD_RPC])
    expect(sql).toContain(`grant execute on function public.${RECORD_RPC}(bigint, date, jsonb) to service_role;`)
  })

  it('is what index.ts calls, and index.ts names the rpc nowhere else', () => {
    const index = readFileSync(`${FN}/index.ts`, 'utf8').replaceAll(/\/\/[^\n]*/g, '')
    expect(index).toMatch(/admin\.rpc\(RECORD_RPC,/)
    expect(index).not.toContain("'record_month_budgets'")
  })
})

// I5 / E2: index.ts decides auth only through authorize, and stops on its refusal;
// a browser never sends the cron header, so CORS does not allow it.
describe('index.ts wiring', () => {
  const index = readFileSync('supabase/functions/fetch-productive-hours/index.ts', 'utf8').replaceAll(/\/\/[^\n]*/g, '')

  it('returns authorize\'s refusal before reading the body', () => {
    const gate = index.indexOf("if ('status' in auth) return json(auth.status,")
    expect(index).toMatch(/const auth = await authorize\(/)
    expect(gate).toBeGreaterThan(-1)
    expect(gate).toBeLessThan(index.indexOf('await req.json()'))
    expect(index).not.toContain('safeEqual')
  })

  it('does not list x-hours-cron-secret in Access-Control-Allow-Headers', () => {
    const allow = /'Access-Control-Allow-Headers':\s*'([^']*)'/.exec(index)
    expect(allow).not.toBeNull()
    expect(allow![1].split(',').map((h) => h.trim())).toEqual(['authorization', 'x-client-info', 'apikey', 'content-type'])
  })
})

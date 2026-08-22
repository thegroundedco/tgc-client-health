import { describe, expect, it } from 'vitest'

// @ts-expect-error -- a .mjs script with no type declarations; scripts/ is in no
// tsconfig include, so tsc cannot type this import. The assertions below are the
// contract.
import { buildSql, parseRoster, STATUSES } from '../scripts/seed-clients.mjs'

// The fixtures here are deliberately fake. The real roster lives in
// clients.local.txt, which is gitignored, because this repository is public --
// so a test fixture must never quietly become the place the client list got
// committed. Anything that looks like a plausible agency client name is wrong
// in this file.
const FAKE = ['Alpha Fixture', 'Beta Fixture', "O'Fixture & Co."]

type Client = { name: string; status: string }

const parse = (text: string) => parseRoster(text) as Client[]
const sqlFor = (text: string) => buildSql(parse(text)) as string

// Strips `--` comments so the "this SQL contains no X" assertions below are
// about statements rather than prose. Without it, the generated file's own
// explanation of why it does not use `on conflict` trips the assertion that it
// does not use `on conflict` -- the same false positive the token gate has on
// comments, noted in the step 2 parked findings. Naive on purpose: it would
// also cut a `--` inside a client name, which no fixture here has.
const withoutComments = (sql: string) => sql.replaceAll(/--[^\n]*/g, '')

describe('parsing the local roster file', () => {
  it('takes one name per line and defaults them to active', () => {
    expect(parse(FAKE.join('\n'))).toEqual([
      { name: 'Alpha Fixture', status: 'active' },
      { name: 'Beta Fixture', status: 'active' },
      { name: "O'Fixture & Co.", status: 'active' },
    ])
  })

  it('ignores blank lines and comments, and trims', () => {
    const text = ['# a comment', '', '   Alpha Fixture   ', '   ', '# another', 'Beta Fixture'].join(
      '\n',
    )
    expect(parse(text).map((c) => c.name)).toEqual(['Alpha Fixture', 'Beta Fixture'])
  })

  it('accepts an explicit status after a pipe', () => {
    expect(parse('Alpha Fixture | former')).toEqual([{ name: 'Alpha Fixture', status: 'former' }])
  })

  it('offers exactly the statuses the check constraint allows', () => {
    // If the migration's check constraint ever gains or loses a value, this is
    // the line that has to change with it -- the generated SQL would otherwise
    // fail at the database with a constraint violation instead of here.
    expect(STATUSES).toEqual(['active', 'paused', 'cancelled', 'former'])
    for (const status of STATUSES as string[]) {
      expect(parse(`Alpha Fixture | ${status}`)[0].status).toBe(status)
    }
  })

  it('refuses a status the database would reject', () => {
    // 'inactive' specifically: it is the word that reads correct and is not one
    // of the four the constraint allows.
    expect(() => parse('Alpha Fixture | inactive')).toThrow(/not one of/)
  })

  it('refuses a duplicate rather than collapsing it', () => {
    // The SQL is idempotent, so a duplicated line would produce a correct
    // result and no complaint anywhere. That makes a typo invisible, which is
    // the reason this throws.
    expect(() => parse('Alpha Fixture\nalpha fixture')).toThrow(/duplicate of line 1/)
  })

  it('refuses an empty name, a control character, and a second pipe', () => {
    expect(() => parse('| active')).toThrow(/name is empty/)
    // A newline cannot reach this check -- the parser splits on newlines
    // first -- so these are the ones that can: bytes that survive a paste
    // out of a spreadsheet and then sit invisibly inside a client's name.
    expect(() => parse('Alpha\u0000Fixture')).toThrow(/control character/)
    expect(() => parse('Alpha\u001bFixture')).toThrow(/control character/)
    expect(() => parse('Alpha\u007fFixture')).toThrow(/control character/)
    expect(() => parse('Alpha\tFixture')).toThrow(/control character/)
    expect(() => parse('Alpha | active | extra')).toThrow(/more than one/)
  })

  it('refuses an input with nothing in it', () => {
    // Rather than writing SQL that runs cleanly and seeds nothing.
    expect(() => parse('')).toThrow(/Refusing/)
    expect(() => parse('# only a comment\n\n')).toThrow(/Refusing/)
  })
})

describe('the generated seed SQL', () => {
  const sql = sqlFor(FAKE.join('\n'))

  it("escapes a name's apostrophe by doubling it", () => {
    // The one input in this file that would produce broken SQL if it were
    // interpolated raw.
    expect(sql).toContain("('O''Fixture & Co.', 'active')")
    expect(sql).not.toContain("('O'Fixture")
  })

  it('guards every row on the name instead of relying on a constraint', () => {
    // public.clients has no unique index on name, so `on conflict` has nothing
    // to key on and a plain insert run twice would duplicate the whole roster.
    expect(sql).toContain('where not exists (')
    expect(sql).toContain('select 1 from public.clients c where c.name = v.name')
    expect(withoutComments(sql)).not.toMatch(/on conflict/i)
  })

  it('asserts the expected count so "inserted 0" cannot read as success', () => {
    expect(sql).toContain(`if present <> ${FAKE.length} then`)
    expect(sql).toContain('raise exception')
  })

  it('ends with a select, because a NOTICE is easy to miss', () => {
    // "Success. No rows returned" in the SQL editor looks exactly like having
    // done nothing, which is the defect this whole slice exists to fix.
    expect(sql.trimEnd().endsWith('order by name;')).toBe(true)
    expect(sql).toContain('select id, name, status, created_at')
  })

  it('never updates or removes anything', () => {
    // A re-run must not reset a status somebody changed in the app, and a seed
    // must never be able to delete client history.
    const statements = withoutComments(sql)
    expect(statements).not.toMatch(/\bdelete\b/i)
    expect(statements).not.toMatch(/\bdrop\b/i)
    expect(statements).not.toMatch(/\btruncate\b/i)
    expect(statements).not.toMatch(/^\s*update\s/im)
  })

  it('carries one values row per client and nothing more', () => {
    const rows = [...sql.matchAll(/^ {4}\('.*'\)[,)]?$/gm)]
    expect(rows).toHaveLength(FAKE.length)
  })
})

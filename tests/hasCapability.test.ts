import { readdirSync, readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

// What this test does and does not do. It pins the text of has_capability, its
// grants, the six replacement policies and the ORDER of the three sections, so
// an edit to the migration has to change this file too and think about it. It
// proves NOTHING about what Postgres does with any of it -- nothing without a
// database can. That is `npm run verify:privileges`, which becomes
// `authenticated` and exercises the policies for real.
//
// The order assertions are the ones that matter most. The outage this project
// has already measured -- a policy-referenced definer function not granted to
// `authenticated`, failing 42501 for every signed-in user -- is shaped like a
// missing or misplaced line, not like a typo in a predicate.
const MIGRATIONS = 'supabase/migrations'

function migration(suffix: string): string {
  const names = readdirSync(MIGRATIONS).filter((name) => name.endsWith(suffix))
  // Exactly one, or the assertions below could be reading a file nobody meant.
  expect(names, `migrations ending in ${suffix}`).toHaveLength(1)
  return readFileSync(`${MIGRATIONS}/${names[0]}`, 'utf8')
}

// Every assertion about presence, absence and order runs against statements
// rather than prose. The migration's comments name the old policies and the old
// function on purpose -- they explain what is being replaced -- so an
// assert-absence run against the raw text would trip on the explanation. This
// project has hit that defect twice now.
function withoutComments(sql: string): string {
  return sql.replaceAll(/--[^\n]*/g, '')
}

// The conversion table from Slice 2 design §6, as data, so a mixed-up pair --
// checkins_insert gating on view_scores, say -- fails on its own row rather than
// hiding inside one big string match.
const POLICIES = [
  { name: 'clients_select_view_scores', table: 'public.clients', capability: 'view_scores' },
  { name: 'clients_insert_manage_clients', table: 'public.clients', capability: 'manage_clients' },
  { name: 'clients_update_manage_clients', table: 'public.clients', capability: 'manage_clients' },
  { name: 'checkins_select_view_scores', table: 'public.checkins', capability: 'view_scores' },
  { name: 'checkins_insert_edit_scores', table: 'public.checkins', capability: 'edit_scores' },
  { name: 'checkins_update_edit_scores', table: 'public.checkins', capability: 'edit_scores' },
]

const OLD_POLICIES = [
  'clients_select_active_users',
  'clients_insert_active_users',
  'clients_update_active_users',
  'checkins_select_active_users',
  'checkins_insert_active_users',
  'checkins_update_active_users',
]

const EXPECTED_DROPS = [
  ...OLD_POLICIES.map((name) => `drop policy ${name}`),
  'drop function private.is_active_user()',
]

describe('the has_capability migration', () => {
  const sql = migration('_has_capability.sql')
  const statements = withoutComments(sql)

  describe('the function', () => {
    it('is security definer, search-path-pinned and stable', () => {
      expect(statements).toContain('security definer')
      // The empty search_path is what stops a name below resolving through a
      // caller-controlled path. A definer function without it is the classic
      // search-path hijack.
      expect(statements).toContain("set search_path = ''")
      expect(statements).toContain('stable')
    })

    it('takes the capability and never the subject', () => {
      // The signature is the security property. A version taking a user id
      // would let any signed-in browser enumerate everybody's permissions.
      expect(statements).toContain('create function private.has_capability(wanted text)')

      const params = statements.match(/create function private\.has_capability\(([^)]*)\)/)
      expect(params, 'the has_capability parameter list').not.toBeNull()
      // One parameter, and it is the capability name. Asserting the absence of a
      // comma is what makes this a check on arity rather than on spelling.
      expect(params![1]).toBe('wanted text')
      expect(params![1]).not.toContain(',')
      expect(params![1]).not.toContain('uuid')
    })

    it('resolves the caller from auth.uid(), not from an argument', () => {
      expect(statements).toContain('where p.id = (select auth.uid())')
      expect(statements).toContain('and p.is_active')
    })
  })

  describe('the grants', () => {
    it('revokes from public as well as anon', () => {
      // `public` is the load-bearing half: Postgres grants EXECUTE on every new
      // function to PUBLIC, so anon reaches it implicitly unless public is named.
      expect(statements).toContain(
        'revoke execute on function private.has_capability(text) from public, anon;',
      )
    })

    it('grants execute to authenticated', () => {
      // The outage assertion. Postgres checks EXECUTE on a policy-referenced
      // function at query time against the role running the query, so without
      // this line every policy below fails 42501 for every signed-in user.
      expect(statements).toContain(
        'grant execute on function private.has_capability(text) to authenticated;',
      )
    })
  })

  describe('the six policies', () => {
    it.each(POLICIES)('$name gates on $capability', ({ name, table, capability }) => {
      const created = statements.match(
        new RegExp(`create policy ${name}\\b[\\s\\S]*?;`),
      )
      expect(created, `create policy ${name}`).not.toBeNull()

      const body = created![0]
      expect(body).toContain(`on ${table}`)
      expect(body).toContain('to authenticated')
      expect(body).toContain(`private.has_capability('${capability}')`)

      // Every capability name that appears in this policy is the right one, so a
      // policy naming two capabilities cannot pass on the first one.
      const named = body.match(/has_capability\('([a-z_]+)'\)/g) ?? []
      expect(named.length, `capability references in ${name}`).toBeGreaterThan(0)
      for (const reference of named) {
        expect(reference).toBe(`has_capability('${capability}')`)
      }
    })

    it('gives every update policy both using and with check', () => {
      // Or a row could be written into a state its writer could not have read.
      for (const name of ['clients_update_manage_clients', 'checkins_update_edit_scores']) {
        const body = statements.match(new RegExp(`create policy ${name}\\b[\\s\\S]*?;`))![0]
        expect(body, `${name} using`).toContain('using (')
        expect(body, `${name} with check`).toContain('with check (')
      }
    })

    it('creates no policy under an old active-users name', () => {
      // The old names are dropped and are named in the comments; what must not
      // exist is a CREATE under one of them.
      for (const name of OLD_POLICIES) {
        expect(statements, `create policy ${name}`).not.toContain(`create policy ${name}`)
      }
    })

    it('leaves no policy referencing the old helper', () => {
      // If one did, the drop at the end of the file would fail -- Postgres
      // refuses to drop a function a policy depends on. Better to fail here.
      const created = statements.match(/create policy[\s\S]*?;/g) ?? []
      expect(created).toHaveLength(POLICIES.length)
      for (const body of created) {
        expect(body).not.toContain('is_active_user')
      }
    })
  })

  describe('the order, which is the whole risk', () => {
    it('creates and grants the function before any policy names it', () => {
      const created = statements.indexOf('create function private.has_capability')
      const granted = statements.indexOf('grant execute on function private.has_capability')
      const firstPolicy = statements.indexOf('create policy')

      expect(created).toBeGreaterThan(-1)
      expect(granted).toBeGreaterThan(created)
      expect(firstPolicy).toBeGreaterThan(granted)
    })

    it('drops the old helper after the last policy is created', () => {
      const lastPolicy = statements.lastIndexOf('create policy')
      const dropped = statements.indexOf('drop function private.is_active_user')

      expect(lastPolicy).toBeGreaterThan(-1)
      expect(dropped).toBeGreaterThan(lastPolicy)
    })
  })

  it('drops exactly the six policies and the one function', () => {
    // A migration against the tables holding the real roster and its history, on
    // a database with no backups. The set is asserted exactly, so a stray drop
    // of anything at all fails rather than passing a keyword check.
    const drops = (statements.match(/drop [^;]*/g) ?? []).map((drop) =>
      drop.replaceAll(/\s+/g, ' ').replace(/ on public\.\w+$/, '').trim(),
    )
    expect(drops.toSorted()).toEqual(EXPECTED_DROPS.toSorted())
    expect(statements).not.toMatch(/\bdrop table\b/i)
    expect(statements).not.toMatch(/\bcascade\b/i)
    expect(statements).not.toMatch(/\bdelete\b/i)
    expect(statements).not.toMatch(/\btruncate\b/i)
  })
})

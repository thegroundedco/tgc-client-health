import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

// The People/Access screen had TWO layout rules -- .screen and .nav -- where the
// Clients roster beside it had nine. Its own header said it was copied from that
// file "verbatim for now"; it copied the two rules that existed at the time, the
// other screen grew a real layout, and this one never did. Everything below
// .screen was default block flow, which is the whole explanation for the
// stacking the owner photographed on 2026-09-02.
//
// jsdom computes no layout, so none of this is visible to a DOM test. That file
// asserts the MARKUP gives these rules something to act on; this asserts the
// rules exist and do what the markup assumes.
//
// Lives outside src/ because it needs node:fs, and tsconfig.app.json gives src/
// no Node types -- the same reason tests/tokens.test.ts lives here.

const ROOT = join(import.meta.dirname, '..')

function stylesheet(...parts: string[]): string {
  // Comments stripped first: these files explain their rules in prose that
  // names the properties being described, so a check against the raw text would
  // match the explanation rather than the code.
  return readFileSync(join(ROOT, ...parts), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '')
}

const USERS = stylesheet('src', 'users', 'UsersAdmin.module.css')
const INVITE = stylesheet('src', 'users', 'InviteForm.module.css')

function ruleBody(code: string, selector: string, file: string): string {
  const start = code.indexOf(`${selector} {`)
  if (start === -1) throw new Error(`no rule for "${selector}" in ${file}`)
  const end = code.indexOf('}', start)
  if (end === -1) throw new Error(`rule "${selector}" is never closed in ${file}`)
  return code.slice(start, end)
}

describe('the people screen stylesheet', () => {
  // A test that silently found nothing would pass forever. This project has
  // already shipped one check that reported success by finding no data.
  it('is read, not silently skipped', () => {
    expect(USERS.length).toBeGreaterThan(500)
    expect(USERS).toContain('.screen {')
  })

  // The specific regression: this file having barely any rules is the defect.
  it('has a real layout rather than the two rules it was left with', () => {
    const rules = USERS.match(/^\.[a-zA-Z]+ \{/gm) ?? []
    expect(rules.length).toBeGreaterThanOrEqual(6)
  })

  it('lays each person out as a card, not a run of stacked paragraphs', () => {
    const row = ruleBody(USERS, '.row', 'UsersAdmin.module.css')
    expect(row).toContain('border')
    expect(row).toContain('var(--rule-hairline)')
    expect(row).toContain('var(--surface-raised)')
  })

  // The two halves of a row. Without a rule keeping them apart the role select
  // and the button wrap under the address at every width.
  it('keeps identity and controls apart within the row', () => {
    expect(ruleBody(USERS, '.row', 'UsersAdmin.module.css')).toContain('justify-content')
    expect(ruleBody(USERS, '.actions', 'UsersAdmin.module.css')).toContain('display: flex')
    expect(ruleBody(USERS, '.identity', 'UsersAdmin.module.css')).toContain('column')
  })

  // Every colour must come from the semantic layer. tests/brandLayering.test.ts
  // bans var(--brand-*) here; this additionally catches a raw literal, which
  // tests/tokens.test.ts would also catch but which is cheap to state locally.
  it('names no colour of its own', () => {
    expect(USERS).not.toMatch(/#[0-9a-fA-F]{3,8}\b/)
    expect(INVITE).not.toMatch(/#[0-9a-fA-F]{3,8}\b/)
  })
})

describe('the invite form stylesheet', () => {
  it('is read, not silently skipped', () => {
    expect(INVITE.length).toBeGreaterThan(200)
  })

  // The photographed defect: a bare <label> and <input> are inline siblings, so
  // they rendered as "EMAIL ADDRESS[input]ROLE[select]" running together on one
  // line with nothing between them.
  it('stacks each label above its own control', () => {
    const block = ruleBody(INVITE, '.fieldBlock', 'InviteForm.module.css')
    expect(block).toContain('display: flex')
    expect(block).toContain('column')
    expect(block).toContain('gap')
  })

  it('lays the form out as a column rather than a run of inline elements', () => {
    const form = ruleBody(INVITE, '.form', 'InviteForm.module.css')
    expect(form).toContain('display: flex')
    expect(form).toContain('column')
  })
})

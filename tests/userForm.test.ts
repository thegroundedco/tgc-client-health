import { describe, expect, it } from 'vitest'
import {
  ASSIGNABLE_ROLES,
  inviteProblems,
  invitePayload,
  normalizeEmail,
  roleLabel,
  sortProfiles,
  writeFailureText,
} from '../src/users/userForm.ts'
import type { AdminProfile } from '../src/users/userForm.ts'

const profile = (over: Partial<AdminProfile>): AdminProfile => ({
  id: 'p1', email: 'a@example.com', full_name: null,
  role: 'viewer', is_active: true, updated_at: '2026-08-25T00:00:00Z', ...over,
})

describe('normalizeEmail', () => {
  it('lowercases and trims, because the check constraint requires lowercase', () => {
    expect(normalizeEmail('  Nick@TheGroundedCompany.COM ')).toBe('nick@thegroundedcompany.com')
  })
})

describe('inviteProblems', () => {
  it('refuses an empty address', () => {
    expect(inviteProblems({ email: '   ', role: 'viewer' }, [])).toEqual([
      { field: 'email', text: 'An invitation needs an email address.' },
    ])
  })

  it('refuses an address that already has an account, and says where to go instead', () => {
    const existing = [profile({ email: 'nick@thegroundedcompany.com' })]
    const problems = inviteProblems({ email: 'Nick@TheGroundedCompany.com', role: 'viewer' }, existing)
    expect(problems).toHaveLength(1)
    expect(problems[0].field).toBe('email')
    expect(problems[0].text).toContain('already has an account')
  })

  it('accepts a fresh address', () => {
    expect(inviteProblems({ email: 'new@example.com', role: 'admin' }, [])).toEqual([])
  })

  it('refuses a role the permission model does not know', () => {
    const problems = inviteProblems({ email: 'new@example.com', role: 'sales' }, [])
    expect(problems.map((p) => p.field)).toContain('role')
  })
})

describe('invitePayload', () => {
  it('normalizes the address, because the check constraint refuses uppercase', () => {
    expect(invitePayload({ email: ' New@Example.COM ', role: 'viewer' }))
      .toEqual({ email: 'new@example.com', role: 'viewer' })
  })
})

describe('writeFailureText', () => {
  it('translates the guard trigger self-edit refusal', () => {
    const text = writeFailureText('cannot change your own role or active status', 'you')
    expect(text).toContain('own access')
    expect(text).toContain('Another admin')
  })

  it('translates a duplicate invitation', () => {
    expect(writeFailureText('duplicate key value violates unique constraint "allowed_emails_pkey"', 'a@b.com'))
      .toContain('already been invited')
  })

  it('translates an RLS refusal into a sentence about permission', () => {
    expect(writeFailureText('new row violates row-level security policy', 'a@b.com'))
      .toContain('not allowed')
  })

  it('passes an unrecognised message through rather than swallowing it', () => {
    expect(writeFailureText('some novel database complaint', 'a@b.com'))
      .toContain('some novel database complaint')
  })
})

describe('sortProfiles', () => {
  it('puts inactive accounts first, because they are the ones needing action', () => {
    const rows = [
      profile({ id: '1', email: 'active@x.com', is_active: true }),
      profile({ id: '2', email: 'pending@x.com', is_active: false }),
    ]
    expect(sortProfiles(rows).map((r) => r.id)).toEqual(['2', '1'])
  })

  it('does not mutate its argument, because React compares by identity', () => {
    const rows = [profile({ id: '1', is_active: true }), profile({ id: '2', is_active: false })]
    const before = [...rows]
    sortProfiles(rows)
    expect(rows).toEqual(before)
  })
})

describe('ASSIGNABLE_ROLES and roleLabel', () => {
  it('offers all three roles, admin included', () => {
    expect([...ASSIGNABLE_ROLES].toSorted()).toEqual(['account_manager', 'admin', 'viewer'])
  })

  it('hands an unrecognised role straight back rather than relabelling it', () => {
    expect(roleLabel('sales')).toBe('sales')
  })
})

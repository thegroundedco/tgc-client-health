import { createClient } from '@supabase/supabase-js'
import { describe, expect, it } from 'vitest'

// Reads the same .env.local the app uses. These tests hit the real project;
// they are the only way to know the policies and grants actually work.
//
// The values arrive on import.meta.env, not process.env. On this toolchain
// (Vite 8 / Vitest 4) .env.local IS loaded under the default 'test' mode, so
// these run as part of a plain `npm test`. `--mode development` is kept in the
// documented command as belt-and-braces: older Vite skipped .env.local in test
// mode, and the flag makes the intent explicit either way.
const env = import.meta.env as unknown as Record<string, string | undefined>
const url = env.VITE_SUPABASE_URL
const key = env.VITE_SUPABASE_PUBLISHABLE_KEY

// Any uuid that cannot exist in auth.users. profiles.id is a foreign key to
// auth.users(id), so even a total grant-and-policy failure could not leave this
// row behind — the write probes below cannot pollute the live project. That FK,
// not any assertion here, is what makes these probes safe to run against a real
// database.
const ABSENT_ID = '00000000-0000-0000-0000-000000000000'

// Unconditional, and deliberately outside the runIf block below. The security
// suite skips itself when .env.local is absent, which would otherwise make a run
// that verified nothing look identical to a run that verified everything. This
// test turns that silence into a failure.
it('has the credentials needed to verify the boundary against the real project', () => {
  expect(
    url,
    'VITE_SUPABASE_URL is missing, so the RLS suite below skipped and NOTHING about ' +
      'the security boundary was verified. Copy .env.example to .env.local and fill it in.',
  ).toBeTruthy()
  expect(
    key,
    'VITE_SUPABASE_PUBLISHABLE_KEY is missing, so the RLS suite below skipped and ' +
      'NOTHING about the security boundary was verified.',
  ).toBeTruthy()
})

// Built lazily, not at collection time. Vitest still executes a
// `describe.runIf(false)` callback in order to register its skipped tests, so
// constructing the client at describe scope would throw during collection when
// .env.local is absent — failing the file with an opaque module error and
// preventing the credentials test above from ever reporting its message.
const makeClient = () =>
  createClient(url!, key!, {
    auth: { persistSession: false, autoRefreshToken: false },
  })

// Annotated from makeClient rather than from createClient directly:
// ReturnType<typeof createClient> resolves the generics to their defaults and
// erases the row types, which makes .insert()/.update() arguments `never`.
let cached: ReturnType<typeof makeClient> | undefined
const client = () => (cached ??= makeClient())

describe.runIf(url && key)('RLS with no session', () => {

  // Every case below is strict about *how* the denial happens, not merely that
  // no rows came back. The brief's original assertion — `expect(error ? [] :
  // data).toEqual([])` — accepted either a denial or an empty set, and is not
  // kept here because it is strictly weaker than the select case below and
  // passes in precisely the situation we most need to catch: `anon` holding full
  // table-level SELECT/INSERT/UPDATE/DELETE with only RLS filtering the rows.
  // That is the state this table actually shipped in before
  // 20260820225903_restrict_profiles_grants.sql, and the lenient assertion did
  // not notice.
  //
  // The discriminator is the *kind* of error. Denial at the privilege layer
  // reports 42501 "permission denied for table profiles". A table that is
  // granted but merely filtered by RLS reports something else entirely: an empty
  // 200 for select and update, or 42501 "new row violates row-level security
  // policy" for insert — same code, different message, which is why the message
  // is asserted and not just the code.
  //
  // Observed behaviour at the time of writing, for all four verbs:
  //   HTTP 401, error.code '42501', message 'permission denied for table profiles'
  const expectGrantLayerDenial = (
    error: { code?: string; message?: string } | null,
  ) => {
    expect(error).not.toBeNull()
    expect(error?.code).toBe('42501')
    // Not 'new row violates row-level security policy' — that would mean the
    // grant is present and only RLS is holding the line.
    expect(error?.message).toMatch(/permission denied for table/i)
  }

  it('refuses an unauthenticated select at the grant layer', async () => {
    const { data, error, status } = await client().from('profiles').select('id')
    expectGrantLayerDenial(error)
    expect(status).toBe(401)
    expect(data).toBeNull()
  })

  it('refuses an unauthenticated insert', async () => {
    const { data, error } = await client()
      .from('profiles')
      .insert({ id: ABSENT_ID, email: 'probe@example.com' })
      .select()
    expectGrantLayerDenial(error)
    expect(data).toBeNull()
  })

  // NOTE ON SCOPE, because this test used to claim more than it delivers.
  //
  // The vulnerability this project shipped with was an *authenticated* user
  // PATCHing role/is_active on their own row. This test cannot reach that: with
  // no session the request is denied at the grant layer on `anon` and never gets
  // near column privileges, so the payload below is incidental rather than the
  // thing being proven. Every test in this file uses the anonymous client, so a
  // future migration re-adding `grant update on public.profiles to
  // authenticated` would leave all of them green.
  //
  // What actually guards that: `npm run verify:privileges`, which asserts the
  // column matrix directly and fails if authenticated can write role or
  // is_active. The signed-in behavioural version — sign in, PATCH your own row,
  // watch full_name succeed while role fails — belongs in Task 4, where a
  // session exists.
  it('refuses an unauthenticated update', async () => {
    const { data, error } = await client()
      .from('profiles')
      .update({ role: 'admin', is_active: true })
      .eq('id', ABSENT_ID)
      .select()
    expectGrantLayerDenial(error)
    expect(data).toBeNull()
  })

  it('refuses an unauthenticated delete', async () => {
    const { data, error } = await client()
      .from('profiles')
      .delete()
      .eq('id', ABSENT_ID)
      .select()
    expectGrantLayerDenial(error)
    expect(data).toBeNull()
  })
})

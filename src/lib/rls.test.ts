import { createClient } from '@supabase/supabase-js'
import { describe, expect, it } from 'vitest'

// Reads the same .env.local the app uses. These tests hit the real project;
// they are the only way to know the policies and grants actually work.
//
// The values arrive on import.meta.env, not process.env. On this toolchain
// (Vite 8 / Vitest 4) .env.local IS loaded under the default 'test' mode, so
// these run as part of a plain `npm test`. `--mode development` is kept in the
// documented command as belt-and-braces: older Vite skipped .env.local in test
// mode, and the flag makes the intent explicit either way. If the file is
// absent the suite skips rather than fails, which is why CI must not treat a
// skip as proof that RLS was verified.
const env = import.meta.env as unknown as Record<string, string | undefined>
const url = env.VITE_SUPABASE_URL
const key = env.VITE_SUPABASE_PUBLISHABLE_KEY

// Any uuid that cannot exist in auth.users. profiles.id is a foreign key to
// auth.users(id), so even a total grant-and-policy failure could not leave this
// row behind — the write probes below cannot pollute the live project.
const ABSENT_ID = '00000000-0000-0000-0000-000000000000'

describe.runIf(url && key)('RLS with no session', () => {
  const anon = createClient(url!, key!, {
    auth: { persistSession: false, autoRefreshToken: false },
  })

  // The invariant that matters most, asserted leniently: however the denial is
  // produced, an unauthenticated caller must never receive a profile row.
  it('returns no profile rows to an unauthenticated caller', async () => {
    const { data, error } = await anon.from('profiles').select('id')
    // Either an explicit denial or an empty set is acceptable. Rows are not.
    expect(error ? [] : data).toEqual([])
  })

  // The four cases below are deliberately strict, because the lenient
  // assertion above is not sufficient on its own: it passes just as happily
  // when `anon` holds full table-level SELECT/INSERT/UPDATE/DELETE and only RLS
  // is filtering the rows. That is exactly the state this table shipped in
  // before 20260820225903_restrict_profiles_grants.sql, and the lenient test
  // did not notice.
  //
  // The discriminator is the *kind* of error. Denial at the privilege layer
  // reports 42501 "permission denied for table profiles". A table that is
  // granted but merely filtered by RLS reports something else entirely: an
  // empty 200 for select and update, or 42501 "new row violates row-level
  // security policy" for insert. Asserting on the message therefore pins the
  // denial to the grant layer, and these tests fail loudly if privileges are
  // ever widened again — including by a future migration that forgets that
  // Postgres privileges are additive.
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
    const { data, error, status } = await anon.from('profiles').select('id')
    expectGrantLayerDenial(error)
    expect(status).toBe(401)
    expect(data).toBeNull()
  })

  it('refuses an unauthenticated insert', async () => {
    const { data, error } = await anon
      .from('profiles')
      .insert({ id: ABSENT_ID, email: 'probe@example.com' })
      .select()
    expectGrantLayerDenial(error)
    expect(data).toBeNull()
  })

  // The write that the original grants would have allowed a signed-in user to
  // make against their own row. An anonymous caller must not get near it.
  it('refuses an unauthenticated update, including a self-promotion attempt', async () => {
    const { data, error } = await anon
      .from('profiles')
      .update({ role: 'admin', is_active: true })
      .eq('id', ABSENT_ID)
      .select()
    expectGrantLayerDenial(error)
    expect(data).toBeNull()
  })

  it('refuses an unauthenticated delete', async () => {
    const { data, error } = await anon
      .from('profiles')
      .delete()
      .eq('id', ABSENT_ID)
      .select()
    expectGrantLayerDenial(error)
    expect(data).toBeNull()
  })

  // Nothing above may leave a trace, whatever the outcome.
  it('leaves no row behind after the write probes', async () => {
    const { data, error } = await anon
      .from('profiles')
      .select('id')
      .eq('id', ABSENT_ID)
    expect(error ? [] : data).toEqual([])
  })
})

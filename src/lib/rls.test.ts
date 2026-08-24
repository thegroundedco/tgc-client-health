import { createClient } from '@supabase/supabase-js'
import { describe, expect, it } from 'vitest'

// Reads the same .env.local the app uses. These tests hit the real project.
//
// WHAT THIS FILE CAN AND CANNOT PROVE. Every test here uses the ANONYMOUS key,
// because that is the only session a test can have without a human clicking a
// magic link in a mailbox. `anon` holds nothing on any table, so every probe
// below is refused at the GRANT layer and no row-security policy is ever
// consulted. That is worth asserting -- it is the outer boundary, and this
// project once shipped with it open -- but it is emphatically not a test of the
// policies. All six policies on public.clients and public.checkins could be
// rewritten as `using (true)` and every test in this file would still pass.
//
// The policy predicates are asserted in `scripts/verify-privileges.sql` section
// 10 (`npm run verify:privileges`), which becomes the `authenticated` role
// inside the database and checks the behaviour: an active account sees the rows
// it should, a subject with no profile row sees zero rows and is refused an
// insert, and a claim-less request sees zero rows. It lives there because
// `set local role` exists only inside Postgres, and a test that needs a human
// to click an emailed link is not a test.
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

// clients.id and checkins.id are identity columns starting at 1, so a negative
// id cannot exist. The update and delete probes below target it so that, in the
// event the grant layer ever fails open, they still cannot touch a real row.
const ABSENT_CLIENT_ID = -1

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
  // What actually guards that: `npm run verify:privileges`, whose section 2
  // asserts the column matrix directly and fails if authenticated can write
  // role or is_active, and whose section 10 asserts what a signed-in subject can
  // actually see. The signed-in behavioural version of THIS probe — sign in,
  // PATCH your own row, watch full_name succeed while role fails — still needs a
  // real session and is not automated anywhere.
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

  // --------------------------------------------------------------------------
  // public.clients and public.checkins. Same strict shape as the profiles cases
  // above, and deliberately NOT the weaker `expect(error ? [] : data)
  // .toEqual([])` form the plan proposed: that assertion passes when anon holds
  // full table privileges and only RLS is filtering, which is precisely the
  // state this project shipped in once already.
  //
  // ONE IMPORTANT DIFFERENCE from the profiles cases, which is why the insert
  // probes below matter more. profiles.id is a foreign key to auth.users, so a
  // total grant-and-policy failure there still could not leave a row behind.
  // clients has no such backstop: a real row would persist in the live project
  // if the grant layer ever opened up. The 'Should not exist' name is chosen so
  // that a leak is greppable, and the task report records the
  // `select count(*) from public.clients where name = 'Should not exist'` that
  // confirms zero after this suite runs.
  //
  // Observed at the time of writing, for every verb on both tables:
  //   HTTP 401, error.code '42501', message 'permission denied for table <t>'
  // anon holds nothing on either table, so denial happens at the privilege
  // layer and the RLS policies are never consulted.

  it('refuses an unauthenticated select on clients at the grant layer', async () => {
    const { data, error, status } = await client().from('clients').select('id')
    expectGrantLayerDenial(error)
    expect(status).toBe(401)
    expect(data).toBeNull()
  })

  it('refuses an unauthenticated select on checkins at the grant layer', async () => {
    const { data, error, status } = await client().from('checkins').select('id')
    expectGrantLayerDenial(error)
    expect(status).toBe(401)
    expect(data).toBeNull()
  })

  // Asserts the write is REFUSED, not merely that a later read comes back
  // empty. A read returning no rows is not evidence about a write, because anon
  // cannot read either way.
  it('refuses an unauthenticated insert on clients', async () => {
    const { data, error } = await client()
      .from('clients')
      .insert({ name: 'Should not exist' })
      .select()
    expectGrantLayerDenial(error)
    expect(data).toBeNull()
  })

  it('refuses an unauthenticated insert on checkins', async () => {
    const { data, error } = await client()
      .from('checkins')
      .insert({ client_id: 1, period: '2026-08-01', relationship: 5 })
      .select()
    expectGrantLayerDenial(error)
    expect(data).toBeNull()
  })

  it('refuses an unauthenticated update on clients', async () => {
    const { data, error } = await client()
      .from('clients')
      .update({ name: 'Should not exist' })
      .eq('id', ABSENT_CLIENT_ID)
      .select()
    expectGrantLayerDenial(error)
    expect(data).toBeNull()
  })

  // The verb most worth probing on checkins: `authenticated` legitimately holds
  // UPDATE there (the board upserts, which needs INSERT and UPDATE on the same
  // statement), so checkins is where an over-broad grant is likeliest to be
  // written by hand. This asserts anon is denied at the privilege layer, not
  // merely that it changed no rows.
  it('refuses an unauthenticated update on checkins', async () => {
    const { data, error } = await client()
      .from('checkins')
      .update({ relationship: 5 })
      .eq('id', ABSENT_CLIENT_ID)
      .select()
    expectGrantLayerDenial(error)
    expect(data).toBeNull()
  })

  // No role reachable from the browser has DELETE on either table at all, so
  // this is denied even for a signed-in active user. Asserted here because a
  // future migration adding `grant delete` would otherwise pass every test.
  it('refuses an unauthenticated delete on clients', async () => {
    const { data, error } = await client()
      .from('clients')
      .delete()
      .eq('id', ABSENT_CLIENT_ID)
      .select()
    expectGrantLayerDenial(error)
    expect(data).toBeNull()
  })

  it('refuses an unauthenticated delete on checkins', async () => {
    const { data, error } = await client()
      .from('checkins')
      .delete()
      .eq('id', ABSENT_CLIENT_ID)
      .select()
    expectGrantLayerDenial(error)
    expect(data).toBeNull()
  })
  // --------------------------------------------------------------------------
  // PostgREST's exposed-schema list. Not a grant and not a policy: it is
  // PROJECT CONFIGURATION that lives in the Supabase dashboard, not in this
  // repository, and it is one of the two independent reasons schema `private` is
  // unreachable from a browser (the other is that no browser role holds USAGE on
  // it — asserted by verify-privileges.sql section 9a).
  //
  // Worth testing precisely BECAUSE it is not in the repo. Nothing in a git diff
  // would show someone adding `private` to that list, and doing so would expose
  // every security definer helper in it as a callable RPC. These two tests are
  // the only tripwire on a setting no migration can pin. If either fails, the
  // fix is in Supabase → Project Settings → API → Exposed schemas, not in code.
  // See the README, "Configuration that is not in this repository".
  //
  // Uses fetch directly rather than supabase-js: the client cannot send an
  // Accept-Profile header for a schema it has no types for, and the raw status
  // codes are the evidence.
  const restHeaders = () => ({
    apikey: key!,
    Authorization: `Bearer ${key!}`,
    'Content-Type': 'application/json',
  })

  it('does not expose schema private over the Data API', async () => {
    const response = await fetch(`${url!}/rest/v1/profiles?select=id`, {
      headers: { ...restHeaders(), 'Accept-Profile': 'private' },
    })

    // PGRST106 'Invalid schema', and the body names every schema that IS
    // exposed — which is the assertion that matters, because it fails the moment
    // someone adds `private` to the list.
    expect(response.status).toBe(406)
    const body = (await response.json()) as { code?: string; hint?: string }
    expect(body.code).toBe('PGRST106')

    // The hint's existence is asserted before its content. It used to read
    // `expect(body.hint ?? '')`, which quietly passed if PostgREST ever stopped
    // sending a hint at all — a vacuous assertion of exactly the kind this
    // branch spent its last wave removing. Its *presence* is checked here and
    // its *wording* deliberately is not, since the wording belongs to PostgREST
    // and asserting it would make this test break on their release notes rather
    // than on our configuration.
    expect(
      typeof body.hint,
      'PostgREST no longer returns a hint listing the exposed schemas, so this ' +
        'test can no longer see whether `private` is among them. Re-establish the ' +
        'check against whatever it returns now — do not delete it.',
    ).toBe('string')
    expect(body.hint).not.toMatch(/\bprivate\b/)
  })

  // THIS PROBE WAS MOVED DELIBERATELY, and the reason is worth more than the
  // assertion. It used to name private.is_active_user(), which
  // 20260824160306_has_capability.sql DROPPED. A 404 for a function that no
  // longer exists anywhere proves nothing about schema exposure -- the test
  // would have stayed green while its subject was deleted, which is this
  // project's standing definition of a worthless test. Renaming the subject was
  // not automatic and nothing would have caught it; if the capability helper is
  // ever renamed again, this line has to move with it.
  it('cannot call private.has_capability() as an RPC', async () => {
    const response = await fetch(`${url!}/rest/v1/rpc/has_capability`, {
      method: 'POST',
      headers: restHeaders(),
      body: JSON.stringify({ wanted: 'view_scores' }),
    })

    // 404 / PGRST202: PostgREST resolved the name against the exposed schema
    // (public), where the function does not exist. The helper that gates every
    // policy on clients and checkins is not addressable from the browser at all.
    //
    // The argument is sent rather than an empty body so a 404 cannot be blamed
    // on the signature not matching: if has_capability were ever exposed in
    // `public`, this call would be a well-formed invocation of it and would
    // return a boolean instead.
    expect(response.status).toBe(404)
    const body = (await response.json()) as { code?: string }
    expect(body.code).toBe('PGRST202')
  })
})

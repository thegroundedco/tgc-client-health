import { createClient } from '@supabase/supabase-js'
import { describe, expect, it } from 'vitest'

// Reads the same .env.local the app uses. These tests hit the real project;
// they are the only way to know the policies actually work.
//
// Vite deliberately skips .env.local when mode is 'test', which is why these
// tests are run with `--mode development`. The values arrive on
// import.meta.env, not process.env.
const env = import.meta.env as unknown as Record<string, string | undefined>
const url = env.VITE_SUPABASE_URL
const key = env.VITE_SUPABASE_PUBLISHABLE_KEY

describe.runIf(url && key)('RLS with no session', () => {
  const anon = createClient(url!, key!, {
    auth: { persistSession: false, autoRefreshToken: false },
  })

  it('returns no profile rows to an unauthenticated caller', async () => {
    const { data, error } = await anon.from('profiles').select('id')
    // Either an explicit denial or an empty set is acceptable. Rows are not.
    expect(error ? [] : data).toEqual([])
  })
})

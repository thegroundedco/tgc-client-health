import { createClient } from '@supabase/supabase-js'
import { readSupabaseConfig } from './env'
import type { Database } from '../types/database'

const config = readSupabaseConfig(
  import.meta.env as unknown as Record<string, string | undefined>,
)

// One client for the whole app. Multiple instances race each other over the
// stored session and cause spurious sign-outs.
//
// The <Database> generic is required, not decorative: without it,
// ReturnType<typeof createClient> resolves the generics to their defaults and
// erases every row type — .select() rows become `never` and
// .update({ role }) arguments become unassignable.
export const supabase = createClient<Database>(config.url, config.publishableKey, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    // The magic-link callback returns tokens in the URL fragment; the client
    // needs to read and clear them on load.
    detectSessionInUrl: true,
  },
})

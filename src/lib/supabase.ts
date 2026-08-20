import { createClient } from '@supabase/supabase-js'
import { readSupabaseConfig } from './env'

const config = readSupabaseConfig(
  import.meta.env as unknown as Record<string, string | undefined>,
)

// One client for the whole app. Multiple instances race each other over the
// stored session and cause spurious sign-outs.
export const supabase = createClient(config.url, config.publishableKey, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    // The magic-link callback returns tokens in the URL fragment; the client
    // needs to read and clear them on load.
    detectSessionInUrl: true,
  },
})

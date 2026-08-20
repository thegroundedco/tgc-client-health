export type SupabaseConfig = {
  url: string
  publishableKey: string
}

function required(source: Record<string, string | undefined>, name: string): string {
  const value = source[name]
  if (!value || value.trim() === '') {
    throw new Error(
      `Missing ${name}. Copy .env.example to .env.local and fill in the values ` +
        `from your Supabase dashboard under Project Settings → API.`,
    )
  }
  return value.trim()
}

export function readSupabaseConfig(
  source: Record<string, string | undefined>,
): SupabaseConfig {
  const url = required(source, 'VITE_SUPABASE_URL')
  const publishableKey = required(source, 'VITE_SUPABASE_PUBLISHABLE_KEY')

  // Vite inlines every VITE_-prefixed variable into the shipped bundle, so a
  // secret key here would be readable by anyone who opens the page.
  if (/^sb_secret_/.test(publishableKey) || /service_role/.test(publishableKey)) {
    throw new Error(
      'VITE_SUPABASE_PUBLISHABLE_KEY looks like a secret key. Secret keys must ' +
        'never be exposed to the browser. Use the publishable key instead.',
    )
  }

  return { url, publishableKey }
}

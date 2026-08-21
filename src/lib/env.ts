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

// Legacy Supabase keys are JWTs, so `service_role` lives inside the
// base64url-encoded payload rather than as a literal substring of the key.
// Decoding is the only way to distinguish a legacy secret (service_role) key
// from a legacy anon key, which must stay accepted.
function decodeJwtPayload(token: string): unknown {
  const segments = token.split('.')
  if (segments.length !== 3) return undefined

  try {
    let base64 = segments[1].replace(/-/g, '+').replace(/_/g, '/')
    const padding = base64.length % 4
    if (padding === 2) base64 += '=='
    else if (padding === 3) base64 += '='
    else if (padding !== 0) return undefined

    return JSON.parse(atob(base64))
  } catch {
    // Malformed or non-JSON payload — not a recognisable JWT shape, so it
    // can't be confirmed as a secret. Let it through rather than crashing;
    // the URL/blank checks above already guard the cases that matter most.
    return undefined
  }
}

function isSecretKey(value: string): boolean {
  // Modern secret keys use an explicit, unmistakable prefix.
  if (/^sb_secret_/i.test(value)) return true

  // Legacy keys (both anon and service_role) are JWTs. Only the decoded
  // `role` claim tells them apart — pattern matching on the raw string
  // cannot, since it's base64url, not plaintext.
  const payload = decodeJwtPayload(value)
  if (payload && typeof payload === 'object' && 'role' in payload) {
    return (payload as { role?: unknown }).role === 'service_role'
  }

  return false
}

export function readSupabaseConfig(
  source: Record<string, string | undefined>,
): SupabaseConfig {
  const url = required(source, 'VITE_SUPABASE_URL')
  const publishableKey = required(source, 'VITE_SUPABASE_PUBLISHABLE_KEY')

  // Vite inlines every VITE_-prefixed variable into the shipped bundle, so a
  // secret key here would be readable by anyone who opens the page.
  if (isSecretKey(publishableKey)) {
    throw new Error(
      'VITE_SUPABASE_PUBLISHABLE_KEY looks like a secret key. Secret keys must ' +
        'never be exposed to the browser. Use the publishable key instead.',
    )
  }

  return { url, publishableKey }
}

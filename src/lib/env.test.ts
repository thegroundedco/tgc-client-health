import { describe, expect, it } from 'vitest'
import { readSupabaseConfig } from './env'

function base64UrlEncode(value: string): string {
  return btoa(value)
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '')
}

function fakeJwt(payload: unknown): string {
  const header = base64UrlEncode(JSON.stringify({ alg: 'HS256', typ: 'JWT' }))
  const body = base64UrlEncode(JSON.stringify(payload))
  return `${header}.${body}.fake-signature`
}

describe('readSupabaseConfig', () => {
  it('returns url and key when both are present', () => {
    const config = readSupabaseConfig({
      VITE_SUPABASE_URL: 'https://example.supabase.co',
      VITE_SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_test',
    })
    expect(config).toEqual({
      url: 'https://example.supabase.co',
      publishableKey: 'sb_publishable_test',
    })
  })

  it('throws naming the missing variable when the url is absent', () => {
    expect(() =>
      readSupabaseConfig({ VITE_SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_test' }),
    ).toThrow(/VITE_SUPABASE_URL/)
  })

  it('throws naming the missing variable when the key is absent', () => {
    expect(() =>
      readSupabaseConfig({ VITE_SUPABASE_URL: 'https://example.supabase.co' }),
    ).toThrow(/VITE_SUPABASE_PUBLISHABLE_KEY/)
  })

  it('treats whitespace-only values as missing', () => {
    expect(() =>
      readSupabaseConfig({
        VITE_SUPABASE_URL: '   ',
        VITE_SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_test',
      }),
    ).toThrow(/VITE_SUPABASE_URL/)
  })

  it('rejects a secret key pasted into the publishable slot', () => {
    expect(() =>
      readSupabaseConfig({
        VITE_SUPABASE_URL: 'https://example.supabase.co',
        VITE_SUPABASE_PUBLISHABLE_KEY: 'sb_secret_oops',
      }),
    ).toThrow(/secret/i)
  })

  it('rejects a legacy service_role JWT pasted into the publishable slot', () => {
    const serviceRoleJwt = fakeJwt({
      iss: 'supabase',
      role: 'service_role',
      iat: 1616239022,
    })
    expect(() =>
      readSupabaseConfig({
        VITE_SUPABASE_URL: 'https://example.supabase.co',
        VITE_SUPABASE_PUBLISHABLE_KEY: serviceRoleJwt,
      }),
    ).toThrow(/secret/i)
  })

  it('accepts a legacy anon JWT in the publishable slot', () => {
    const anonJwt = fakeJwt({
      iss: 'supabase',
      role: 'anon',
      iat: 1616239022,
    })
    const config = readSupabaseConfig({
      VITE_SUPABASE_URL: 'https://example.supabase.co',
      VITE_SUPABASE_PUBLISHABLE_KEY: anonJwt,
    })
    expect(config).toEqual({
      url: 'https://example.supabase.co',
      publishableKey: anonJwt,
    })
  })

  it('rejects a secret key prefix regardless of case', () => {
    expect(() =>
      readSupabaseConfig({
        VITE_SUPABASE_URL: 'https://example.supabase.co',
        VITE_SUPABASE_PUBLISHABLE_KEY: 'SB_SECRET_OOPS',
      }),
    ).toThrow(/secret/i)
  })

  it('does not throw an unexpected error on a malformed JWT-shaped value', () => {
    const malformed = 'not-base64.!!!not-json-either!!!.fake-signature'
    expect(() =>
      readSupabaseConfig({
        VITE_SUPABASE_URL: 'https://example.supabase.co',
        VITE_SUPABASE_PUBLISHABLE_KEY: malformed,
      }),
    ).not.toThrow()
  })
})

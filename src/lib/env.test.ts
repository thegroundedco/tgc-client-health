import { describe, expect, it } from 'vitest'
import { readSupabaseConfig } from './env'

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
})

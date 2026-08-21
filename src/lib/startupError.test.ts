import { describe, expect, it } from 'vitest'
import { readSupabaseConfig } from './env'
import { startupError } from './startupError'

// The scenario under test is the whole reason this module exists: a GitHub
// Actions secret that is missing or misspelled. `vite build` cannot fail on it,
// so the first evidence of the mistake is the shipped bundle throwing on load.
// These tests run the REAL readSupabaseConfig throw through the message builder,
// rather than a hand-written fake message, so a reworded throw cannot leave the
// on-page advice silently generic.
function thrownByMissing(name: 'VITE_SUPABASE_URL' | 'VITE_SUPABASE_PUBLISHABLE_KEY') {
  const source: Record<string, string | undefined> = {
    VITE_SUPABASE_URL: 'https://example.supabase.co',
    VITE_SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_abc',
  }
  delete source[name]
  try {
    readSupabaseConfig(source)
  } catch (thrown) {
    return thrown
  }
  throw new Error(`readSupabaseConfig did not throw for a missing ${name}`)
}

describe('startupError', () => {
  it.each(['VITE_SUPABASE_URL', 'VITE_SUPABASE_PUBLISHABLE_KEY'] as const)(
    'names %s, and says where it is set, when it is missing',
    (name) => {
      const result = startupError(thrownByMissing(name))

      expect(result.title).toMatch(/required setting is missing/i)
      // The setting has to appear by its exact name, or the reader cannot act.
      expect(result.detail).toContain(name)
      const advice = result.steps.join(' ')
      expect(advice).toContain(name)
      // Both places it is configured, because the same blank page happens in
      // both and the owner will not know which one he is looking at.
      expect(advice).toMatch(/Secrets and variables/i)
      expect(advice).toMatch(/\.env\.local/)
      // Says the data is fine. The blank page looks like data loss and is not.
      expect(advice).toMatch(/untouched|lost/i)
    },
  )

  it('still produces something readable and non-empty for an unrelated failure', () => {
    const result = startupError(new Error('Failed to fetch dynamically imported module'))
    expect(result.title).toMatch(/could not start/i)
    expect(result.detail).toBe('Failed to fetch dynamically imported module')
    expect(result.steps.length).toBeGreaterThan(0)
  })

  // A failure with no message at all must not render a heading over an empty
  // paragraph — that is a blank page with extra steps.
  it('never leaves the detail line empty', () => {
    for (const thrown of [new Error(''), {}, undefined]) {
      expect(startupError(thrown).detail.trim().length).toBeGreaterThan(0)
    }
  })
})

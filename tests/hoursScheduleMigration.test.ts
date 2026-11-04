import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

// Text-level pins on 20261104130000_schedule_productive_hours.sql: what the
// migration TEXT says, not what Postgres does with it. Comments are stripped
// first, and the assertions slice to the one cron.schedule statement.
const SQL = readFileSync('supabase/migrations/20261104130000_schedule_productive_hours.sql', 'utf8')
const stripped = SQL.replaceAll(/--[^\n]*/g, '')

function schedule(): string {
  const found = stripped.match(/select cron\.schedule\([\s\S]*?\$cron\$[\s\S]*?\$cron\$\s*\);/)
  expect(found, 'the cron.schedule statement').not.toBeNull()
  return found![0]
}

describe('the productive hours schedule migration', () => {
  it('schedules the named job at noon UTC on the 1st', () => {
    expect(schedule()).toMatch(/cron\.schedule\(\s*'fetch-productive-hours-monthly',\s*'0 12 1 \* \*',/)
  })

  it('calls the function through net.http_post', () => {
    expect(schedule()).toMatch(/select net\.http_post\(/)
  })

  it('reads the URL, the cron secret and the anon key from Vault, each into its own place', () => {
    const s = schedule()
    const vault = (name: string) =>
      `(select decrypted_secret from vault.decrypted_secrets where name = '${name}')`
    expect(s).toContain(`url := ${vault('productive_hours_fn_url')}`)
    expect(s).toContain(`'x-hours-cron-secret', ${vault('productive_hours_cron_secret')}`)
    expect(s).toContain(`'Authorization', 'Bearer ' || ${vault('productive_hours_anon_key')}`)
  })

  it('sends the previous month as the period', () => {
    expect(schedule()).toContain(
      "body := jsonb_build_object('period', date_trunc('month', now() - interval '1 month')::date)",
    )
  })

  it('enables the two extensions it needs', () => {
    expect(stripped).toContain('create extension if not exists pg_cron;')
    expect(stripped).toContain('create extension if not exists pg_net;')
  })

  it('holds no URL literal and no secret-looking literal', () => {
    const s = schedule()
    expect(s).not.toMatch(/https?:/i)
    expect(s).not.toMatch(/\/\//)
    const literals = [...s.matchAll(/'([^']*)'/g)].map((m) => m[1])
    expect(literals.length).toBeGreaterThan(5)
    for (const lit of literals) {
      // A key or token is a long unbroken run of key characters.
      expect(lit, `literal '${lit}'`).not.toMatch(/[A-Za-z0-9_\-.]{32,}/)
      expect(lit, `literal '${lit}'`).not.toMatch(/^eyJ/)
    }
  })
})

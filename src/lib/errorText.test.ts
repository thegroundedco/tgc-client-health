import { describe, expect, it } from 'vitest'
import { describeError } from './errorText'

describe('describeError', () => {
  // The reason this function exists. Every failure branch in the app is guarded
  // by a truthiness test, so a '' message means the guard misses and the user
  // gets a permanent "Loading…" instead of an error.
  it('never returns an empty string, whatever it is handed', () => {
    for (const input of [
      new Error(''),
      new Error('   '),
      { message: '' },
      { message: '   ' },
      {},
      [],
      '',
      '   ',
      null,
      undefined,
    ]) {
      expect(describeError(input), `input: ${JSON.stringify(input)}`).not.toBe('')
      expect(describeError(input).trim().length).toBeGreaterThan(0)
    }
  })

  it('uses the message of an Error', () => {
    expect(describeError(new Error('permission denied for table clients'))).toBe(
      'permission denied for table clients',
    )
  })

  // PostgrestError and AuthError are not always `instanceof Error`; they are
  // plain objects carrying a string message. `String(thrown)` on one of those
  // yields '[object Object]', which is why the message property is read first.
  it('uses the message of a plain object that has one', () => {
    expect(describeError({ code: '42501', message: 'permission denied' })).toBe(
      'permission denied',
    )
  })

  it('does not report [object Object] for a message-less object', () => {
    expect(describeError({ code: '42501' })).not.toContain('[object Object]')
  })

  it('keeps a thrown string', () => {
    expect(describeError('boom')).toBe('boom')
  })

  it('reports a thrown non-string primitive as itself', () => {
    expect(describeError(0)).toBe('0')
    expect(describeError(false)).toBe('false')
  })
})

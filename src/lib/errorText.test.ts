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

  // A dropped connection is the failure a person is most likely to meet, and it
  // was arriving on screen as "Could not save: TypeError: Failed to fetch."
  // The rest of that sentence does its job -- nothing is lost, retrying is free
  // -- so leaking a JavaScript class name into it is the one thing wrong with
  // the most important error message in the app. Observed by the owner on the
  // deployed site 2026-08-21 with the wifi off.
  describe('a failed connection', () => {
    it('says the connection failed rather than naming a JavaScript type', () => {
      // The exact shape the owner saw: supabase-js hands the stringified
      // TypeError through as the message, prefix included.
      expect(describeError({ message: 'TypeError: Failed to fetch' })).toBe(
        'the connection failed',
      )
      // And the unwrapped form, which is what fetch itself throws.
      expect(describeError(new TypeError('Failed to fetch'))).toBe('the connection failed')
    })

    it('recognises the wording of the other engines too', () => {
      // Chrome and Edge say "Failed to fetch"; Firefox and Safari word it
      // differently. Only Chrome's was observed here -- the other two are from
      // the engines' documented messages, not measured on this project.
      for (const message of [
        'NetworkError when attempting to fetch resource.',
        'Load failed',
      ]) {
        expect(describeError(new Error(message)), `message: ${message}`).toBe(
          'the connection failed',
        )
      }
    })

    it('reads correctly in both sentences it appears in', () => {
      // describeError feeds a bare load error as well as "Could not save: ...",
      // so the phrase has to work with and without a prefix. Lowercase matches
      // every other message this function returns, which are raw API strings
      // like 'permission denied for table clients'.
      expect(`Could not save: ${describeError(new TypeError('Failed to fetch'))}.`).toBe(
        'Could not save: the connection failed.',
      )
    })

    it('leaves an error that merely mentions the network alone', () => {
      // Only the known failure shapes are replaced. A real server message has
      // to survive verbatim, or a diagnosable fault becomes an unhelpful one.
      expect(describeError(new Error('network policy denies this request'))).toBe(
        'network policy denies this request',
      )
      expect(describeError(new Error('permission denied for table checkins'))).toBe(
        'permission denied for table checkins',
      )
    })
  })

  it('keeps a thrown string', () => {
    expect(describeError('boom')).toBe('boom')
  })

  it('reports a thrown non-string primitive as itself', () => {
    expect(describeError(0)).toBe('0')
    expect(describeError(false)).toBe('false')
  })
})

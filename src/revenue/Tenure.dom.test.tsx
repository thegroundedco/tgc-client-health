// @vitest-environment jsdom

import { render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { Tenure } from './Tenure'
import type { CurrentRow, LifecycleClient } from './tenureMath'

afterEach(() => {
  document.body.innerHTML = ''
})

function row(name: string, days: number | null, paused = false): CurrentRow {
  const client: LifecycleClient = {
    id: name.length,
    name,
    status: paused ? 'paused' : 'active',
    started_on: days === null ? null : '2026-01-01',
    ended_on: null,
    end_reason_code: null,
    end_reason_note: null,
  }
  return { client, days, paused }
}

describe('Tenure', () => {
  it('lists the clients in the order it is given', () => {
    render(<Tenure rows={[row('Ballast', 400), row('Acme', 90), row('Cove', 10)]} />)

    const names = [...screen.getByRole('list', { name: 'Tenure' }).querySelectorAll('li')].map(
      (item) => item.textContent,
    )
    expect(names[0]).toContain('Ballast')
    expect(names[2]).toContain('Cove')
  })

  it('states the count, the median and the longest', () => {
    render(<Tenure rows={[row('Ballast', 400), row('Acme', 90), row('Cove', 10)]} />)

    const summary = screen.getByTestId('tenure-summary').textContent ?? ''
    expect(summary).toContain('3 clients')
    expect(summary).toContain('3 mo')
    expect(summary).toContain('1 yr 1 mo')
  })

  // Spec §3: count everybody, measure only what is measured, and SAY when the
  // two differ. A summary that quietly measured two of three would be a true
  // sentence about a group the reader thinks is bigger than it is.
  it('says how many could not be measured, when any could not', () => {
    render(<Tenure rows={[row('Acme', 90), row('Ember', null)]} />)

    expect(screen.getByTestId('tenure-summary').textContent).toContain('1 without a start date')
  })

  it('says nothing about unmeasured clients when every one is measured', () => {
    render(<Tenure rows={[row('Acme', 90)]} />)

    expect(screen.getByTestId('tenure-summary').textContent).not.toContain('without a start date')
  })

  // Never zero, never a bare dash. Spec §3 and the matrix's own rule that an
  // absent measurement and a measurement of zero must not converge.
  it('reads unknown for a client with no start date', () => {
    render(<Tenure rows={[row('Ember', null)]} />)

    const item = screen.getByRole('list', { name: 'Tenure' }).querySelector('li')
    expect(item?.textContent).toContain('unknown')
    expect(item?.textContent).not.toContain('0')
  })

  it('marks a paused client', () => {
    render(<Tenure rows={[row('Acme', 90), row('Cove', 30, true)]} />)

    const items = [...screen.getByRole('list', { name: 'Tenure' }).querySelectorAll('li')]
    expect(items.find((item) => item.textContent?.includes('Cove'))?.textContent).toContain(
      'Paused',
    )
    expect(items.find((item) => item.textContent?.includes('Acme'))?.textContent).not.toContain(
      'Paused',
    )
  })

  // A blank region reads as a failed load, which is this project's signature
  // defect wearing a new mask.
  it('says so when there are no clients at all', () => {
    render(<Tenure rows={[]} />)

    expect(screen.getByText(/no clients yet/i)).toBeTruthy()
  })
})

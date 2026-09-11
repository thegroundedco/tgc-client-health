// @vitest-environment jsdom

import { render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { Mix } from './Mix'
import type { RevenueRow } from './chartMath'
import type { RetentionClient } from './retentionMath'

function client(id: number, over: Partial<RetentionClient> = {}): RetentionClient {
  return {
    id,
    name: `Client ${id}`,
    status: 'active',
    started_on: '2026-01-01',
    ended_on: null,
    end_reason_code: null,
    ...over,
  }
}

function row(client_id: number, retainer: number, project = 0): RevenueRow {
  return { client_id, period: '2026-01-01', retainer_cents: retainer, project_cents: project }
}

const CLIENTS = [client(1), client(2), client(3)]
const ROWS = [row(1, 500000), row(2, 300000), row(3, 0, 200000)]

function show(over: Record<string, unknown> = {}) {
  return render(
    <Mix clients={CLIENTS} rows={ROWS} status="ready" asOf="2026-09-30" {...over} />,
  )
}

afterEach(() => {
  document.body.innerHTML = ''
})

describe('Mix', () => {
  it('names itself for the question it answers', () => {
    show()

    expect(screen.getByRole('heading', { name: /retainer vs project/i })).toBeTruthy()
  })

  it('reports both groups, counted and totalled', () => {
    show()

    const retainer = screen.getByTestId('mix-retainer').textContent ?? ''
    expect(retainer).toContain('2 clients')
    expect(retainer).toContain('$8,000')

    const project = screen.getByTestId('mix-project').textContent ?? ''
    expect(project).toContain('1 client')
    expect(project).toContain('$2,000')
  })

  it('leads with the MEDIAN client, not the group total', () => {
    // The question is whether one KIND of client is worth more, which is a
    // question about a typical client. A group total mostly reports how many
    // of each kind there happen to be.
    show()

    expect(screen.getByTestId('mix-retainer-median').textContent).toContain('$4,000')
  })

  // The caveat the section cannot be read without.
  it('says the tenure comparison rests on how many start dates it has', () => {
    show({
      clients: [client(1), client(2, { started_on: null }), client(3, { started_on: null })],
    })

    expect(screen.getByTestId('mix-caveat').textContent).toMatch(/start date/i)
  })

  it('refuses a tenure median for a group with no start dates at all', () => {
    show({
      clients: [
        client(1, { started_on: null }),
        client(2, { started_on: null }),
        client(3, { started_on: null }),
      ],
    })

    expect(screen.getByTestId('mix-retainer').textContent).not.toMatch(/\d+ (mo|yr|wk)/)
  })

  it('says a group is empty rather than showing it at zero', () => {
    // Zero is a measurement. "No clients of this kind" is not, and a $0 median
    // would read as a kind of client that earns nothing.
    show({ clients: [client(1)], rows: [row(1, 500000)] })

    expect(screen.getByTestId('mix-project').textContent).toMatch(/none/i)
    expect(screen.getByTestId('mix-project').textContent).not.toContain('$0')
  })

  it('says it measures the whole relationship, not the selected range', () => {
    // It sits under a page-level range control that does not govern it. Left
    // unsaid, a reader would take these figures as answers about the months
    // they picked.
    show()

    expect(document.body.textContent).toMatch(/every month entered|all time|whole/i)
  })

  it('says nothing has been entered rather than drawing empty groups', () => {
    show({ rows: [] })

    expect(screen.queryByTestId('mix-retainer')).toBeNull()
    expect(document.body.textContent).toMatch(/no revenue/i)
  })

  it('shows a failed read as an error, not as an empty comparison', () => {
    show({ status: 'error', loadError: 'permission denied' })

    expect(screen.getByRole('alert').textContent).toContain('permission denied')
  })
})

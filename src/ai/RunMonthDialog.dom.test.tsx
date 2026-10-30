// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { RunMonthDialog } from './RunMonthDialog'

const clients = [
  { id: 1, name: 'Babaloo', status: 'active', started_on: null, ended_on: null },
  { id: 2, name: 'Colorfil', status: 'active', started_on: null, ended_on: null },
  { id: 3, name: 'Sno-Go', status: 'active', started_on: null, ended_on: null },
]
const PERIOD = '2026-10-01'

function setup(manual: number[] = []) {
  const onRun = vi.fn()
  const onCancel = vi.fn()
  render(<RunMonthDialog period={PERIOD} clients={clients} manual={new Set(manual)} onRun={onRun} onCancel={onCancel} />)
  return { onRun, onCancel, user: userEvent.setup() }
}
const notice = 'These clients have already been manually scored – overwrite their data?'

afterEach(cleanup)

describe('RunMonthDialog', () => {
  it('is a labelled modal dialog asking the exact scope question, focus on its first button', () => {
    setup()
    const dialog = screen.getByRole('dialog', { name: 'Run AI suggested scores for all 3 clients in October 2026?' })
    expect(dialog.getAttribute('aria-modal')).toBe('true')
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Yes, all clients' }))
  })

  it('Yes with no manual clients runs for everyone with no overwrites', async () => {
    const { onRun, user } = setup()
    await user.click(screen.getByRole('button', { name: 'Yes, all clients' }))
    expect(onRun).toHaveBeenCalledWith({ period: PERIOD, client_ids: null, overwrite_client_ids: [], source: 'board' })
  })

  it('Yes with manual clients shows the overwrite notice listing only them, unticked; Run sends ticked ids', async () => {
    const { onRun, user } = setup([1, 3])
    await user.click(screen.getByRole('button', { name: 'Yes, all clients' }))
    expect(screen.getByRole('dialog', { name: notice })).toBeTruthy()
    expect(screen.queryByRole('checkbox', { name: 'Colorfil' })).toBeNull()
    const babaloo = screen.getByRole('checkbox', { name: 'Babaloo' }) as HTMLInputElement
    const sno = screen.getByRole('checkbox', { name: 'Sno-Go' }) as HTMLInputElement
    expect(babaloo.checked).toBe(false)
    expect(sno.checked).toBe(false)
    await user.click(sno)
    await user.click(screen.getByRole('button', { name: 'Run' }))
    expect(onRun).toHaveBeenCalledWith({ period: PERIOD, client_ids: null, overwrite_client_ids: [3], source: 'board' })
  })

  it('Run with nothing ticked sends no overwrites', async () => {
    const { onRun, user } = setup([1])
    await user.click(screen.getByRole('button', { name: 'Yes, all clients' }))
    await user.click(screen.getByRole('button', { name: 'Run' }))
    expect(onRun).toHaveBeenCalledWith({ period: PERIOD, client_ids: null, overwrite_client_ids: [], source: 'board' })
  })

  it('No, let me choose lists every member ticked; unticking all disables Continue', async () => {
    const { user } = setup()
    await user.click(screen.getByRole('button', { name: 'No, let me choose' }))
    for (const c of clients) expect((screen.getByRole('checkbox', { name: c.name }) as HTMLInputElement).checked).toBe(true)
    const cont = screen.getByRole('button', { name: 'Continue' }) as HTMLButtonElement
    expect(cont.disabled).toBe(false)
    for (const c of clients) await user.click(screen.getByRole('checkbox', { name: c.name }))
    expect(cont.disabled).toBe(true)
  })

  it('unticking one sends the rest as client_ids', async () => {
    const { onRun, user } = setup()
    await user.click(screen.getByRole('button', { name: 'No, let me choose' }))
    await user.click(screen.getByRole('checkbox', { name: 'Colorfil' }))
    await user.click(screen.getByRole('button', { name: 'Continue' }))
    expect(onRun).toHaveBeenCalledWith({ period: PERIOD, client_ids: [1, 3], overwrite_client_ids: [], source: 'board' })
  })

  it('after choosing, the overwrite step lists only chosen manual clients', async () => {
    const { onRun, user } = setup([1, 2])
    await user.click(screen.getByRole('button', { name: 'No, let me choose' }))
    await user.click(screen.getByRole('checkbox', { name: 'Colorfil' }))
    await user.click(screen.getByRole('button', { name: 'Continue' }))
    expect(screen.getByRole('checkbox', { name: 'Babaloo' })).toBeTruthy()
    expect(screen.queryByRole('checkbox', { name: 'Colorfil' })).toBeNull()
    await user.click(screen.getByRole('checkbox', { name: 'Babaloo' }))
    await user.click(screen.getByRole('button', { name: 'Run' }))
    expect(onRun).toHaveBeenCalledWith({ period: PERIOD, client_ids: [1, 3], overwrite_client_ids: [1], source: 'board' })
  })

  it('choosing only non-manual clients skips the overwrite step', async () => {
    const { onRun, user } = setup([1])
    await user.click(screen.getByRole('button', { name: 'No, let me choose' }))
    await user.click(screen.getByRole('checkbox', { name: 'Babaloo' }))
    await user.click(screen.getByRole('button', { name: 'Continue' }))
    expect(onRun).toHaveBeenCalledWith({ period: PERIOD, client_ids: [2, 3], overwrite_client_ids: [], source: 'board' })
  })

  it.each(['scope', 'choose', 'overwrite'])('Cancel at the %s step cancels and never runs', async (step) => {
    const { onRun, onCancel, user } = setup([1])
    if (step !== 'scope') {
      await user.click(screen.getByRole('button', { name: step === 'choose' ? 'No, let me choose' : 'Yes, all clients' }))
    }
    await user.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(onCancel).toHaveBeenCalledTimes(1)
    expect(onRun).not.toHaveBeenCalled()
  })

  it.each(['scope', 'choose', 'overwrite'])('Escape at the %s step cancels and never runs', async (step) => {
    const { onRun, onCancel, user } = setup([1])
    if (step !== 'scope') {
      await user.click(screen.getByRole('button', { name: step === 'choose' ? 'No, let me choose' : 'Yes, all clients' }))
    }
    await user.keyboard('{Escape}')
    expect(onCancel).toHaveBeenCalledTimes(1)
    expect(onRun).not.toHaveBeenCalled()
  })

  it('focus moves to the first button of each new step', async () => {
    const { user } = setup([1])
    await user.click(screen.getByRole('button', { name: 'Yes, all clients' }))
    const dialog = screen.getByRole('dialog')
    expect(dialog.contains(document.activeElement)).toBe(true)
    expect(document.activeElement?.tagName).toBe('BUTTON')
  })
})

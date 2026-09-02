import { describe, expect, it } from 'vitest'
import {
  adminSections,
  canSeeAdmin,
  DESTINATIONS,
  LANDING,
  openDestination,
} from './destination'

describe('the destination list', () => {
  it('is the four the owner asked for, in his order', () => {
    expect(DESTINATIONS.map((entry) => entry.kind)).toEqual([
      'overview',
      'clients',
      'revenue',
      'admin',
    ])
    expect(DESTINATIONS.map((entry) => entry.label)).toEqual([
      'Overview',
      'Clients',
      'Revenue',
      'Admin',
    ])
  })

  // Spec §3.1. Overview is the homepage and WILL be the landing destination --
  // but not while it is empty, because an empty first screen on every sign-in
  // is worse than a menu whose first item is not where the app opens. This
  // assertion is the reminder to change it deliberately rather than discover it.
  it('lands on Clients, not on the still-empty Overview', () => {
    expect(LANDING).toEqual({ kind: 'clients' })
  })
})

describe('who can see Admin', () => {
  it('gives an admin both sections', () => {
    expect(adminSections('admin')).toEqual(['people', 'clients'])
    expect(canSeeAdmin('admin')).toBe(true)
  })

  // The case a single admin-versus-viewer test would miss, and the reason
  // openDestination exists at all: an account manager holds manage_clients but
  // NOT manage_users.
  it('gives an account manager only the client roster', () => {
    expect(adminSections('account_manager')).toEqual(['clients'])
    expect(canSeeAdmin('account_manager')).toBe(true)
  })

  it('gives a viewer nothing, so the tab never appears', () => {
    expect(adminSections('viewer')).toEqual([])
    expect(canSeeAdmin('viewer')).toBe(false)
  })

  // `role` arrives from a profiles row -- a text column. Closed by default.
  it('gives an unrecognised role nothing', () => {
    expect(adminSections('pirate')).toEqual([])
    expect(canSeeAdmin('pirate')).toBe(false)
  })
})

describe('openDestination', () => {
  it('opens the three simple destinations for anybody', () => {
    for (const role of ['admin', 'account_manager', 'viewer']) {
      expect(openDestination('overview', role)).toEqual({ kind: 'overview' })
      expect(openDestination('clients', role)).toEqual({ kind: 'clients' })
      expect(openDestination('revenue', role)).toEqual({ kind: 'revenue' })
    }
  })

  // The defect this prevents: opening Admin on a hardcoded 'people' would land
  // an account manager on a section that is not theirs -- an empty screen
  // reached by a button that looked like it worked.
  it('opens Admin on the first section the person can actually see', () => {
    expect(openDestination('admin', 'admin')).toEqual({ kind: 'admin', section: 'people' })
    expect(openDestination('admin', 'account_manager')).toEqual({
      kind: 'admin',
      section: 'clients',
    })
  })

  it('refuses to open Admin for somebody with neither capability', () => {
    expect(openDestination('admin', 'viewer')).toBe(null)
    expect(openDestination('admin', 'pirate')).toBe(null)
  })
})

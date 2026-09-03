import { describe, expect, it } from 'vitest'
import {
  adminSections,
  canSeeAdmin,
  canSeeDestination,
  DESTINATIONS,
  LANDING,
  openDestination,
} from './destination'

describe('the destination list', () => {
  // Note what this cannot catch, and where that is covered instead. This pins
  // what IS in DESTINATIONS; a fifth DestinationKind added to the union with no
  // entry here would leave this array untouched and this test green, and the
  // destination would simply never appear in the bar -- reachable by nothing,
  // with a clean build. That case is a type-level assertion in destination.ts,
  // because no runtime test can see a value that was never listed.
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
  // Was "both sections" before slice 6c added edit_revenue, which admin also
  // holds -- now three.
  it('gives an admin all three sections', () => {
    expect(adminSections('admin')).toEqual(['people', 'clients', 'revenue'])
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
  // Revenue used to be a third unconditional destination here, open to anybody
  // who pressed it. Slice 6c gates it on view_revenue, so it moved out of this
  // blanket loop and into 'the revenue gates' below, where a viewer's refusal
  // is the point being tested rather than an oversight.
  it('opens the two simple destinations for anybody', () => {
    for (const role of ['admin', 'account_manager', 'viewer']) {
      expect(openDestination('overview', role)).toEqual({ kind: 'overview' })
      expect(openDestination('clients', role)).toEqual({ kind: 'clients' })
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

describe('the revenue gates', () => {
  it('offers the revenue admin section to an admin and not to an account manager', () => {
    // edit_revenue, not view_revenue. An account manager who reached this
    // screen would see an entry grid the database refuses -- the exact thing
    // parent spec section 7.2 forbids drawing.
    expect(adminSections('admin')).toContain('revenue')
    expect(adminSections('account_manager')).not.toContain('revenue')
    expect(adminSections('viewer')).not.toContain('revenue')
  })

  it('puts Revenue in the bar for an account manager and takes it from a viewer', () => {
    // view_revenue. The reports are the account manager's; the entry screen is
    // not. A viewer sees neither.
    expect(canSeeDestination('revenue', 'admin')).toBe(true)
    expect(canSeeDestination('revenue', 'account_manager')).toBe(true)
    expect(canSeeDestination('revenue', 'viewer')).toBe(false)
  })

  it('refuses to open Revenue for somebody who cannot see it', () => {
    // Null means the press does nothing. Returning a Destination anyway and
    // letting the screen render an error is the failure openDestination exists
    // to prevent.
    expect(openDestination('revenue', 'viewer')).toBe(null)
    expect(openDestination('revenue', 'account_manager')).toEqual({ kind: 'revenue' })
  })

  // The admin case the test above does not carry: admin holds view_revenue
  // too, so the gate must not accidentally read as "account managers only".
  it('opens Revenue for an admin', () => {
    expect(openDestination('revenue', 'admin')).toEqual({ kind: 'revenue' })
  })

  it('leaves the destinations every role can see alone', () => {
    for (const role of ['admin', 'account_manager', 'viewer']) {
      expect(canSeeDestination('overview', role)).toBe(true)
      expect(canSeeDestination('clients', role)).toBe(true)
    }
  })

  it('answers false for a role it does not know', () => {
    // Closed by default, matching `can`. An unknown role must not be handed
    // the revenue screens by a lookup that missed.
    expect(canSeeDestination('revenue', 'sales')).toBe(false)
    expect(adminSections('sales')).toEqual([])
  })
})

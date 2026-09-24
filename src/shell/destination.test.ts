import { describe, expect, it } from 'vitest'
import {
  adminDestination,
  adminSections,
  canSeeAdmin,
  canSeeDestination,
  DESTINATIONS,
  LANDING,
  openDestination,
} from './destination'
import type { Destination } from './destination'

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

  // Spec §3.1. Overview is the homepage and WILL be the landing destination.
  // It was empty through slice 6a and was filled on 2026-09-11, so this moved
  // to Overview in slice D. This assertion is the reminder to never move it
  // back without a reason recorded in the comment at its definition.
  it('lands on Overview, the primary reader\'s working screen', () => {
    expect(LANDING).toEqual({ kind: 'overview' })
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

  it('puts Admin in the bar for an account manager as well as an admin, and takes it from a viewer', () => {
    // The direct test of the arm that is now the SOLE gate on the Admin
    // button -- MenuBar's own `entry.kind !== 'admin' || canSeeAdmin` special
    // case moved in here, and nothing exercised the replacement through this
    // function.
    //
    // The account_manager row is the one that matters, and it is the project's
    // standing trap: that role holds manage_clients but NOT manage_users, so
    // an arm written as `can(role, 'manage_users')` reads correct, gives an
    // admin the button, and silently hides Clients admin from the person whose
    // job it is. It must be EITHER capability, which is what canSeeAdmin's
    // length check says.
    expect(canSeeDestination('admin', 'admin')).toBe(true)
    expect(canSeeDestination('admin', 'account_manager')).toBe(true)
    // And a viewer holds none of the three, so an arm hardcoded to `true`
    // -- the other way this breaks -- puts a button on their bar that opens
    // nothing, since openDestination returns null for them.
    expect(canSeeDestination('admin', 'viewer')).toBe(false)
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

// FINAL-REVIEW FINDING 5: the union's own comment promises each impossible
// combination is a compile error, and the admin arm had stopped keeping that
// promise -- `{ kind: 'admin', section: 'people', editClientId: 7 }` compiled,
// attaching a client id to a screen that cannot read one.
describe('the admin destination, and the id only one section can carry', () => {
  // A TYPE-LEVEL assertion, and it fails the BUILD rather than this run --
  // which is the only place it could live, because the thing being refused is
  // a value that must never exist. @ts-expect-error is itself the assertion:
  // if the arms are ever merged back into one, the error disappears, the
  // directive becomes unused, and `tsc -b` fails on THIS line. `npm run build`
  // is therefore part of what covers this describe.
  it('refuses an id beside a section that cannot use one', () => {
    // @ts-expect-error -- editClientId belongs to the 'clients' arm alone.
    const impossible: Destination = { kind: 'admin', section: 'people', editClientId: 7 }
    expect(impossible.kind).toBe('admin')
  })

  // The runtime half, for the hole the excess-property check cannot see: a
  // WIDENED AdminSection carrying an id. adminDestination narrows, so the id is
  // dropped rather than smuggled onto a screen that will never read it.
  it('carries the id when the section is clients', () => {
    expect(adminDestination('clients', 7)).toEqual({
      kind: 'admin',
      section: 'clients',
      editClientId: 7,
    })
  })

  it('DROPS an id handed in beside any other section', () => {
    const section: 'people' | 'clients' = 'people'
    expect(adminDestination(section, 7)).toStrictEqual({ kind: 'admin', section: 'people' })
    expect(adminDestination('revenue', 7)).toStrictEqual({ kind: 'admin', section: 'revenue' })
  })

  it('builds a plain destination when no id is offered', () => {
    expect(adminDestination('clients')).toEqual({ kind: 'admin', section: 'clients' })
    expect(adminDestination('people')).toStrictEqual({ kind: 'admin', section: 'people' })
  })
})

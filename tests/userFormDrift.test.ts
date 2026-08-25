import { readdirSync, readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import {
  ASSIGNABLE_ROLES,
  NOT_ADMIN_MESSAGE,
  ROLE_HINTS,
  ROLE_LABELS,
  SELF_EDIT_MESSAGE,
} from '../src/users/userForm.ts'
import { ROLES } from '../src/lib/capabilities.ts'

// The users admin screen's vocabularies and its error contract, against what is
// actually written in the migrations. Same shape and same bargain as
// tests/clientFormDrift.test.ts: a second copy of something the database owns
// has to exist in the browser, and this file is the entire mitigation for it.
//
// What this does NOT prove: that Postgres raises either message. That is
// `npm run verify:privileges` section 10h, which becomes a viewer and an admin
// in turn and compares sqlerrm against these exact strings. 10h needs staging,
// an ACTIVE VIEWER and an ACTIVE ADMIN -- three preconditions this project does
// not yet meet -- so until a second account exists, this file is the only thing
// standing between a reworded `raise exception` and a screen that shows raw
// Postgres text to an account manager.
const MIGRATIONS = 'supabase/migrations'

function migration(suffix: string): string {
  const names = readdirSync(MIGRATIONS).filter((name) => name.endsWith(suffix))
  // Exactly one, or the assertions below could be reading a file nobody meant.
  expect(names, `migrations ending in ${suffix}`).toHaveLength(1)
  return readFileSync(`${MIGRATIONS}/${names[0]}`, 'utf8')
}

describe('the screen agrees with the guard trigger about its two refusals', () => {
  const sql = migration('_profiles_admin_write_path.sql')

  // writeFailureText matches both as SUBSTRINGS of whatever supabase-js hands
  // back, so a substring match here is the same test the runtime performs. The
  // `raise exception` prefix is asserted alongside the text: finding the words
  // somewhere in a comment would be agreement for the wrong reason, and this
  // project has already shipped one check that reported success by finding no
  // data.
  it('raises the self-edit message userForm.ts matches on', () => {
    expect(sql).toContain(`raise exception '${SELF_EDIT_MESSAGE}'`)
  })

  it('raises the not-an-admin message userForm.ts matches on', () => {
    expect(sql).toContain(`raise exception '${NOT_ADMIN_MESSAGE}'`)
  })

  it('gives both raises the 42501 the screen expects, not a bare exception', () => {
    // Two raises, two errcodes. errcode is what makes these refusals rather
    // than crashes, and it is what verify-privileges 10h catches on
    // (`when insufficient_privilege`). A raise that lost its `using errcode`
    // would still carry the right words and would still be translated by
    // writeFailureText, so nothing else here would notice.
    const raises = [...sql.matchAll(/raise exception '[^']+'\s*\n\s*using errcode = '42501';/g)]
    expect(raises).toHaveLength(2)
  })
})

describe('the role vocabulary the screen draws', () => {
  it('offers exactly the roles the permission model knows', () => {
    // ASSIGNABLE_ROLES is derived from ROLES, so this is cheap; it is here so
    // that a future decision to withhold `admin` from the picker has to be made
    // in a diff rather than by an accidental filter.
    expect([...ASSIGNABLE_ROLES].toSorted()).toEqual([...ROLES].toSorted())
  })

  it('has a label for every role and no label for a role that does not exist', () => {
    // clientFormDrift.test.ts makes the same assertion about END_REASON_LABELS,
    // verbatim, and for the same reason: ROLE_LABELS[role] ?? role means a
    // missing entry degrades silently to a raw `account_manager` in a <option>,
    // which nobody notices in review.
    expect(Object.keys(ROLE_LABELS).toSorted()).toEqual([...ROLES].toSorted())
  })

  it('has a hint for every role and no hint for a role that does not exist', () => {
    // ROLE_HINTS is the sentence under the picker that tells an admin what they
    // are about to hand somebody. A missing entry renders as an empty <p>:
    // the control still works and grants the role, with nothing on screen
    // saying what it means.
    expect(Object.keys(ROLE_HINTS).toSorted()).toEqual([...ROLES].toSorted())
  })
})
